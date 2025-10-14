// src/controllers/adminReportsController.js
import { getPool } from '../../config/db.js';
import logger from '../../utils/logger.js';
import { Transform } from 'stream';

/**
 * Simple CSV escaper
 */
function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  // if contains quote/comma/newline then wrap with quotes and double quotes inside
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Build WHERE clause and params from query
 */
function buildFilters(q) {
  const filters = [];
  const params = [];

  if (q.from) {
    filters.push('t.created_at >= ?');
    params.push(q.from + ' 00:00:00');
  }
  if (q.to) {
    filters.push('t.created_at <= ?');
    params.push(q.to + ' 23:59:59');
  }
  if (q.operator) {
    filters.push('t.operator_code = ?');
    params.push(q.operator);
  }
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

  const where = filters.length ? ('WHERE ' + filters.join(' AND ')) : '';
  return { where, params };
}

/**
 * Handler: supports pagination JSON or streaming CSV when export=csv
 */
export async function transactionsReportHandler(req, res) {
  const pool = getPool();
  try {
    const q = req.query || {};
    const page = Math.max(1, parseInt(q.page || '1', 10));
    const pageSize = Math.min(500, parseInt(q.page_size || '50', 10)); // default 50, max 500
    const offset = (page - 1) * pageSize;

    const { where, params } = buildFilters(q);

    // base select (choose columns you want to expose)
    const selectCols = [
      't.id', 't.txn_ref', 't.user_id', 't.mobile', 't.operator_code',
      't.amount', 't.service_charge', 't.status', 't.provider_txn_id',
      't.created_at', 't.updated_at', 't.commission_amount', 't.commission_breakdown'
    ];
    const baseSql = `FROM transactions t ${where} ORDER BY t.created_at DESC`;

    // If CSV export requested — stream results
    if (String(q.export || '').toLowerCase() === 'csv') {
      // Set filename
      const fnameParts = ['transactions'];
      if (q.from) fnameParts.push(q.from);
      if (q.to) fnameParts.push(q.to);
      const filename = fnameParts.join('_') + '.csv';

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Transfer-Encoding', 'chunked');

      // write header row
      const header = selectCols.map(c => c.replace(/^t\./, '')).join(',');
      res.write(header + '\n');

      // stream query using connection.query().stream()
      const conn = await pool.getConnection();
      try {
        // build SQL
        const sql = `SELECT ${selectCols.join(', ')} ${baseSql}`;
        // node-mysql2: use conn.query(sql, params).stream()
        const queryStream = conn.query(sql, params).stream({ highWaterMark: 5 });

        const transform = new Transform({
          objectMode: true,
          transform(row, enc, cb) {
            try {
              // convert commission_breakdown to JSON string if object
              if (row.commission_breakdown && typeof row.commission_breakdown === 'object') {
                row.commission_breakdown = JSON.stringify(row.commission_breakdown);
              }
              const vals = selectCols.map(col => {
                const key = col.replace(/^t\./, '');
                return csvEscape(row[key]);
              });
              const line = vals.join(',') + '\n';
              cb(null, line);
            } catch (e) {
              cb(e);
            }
          }
        });

        queryStream.on('error', err => {
          logger.error('transactionsReport CSV stream error', { err: err.stack || err.message });
          try { conn.release(); } catch (_) {}
          if (!res.headersSent) res.status(500).json({ error: 'internal_server_error' });
          else res.end();
        });

        queryStream.on('end', () => {
          try { conn.release(); } catch (_) {}
          res.end();
        });

        // pipe stream -> transform -> response
        queryStream.pipe(transform).pipe(res);
      } catch (err) {
        try { conn.release(); } catch (_) {}
        logger.error('transactionsReport CSV error', { err: err.stack || err.message });
        if (!res.headersSent) return res.status(500).json({ error: 'internal_server_error' });
        return res.end();
      }
      return;
    }

    // else JSON paginated response
    // count total
    const countSql = `SELECT COUNT(*) AS total ${baseSql}`;
    const [countRows] = await pool.execute(countSql, params);
    const total = (Array.isArray(countRows) && countRows[0]) ? Number(countRows[0].total || 0) : 0;

    const listSql = `SELECT ${selectCols.join(', ')} ${baseSql} LIMIT ${pageSize} OFFSET ${offset}`;
    const [rows] = await pool.execute(listSql, params);

    return res.json({
      ok: true,
      meta: { total, page, page_size: pageSize, pages: Math.ceil(total / pageSize) },
      data: rows || []
    });
  } catch (err) {
    logger.error('transactionsReportHandler error', { err: err.stack || err.message, query: req.query });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}