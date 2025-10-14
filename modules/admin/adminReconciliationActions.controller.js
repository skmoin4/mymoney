// src/controllers/adminReconciliationActionsController.js
import { getPool } from '../../config/db.js';
import logger from '../../utils/logger.js';
import walletService from '../../services/walletService.js';
import providerService from '../../services/providerService.js';

/**
 * GET /api/v1/admin/reconciliation/:id
 */
export async function getReconciliationItem(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });

    const pool = getPool();
    const [rows] = await pool.execute('SELECT * FROM reconciliation_reports WHERE id = ? LIMIT 1', [id]);
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'not_found' });
    return res.json({ ok: true, item: rows[0] });
  } catch (err) {
    logger.error('getReconciliationItem error', { err: err.stack || err.message, id: req.params.id });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}

/**
 * POST /api/v1/admin/reconciliation/:id/resolve
 * Body: { resolution_type: 'ignored'|'manual_adjustment'|'auto_reconciled', note }
 * Just mark resolved (no money movement)
 */
export async function resolveReconciliationItem(req, res) {
  const adminUser = req.user;
  try {
    const id = Number(req.params.id);
    const { resolution_type = 'ignored', note = '' } = req.body || {};
    if (!id) return res.status(400).json({ error: 'invalid_id' });

    const pool = getPool();
    // idempotency: if already resolved, return current row
    const [rows] = await pool.execute('SELECT resolved_at FROM reconciliation_reports WHERE id = ? LIMIT 1', [id]);
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'not_found' });

    if (rows[0].resolved_at) {
      return res.json({ ok: true, message: 'already_resolved' });
    }

    await pool.execute(
      'UPDATE reconciliation_reports SET resolved_at = NOW(), resolved_by = ?, resolution_note = ?, resolution_type = ? WHERE id = ?',
      [adminUser.id, note, resolution_type, id]
    );

    // audit log
    await pool.execute('INSERT INTO admin_actions (admin_user_id, action_type, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [adminUser.id, 'resolve_reconciliation', 'reconciliation_reports', id, JSON.stringify({ resolution_type, note })]);

    return res.json({ ok: true });
  } catch (err) {
    logger.error('resolveReconciliationItem error', { err: err.stack || err.message, id: req.params.id, admin: req.user?.id });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}

/**
 * POST /api/v1/admin/reconciliation/:id/adjust
 * Body: {
 *   target_type: 'user_wallet'|'provider_account',
 *   target_id: <user_id or provider_accounts.id>,
 *   change_type: 'credit'|'debit',
 *   amount: number,
 *   reason: string,
 *   mark_resolved: boolean (default true)
 * }
 *
 * This endpoint does:
 *  - Create manual_adjustments row
 *  - Perform walletService.creditWallet / debit logic (atomic where possible)
 *  - Update reconciliation_reports resolved_at/resolved_by/resolution_note
 *  - Write admin_actions audit
 */
export async function adjustReconciliationItem(req, res) {
  const adminUser = req.user;
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    const {
      target_type,
      target_id,
      change_type,
      amount,
      reason = '',
      mark_resolved = true
    } = body;

    if (!id || !target_type || !target_id || !change_type || !amount) {
      return res.status(400).json({ error: 'missing_parameters' });
    }

    if (!['user_wallet','provider_account'].includes(target_type)) return res.status(400).json({ error: 'invalid_target_type' });
    if (!['credit','debit'].includes(change_type)) return res.status(400).json({ error: 'invalid_change_type' });

    const pool = getPool();
    // Fetch reconciliation item
    const [rrows] = await pool.execute('SELECT * FROM reconciliation_reports WHERE id = ? LIMIT 1', [id]);
    if (!rrows || rrows.length === 0) return res.status(404).json({ error: 'not_found' });

    // Idempotency / safety: avoid double adjustments for same reconciliation_report_id.
    // We'll insert manual_adjustments row and proceed; use a DB transaction.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // create adjustment record
      const [ins] = await conn.execute(
        `INSERT INTO manual_adjustments (reconciliation_report_id, admin_user_id, target_type, target_id, change_type, amount, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [id, adminUser.id, target_type, target_id, change_type, Number(amount), reason]
      );
      const adjustmentId = ins.insertId;

      // perform actual money move
      if (target_type === 'user_wallet') {
        const userId = Number(target_id);
        if (change_type === 'credit') {
          // credit user's wallet via walletService
          await walletService.creditWalletAdmin(userId, Number(amount), `recon-${id}`, `manual adjustment: ${reason}`, conn);
        } else {
          // debit user's wallet
          await walletService.debitWalletAdmin(userId, Number(amount), `recon-${id}`, `manual adjustment: ${reason}`, conn);
        }
      } else {
        // provider_account adjustment
        const providerAccountId = Number(target_id);
        if (change_type === 'credit') {
          await providerService.creditProviderAccount(providerAccountId, Number(amount), reason, `recon-${id}`, conn);
        } else {
          await providerService.debitProviderAccount(providerAccountId, Number(amount), reason, `recon-${id}`, conn);
        }
      }

      // mark reconciliation resolved if requested
      if (mark_resolved) {
        await conn.execute('UPDATE reconciliation_reports SET resolved_at = NOW(), resolved_by = ?, resolution_note = ?, resolution_type = ? WHERE id = ?',
          [adminUser.id, `manual_adjustment:${adjustmentId} ${reason}`, 'manual_adjustment', id]);
      }

      // write admin action/audit
      await conn.execute('INSERT INTO admin_actions (admin_user_id, action_type, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
        [adminUser.id, 'manual_adjustment', 'reconciliation_reports', id, JSON.stringify({ adjustmentId, target_type, target_id, change_type, amount, reason })]);

      await conn.commit();
      conn.release();

      return res.json({ ok: true, adjustment_id: adjustmentId });
    } catch (txErr) {
      await conn.rollback();
      conn.release();
      logger.error('adjustReconciliationItem tx error', { err: txErr.stack || txErr.message, admin: adminUser.id });
      return res.status(500).json({ error: 'internal_server_error', detail: txErr.message });
    }
  } catch (err) {
    logger.error('adjustReconciliationItem error', { err: err.stack || err.message, admin: req.user?.id });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}