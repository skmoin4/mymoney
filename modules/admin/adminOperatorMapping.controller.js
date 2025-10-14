// src/controllers/adminOperatorMappingController.js
import { getPool } from '../../config/db.js';
import logger from '../../utils/logger.js';

function parseInteger(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * POST /api/v1/admin/operator-mapping
 * Body: { operator_code, provider_id, priority?, enabled?, metadata? }
 */
export async function createOperatorMapping(req, res) {
  try {
    const { operator_code, provider_id, priority = 10, enabled = 1, metadata = null } = req.body || {};
    if (!operator_code || !provider_id) return res.status(400).json({ error: 'operator_code_and_provider_id_required' });

    const pool = getPool();
    try {
      const [ins] = await pool.execute(
        `INSERT INTO operator_provider_mapping (operator_code, provider_id, priority, enabled, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [operator_code, provider_id, parseInteger(priority, 10), enabled ? 1 : 0, metadata ? JSON.stringify(metadata) : null]
      );
      const [row] = await pool.execute('SELECT * FROM operator_provider_mapping WHERE id = ? LIMIT 1', [ins.insertId]);
      return res.json({ ok: true, mapping: row[0] });
    } catch (err) {
      if (err && err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'mapping_exists' });
      }
      throw err;
    }
  } catch (err) {
    logger.error('createOperatorMapping error', { err: err.stack || err.message, body: req.body });
    return res.status(500).json({ error: 'internal_server_error', detail: err.message });
  }
}

/**
 * GET /api/v1/admin/operator-mapping
 * Query params:
 *  - operator_code (optional)
 *  - provider_id (optional)
 *  - enabled (optional)
 *  - page, page_size
 *  - sort (e.g. "priority:asc")
 */
export async function listOperatorMappings(req, res) {
  try {
    const q = req.query || {};
    const pool = getPool();

    const page = Math.max(1, parseInt(q.page || '1', 10));
    const pageSize = Math.min(Math.max(1, parseInt(q.page_size || '20', 10)), 200);
    const offset = (page - 1) * pageSize;

    const filters = [];
    const params = [];

    if (q.operator_code) { filters.push('operator_code = ?'); params.push(q.operator_code); }
    if (q.provider_id) { filters.push('provider_id = ?'); params.push(q.provider_id); }
    if (q.enabled !== undefined) { filters.push('enabled = ?'); params.push(Number(q.enabled) ? 1 : 0); }

    const whereClause = filters.length ? ('WHERE ' + filters.join(' AND ')) : '';

    const countSql = `SELECT COUNT(*) AS total FROM operator_provider_mapping ${whereClause}`;
    const [countRows] = await pool.execute(countSql, params);
    const total = Number((countRows && countRows[0] && countRows[0].total) || 0);

    // default sort by operator, priority asc
    const sortClause = 'ORDER BY operator_code ASC, priority ASC';
    const listSql = `
      SELECT id, operator_code, provider_id, priority, enabled, metadata, created_at, updated_at
      FROM operator_provider_mapping
      ${whereClause}
      ${sortClause}
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    const [rows] = await pool.execute(listSql, params);

    return res.json({ ok: true, meta: { total, page, page_size: pageSize, pages: Math.ceil(total / pageSize) }, data: rows || [] });
  } catch (err) {
    logger.error('listOperatorMappings error', { err: err.stack || err.message, query: req.query });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}

/**
 * GET /api/v1/admin/operator-mapping/:id
 */
export async function getOperatorMapping(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const pool = getPool();
    const [rows] = await pool.execute('SELECT * FROM operator_provider_mapping WHERE id = ? LIMIT 1', [id]);
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'not_found' });
    return res.json({ ok: true, mapping: rows[0] });
  } catch (err) {
    logger.error('getOperatorMapping error', { err: err.stack || err.message, id: req.params.id });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}

/**
 * PUT /api/v1/admin/operator-mapping/:id
 * Body: { priority?, enabled?, metadata? }
 */
export async function updateOperatorMapping(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const { priority, enabled, metadata } = req.body || {};
    const pool = getPool();

    const updates = [];
    const params = [];
    if (priority !== undefined) { updates.push('priority = ?'); params.push(parseInteger(priority, 10)); }
    if (enabled !== undefined) { updates.push('enabled = ?'); params.push(enabled ? 1 : 0); }
    if (metadata !== undefined) { updates.push('metadata = ?'); params.push(JSON.stringify(metadata)); }

    if (updates.length === 0) return res.status(400).json({ error: 'nothing_to_update' });

    const sql = `UPDATE operator_provider_mapping SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`;
    params.push(id);
    await pool.execute(sql, params);

    const [rows] = await pool.execute('SELECT * FROM operator_provider_mapping WHERE id = ? LIMIT 1', [id]);
    return res.json({ ok: true, mapping: rows[0] });
  } catch (err) {
    logger.error('updateOperatorMapping error', { err: err.stack || err.message, id: req.params.id, body: req.body });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}

/**
 * DELETE /api/v1/admin/operator-mapping/:id
 */
export async function deleteOperatorMapping(req, res) {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid_id' });
    const pool = getPool();
    await pool.execute('DELETE FROM operator_provider_mapping WHERE id = ?', [id]);
    return res.json({ ok: true });
  } catch (err) {
    logger.error('deleteOperatorMapping error', { err: err.stack || err.message, id: req.params.id });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}