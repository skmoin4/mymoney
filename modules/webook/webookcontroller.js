// src/controllers/webhookController.js
import crypto from 'crypto';
import { getPool } from '../../config/db.js';
import walletService from '../../services/walletService.js';
import logger from '../../utils/logger.js';
import { emitPaymentStatus } from '../../socket.js';
import { emitTransactionUpdate, emitAdminEvent } from '../../realTime/socket.js';
import { notificationQueue } from '../../queues/index.js';
import providerFactory from '../../services/providers/providerFactory.js';

function verifySignature(provider, rawBody, signatureHeader) {
  if (provider === 'razorpay') {
    const secret = process.env.PROVIDER_SECRET_razorpay;
    if (!secret) return (process.env.NODE_ENV !== 'production');
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader || ''));
  }
  // fallback to earlier generic HMAC approach
  const envKey = `PROVIDER_SECRET_${provider}`;
  const secret = process.env[envKey];

  if (!secret) {
    const allow = (process.env.NODE_ENV || 'development') !== 'production';
    logger.warn('verifySignature: no secret configured', { provider, allow });
    return allow;
  }
  if (!signatureHeader) return false;

  const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  try {
    const sigBuf = Buffer.from(signatureHeader);
    const hmacBuf = Buffer.from(hmac);
    if (sigBuf.length !== hmacBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, hmacBuf);
  } catch (e) {
    return false;
  }
}

export async function paymentWebhook(req, res) {
  const provider = (req.params.provider || 'mock').toString().toLowerCase();
  const rawBody = req.rawBody || (req.body ? JSON.stringify(req.body) : '');
  const signatureHeader = req.headers['x-provider-signature'] || req.headers['x-signature'] || req.headers['x-razorpay-signature'] || null;

  const pool = getPool();

  // log raw webhook first
  let logId = null;
  const providerPaymentIdFromBody = req.body?.provider_payment_id || req.body?.id || null;
  const requestRefFromBody = req.body?.request_ref || req.body?.orderId || null;

  try {
    const payloadJson = typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body || '');
    const [ins] = await pool.execute(
      `INSERT INTO payment_webhook_logs (provider, provider_payment_id, payment_request_id, signature_header, payload, processed, created_at)
       VALUES (?, ?, NULL, ?, ?, 0, NOW())`,
      [provider, providerPaymentIdFromBody, signatureHeader, payloadJson]
    );
    logId = ins.insertId;
  } catch (err) {
    logger.error('paymentWebhook: failed to insert webhook log', { err: err.message });
    // continue — logging failure not fatal for processing
  }

  // verify signature
