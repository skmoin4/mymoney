// apmoney/controllers/healthController.js
import { getPool } from '../config/db.js';

export async function healthHandler(req, res) {
  try {
    const pool = getPool();
    await pool.execute('SELECT 1');
    return res.json({ ok: true, env: process.env.NODE_ENV || 'dev' });
  } catch (err) {
    return res.status(500).json({ ok: false });
  }
}