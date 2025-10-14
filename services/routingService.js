// src/services/routingService.js
import { getPool } from '../config/db.js';
import logger from '../utils/logger.js';
import providerFactory from './providers/providerFactory.js';

/**
 * Routing Service - determines which provider to use for which operator
 * Handles provider failover, load balancing, and health checks
 */

// Static routing for common operators (fallback)
const STATIC_ROUTING = {
  'AIRTEL': ['tuktuk', 'mock'],
  'JIO': ['tuktuk', 'mock'],
  'VI': ['tuktuk', 'mock'],
  'BSNL': ['tuktuk', 'mock'],
  'MTNL': ['tuktuk', 'mock']
};

export async function getProvidersForOperator(operatorCode) {
  try {
    const pool = getPool();

    // Query database for active provider mappings
    const [rows] = await pool.execute(
      `SELECT op.provider_key, op.priority, op.min_amount, op.max_amount,
              pa.is_healthy, pa.balance
       FROM operator_providers op
       JOIN provider_accounts pa ON op.provider_key = pa.provider_key
       WHERE op.operator_code = ? AND op.is_active = true AND pa.is_active = true
       ORDER BY op.priority DESC`,
      [operatorCode]
    );

    if (rows && rows.length > 0) {
      return rows.map(row => ({
        provider: row.provider_key,
        priority: row.priority,
        minAmount: parseFloat(row.min_amount),
        maxAmount: parseFloat(row.max_amount),
        isHealthy: !!row.is_healthy,
        balance: parseFloat(row.balance || 0)
      }));
    }

    // Fallback to static routing
    const providers = STATIC_ROUTING[operatorCode] || ['mock'];
    logger.info('RoutingService: Using static routing', { operatorCode, providers });

    return providers.map(provider => ({
      provider,
      priority: 1,
      minAmount: 10,
      maxAmount: 10000,
      isHealthy: true,
      balance: 999999 // Mock has unlimited balance
    }));

  } catch (error) {
    logger.error('RoutingService: Error getting providers', { operatorCode, error: error.message });
    // Ultimate fallback
    return [{ provider: 'mock', priority: 1, minAmount: 10, maxAmount: 10000, isHealthy: true, balance: 999999 }];
  }
}

export async function attemptProvidersSequentially(jobData) {
  const { operator_code, amount } = jobData;
  const providers = await getProvidersForOperator(operator_code);

  // Filter by amount limits and health
  const validProviders = providers.filter(p =>
    parseFloat(amount) >= p.minAmount &&
    parseFloat(amount) <= p.maxAmount &&
    p.isHealthy &&
    p.balance >= parseFloat(amount) // Ensure sufficient balance
  );

  if (validProviders.length === 0) {
    const errorMsg = `No healthy provider available for operator ${operator_code} with amount ${amount}`;
    logger.error('RoutingService: No valid providers', { operatorCode: operator_code, amount, providers });
    throw new Error(errorMsg);
  }

  // Sort by priority (highest first)
  validProviders.sort((a, b) => b.priority - a.priority);

  const providerKeys = validProviders.map(p => p.provider);
  logger.info('RoutingService: Provider sequence', {
    operatorCode: operator_code,
    amount,
    providers: providerKeys,
    totalValid: validProviders.length
  });

  return providerKeys;
}

export async function getOperatorConfig(operatorCode) {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      `SELECT op.*, pa.name as provider_name, pa.is_healthy, pa.balance
       FROM operator_providers op
       JOIN provider_accounts pa ON op.provider_key = pa.provider_key
       WHERE op.operator_code = ? AND op.is_active = true`,
      [operatorCode]
    );

    return rows || [];
  } catch (error) {
    logger.error('RoutingService: Error getting operator config', { operatorCode, error: error.message });
    return [];
  }
}

export async function updateProviderHealth(providerKey, isHealthy, balance = null) {
  try {
    const pool = getPool();
    const updateData = {
      is_healthy: isHealthy,
      last_health_check: new Date()
    };

    if (balance !== null) {
      updateData.balance = balance;
    }

    await pool.execute(
      'UPDATE provider_accounts SET ? WHERE provider_key = ?',
      [updateData, providerKey]
    );

    // Clear provider factory cache to reload with new health status
    providerFactory.clearCache(providerKey);

    logger.info('RoutingService: Updated provider health', { providerKey, isHealthy, balance });

  } catch (error) {
    logger.error('RoutingService: Error updating provider health', { providerKey, error: error.message });
  }
}

export async function getAllOperators() {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT DISTINCT operator_code FROM operator_providers WHERE is_active = true ORDER BY operator_code'
    );

    return rows.map(r => r.operator_code);
  } catch (error) {
    logger.error('RoutingService: Error getting operators', { error: error.message });
    return Object.keys(STATIC_ROUTING);
  }
}