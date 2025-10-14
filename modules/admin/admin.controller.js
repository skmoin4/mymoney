// src/controllers/adminTransactionsController.js
import { getPool } from '../../config/db.js';
import { getPlatformBalance, getPlatformTransactions } from '../../services/superAdminWalletService.js';
import logger from '../../utils/logger.js';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parseInteger(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * GET /api/v1/admin/transactions
 * Query params:
 *  - status
 *  - page (1-based)
 *  - page_size
 *  - user_id
 *  - txn_ref
 *  - mobile
 *  - date_from (YYYY-MM-DD)
 *  - date_to   (YYYY-MM-DD)
 */
// debug-enabled listAdminTransactions
export async function listAdminTransactions(req, res) {
  try {
    const pool = getPool();
    const q = req.query || {};

    const page = parseInteger(q.page, 1);
    const pageSize = Math.min(parseInteger(q.page_size, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const offset = (page - 1) * pageSize;

    const filters = [];
    const params = [];

    if (q.status) {
      filters.push('t.status = ?');
      params.push(q.status);
    }
    if (q.user_id) {
      filters.push('t.user_id = ?');
      params.push(Number(q.user_id));
    }
    if (q.txn_ref) {
      filters.push('t.txn_ref = ?');
      params.push(q.txn_ref);
    }
    if (q.mobile) {
      filters.push('t.mobile LIKE ?');
      params.push(`%${q.mobile}%`);
    }
    if (q.date_from) {
      filters.push('t.created_at >= ?');
      params.push(q.date_from + ' 00:00:00');
    }
    if (q.date_to) {
      filters.push('t.created_at <= ?');
      params.push(q.date_to + ' 23:59:59');
    }

    const whereClause = filters.length ? ('WHERE ' + filters.join(' AND ')) : '';

    const countSql = `SELECT COUNT(*) as total FROM transactions t ${whereClause}`;
    const [countRows] = await pool.execute(countSql, params);
    const total = (Array.isArray(countRows) && countRows.length > 0) ? Number(countRows[0].total || 0) : 0;

    const listSql = `
      SELECT t.id, t.txn_ref, t.user_id, t.mobile, t.operator_code,
             t.amount, t.service_charge, t.status, t.provider_txn_id,
             t.created_at, t.updated_at
      FROM transactions t
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `.trim();
    const [rows] = await pool.execute(listSql, params);

    return res.json({
      ok: true,
      meta: { total, page, page_size: pageSize, pages: Math.ceil(total / pageSize) },
      data: rows || []
    });
  } catch (err) {
    logger.error('listAdminTransactions error', { err: err && err.stack ? err.stack : err, query: req.query });
    return res.status(500).json({ error: 'internal_server_error', detail: process.env.NODE_ENV === 'development' ? (err && err.message) : undefined });
  }
}

/**
 * GET /api/v1/admin/transactions/:id
 * Return transaction details and recent webhook logs for that txn
 */
export async function getAdminTransaction(req, res) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });

    const [txRows] = await pool.execute('SELECT * FROM transactions WHERE id = ? LIMIT 1', [id]);
    if (!txRows || txRows.length === 0) return res.status(404).json({ error: 'not_found' });
    const tx = txRows[0];

    // fetch recent webhook logs matching txn_ref or provider_txn_id
    let webhookRows = [];
    try {
      const [rows] = await pool.execute(
        `SELECT id, provider, provider_txn_id, request_ref, payload, result, error_text, created_at, processed_at
         FROM provider_webhook_logs
         WHERE request_ref = ? OR provider_txn_id = ?
         ORDER BY created_at DESC
         LIMIT 20`,
        [tx.txn_ref || '', tx.provider_txn_id || '']
      );
      webhookRows = rows || [];
    } catch (webhookErr) {
      // Table might not exist or have different schema
      logger.warn('provider_webhook_logs query failed', {
        err: webhookErr.message,
        txn_ref: tx.txn_ref,
        provider_txn_id: tx.provider_txn_id
      });
    }

    return res.json({ ok: true, transaction: tx, webhooks: webhookRows });
  } catch (err) {
    logger.error('getAdminTransaction error', { err: err && err.stack ? err.stack : err, id: req.params.id });
    return res.status(500).json({ error: 'internal_server_error', detail: process.env.NODE_ENV === 'development' ? (err && err.message) : undefined });
  }
}

/**
 * Get platform balance
 */
export async function getPlatformBalanceAPI(req, res) {
  try {
    const balance = await getPlatformBalance();
    res.json({ ok: true, data: balance });
  } catch (err) {
    logger.error('getPlatformBalanceAPI error', { err: err.message });
    res.status(500).json({ ok: false, error: 'internal_server_error' });
  }
}

/**
 * Get platform transactions
 */
export async function getPlatformTransactionsAPI(req, res) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const transactions = await getPlatformTransactions(page, limit);

    res.json({
      ok: true,
      data: transactions,
      pagination: { page: Number(page), limit: Number(limit) }
    });
  } catch (err) {
    logger.error('getPlatformTransactionsAPI error', { err: err.message });
    res.status(500).json({ ok: false, error: 'internal_server_error' });
  }
}
