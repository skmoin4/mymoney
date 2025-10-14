// src/cron/pendingMonitor.js
import { getPool } from '../config/db.js';
import logger from '../utils/logger.js';
import providerFactory from '../services/providers/providerFactory.js';
import * as walletService from '../services/walletService.js';

const PENDING_THRESHOLD_MIN = Number(process.env.PENDING_THRESHOLD_MIN || 5);

export async function runPendingMonitor() {
  const pool = getPool();
  logger.info('PendingMonitor: starting');

  try {
    // 1. find old pending txns
    const [rows] = await pool.execute(
      `SELECT id, txn_ref, user_id, amount, provider_id, status
       FROM transactions
       WHERE status = 'pending'
         AND created_at < (NOW() - INTERVAL ? MINUTE)
       LIMIT 50`, // batch size to avoid overloading provider
      [PENDING_THRESHOLD_MIN]
    );

  if (!rows.length) {
    logger.info('PendingMonitor: no stale pending txns');
    return;
  }

  logger.info(`PendingMonitor: found ${rows.length} pending txns`);

  for (const txn of rows) {
    try {
      const provider = providerFactory.get(txn.provider_id || 'mock');
      const statusResp = await provider.getStatus(txn);

      if (statusResp.status === 'success') {
        await walletService.finalizeDebit(txn.user_id, txn.amount, {
          refType: 'recharge',
          refId: txn.txn_ref,
          note: 'auto finalize by cron'
        });
        await pool.execute(
          `UPDATE transactions SET status='success', provider_txn_id=?, updated_at=NOW() WHERE id=?`,
          [statusResp.provider_txn_id || null, txn.id]
        );
        try {
          await pool.execute(
            `INSERT INTO cron_actions (action_type, txn_id, old_status, new_status, note)
             VALUES (?,?,?,?,?)`,
            ['pending_monitor', txn.id, 'pending', 'success', 'auto finalize']
          );
        } catch (logErr) {
          logger.warn('Failed to log cron action (table may not exist)', { err: logErr.message });
        }
        logger.info(`Txn ${txn.txn_ref} auto-finalized success`);
      } else if (statusResp.status === 'failed') {
        await walletService.refundReserved(txn.user_id, txn.amount, {
          refType: 'recharge_refund',
          refId: txn.txn_ref,
          note: 'auto refund by cron'
        });
        await pool.execute(
          `UPDATE transactions SET status='failed', updated_at=NOW() WHERE id=?`,
          [txn.id]
        );
        try {
          await pool.execute(
            `INSERT INTO cron_actions (action_type, txn_id, old_status, new_status, note)
             VALUES (?,?,?,?,?)`,
            ['pending_monitor', txn.id, 'pending', 'failed', 'auto refund']
          );
        } catch (logErr) {
          logger.warn('Failed to log cron action (table may not exist)', { err: logErr.message });
        }
        logger.info(`Txn ${txn.txn_ref} auto-refunded failed`);
      } else {
        // still pending
        try {
          await pool.execute(
            `INSERT INTO cron_actions (action_type, txn_id, old_status, new_status, note)
             VALUES (?,?,?,?,?)`,
            ['pending_monitor', txn.id, 'pending', 'pending', 'still pending, left untouched']
          );
        } catch (logErr) {
          logger.warn('Failed to log cron action (table may not exist)', { err: logErr.message });
        }
      }
    } catch (err) {
      logger.error(`PendingMonitor: txn ${txn.txn_ref} check failed`, { err: err.message });
      // mark for manual review?
    }
  }
  } catch (err) {
    logger.error('PendingMonitor: fatal error', { err: err.stack || err.message });
    throw err;
  }
}