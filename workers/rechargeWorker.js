// src/workers/rechargeWorker.js
import bullmqPkg from 'bullmq';
const BullMQ = bullmqPkg && (bullmqPkg.default ? bullmqPkg.default : bullmqPkg);
const { Worker, QueueScheduler, Queue, Job } = BullMQ;

import { getRedis } from '../config/redis.js';
import { getPool } from '../config/db.js';
import providerFactory from '../services/providers/providerFactory.js';
import walletService from '../services/walletService.js';
import logger from '../utils/logger.js';
import { emitTransactionUpdate } from '../realTime/socket.js';
import { notificationQueue } from '../queues/index.js';

function enqueuePushForTxn(txn) {
  const title = `Transaction ${txn.txn_ref} ${txn.status}`;
  const body = `Your recharge of ₹${txn.amount} is ${txn.status}`;
  const data = { txn_ref: txn.txn_ref, status: txn.status, amount: String(txn.amount) };

  notificationQueue.add('push-' + Date.now(), {
    type: 'push',
    targetUserId: txn.user_id,
    payload: { title, body, data }
  });
}
import { attemptProvidersSequentially } from '../services/routingService.js';
import { creditProviderCommission } from '../services/commissionService.js';

const RECHARGE_QUEUE_NAME = 'recharge-queue';
const connection = getRedis();

// Provider calling logic moved to routingService.js

// Metrics tracking
const metrics = {
  jobsProcessed: 0,
  jobsSuccessful: 0,
  jobsFailed: 0,
  jobsPending: 0,
  errors: [],
  lastReset: new Date(),
  success: 0,
  failed: 0,
  retried: 0
};

/**
 * createRechargeWorker()
 * Starts a Worker that processes jobs pushed to 'recharge-queue'.
 */
