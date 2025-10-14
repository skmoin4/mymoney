// apmoney/modules/device/deviceController.js
import { getPool } from '../../config/db.js';
import logger from '../../utils/logger.js';

export async function registerDevice(req, res) {
  try {
    const user = req.user;
    const { token, platform = 'android', app_version = null, meta = null } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token_required' });

    const pool = getPool();
    await pool.execute(
      `INSERT INTO device_registrations (user_id, platform, token, app_version, meta, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE last_seen_at = NOW(), app_version = VALUES(app_version), meta = VALUES(meta)`,
      [user.id, platform, token, app_version, meta ? JSON.stringify(meta) : null]
    );
    return res.json({ ok: true });
  } catch (err) {
    logger.error('registerDevice error', { err: err.stack || err.message, user: req.user?.id });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}

export async function unregisterDevice(req, res) {
  try {
    const user = req.user;
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token_required' });

    const pool = getPool();
    await pool.execute('DELETE FROM device_registrations WHERE user_id = ? AND token = ?', [user.id, token]);
    return res.json({ ok: true });
  } catch (err) {
    logger.error('unregisterDevice error', { err: err.stack || err.message, user: req.user?.id });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}

export async function listDevicesForUser(req, res) {
  try {
    const pool = getPool();
    const user = req.user;
    // admin may pass ?user_id= or else returns own devices
    const userId = (user.role === 'admin' && req.query.user_id) ? Number(req.query.user_id) : user.id;
    const [rows] = await pool.execute('SELECT id, platform, token, app_version, meta, last_seen_at, created_at FROM device_registrations WHERE user_id = ? ORDER BY last_seen_at DESC', [userId]);
    return res.json({ ok: true, data: rows });
  } catch (err) {
    logger.error('listDevicesForUser error', { err: err.stack || err.message });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}