// verify signature
let okSig = true;
if (provider !== 'mock') {
  okSig = verifySignature(provider, rawBody, signatureHeader);
}


  // Now begin transaction and lock the matching payment_request
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Try to find by provider_payment_id -> request_ref -> (fallback) by payment_request.id if provided in URL (we use body)
    let payReqRows = [];
    if (providerPaymentIdFromBody) {
      [payReqRows] = await conn.execute('SELECT * FROM payment_requests WHERE provider_payment_id = ? FOR UPDATE', [providerPaymentIdFromBody]);
    }
    if ((!payReqRows || payReqRows.length === 0) && requestRefFromBody) {
      [payReqRows] = await conn.execute('SELECT * FROM payment_requests WHERE request_ref = ? FOR UPDATE', [requestRefFromBody]);
    }

    if (!payReqRows || payReqRows.length === 0) {
      // no matching request -> update log and commit
      if (logId) {
        await conn.execute('UPDATE payment_webhook_logs SET processed = 1, result = ?, error = ? WHERE id = ?', ['no_matching_request', null, logId]);
      }
      await conn.commit();
      logger.warn('paymentWebhook: no matching payment_request', { provider, providerPaymentIdFromBody, requestRefFromBody });
      return res.status(200).json({ ok: true, note: 'no_matching_request' });
    }

    const paymentRequest = payReqRows[0];

    // Idempotency: if already success, do nothing (but still update log and emit)
    if (paymentRequest.status === 'success') {
      if (logId) {
        await conn.execute('UPDATE payment_webhook_logs SET processed = 1, result = ? WHERE id = ?', ['already_processed', logId]);
      }
      // Emit event to user; safe
      try { emitPaymentStatus(paymentRequest.id, paymentRequest.user_id, { status: 'success', amount: paymentRequest.amount }); } catch (e) {}
      await conn.commit();
      logger.info('paymentWebhook: already processed', { paymentRequestId: paymentRequest.id });
      return res.status(200).json({ ok: true, note: 'already_processed' });
    }

    // Deduce status from body
    const statusRaw = (req.body?.status || '').toString().toLowerCase();
    const isSuccess = ['paid','success','completed'].includes(statusRaw) || req.body?.paid === true;
    const isFailed = ['failed','cancelled','error'].includes(statusRaw);

    if (isSuccess) {
      // Mark payment_request as success first (prevents another concurrent worker from also crediting)
      await conn.execute('UPDATE payment_requests SET status = ?, provider_payment_id = ?, updated_at = NOW() WHERE id = ?', ['success', providerPaymentIdFromBody || paymentRequest.provider_payment_id, paymentRequest.id]);

      // commit the status update only after credit? We will call credit and then commit; but status update is already in same txn — good.
      try {
        // call credit (this will use separate getConnection inside walletService which will do its own transaction)
        await walletService.creditWallet(paymentRequest.user_id, Number(paymentRequest.amount), 'topup', providerPaymentIdFromBody || paymentRequest.provider_payment_id, `topup by ${provider}`, req.body);
      } catch (creditErr) {
        // credit failed — rollback and update webhook log with error
        await conn.rollback();
        logger.error('paymentWebhook: creditWallet failed', { err: creditErr.message, paymentRequestId: paymentRequest.id });
        if (logId) {
          await pool.execute('UPDATE payment_webhook_logs SET processed = 1, result = ?, error = ? WHERE id = ?', ['credit_failed', creditErr.message, logId]);
        }
        return res.status(500).json({ ok: false, error: 'credit_failed' });
      }

      // If credit success, mark webhook log and commit
      if (logId) {
        await conn.execute('UPDATE payment_webhook_logs SET processed = 1, result = ?, error = NULL, payment_request_id = ? WHERE id = ?', ['success', paymentRequest.id, logId]);
      }

      await conn.commit();

      // emit socket event
      try { emitPaymentStatus(paymentRequest.id, paymentRequest.user_id, { status: 'success', provider_payment_id: providerPaymentIdFromBody || paymentRequest.provider_payment_id, amount: paymentRequest.amount }); } catch (e) {}

      try {
        emitTransactionUpdate({
          user_id: paymentRequest.user_id,
          txn_ref: paymentRequest.request_ref,
          status: 'success',
          amount: paymentRequest.amount,
          updated_at: new Date().toISOString()
        });
        await notificationQueue.add('txn_notification', {
          user_id: paymentRequest.user_id,
          title: 'Topup successful',
          body: `₹${paymentRequest.amount} credited to your wallet`,
          data: { txn_ref: paymentRequest.request_ref, status: 'success' }
        });
      } catch (e) {
        logger.warn('notification emit failed', { err: e.message });
      }

      logger.info('paymentWebhook: processed success', { paymentRequestId: paymentRequest.id });
      return res.status(200).json({ ok: true });
    } else if (isFailed) {
      // mark failed
      await conn.execute('UPDATE payment_requests SET status = ?, provider_payment_id = ?, updated_at = NOW() WHERE id = ?', ['failed', providerPaymentIdFromBody || paymentRequest.provider_payment_id, paymentRequest.id]);
      if (logId) {
        await conn.execute('UPDATE payment_webhook_logs SET processed = 1, result = ?, payment_request_id = ? WHERE id = ?', ['failed', paymentRequest.id, logId]);
      }
      await conn.commit();
      try { emitPaymentStatus(paymentRequest.id, paymentRequest.user_id, { status: 'failed', provider_payment_id: providerPaymentIdFromBody || paymentRequest.provider_payment_id, amount: paymentRequest.amount }); } catch (e) {}

      try {
        emitTransactionUpdate({
          user_id: paymentRequest.user_id,
          txn_ref: paymentRequest.request_ref,
          status: 'failed',
          amount: paymentRequest.amount,
          updated_at: new Date().toISOString()
        });
        await notificationQueue.add('txn_notification', {
          user_id: paymentRequest.user_id,
          title: 'Topup failed',
          body: 'Your topup failed',
          data: { txn_ref: paymentRequest.request_ref, status: 'failed' }
        });
      } catch (e) {
        logger.warn('notification emit failed', { err: e.message });
      }

      logger.info('paymentWebhook: processed failed', { paymentRequestId: paymentRequest.id });
      return res.status(200).json({ ok: true });
    } else {
      // pending/unknown
      await conn.execute('UPDATE payment_requests SET status = ?, provider_payment_id = ?, updated_at = NOW() WHERE id = ?', ['pending', providerPaymentIdFromBody || paymentRequest.provider_payment_id, paymentRequest.id]);
      if (logId) {
        await conn.execute('UPDATE payment_webhook_logs SET processed = 1, result = ?, payment_request_id = ? WHERE id = ?', ['pending', paymentRequest.id, logId]);
      }
      await conn.commit();
      try { emitPaymentStatus(paymentRequest.id, paymentRequest.user_id, { status: 'pending', provider_payment_id: providerPaymentIdFromBody || paymentRequest.provider_payment_id, amount: paymentRequest.amount }); } catch (e) {}

      try {
        emitTransactionUpdate({
          user_id: paymentRequest.user_id,
          txn_ref: paymentRequest.request_ref,
          status: 'pending',
          amount: paymentRequest.amount,
          updated_at: new Date().toISOString()
        });
        await notificationQueue.add('txn_notification', {
          user_id: paymentRequest.user_id,
          title: 'Topup pending',
          body: 'Your topup is pending',
          data: { txn_ref: paymentRequest.request_ref, status: 'pending' }
        });
      } catch (e) {
        logger.warn('notification emit failed', { err: e.message });
      }

      logger.info('paymentWebhook: processed pending', { paymentRequestId: paymentRequest.id });
      return res.status(200).json({ ok: true });
    }
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    logger.error('paymentWebhook: fatal', { err: err.stack || err.message });
    if (logId) {
      await pool.execute('UPDATE payment_webhook_logs SET processed = 1, result = ?, error = ? WHERE id = ?', ['error', err.message, logId]);
    }
    return res.status(500).json({ ok: false, error: 'internal_server_error' });
  } finally {
    try { conn.release(); } catch (_) {}
  }
}

