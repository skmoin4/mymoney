// src/controllers/adminMetricsController.js
import { getPool } from '../../config/db.js';
import logger from '../../utils/logger.js';
import redis from '../../config/redis.js'; // optional: returns ioredis instance or null

const CACHE_KEY = 'admin_metrics_v1';
const CACHE_TTL_SEC = Number(process.env.ADMIN_METRICS_TTL || 15); // small TTL by default

function toSqlDate(date) {
  // returns YYYY-MM-DD
  return date.toISOString().slice(0,10);
}

export async function adminMetricsHandler(req, res) {
  try {
    // Try cache first (if redis configured)
    if (redis) {
      try {
        const cached = await redis.get(CACHE_KEY);
        if (cached) {
          return res.json(JSON.parse(cached));
        }
      } catch (err) {
        logger.warn('adminMetrics: redis get failed', { err: err.message });
      }
    }

    const pool = getPool();

    // 1) total_txn_today & total_volume_today (success)
    const today = new Date();
    const todayStart = `${toSqlDate(today)} 00:00:00`;
    const todayEnd = `${toSqlDate(today)} 23:59:59`;

    const q1 = `
      SELECT
        COUNT(*) AS total_txn_today,
        SUM(CASE WHEN status = 'success' THEN amount ELSE 0 END) AS total_volume_today,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count_today
      FROM transactions
      WHERE created_at BETWEEN ? AND ?
    `;
    const [r1] = await pool.execute(q1, [todayStart, todayEnd]);
    const total_txn_today = Number(r1[0]?.total_txn_today || 0);
    const total_volume_today = Number(r1[0]?.total_volume_today || 0);
    const success_count_today = Number(r1[0]?.success_count_today || 0);

    // 2) success_rate for last 24 hours
    const since24h = new Date(Date.now() - 24*60*60*1000).toISOString().slice(0,19).replace('T',' ');
    const q2 = `
      SELECT
        SUM(status = 'success') AS succ,
        COUNT(*) AS total
      FROM transactions
      WHERE created_at >= ?
    `;
    const [r2] = await pool.execute(q2, [since24h]);
    const succ24 = Number(r2[0]?.succ || 0);
    const total24 = Number(r2[0]?.total || 0);
    const success_rate_24h = total24 > 0 ? +(succ24 / total24).toFixed(4) : 0;

    // 3) pending_count (global)
    const [r3] = await pool.execute(`SELECT COUNT(*) AS pending_count FROM transactions WHERE status = 'pending'`);
    const pending_count = Number(r3[0]?.pending_count || 0);

    // 4) per_provider_balances
    const [provRows] = await pool.execute(
      `SELECT provider_id, account_name, balance, currency, is_healthy, last_health_check
       FROM provider_accounts
       ORDER BY provider_id`
    );

    // 5) optional recent_errors (last 10 failed txns)
    const [errRows] = await pool.execute(
      `SELECT id, txn_ref, user_id, operator_code, amount, status, updated_at
       FROM transactions
       WHERE status = 'failed'
       ORDER BY updated_at DESC
       LIMIT 10`
    );

    const payload = {
      ok: true,
      total_txn_today,
      total_volume_today,
      success_count_today,
      success_rate_24h,
      pending_count,
      per_provider_balances: provRows || [],
      recent_errors: errRows || []
    };

    // cache result
    if (redis) {
      try {
        await redis.set(CACHE_KEY, JSON.stringify(payload), 'EX', CACHE_TTL_SEC);
      } catch (err) {
        logger.warn('adminMetrics: redis set failed', { err: err.message });
      }
    }

    return res.json(payload);
  } catch (err) {
    logger.error('adminMetricsHandler error', { err: err.stack || err.message });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}