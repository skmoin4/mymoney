// src/workers/reconciliationWorker.js
import { getPool } from '../config/db.js';
import providerFactory from '../services/providers/providerFactory.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';

const TEMP_DIR = process.env.RECONCILE_TMP_DIR || './tmp';

export async function ingestSettlementFile(providerId, fileId, content, opts = {}) {
  const pool = getPool();

  // compute hash for idempotency
  const hash = crypto.createHash('sha256').update(content).digest('hex');

  // if file already ingested by hash, return existing
  const [existing] = await pool.execute('SELECT id,status FROM provider_settlement_files WHERE file_hash = ? LIMIT 1', [hash]);
  if (existing && existing.length > 0) {
    return { ok: true, id: existing[0].id, note: 'already_ingested' };
  }

  // save file locally (optional)
  const filename = `settle_${providerId}_${Date.now()}.csv`;
  const filepath = path.join(TEMP_DIR, filename);
  await fs.writeFile(filepath, content, 'utf8');

  const [ins] = await pool.execute(
    `INSERT INTO provider_settlement_files
      (provider_id, provider_file_id, file_path, file_hash, raw_payload, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'new', NOW())`,
    [providerId, fileId || null, filepath, hash, null]
  );

  const id = ins.insertId;
  // kick off processing
  processSettlementFile(id).catch(err => logger.error('processSettlementFile failed', { err: err.stack || err.message, id }));
  return { ok: true, id };
}

export async function processSettlementFile(settlementFileId) {
  const pool = getPool();
  // lock row for update
  const [rows] = await pool.execute('SELECT * FROM provider_settlement_files WHERE id = ? FOR UPDATE', [settlementFileId]);
  if (!rows || rows.length === 0) throw new Error('settlement_file_not_found');
  const fileRow = rows[0];

  if (fileRow.status === 'processing' || fileRow.status === 'done') {
    return { ok: true, note: 'already_processed' };
  }

  // mark processing
  await pool.execute('UPDATE provider_settlement_files SET status = ? WHERE id = ?', ['processing', settlementFileId]);

  try {
    const providerId = fileRow.provider_id;
    // read file
    const content = await fs.readFile(fileRow.file_path, 'utf8');

    // find provider adapter
    const provider = providerFactory.get(providerId);
    const normalizedRows = provider.parseSettlementFile ? await provider.parseSettlementFile(content) : parseCsvBasic(content);

    // iterate rows and match to our DB
    for (const r of normalizedRows) {
      const providerTxnRef = r.provider_txn_ref;
      const ourRef = r.request_ref || r.our_txn_ref || null;

      // try match by provider_txn_ref first
      let [matchRows] = await pool.execute('SELECT id, txn_ref, amount, status FROM transactions WHERE provider_txn_id = ? LIMIT 1', [providerTxnRef]);

      // if not found and ourRef present, try by txn_ref
      if ((!matchRows || matchRows.length === 0) && ourRef) {
        [matchRows] = await pool.execute('SELECT id, txn_ref, amount, status FROM transactions WHERE txn_ref = ? LIMIT 1', [ourRef]);
      }

      if (!matchRows || matchRows.length === 0) {
        // missing in our DB => record mismatch
        await pool.execute(
          `INSERT INTO reconciliation_reports
            (provider_settlement_file_id, provider_id, provider_txn_ref, our_txn_ref, provider_amount, our_amount, provider_status, our_status, discrepancy_type, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [settlementFileId, providerId, providerTxnRef, ourRef, r.provider_amount || null, null, r.provider_status || null, null, 'missing_in_our_db', JSON.stringify(r)]
        );
        continue;
      }

      const tx = matchRows[0];
      const ourAmount = Number(tx.amount || 0);
      const provAmount = Number(r.provider_amount || 0);
      const provStatus = r.provider_status || null;
      const ourStatus = tx.status || null;

      // amount mismatch?
      if (Math.abs(provAmount - ourAmount) > 0.01) {
        await pool.execute(
          `INSERT INTO reconciliation_reports
            (provider_settlement_file_id, provider_id, provider_txn_ref, our_txn_ref, provider_amount, our_amount, provider_status, our_status, discrepancy_type, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [settlementFileId, providerId, providerTxnRef, tx.txn_ref, provAmount, ourAmount, provStatus, ourStatus, 'amount_mismatch', 'amount differs']
        );
        continue;
      }

      // status mismatch?
      if (provStatus && provStatus !== ourStatus) {
        await pool.execute(
          `INSERT INTO reconciliation_reports
            (provider_settlement_file_id, provider_id, provider_txn_ref, our_txn_ref, provider_amount, our_amount, provider_status, our_status, discrepancy_type, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [settlementFileId, providerId, providerTxnRef, tx.txn_ref, provAmount, ourAmount, provStatus, ourStatus, 'status_mismatch', 'status differs']
        );
        continue;
      }

      // if matches, optionally insert a "matched" row? We'll skip to keep table for mismatches only.
    } // end loop

    await pool.execute('UPDATE provider_settlement_files SET status = ? WHERE id = ?', ['done', settlementFileId]);
    return { ok: true };
  } catch (err) {
    logger.error('processSettlementFile error', { err: err.stack || err.message, settlementFileId });
    await pool.execute('UPDATE provider_settlement_files SET status = ? WHERE id = ?', ['failed', settlementFileId]);
    throw err;
  }
}

/** basic CSV parser fallback if provider doesn't implement parseSettlementFile
 * expects CSV with header id,provider_txn_ref,request_ref,amount,status
 */
function parseCsvBasic(content) {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines.shift().split(',').map(h => h.trim());
  const out = [];
  for (const line of lines) {
    const cols = line.split(',');
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i]] = cols[i] ? cols[i].trim() : null;
    out.push({
      provider_txn_ref: obj.provider_txn_ref || obj.id || null,
      request_ref: obj.request_ref || obj.txn_ref || null,
      provider_amount: obj.amount ? Number(obj.amount) : null,
      provider_status: obj.status || null,
      metadata: obj
    });
  }
  return out;
}