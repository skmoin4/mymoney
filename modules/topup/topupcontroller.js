// src/controllers/topupController.js
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../../config/db.js';
import walletService from '../../services/walletService.js';
import logger from '../../utils/logger.js';
import Razorpay from 'razorpay';

let razor = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razor = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
}

/**
 * POST /api/v1/wallet/topup
 * Body: { amount, method? ('razorpay'|'upi'|'bank'), request_ref? }
 * Returns: payment_request id and mock checkout token
 */
export async function createTopup(req, res) {
  try {
    const user = req.user;
    if (!user || !user.id) return res.status(401).json({ error: 'unauthenticated' });
    const { amount, method = 'razorpay', request_ref } = req.body;
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'amount_required' });

    const ref = request_ref || `topup-${uuidv4()}`;
    const pool = getPool();

    // Create payment_request
    const sql = `INSERT INTO payment_requests (request_ref, user_id, amount, currency, method, status, created_at)
                 VALUES (?, ?, ?, ?, ?, 'created', NOW())`;
    const [ins] = await pool.execute(sql, [ref, user.id, Number(amount), 'INR', method]);

    const paymentRequestId = ins.insertId;

    // Razorpay integration
    if (method === 'razorpay') {
      if (!razor) {
        return res.status(500).json({ error: 'razorpay_not_configured' });
      }
      const numericAmount = Number(amount);
      const order = await razor.orders.create({
        amount: Math.round(numericAmount * 100), // paise
        currency: 'INR',
        receipt: ref,
        payment_capture: 1
      });
      // Save order.id to payment_requests.provider_payment_id
      await pool.execute(
        'UPDATE payment_requests SET provider_payment_id = ? WHERE id = ?',
        [order.id, paymentRequestId]
      );

      return res.json({
        payment_request_id: paymentRequestId,
        request_ref: ref,
        checkout: {
          provider: 'razorpay',
          order_id: order.id,
          amount: numericAmount,
          currency: 'INR',
          key_id: process.env.RAZORPAY_KEY_ID
        }
      });
    }

    // For other methods, return a mock checkout token
    const mockCheckout = {
      checkout_id: `ch_${uuidv4()}`,
      provider: method,
      amount
    };

    return res.json({ payment_request_id: paymentRequestId, request_ref: ref, checkout: mockCheckout });
  } catch (err) {
  logger.error('createTopup error', { 
    message: err.message,
    stack: err.stack,
    raw: err
  });
  return res.status(500).json({ error: 'internal_server_error' });
}
}


/**
 * GET /api/v1/wallet/topup/:id/status
 */
export async function topupStatus(req, res) {
  try {
    const user = req.user;
    if (!user || !user.id) return res.status(401).json({ error: 'unauthenticated' });

    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });

    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id, request_ref, amount, currency, method, provider_payment_id, status, proof_url, metadata, created_at, updated_at FROM payment_requests WHERE id = ? AND user_id = ?',
      [id, user.id]
    );

    if (!rows || rows.length === 0) return res.status(404).json({ error: 'not_found' });

    return res.json({ payment_request: rows[0] });
  } catch (err) {
    logger.error('topupStatus error', { err: err.message, params: req.params });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}