export function createRechargeWorker() {
  // Note: QueueScheduler removed in newer BullMQ versions - retries handled by worker options

  const worker = new Worker(RECHARGE_QUEUE_NAME, async (job) => {
    metrics.jobsProcessed++;
    logger.info('rechargeWorker:start', { jobId: job.id, data: job.data, totalProcessed: metrics.jobsProcessed });

    const pool = getPool();

    // job.data expected to contain at least one of:
    // { transaction_id, txn_ref, user_id, amount, provider (optional), mockOutcome (optional) }
    const { transaction_id, txn_ref, user_id, amount } = job.data;
    const providerKey = job.data.provider || 'mock';
    const provider = providerFactory.get(providerKey);

    // 1) Load transaction and lock it to avoid double-processing
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      let txRow;
      if (transaction_id) {
        const [rows] = await conn.execute('SELECT * FROM transactions WHERE id = ? FOR UPDATE', [transaction_id]);
        txRow = rows && rows[0];
      } else if (txn_ref) {
        const [rows] = await conn.execute('SELECT * FROM transactions WHERE txn_ref = ? FOR UPDATE', [txn_ref]);
        txRow = rows && rows[0];
      } else {
        // No transaction reference — we proceed but log
        logger.warn('rechargeWorker: job without transaction_id/txn_ref', { jobData: job.data });
      }

      if (txRow) {
        // If status already final, skip
        if (['success','failed','reversed'].includes(txRow.status)) {
          logger.info('rechargeWorker: txn already finalized - skipping', { txnId: txRow.id, status: txRow.status });
          await conn.commit();
          return { ok: true, note: 'already_finalized' };
        }

        // mark as processing (optional)
        await conn.execute('UPDATE transactions SET status = ?, updated_at = NOW() WHERE id = ?', ['processing', txRow.id]);
      }

      await conn.commit();
    } catch (err) {
      try { await conn.rollback(); } catch (_) {}
      logger.error('rechargeWorker: DB lock error', { err: err.stack || err.message });
      throw err;
    } finally {
      try { conn.release(); } catch (_) {}
    }

    // 2) Call providers with routing and failover
    const providerAttempt = await attemptProvidersSequentially(job, job.data);
    const providerRes = providerAttempt.result;
    const actualProvider = providerAttempt.providerId || providerKey;

    logger.info('rechargeWorker: provider routing complete', {
      jobId: job.id,
      providerAttempt: {
        providerId: providerAttempt.providerId,
        tried: providerAttempt.tried,
        errors: providerAttempt.errors
      },
      providerRes
    });

    // 3) Act on provider response
    // providerRes expected: { status: 'success'|'pending'|'failed', provider_txn_id, raw }
    const pStatus = (providerRes && providerRes.status) ? providerRes.status.toString().toLowerCase() : 'failed';

    // We'll update transactions and call walletService accordingly.
    try {
      // Update transactions table accordingly (use pool.execute)
      if (pStatus === 'success') {
        // finalize: reduce reserved & balance -> ledger debit
        // finalizeDebit may throw; handle with try/catch to update txn state accordingly
        try {
          await walletService.finalizeDebit(user_id || job.data.user_id, Number(amount || job.data.amount), {
            refType: 'recharge',
            refId: txn_ref || job.data.txn_ref || job.data.transaction_id,
            operator_code: job.data.operator_code,
            note: 'finalize by worker'
          });

          // Credit platform commission
          try {
            await creditProviderCommission(
              job.data.operator_code,
              Number(amount || job.data.amount),
              actualProvider,
              txn_ref || job.data.txn_ref || job.data.transaction_id
            );
          } catch (commissionErr) {
            logger.error('rechargeWorker: commission credit failed', { err: commissionErr.message, txn_ref });
            // Don't fail the transaction for commission errors
          }

          await pool.execute(
            'UPDATE transactions SET status = ?, provider_txn_id = ?, response_payload = JSON_MERGE_PATCH(COALESCE(response_payload,"{}"), ?), updated_at = NOW() WHERE id = ? OR txn_ref = ?',
            ['success', providerRes.provider_txn_id || null, JSON.stringify({ providerAttempt, response: providerRes.raw || providerRes }), transaction_id || null, txn_ref || null]
          );

          // notify user (socket + push)
          const uId = user_id || job.data.user_id;
          const txn = {
            user_id: uId,
            txn_ref: txn_ref || job.data.txn_ref,
            status: 'success',
            amount: amount || job.data.amount,
            provider_txn_id: providerRes.provider_txn_id || null,
            updated_at: new Date().toISOString()
          };
          emitTransactionUpdate(txn);
          enqueuePushForTxn(txn);
          await notificationQueue.add('txn_notification', {
            user_id: uId,
            title: 'Recharge successful',
            body: `₹${amount || job.data.amount} recharge successful`,
            data: { txn_ref: txn_ref || job.data.txn_ref, status: 'success' }
          });

          metrics.jobsSuccessful++;
          metrics.success++;
          logger.info('rechargeWorker: finalize success complete', { txn_ref, transaction_id, user_id, metrics: { successful: metrics.jobsSuccessful, total: metrics.jobsProcessed, success: metrics.success, failed: metrics.failed, retried: metrics.retried } });
          return { ok: true, status: 'success' };
        } catch (finalizeErr) {
          // finalize failed — this is serious: record failure for investigation
          logger.error('rechargeWorker: finalizeDebit failed', { err: finalizeErr.stack || finalizeErr.message, jobData: job.data });

          // Update txn to 'failed' (or 'error') and include error
          await pool.execute(
            'UPDATE transactions SET status = ?, response_payload = JSON_MERGE_PATCH(COALESCE(response_payload, "{}"), ?), updated_at = NOW() WHERE id = ? OR txn_ref = ?',
            ['failed', JSON.stringify({ finalize_error: finalizeErr.message }), transaction_id || null, txn_ref || null]
          );

          // attempt refund of reserved to avoid user losing funds (best-effort)
          try {
            await walletService.refundReserved(user_id || job.data.user_id, Number(amount || job.data.amount), {
              refType: 'recharge_refund',
              refId: txn_ref || job.data.txn_ref,
              note: 'refund after finalize failure'
            });
          } catch (refundErr) {
            logger.error('rechargeWorker: refund after finalize failed', { err: refundErr.stack || refundErr.message, jobData: job.data });
          }

          // notify user of failure
          const uId = user_id || job.data.user_id;
          emitTransactionUpdate({
            user_id: uId,
            txn_ref: txn_ref || job.data.txn_ref,
            status: 'failed',
            amount: amount || job.data.amount,
            updated_at: new Date().toISOString()
          });
          await notificationQueue.add('txn_notification', {
            user_id: uId,
            title: 'Recharge failed',
            body: `Recharge failed — we refunded your reserved amount`,
            data: { txn_ref: txn_ref || job.data.txn_ref, status: 'failed' }
          });

          return { ok: false, status: 'failed', reason: 'finalize_failed' };
        }
      } else if (pStatus === 'pending') {
        // mark txn processing/pending and leave for webhook or later polling
        await pool.execute(
          'UPDATE transactions SET status = ?, provider_txn_id = ?, response_payload = JSON_MERGE_PATCH(COALESCE(response_payload,"{}"), ?), updated_at = NOW() WHERE id = ? OR txn_ref = ?',
          ['processing', providerRes.provider_txn_id || null, JSON.stringify({ providerAttempt, response: providerRes.raw || providerRes }), transaction_id || null, txn_ref || null]
        );

        // optionally re-enqueue a status-check job (not implemented here)
        const uId = user_id || job.data.user_id;
        emitTransactionUpdate({
          user_id: uId,
          txn_ref: txn_ref || job.data.txn_ref,
          status: 'processing',
          amount: amount || job.data.amount,
          updated_at: new Date().toISOString()
        });
        metrics.jobsPending++;
        logger.info('rechargeWorker: provider returned pending', { jobId: job.id, providerRes, metrics: { pending: metrics.jobsPending, total: metrics.jobsProcessed, success: metrics.success, failed: metrics.failed, retried: metrics.retried } });
        return { ok: true, status: 'processing' };
      } else {
        // failed - return reserved to wallet
        try {
          await walletService.refundReserved(user_id || job.data.user_id, Number(amount || job.data.amount), {
            refType: 'recharge_refund',
            refId: txn_ref || job.data.txn_ref,
            note: 'provider failed'
          });
        } catch (refundErr) {
          logger.error('rechargeWorker: refundReserved failed', { err: refundErr.stack || refundErr.message, jobData: job.data });
          // still continue to mark txn failed
        }

        await pool.execute(
          'UPDATE transactions SET status = ?, provider_txn_id = ?, response_payload = JSON_MERGE_PATCH(COALESCE(response_payload,"{}"), ?), updated_at = NOW() WHERE id = ? OR txn_ref = ?',
          ['failed', providerRes.provider_txn_id || null, JSON.stringify({ providerAttempt, response: providerRes.raw || providerRes }), transaction_id || null, txn_ref || null]
        );

        const uId = user_id || job.data.user_id;
        emitTransactionUpdate({
          user_id: uId,
          txn_ref: txn_ref || job.data.txn_ref,
          status: 'failed',
          amount: amount || job.data.amount,
          updated_at: new Date().toISOString()
        });
        await notificationQueue.add('txn_notification', {
          user_id: uId,
          title: 'Recharge failed',
          body: `Recharge failed for ₹${amount || job.data.amount}`,
          data: { txn_ref: txn_ref || job.data.txn_ref, status: 'failed' }
        });

        metrics.jobsFailed++;
        metrics.failed++;
        logger.info('rechargeWorker: provider failed and refund attempted', { jobId: job.id, metrics: { failed: metrics.jobsFailed, total: metrics.jobsProcessed, success: metrics.success, failed: metrics.failed, retried: metrics.retried } });
        return { ok: false, status: 'failed' };
      }
    } catch (err) {
      metrics.errors.push({ type: 'post_provider', message: err.message, jobId: job.id, timestamp: new Date() });
      logger.error('rechargeWorker: error during post-provider processing', { err: err.stack || err.message, jobData: job.data, errorCount: metrics.errors.length });
      // Throw to allow BullMQ to retry according to job attempts/backoff
      throw err;
    }
  }, { connection });

  worker.on('completed', (job, result) => {
    metrics.success++;
    logger.info('rechargeWorker: job completed', {
      jobId: job.id,
      txn_ref: job?.data?.txn_ref,
      user_id: job?.data?.user_id,
      result,
      metrics: { success: metrics.success, failed: metrics.failed, retried: metrics.retried }
    });
  });

  worker.on('failed', (job, err) => {
    metrics.failed++;
    if (job && job.attemptsMade < (job.opts?.attempts || 1)) {
      metrics.retried++;
    }
    logger.error('rechargeWorker: job failed', {
      jobId: job?.id,
      txn_ref: job?.data?.txn_ref,
      user_id: job?.data?.user_id,
      attemptsMade: job?.attemptsMade,
      attempts: job?.opts?.attempts,
      err: err?.message,
      stack: err?.stack,
      metrics: { success: metrics.success, failed: metrics.failed, retried: metrics.retried }
    });
  });

  // Track retries
  worker.on('error', (err) => {
    logger.error('rechargeWorker: worker error', { err: err?.message });
  });

  return { worker };
}
