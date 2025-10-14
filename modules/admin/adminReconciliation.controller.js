// src/controllers/adminReconciliationController.js
import { ingestSettlementFile } from '../../workers/reconciliationWorker.js';
import { getPool } from '../../config/db.js';
import logger from '../../utils/logger.js';

/**
 * POST /api/v1/admin/reconciliation/upload
 * Form-data: provider_id, file (multipart) OR body: provider_id, content
 */
export async function uploadSettlementFileHandler(req, res) {
  try {
    const providerId = req.body.provider_id || req.query.provider_id;
    if (!providerId) return res.status(400).json({ error: 'provider_id_required' });

    // accept direct content or multipart upload
    let content = null;
    if (req.file && req.file.buffer) {
      content = req.file.buffer.toString('utf8');
    } else if (req.body.content) {
      content = req.body.content;
    } else if (req.files && req.files.file) {
      // if using express-fileupload etc.
      content = req.files.file.data.toString('utf8');
    } else {
      return res.status(400).json({ error: 'file_required' });
    }

    const fileId = req.body.provider_file_id || null;
    const result = await ingestSettlementFile(providerId, fileId, content);
    return res.json({ ok: true, result });
  } catch (err) {
    logger.error('uploadSettlementFileHandler error', { err: err.stack || err.message });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}

export async function listReconciliationReports(req, res) {
  try {
    const pool = getPool();
    const q = req.query || {};
    const limit = Math.min(200, Number(q.limit || 100));
    const params = [];
    let where = '';
    if (q.provider_id) { where += (where ? ' AND ' : 'WHERE ') + 'provider_id = ?'; params.push(q.provider_id); }
    if (q.type) { where += (where ? ' AND ' : 'WHERE ') + 'discrepancy_type = ?'; params.push(q.type); }
    const [rows] = await pool.execute(`SELECT * FROM reconciliation_reports ${where} ORDER BY created_at DESC LIMIT ?`, [...params, limit]);
    return res.json({ ok: true, data: rows });
  } catch (err) {
    logger.error('listReconciliationReports error', { err: err.stack || err.message });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}

export async function getSettlementFiles(req, res) {
  try {
    const pool = getPool();
    const [rows] = await pool.execute('SELECT id, provider_id, provider_file_id, status, file_path, created_at FROM provider_settlement_files ORDER BY created_at DESC LIMIT 100');
    return res.json({ ok: true, data: rows });
  } catch (err) {
    logger.error('getSettlementFiles error', { err: err.stack || err.message });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}