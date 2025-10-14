// src/controllers/adminAlertsController.js
import { getPool } from '../../config/db.js';
import logger from '../../utils/logger.js';

/**
 * GET /api/admin/alerts - List alerts
 */
export async function listAlerts(req, res) {
  try {
    const pool = getPool();
    const q = req.query || {};
    const limit = Math.min(200, Number(q.limit || 100));
    const params = [];
    let where = '';

    if (q.status) {
      where += (where ? ' AND ' : 'WHERE ') + 'status = ?';
      params.push(q.status);
    }
    if (q.level) {
      where += (where ? ' AND ' : 'WHERE ') + 'level = ?';
      params.push(q.level);
    }
    if (q.type) {
      where += (where ? ' AND ' : 'WHERE ') + 'alert_type = ?';
      params.push(q.type);
    }

    const [rows] = await pool.execute(
      `SELECT id, alert_key as alert_key, alert_type, level, payload, status, last_sent_at as last_sent_at, created_at, updated_at FROM alerts ${where} ORDER BY created_at DESC LIMIT ?`,
      [...params, limit]
    );

    // Transform the data to match expected format
    const transformedRows = rows.map(row => ({
      id: row.id,
      level: row.level,
      alert_type: row.alert_type,
      message: row.alert_key || 'Alert notification', // Use alert_key as message
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      metadata: row.payload
    }));

    return res.json({ ok: true, data: transformedRows });
  } catch (err) {
    logger.error('listAlerts error', { err: err.stack || err.message });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}

/**
 * POST /api/admin/alerts/:id/ack - Acknowledge alert
 */
export async function acknowledgeAlert(req, res) {
  try {
    const pool = getPool();
    const { id } = req.params;

    // Check current status first
    const [current] = await pool.execute('SELECT status FROM alerts WHERE id = ?', [id]);
    if (!current || current.length === 0) {
      return res.status(404).json({ error: 'alert_not_found' });
    }

    // Only acknowledge if status is 'open'
    if (current[0].status !== 'open') {
      return res.status(400).json({ error: 'alert_not_acknowledgable' });
    }

    const [result] = await pool.execute(
      'UPDATE alerts SET status = ?, updated_at = NOW() WHERE id = ?',
      ['acknowledged', id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'alert_not_found' });
    }

    return res.json({ ok: true, message: 'alert_acknowledged' });
  } catch (err) {
    logger.error('acknowledgeAlert error', { err: err.stack || err.message });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}

/**
 * POST /api/admin/alerts/:id/close - Close alert
 */
export async function closeAlert(req, res) {
  try {
    const pool = getPool();
    const { id } = req.params;

    // Check current status first
    const [current] = await pool.execute('SELECT status FROM alerts WHERE id = ?', [id]);
    if (!current || current.length === 0) {
      return res.status(404).json({ error: 'alert_not_found' });
    }

    // Can close from any status except already closed
    if (current[0].status === 'closed') {
      return res.status(400).json({ error: 'alert_already_closed' });
    }

    const [result] = await pool.execute(
      'UPDATE alerts SET status = ?, updated_at = NOW() WHERE id = ?',
      ['closed', id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'alert_not_found' });
    }

    return res.json({ ok: true, message: 'alert_closed' });
  } catch (err) {
    logger.error('closeAlert error', { err: err.stack || err.message });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}