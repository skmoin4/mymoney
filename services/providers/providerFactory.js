// src/services/providers/providerFactory.js
/**
 * ProviderFactory - register providers and return instances by key.
 * Supports both static registration and dynamic loading from database.
 */

import createMockProvider from './mockProvider.js';
import createGenericProvider from './genericProvider.js';
import createTuktukProvider from './tuktukProvider.js';
import { getPool } from '../../config/db.js';
import logger from '../../utils/logger.js';

const registry = new Map();
const dbInstances = new Map(); // Cache for DB-loaded providers

// Register built-in providers
registry.set('mock', createMockProvider({ name: 'mock' }));
registry.set('generic', createGenericProvider);
registry.set('tuktuk', createTuktukProvider);

export default {
  /**
   * get(providerKey) -> provider instance
   * First checks static registry, then tries to load from database
   */
  async get(providerKey) {
    const key = (providerKey || 'mock').toString().toLowerCase();

    // Check static registry first
    if (registry.has(key)) {
      const factory = registry.get(key);
      if (typeof factory === 'function') {
        // It's a factory function, call it with default config
        return factory({});
      }
      // It's already an instance
      return factory;
    }

    // Try to load from database
    try {
      return await this.getFromDatabase(key);
    } catch (error) {
      logger.warn('ProviderFactory: Failed to load from DB, using mock', { key, error: error.message });
      return registry.get('mock');
    }
  },

  /**
   * Load provider instance from database
   */
  async getFromDatabase(providerKey) {
    // Check cache first
    if (dbInstances.has(providerKey)) {
      return dbInstances.get(providerKey);
    }

    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT * FROM provider_accounts WHERE provider_key = ? AND is_active = true',
      [providerKey]
    );

    if (!rows || rows.length === 0) {
      throw new Error(`Provider ${providerKey} not found in database`);
    }

    const account = rows[0];
    const config = JSON.parse(account.config || '{}');

    // Determine which factory to use based on provider type or use generic
    let factory;
    if (account.provider_key === 'tuktuk') {
      factory = createTuktukProvider;
    } else {
      factory = createGenericProvider;
    }

    // Create instance with DB config
    const instance = factory(config);

    // Cache the instance
    dbInstances.set(providerKey, instance);

    logger.info('ProviderFactory: Loaded provider from database', {
      key: providerKey,
      balance: account.balance,
      healthy: account.is_healthy
    });

    return instance;
  },

  /**
   * Register a provider statically
   */
  register(name, factoryFn) {
    const key = name.toString().toLowerCase();
    registry.set(key, factoryFn);
    // Clear cache if re-registering
    dbInstances.delete(key);
  },

  /**
   * Clear database provider cache (useful after config updates)
   */
  clearCache(providerKey = null) {
    if (providerKey) {
      dbInstances.delete(providerKey);
    } else {
      dbInstances.clear();
    }
  },

  /**
   * List all available providers (static + DB)
   */
  async listAll() {
    const staticProviders = Array.from(registry.keys());

    try {
      const pool = getPool();
      const [rows] = await pool.execute(
        'SELECT provider_key FROM provider_accounts WHERE is_active = true'
      );
      const dbProviders = rows.map(r => r.provider_key);

      return [...new Set([...staticProviders, ...dbProviders])];
    } catch (error) {
      logger.warn('ProviderFactory: Could not list DB providers', { error: error.message });
      return staticProviders;
    }
  },

  /**
   * Get provider account info from database
   */
  async getAccountInfo(providerKey) {
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id, provider_key, name, balance, currency, is_active, is_healthy, last_health_check FROM provider_accounts WHERE provider_key = ?',
      [providerKey]
    );

    return rows && rows.length > 0 ? rows[0] : null;
  }
};
