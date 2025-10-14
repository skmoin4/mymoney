// src/cron/alertsMonitor.js
import cron from 'node-cron';
import { getPool } from '../config/db.js';
import logger from '../utils/logger.js';
import { notificationQueue } from '../queues/index.js';

const CHECK_CRON = process.env.ALERT_CHECK_INTERVAL_CRON || '*/5 * * * *';
const PROVIDER_BAL_THRESHOLD = Number(process.env.ALERT_PROVIDER_BALANCE_THRESHOLD || 500);
const PENDING_THRESHOLD = Number(process.env.ALERT_PENDING_COUNT_THRESHOLD || 50);
const FAILURE_SPIKE_PCT = Number(process.env.ALERT_FAILURE_SPIKE_PERCENT || 0.2);
const COOLDOWN_MIN = Number(process.env.ALERT_COOLDOWN_MIN || 30);

async function upsertAlert(alertKey, type, level, payload) {
  const pool = getPool();
  try {
    const [existing] = await pool.execute('SELECT id, last_sent_at FROM alerts WHERE alert_key = ? LIMIT 1', [alertKey]);
    if (existing && existing.length > 0) {
      const id = existing[0].id;
      await pool.execute('UPDATE alerts SET payload = ?, level = ?, updated_at = NOW() WHERE id = ?', [JSON.stringify(payload), level, id]);
      return { id, existed: true };
    }
    const [ins] = await pool.execute('INSERT INTO alerts (alert_key, alert_type, level, payload, created_at) VALUES (?, ?, ?, ?, NOW())', [alertKey, type, level, JSON.stringify(payload)]);
    return { id: ins.insertId, existed: false };
  } catch (err) {
    logger.error('upsertAlert error', { err: err.stack || err.message, alertKey });
    throw err;
  }
}

async function shouldSend(id, lastSentAt) {
  if (!lastSentAt) return true;
  const last = new Date(lastSentAt);
  const now = new Date();
  const diffMinutes = (now - last) / (1000 * 60);
  return diffMinutes >= COOLDOWN_MIN;
}

async function sendAlertNotification(alertRow) {
  await notificationQueue.add('send_alert', {
    alertId: alertRow.id,
    alertKey: alertRow.alert_key,
    type: alertRow.alert_type,
    payload: alertRow.payload,
    level: alertRow.level
  });
  const pool = getPool();
  await pool.execute('UPDATE alerts SET last_sent_at = NOW() WHERE id = ?', [alertRow.id]);
}

export async function evalAlertsOnce() {
  const pool = getPool();
  logger.info('alertsMonitor: running check');

  // 1) per-provider balance check
  const [providers] = await pool.execute('SELECT provider_key as provider_id, name as account_name, balance, is_healthy, last_health_check FROM provider_accounts');
  for (const p of providers) {
    if (Number(p.balance) < PROVIDER_BAL_THRESHOLD) {
      const key = `provider:${p.provider_id}:low_balance`;
      const payload = {
        provider_id: p.provider_id,
        balance: Number(p.balance),
        threshold: PROVIDER_BAL_THRESHOLD,
        last_health_check: p.last_health_check
      };
      const { id } = await upsertAlert(key, 'provider_balance', 'warning', payload);
      const [rows] = await pool.execute('SELECT id, last_sent_at, payload, level FROM alerts WHERE id = ? LIMIT 1', [id]);
      const row = rows[0];
      if (await shouldSend(row.id, row.last_sent_at)) {
        await sendAlertNotification(row);
      }
    } else {
      const key = `provider:${p.provider_id}:low_balance`;
      await pool.execute('DELETE FROM alerts WHERE alert_key = ?', [key]);
    }
  }

  // 2) pending count check (global)
  const [pc] = await pool.execute('SELECT COUNT(*) AS pending_count FROM transactions WHERE status = ?', ['pending']);
  const pendingCount = Number(pc[0]?.pending_count || 0);
  if (pendingCount >= PENDING_THRESHOLD) {
    const key = `global:pending_high`;
    const payload = { pending_count: pendingCount, threshold: PENDING_THRESHOLD };
    const level = pendingCount >= PENDING_THRESHOLD * 2 ? 'critical' : 'warning';
    const { id } = await upsertAlert(key, 'pending_count', level, payload);
    const [rows] = await pool.execute('SELECT id, last_sent_at FROM alerts WHERE id = ? LIMIT 1', [id]);
    const row = rows[0];
    if (await shouldSend(row.id, row.last_sent_at)) await sendAlertNotification(row);
  } else {
    await pool.execute('DELETE FROM alerts WHERE alert_key = ?', ['global:pending_high']);
  }

  // 3) failure spike: compare last window failure rate vs previous window
  const WINDOW_MIN = 30;
  const now = new Date();
  const windowEnd = now.toISOString().slice(0, 19).replace('T', ' ');
  const windowStart = new Date(now.getTime() - WINDOW_MIN * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const prevStart = new Date(now.getTime() - WINDOW_MIN * 2 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const prevEnd = new Date(now.getTime() - WINDOW_MIN * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');

  const [cur] = await pool.execute(`SELECT SUM(status='failed') AS failed, COUNT(*) AS total FROM transactions WHERE created_at BETWEEN ? AND ?`, [windowStart, windowEnd]);
  const [prev] = await pool.execute(`SELECT SUM(status='failed') AS failed, COUNT(*) AS total FROM transactions WHERE created_at BETWEEN ? AND ?`, [prevStart, prevEnd]);
  const curFailed = Number(cur[0].failed || 0), curTotal = Number(cur[0].total || 0);
  const prevFailed = Number(prev[0].failed || 0), prevTotal = Number(prev[0].total || 0);
  const curRate = curTotal ? curFailed / curTotal : 0;
  const prevRate = prevTotal ? prevFailed / prevTotal : 0;

  if (prevTotal >= 5 && curTotal >= 5) {
    if (curRate - prevRate >= FAILURE_SPIKE_PCT) {
      const key = 'global:failure_spike';
      const payload = { window_min: WINDOW_MIN, curRate, prevRate, curFailed, curTotal, prevFailed, prevTotal };
      const { id } = await upsertAlert(key, 'failure_spike', 'critical', payload);
      const [rows] = await pool.execute('SELECT id, last_sent_at FROM alerts WHERE id = ? LIMIT 1', [id]);
      const row = rows[0];
      if (await shouldSend(row.id, row.last_sent_at)) await sendAlertNotification(row);
    } else {
      await pool.execute('DELETE FROM alerts WHERE alert_key = ?', ['global:failure_spike']);
    }
  }

  logger.info('alertsMonitor: done');
}

/**
 * Start cron
 */
export function startAlertCron() {
  cron.schedule(CHECK_CRON, async () => {
    try {
      await evalAlertsOnce();
    } catch (err) {
      logger.error('alertsMonitor cron error', { err: err.stack || err.message });
    }
  });
  logger.info('alertsMonitor: cron started', { schedule: CHECK_CRON });
}