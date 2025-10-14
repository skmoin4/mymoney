// src/modules/admin/adminCommissionPacks.controller.js
import { getPool } from '../../config/db.js';
import logger from '../../utils/logger.js';

/**
 * POST /api/admin/commission-packs
 * Body: { name, global_commission, operator_overrides?, status? }
 */
export async function createCommissionPack(req, res) {
  try {
    const { name, global_commission, operator_overrides = {}, status = 'active' } = req.body || {};
    if (!name || global_commission === undefined) {
      return res.status(400).json({ error: 'name_and_global_commission_required' });
    }

    const pool = getPool();
    try {
      const [ins] = await pool.execute(
        `INSERT INTO commission_packs (name, global_commission, operator_overrides, status, created_at)
         VALUES (?, ?, ?, ?, NOW())`,
        [name, global_commission, JSON.stringify(operator_overrides), status]
      );

      const [rows] = await pool.execute(`SELECT * FROM commission_packs WHERE id = ?`, [ins.insertId]);
      return res.json({ ok: true, pack: rows[0] });
    } catch (err) {
      if (err && err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'duplicate_name' });
      }
      throw err;
    }
  } catch (err) {
    logger.error('createCommissionPack error', { err: err.message, body: req.body });
    return res.status(500).json({ error: 'internal_server_error', detail: err.message });
  }
}

/**
 * GET /api/admin/commission-packs
 */
export async function listCommissionPacks(req, res) {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT id, name, global_commission, operator_overrides, status, created_at, updated_at
       FROM commission_packs
       ORDER BY created_at DESC`
    );
    return res.json({ ok: true, data: rows });
  } catch (err) {
    logger.error('listCommissionPacks error', { err: err.message });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}