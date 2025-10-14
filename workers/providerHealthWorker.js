// src/workers/providerHealthWorker.js
import { getPool } from '../config/db.js';
import providerFactory from '../services/providers/providerFactory.js';
import { updateProviderHealth } from '../services/routingService.js';
import logger from '../utils/logger.js';

// how often to run health checks (ms)
const INTERVAL_MS = Number(process.env.PROVIDER_HEALTH_INTERVAL_MS || 60_000);

export async function runProviderHealthCheck() {
  const pool = getPool();

  try {
    // get active providers
    const [rows] = await pool.execute(
      'SELECT provider_key, name FROM provider_accounts WHERE is_active = true'
    );

    logger.info('Running provider health checks', { count: rows.length });

    for (const row of rows) {
      const providerKey = row.provider_key;
      const providerName = row.name;

      try {
        const provider = await providerFactory.get(providerKey);

        if (!provider.getBalance) {
          logger.warn('Provider does not support getBalance()', { provider: providerKey });
          await updateProviderHealth(providerKey, false);
          continue;
        }

        // call provider API
        const balanceInfo = await provider.getBalance();
        const balance = parseFloat(balanceInfo.balance || 0);
        const currency = balanceInfo.currency || 'INR';

        // Update health and balance
        await updateProviderHealth(providerKey, true, balance);

        logger.info('Provider health OK', {
          provider: providerKey,
          name: providerName,
          balance,
          currency
        });

      } catch (err) {
        logger.error('Provider health FAILED', {
          provider: providerKey,
          name: providerName,
          error: err.message
        });

        // Mark as unhealthy
        await updateProviderHealth(providerKey, false);

        // TODO: enqueue notification to admin/ops if needed
        // await notificationQueue.add('admin_notification', {
        //   type: 'provider_health_failed',
        //   payload: { provider_key: providerKey, error: err.message }
        // });
      }
    }

    logger.info('Provider health checks completed');

  } catch (err) {
    logger.error('runProviderHealthCheck fatal error', { err: err.stack || err.message });
  }
}

// start interval loop (if running as standalone worker)
if (process.env.ENABLE_PROVIDER_HEALTH_WORKER === '1') {
  logger.info('Starting provider health worker...');
  setInterval(runProviderHealthCheck, INTERVAL_MS);

  // Run initial check
  runProviderHealthCheck();
}