export async function providerWebhook(req, res) {
  const providerKey = (req.params.provider_key || 'mock').toString().toLowerCase();
  const rawBody = req.rawBody || (req.body ? JSON.stringify(req.body) : '');
  const headers = req.headers || {};

  const pool = getPool();
  const provider = providerFactory.get(providerKey);

  // 1) insert webhook log (raw) - moved to top to initialize logId
  let logId = null;
  try {
    const payloadJson = typeof req.body === 'object' ? JSON.stringify(req.body) : String(req.body || '');
    const [ins] = await pool.execute(
      `INSERT INTO provider_webhook_logs (provider, provider_txn_id, request_ref, payload, headers, processed, created_at)
       VALUES (?, NULL, NULL, ?, ?, 0, NOW())`,
      [providerKey, payloadJson, JSON.stringify(headers)]
    );
    logId = ins.insertId;
  } catch (err) {
    logger.warn('providerWebhook: failed to insert webhook log', { err: err.message });
  }

  // 2) verify signature (provider-specific)
  try {
    const ok = provider.verifyWebhook(rawBody, headers);
    if (!ok) {
      logger.warn('providerWebhook: invalid signature', { provider: providerKey });
      if (logId) await pool.execute('UPDATE provider_webhook_logs SET processed = 1, result = ?, error_text = ?, processed_at = NOW() WHERE id = ?', ['invalid_signature', 'signature_mismatch', logId]);
      return res.status(400).json({ ok: false, error: 'invalid_signature' });
    }
  } catch (err) {
    logger.error('providerWebhook: verifyWebhook error', { err: err.message });
    if (logId) await pool.execute('UPDATE provider_webhook_logs SET processed = 1, result = ?, error_text = ?, processed_at = NOW() WHERE id = ?', ['verify_error', err.message, logId]);
    return res.status(400).json({ ok: false, error: 'verify_error' });
  }

  // 3) parse normalized payload
  let parsed;
  try {
    parsed = provider.parseWebhook(rawBody, headers);
    // parsed => { provider_txn_id, request_ref, status, raw }
  } catch (err) {
    logger.error('providerWebhook: parseWebhook failed', { err: err.message });
    if (logId) await pool.execute('UPDATE provider_webhook_logs SET processed = 1, result = ?, error_text = ?, processed_at = NOW() WHERE id = ?', ['parse_error', err.message, logId]);
    return res.status(400).json({ ok: false, error: 'parse_error' });
  }

  const { provider_txn_id, request_ref, status } = parsed;
  // status normalized to 'success'|'failed'|'pending' by provider.parseWebhook

  // Find and update transaction idempotently
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Find transaction by provider_txn_id or request_ref
    let txRows = [];
    if (provider_txn_id) {
      [txRows] = await conn.execute('SELECT * FROM transactions WHERE provider_txn_id = ? FOR UPDATE', [provider_txn_id]);
    }
    if ((!txRows || txRows.length === 0) && request_ref) {
      [txRows] = await conn.execute('SELECT * FROM transactions WHERE txn_ref = ? FOR UPDATE', [request_ref]);
    }

    if (!txRows || txRows.length === 0) {
      if (logId) {
        await conn.execute('UPDATE provider_webhook_logs SET processed = 1, result = ? WHERE id = ?', ['no_matching_transaction', logId]);
      }
      await conn.commit();
      logger.warn('providerWebhook: no matching transaction', { providerKey, provider_txn_id, request_ref });
      return res.status(200).json({ ok: true, note: 'no_matching_transaction' });
    }

    const transaction = txRows[0];

    // Idempotency: if already finalized, do nothing
    if (['success', 'failed', 'reversed'].includes(transaction.status)) {
      if (logId) {
        await conn.execute('UPDATE provider_webhook_logs SET processed = 1, result = ?, transaction_id = ? WHERE id = ?', ['already_finalized', transaction.id, logId]);
      }
      await conn.commit();
      logger.info('providerWebhook: transaction already finalized', { transactionId: transaction.id, status: transaction.status });
      return res.status(200).json({ ok: true, note: 'already_finalized' });
    }

    // Only update if status is 'pending' or 'processing'
    if (!['pending', 'processing'].includes(transaction.status)) {
      if (logId) {
        await conn.execute('UPDATE provider_webhook_logs SET processed = 1, result = ? WHERE id = ?', ['invalid_status', logId]);
      }
      await conn.commit();
      logger.warn('providerWebhook: transaction not in pending/processing', { transactionId: transaction.id, status: transaction.status });
      return res.status(200).json({ ok: true, note: 'invalid_status' });
    }

    // Now update based on webhook status
    if (status === 'success') {
      // 1) mark transaction success and attach provider_txn_id + response_payload
      await conn.execute(
        'UPDATE transactions SET status = ?, provider_txn_id = ?, response_payload = JSON_MERGE_PATCH(COALESCE(response_payload,"{}"), ?), updated_at = NOW() WHERE id = ?',
        ['success', provider_txn_id || transaction.provider_txn_id, JSON.stringify(parsed.raw || parsed), transaction.id]
      );

      // commit this transaction BEFORE calling walletService? we will commit after wallet finalize to keep atomicity
      // But we need to finalize wallet now. We'll call walletService.finalizeDebit outside the DB lock to avoid long locks.
      await conn.commit();

      // finalize debit: this should be atomic and will insert ledger
      try {
        await walletService.finalizeDebit(transaction.user_id, Number(transaction.amount), {
          refType: 'recharge',
          refId: transaction.txn_ref,
          note: `finalize via webhook ${providerKey}`
        });
      } catch (err) {
        // if finalize fails, log and attempt to mark txn failed and notify admin
        logger.error('providerWebhook: finalizeDebit failed', { err: err.message, txnId: transaction.id });
        // best-effort: update tx as failed and record error
        await pool.execute('UPDATE transactions SET status = ?, response_payload = JSON_MERGE_PATCH(COALESCE(response_payload,"{}"), ?), updated_at = NOW() WHERE id = ?', ['failed', JSON.stringify({ finalize_error: err.message }), transaction.id]);
        if (logId) await pool.execute('UPDATE provider_webhook_logs SET processed = 1, result = ?, error_text = ?, processed_at = NOW() WHERE id = ?', ['finalize_failed', err.message, logId]);
        // emit notify admin / user
        emitTransactionUpdate({
          user_id: transaction.user_id,
          txn_ref: transaction.txn_ref,
          status: 'failed',
          amount: transaction.amount,
          updated_at: new Date().toISOString()
        });
        await notificationQueue.add('txn_notification', { user_id: transaction.user_id, title: 'Recharge failed', body: 'We failed to finalize recharge; admin will investigate', data: { txn_ref: transaction.txn_ref } });
        return res.status(500).json({ ok: false, error: 'finalize_failed' });
      }

      // success: mark webhook log processed & notify
      if (logId) await pool.execute('UPDATE provider_webhook_logs SET processed = 1, result = ?, processed_at = NOW() WHERE id = ?', ['success', logId]);

      emitTransactionUpdate({
        user_id: transaction.user_id,
        txn_ref: transaction.txn_ref,
        status: 'success',
        amount: transaction.amount,
        provider_txn_id: provider_txn_id,
        updated_at: new Date().toISOString()
      });
      await notificationQueue.add('txn_notification', { user_id: transaction.user_id, title: 'Recharge successful', body: `₹${transaction.amount} credited`, data: { txn_ref: transaction.txn_ref, provider_txn_id } });

      // emit admin event for real-time dashboard updates
      emitAdminEvent('transaction_updated', { txn_id: transaction.id, status: 'success', provider: providerKey });

      return res.status(200).json({ ok: true });
    } else if (status === 'failed') {
      // mark transaction failed
      await conn.execute('UPDATE transactions SET status = ?, response_payload = JSON_MERGE_PATCH(COALESCE(response_payload,"{}"), ?), updated_at = NOW() WHERE id = ?', ['failed', JSON.stringify(parsed.raw || parsed), transaction.id]);
      await conn.commit();

      // refund reserved to user
      try {
        await walletService.refundReserved(transaction.user_id, Number(transaction.amount), {
          refType: 'recharge_refund',
          refId: transaction.txn_ref,
          note: `refund via webhook ${providerKey}`
        });
      } catch (err) {
        logger.error('providerWebhook: refundReserved failed', { err: err.message, txnId: transaction.id });
        // log and continue
      }

      if (logId) await pool.execute('UPDATE provider_webhook_logs SET processed = 1, result = ?, processed_at = NOW() WHERE id = ?', ['failed', logId]);

      emitTransactionUpdate({
        user_id: transaction.user_id,
        txn_ref: transaction.txn_ref,
        status: 'failed',
        amount: transaction.amount,
        updated_at: new Date().toISOString()
      });
      await notificationQueue.add('txn_notification', { user_id: transaction.user_id, title: 'Recharge failed', body: `Recharge of ₹${transaction.amount} failed`, data: { txn_ref: transaction.txn_ref } });

      // emit admin event for real-time dashboard updates
      emitAdminEvent('transaction_updated', { txn_id: transaction.id, status: 'failed', provider: providerKey });

      return res.status(200).json({ ok: true });
    } else {
      // pending or other states — mark processing/pending and leave for later
      await conn.execute('UPDATE transactions SET status = ?, provider_txn_id = ?, response_payload = JSON_MERGE_PATCH(COALESCE(response_payload,"{}"), ?), updated_at = NOW() WHERE id = ?',
        ['processing', provider_txn_id || transaction.provider_txn_id, JSON.stringify(parsed.raw || parsed), transaction.id]);
      await conn.commit();

      if (logId) await pool.execute('UPDATE provider_webhook_logs SET processed = 1, result = ?, processed_at = NOW() WHERE id = ?', ['pending', logId]);

      emitTransactionUpdate({
        user_id: transaction.user_id,
        txn_ref: transaction.txn_ref,
        status: 'processing',
        amount: transaction.amount,
        updated_at: new Date().toISOString()
      });

      // emit admin event for real-time dashboard updates
      emitAdminEvent('transaction_updated', { txn_id: transaction.id, status: 'processing', provider: providerKey });

      return res.status(200).json({ ok: true });
    }
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    logger.error('providerWebhook: fatal error', { err: err.stack || err.message });
    if (logId) await pool.execute('UPDATE provider_webhook_logs SET processed = 1, result = ?, error_text = ?, processed_at = NOW() WHERE id = ?', ['error', err.message, logId]);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  } finally {
    try { conn.release(); } catch (_) {}
  }
}

