// src/controllers/adminActionsController.js
import { getPool } from '../../config/db.js';
import walletService from '../../services/walletService.js';
import logger from '../../utils/logger.js';
import { emitTransactionUpdate, emitAdminEvent } from '../../realTime/socket.js';
import { notificationQueue } from '../../queues/index.js';

/**
 * POST /api/admin/transactions/:id/refund
 * Body: { amount? (optional), reason? }
 */
export async function adminRefund(req, res) {
  const pool = getPool();
  const admin = req.user;
  const txnId = Number(req.params.id);
  const { amount: overrideAmount, reason } = req.body || {};

  if (!txnId) return res.status(400).json({ error: 'invalid_id' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [txRows] = await conn.execute('SELECT * FROM transactions WHERE id = ? FOR UPDATE', [txnId]);
    if (!txRows || txRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'transaction_not_found' });
    }
    const tx = txRows[0];

    if (['reversed','refunded','failed'].includes(tx.status) && Number(tx.refunded_amount || 0) >= Number(tx.amount || 0)) {
      await conn.rollback();
      return res.status(409).json({ error: 'already_refunded_or_final' });
    }

    const refundAmount = (overrideAmount && Number(overrideAmount) > 0) ? Number(overrideAmount) : Number(tx.amount || 0);

    const adminActionDetails = {
      txn_ref: tx.txn_ref,
      original_amount: tx.amount,
      refund_amount: refundAmount,
      reason: reason || 'admin_refund'
    };

    const [ins] = await conn.execute(
      `INSERT INTO admin_actions (admin_user_id, action_type, target_type, target_id, details, created_at)
       VALUES (?, 'refund', 'transaction', ?, ?, NOW())`,
      [admin.id, txnId, JSON.stringify(adminActionDetails)]
    );
    const actionId = ins.insertId;

    const newStatus = 'reversed';
    await conn.execute(
      `UPDATE transactions SET status = ?, refunded_amount = COALESCE(refunded_amount,0) + ?, updated_at = NOW() WHERE id = ?`,
      [newStatus, refundAmount, txnId]
    );

    await conn.commit();

    try {
      await walletService.creditWallet(tx.user_id, refundAmount, 'admin_refund', `admin_refund_${actionId}`, reason || 'admin_refund');
      emitTransactionUpdate({
        user_id: tx.user_id,
        txn_ref: tx.txn_ref,
        status: 'refunded',
        amount: refundAmount,
        updated_at: new Date().toISOString()
      });
      await notificationQueue.add('txn_notification', {
        user_id: tx.user_id,
        title: 'Refund processed',
        body: `₹${refundAmount} refunded to your wallet`,
        data: { txn_ref: tx.txn_ref, action: 'admin_refund' }
      });

      // emit admin event for real-time dashboard updates
      emitAdminEvent('transaction_refunded', { txn_id: txnId, user_id: tx.user_id, amount: refundAmount, admin_id: admin.id });
      await notificationQueue.add('admin_notification', { type: 'transaction_refunded', payload:{ txn_id: txnId, user_id: tx.user_id, amount: refundAmount, admin_id: admin.id } });
    } catch (creditErr) {
      logger.error('adminRefund: creditWallet failed', { err: creditErr.stack || creditErr.message, admin, txnId, refundAmount });
      await pool.execute('INSERT INTO admin_actions (admin_user_id, action_type, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [admin.id, 'refund_failed', 'transaction', txnId, JSON.stringify({ reason: creditErr.message })]);
      return res.status(500).json({ error: 'refund_credit_failed', detail: creditErr.message });
    }

    return res.json({ ok: true, action_id: actionId, refunded_amount: refundAmount });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    logger.error('adminRefund error', { err: err.stack || err.message, params: req.params, body: req.body });
    return res.status(500).json({ error: 'internal_server_error', detail: err.message });
  } finally {
    try { conn.release(); } catch (_) {}
  }
}

/**
 * POST /api/admin/transactions/:id/force-status
 * Body: { status: 'success'|'failed', note? }
 */
export async function adminForceStatus(req, res) {
  const pool = getPool();
  const admin = req.user;
  const txnId = Number(req.params.id);
  const { status, note } = req.body || {};

  if (!txnId) return res.status(400).json({ error: 'invalid_id' });
  if (!status || !['success','failed'].includes(status)) return res.status(400).json({ error: 'invalid_status' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [txRows] = await conn.execute('SELECT * FROM transactions WHERE id = ? FOR UPDATE', [txnId]);
    if (!txRows || txRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'not_found' });
    }
    const tx = txRows[0];

    const details = { action: 'force_status', status, note, txn_ref: tx.txn_ref };
    await conn.execute('INSERT INTO admin_actions (admin_user_id, action_type, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [admin.id, `force_status_${status}`, 'transaction', txnId, JSON.stringify(details)]);

    await conn.execute('UPDATE transactions SET status = ?, updated_at = NOW() WHERE id = ?', [status === 'success' ? 'success' : 'failed', txnId]);

    await conn.commit();

    try {
      if (status === 'success') {
        await walletService.finalizeDebit(tx.user_id, Number(tx.amount), {
          refType: 'admin_force',
          refId: `force_${txnId}`,
          note: note || 'admin_force_success'
        });

        emitTransactionUpdate({
          user_id: tx.user_id,
          txn_ref: tx.txn_ref,
          status: 'success',
          amount: tx.amount,
          updated_at: new Date().toISOString()
        });
        await notificationQueue.add('txn_notification', { user_id: tx.user_id, title: 'Transaction marked success', body: `Transaction ${tx.txn_ref} marked success by admin`, data: { txn_ref: tx.txn_ref } });

        // emit admin event for real-time dashboard updates
        emitAdminEvent('transaction_status_forced', { txn_id: txnId, status: 'success', admin_id: admin.id });
        await notificationQueue.add('admin_notification', { type: 'transaction_status_forced', payload:{ txn_id: txnId, status: 'success', admin_id: admin.id } });
      } else {
        await walletService.refundReserved(tx.user_id, Number(tx.amount), {
          refType: 'admin_force',
          refId: `force_${txnId}`,
          note: note || 'admin_force_failed'
        });

        emitTransactionUpdate({
          user_id: tx.user_id,
          txn_ref: tx.txn_ref,
          status: 'failed',
          amount: tx.amount,
          updated_at: new Date().toISOString()
        });
        await notificationQueue.add('txn_notification', { user_id: tx.user_id, title: 'Transaction failed', body: `Transaction ${tx.txn_ref} marked failed by admin`, data: { txn_ref: tx.txn_ref } });

        // emit admin event for real-time dashboard updates
        emitAdminEvent('transaction_status_forced', { txn_id: txnId, status: 'failed', admin_id: admin.id });
        await notificationQueue.add('admin_notification', { type: 'transaction_status_forced', payload:{ txn_id: txnId, status: 'failed', admin_id: admin.id } });
      }
    } catch (walletErr) {
      logger.error('adminForceStatus wallet op failed', { err: walletErr.stack || walletErr.message, txnId, status });
      return res.status(500).json({ error: 'wallet_operation_failed', detail: walletErr.message });
    }

    const [updatedRows] = await pool.execute('SELECT * FROM transactions WHERE id = ? LIMIT 1', [txnId]);
    return res.json({ ok: true, transaction: updatedRows[0] });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    logger.error('adminForceStatus error', { err: err.stack || err.message, params: req.params, body: req.body });
    return res.status(500).json({ error: 'internal_server_error', detail: err.message });
  } finally {
    try { conn.release(); } catch (_) {}
  }
}