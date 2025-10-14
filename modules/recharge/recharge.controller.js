// src/controllers/rechargeController.js
import { getPool } from '../../config/db.js';
import logger from '../../utils/logger.js';
import walletService from '../../services/walletService.js';
import { rechargeQueue } from '../../queues/index.js'; // queue producer

/**
 * POST /api/v1/recharge/initiate
 * Body: {
 *   txn_ref, user_id(optional: from token), mobile, operator_code, amount, service_charge?
 * }
 */
export async function initiateRecharge(req, res) {
  const pool = getPool();
  const user = req.user;
  try {
    const {
      txn_ref,
      mobile,
      operator_code,
      amount,
      service_charge = 0
    } = req.body;

    // validate
    if (!txn_ref) return res.status(400).json({ error: 'txn_ref_required' });
    const numericAmount = Number(amount);
    if (!numericAmount || numericAmount <= 0) return res.status(400).json({ error: 'invalid_amount' });

    const userId = user?.id || Number(req.body.user_id);
    if (!userId) return res.status(400).json({ error: 'user_id_required' });

    // Idempotency: check transactions table for existing txn_ref
    const [existingRows] = await pool.execute('SELECT id, status FROM transactions WHERE txn_ref = ? LIMIT 1', [txn_ref]);
    if (existingRows && existingRows.length > 0) {
      const existing = existingRows[0];
      return res.json({ ok: true, note: 'already_exists', transaction_id: existing.id, status: existing.status });
    }

    // Reserve amount (amount + service_charge if you plan to deduct charges)
    const totalReserve = Number(numericAmount) + Number(service_charge || 0);

    // Try to reserve using walletService (throws if insufficient)
    const reserveMeta = {
      refType: 'recharge_reserve',
      refId: txn_ref,
      note: `reserve for recharge ${mobile}`
    };
    await walletService.reserveAmount(userId, totalReserve, reserveMeta);

    // create transaction record
    const requestPayload = {
      mobile,
      operator_code,
      amount: numericAmount,
      service_charge: Number(service_charge || 0)
    };
    const sql = `INSERT INTO transactions (txn_ref, user_id, type, operator_code, mobile, amount, service_charge, status, request_payload, created_at)
                 VALUES (?, ?, 'recharge', ?, ?, ?, ?, 'pending', ?, NOW())`;
    const [ins] = await pool.execute(sql, [txn_ref, userId, operator_code || null, mobile || null, numericAmount, Number(service_charge || 0), JSON.stringify(requestPayload)]);
    const transactionId = ins.insertId;

    // enqueue job with retry configuration
    await rechargeQueue.add('recharge', {
      transaction_id: transactionId,
      txn_ref,
      user_id: userId,
      mobile,
      operator_code,
      amount: numericAmount,
      service_charge: Number(service_charge || 0),
      provider: 'mock'
    }, {
      attempts: 5,                          // max retries
      backoff: { type: 'exponential', delay: 2000 }, // exponential backoff starting at 2s
      removeOnComplete: true,
      removeOnFail: false,                  // keep failed jobs for inspection
    });

    // return pending success (wallet ledger should already have reserve entry)
    return res.json({ ok: true, transaction_id: transactionId, txn_ref, status: 'pending' });
  } catch (err) {
    logger.error('initiateRecharge error', { err: err.stack || err.message, body: req.body });
    // If walletService.reserveAmount threw reserved_insufficient, send 409
    if (err && (err.message === 'insufficient_funds' || err.message === 'reserved_insufficient')) {
      return res.status(409).json({ error: 'insufficient_funds' });
    }
    return res.status(500).json({ error: 'internal_server_error', detail: err.message });
  }
}
