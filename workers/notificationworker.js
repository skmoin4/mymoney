// apmoney/workers/notificationWorker.js
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import logger from '../utils/logger.js';
import { getPool } from '../config/db.js';
import admin from 'firebase-admin';

const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

// Initialize firebase-admin if FCM mode
function initFCM() {
  if (process.env.PUSH_PROVIDER !== 'fcm') return;
  try {
    if (process.env.FCM_SERVICE_ACCOUNT_JSON) {
      const svc = JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({
        credential: admin.credential.cert(svc)
      });
      logger.info('FCM initialized from SERVICE_ACCOUNT_JSON');
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp();
      logger.info('FCM initialized from GOOGLE_APPLICATION_CREDENTIALS');
    } else {
      logger.warn('PUSH_PROVIDER=fcm but no service account configured');
    }
  } catch (err) {
    logger.error('initFCM error', { err: err.stack || err.message });
  }
}
initFCM();

async function sendMockPush(token, payload) {
  logger.info('mock push send', { token, payload });
  // emulate network latency
  await new Promise(r => setTimeout(r, 100));
  return { ok: true };
}

async function sendFCMPush(token, payload) {
  try {
    const message = {
      token,
      notification: {
        title: payload.title,
        body: payload.body
      },
      data: payload.data || {}
    };
    const resp = await admin.messaging().send(message);
    return { ok: true, resp };
  } catch (err) {
    logger.error('sendFCMPush error', { err: err.stack || err.message });
    throw err;
  }
}

const worker = new Worker('notification', async job => {
  const { type, targetUserId, payload } = job.data;
  if (type !== 'push') {
    // worker covers other notification types too; ignore here
    return true;
  }

  const pool = getPool();
  // load active tokens for user
  const [rows] = await pool.execute('SELECT token FROM device_registrations WHERE user_id = ?', [targetUserId]);
  if (!rows || rows.length === 0) {
    logger.info('no devices for user', { user: targetUserId });
    return true;
  }

  for (const r of rows) {
    try {
      if (process.env.PUSH_PROVIDER === 'fcm') {
        await sendFCMPush(r.token, payload);
      } else {
        await sendMockPush(r.token, payload);
      }
    } catch (err) {
      logger.warn('push send failed for token', { token: r.token, err: err.message });
      // Optionally: if token invalid, remove from DB (FCM returns error codes)
    }
  }
  return true;
}, { connection });

worker.on('completed', job => logger.info('notification job completed', { id: job.id }));
worker.on('failed', (job, err) => logger.error('notification job failed', { id: job.id, err: err.message }));

export { worker };
