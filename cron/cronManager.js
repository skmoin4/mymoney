// src/cron/cronManager.js
import cron from 'node-cron';
import { runPendingMonitor } from './pendingMonitor.js';
import { startAlertCron } from './alertsMonitor.js';
import logger from '../utils/logger.js';

export function startCrons() {
  // run every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      await runPendingMonitor();
    } catch (err) {
      logger.error('Cron runPendingMonitor error', { err: err.message });
    }
  });

  // Start alerts monitoring cron
  startAlertCron();

  logger.info('Cron jobs started - pending monitor and alerts monitor running');
}