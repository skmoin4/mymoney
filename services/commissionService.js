// src/services/commissionService.js
import { getPool } from '../config/db.js';
import walletService from './walletService.js';
import { creditPlatformRevenue } from './superAdminWalletService.js';
import logger from '../utils/logger.js';

/**
 * Calculate commission amount for an operator based on pack rules.
 */
export async function calculateCommission(userId, operatorCode, amount) {
  const pool = getPool();
  // load user's commission pack
  const [userRows] = await pool.execute(
    'SELECT commission_pack_id FROM users WHERE id = ? LIMIT 1',
    [userId]
  );
  if (!userRows || !userRows[0] || !userRows[0].commission_pack_id) {
    return { commission: 0, packId: null };
  }
  const packId = userRows[0].commission_pack_id;

  const [packRows] = await pool.execute(
    'SELECT * FROM commission_packs WHERE id = ? AND status = "active" LIMIT 1',
    [packId]
  );
  if (!packRows || packRows.length === 0) {
    return { commission: 0, packId };
  }
  const pack = packRows[0];

  const overrides = pack.operator_overrides ? JSON.parse(pack.operator_overrides) : {};
  let percent = overrides[operatorCode] || pack.global_commission || 0;
  const commission = ((Number(amount) || 0) * Number(percent)) / 100.0;

  return { commission, packId };
}

/**
 * Credit commission to user's wallet.
 * Optionally, extend later for distributor/upline logic.
 */
export async function creditCommission(userId, txnRef, operatorCode, amount) {
  try {
    const { commission, packId } = await calculateCommission(userId, operatorCode, amount);
    if (commission <= 0) return { commission: 0 };

    // credit to user's wallet
    const note = `Commission for txn ${txnRef} (${operatorCode})`;
    const walletResult = await walletService.creditWallet(
      userId,
      commission,
      'commission',
      txnRef,
      note
    );

    // credit platform revenue (the commission amount)
    await creditPlatformRevenue(
      commission,
      `commission_${operatorCode}`,
      txnRef
    );

    // also update transactions table with commission info
    const pool = getPool();
    await pool.execute(
      'UPDATE transactions SET commission_amount = ?, commission_pack_id = ? WHERE txn_ref = ?',
      [commission, packId, txnRef]
    );

    return { commission, wallet: walletResult };
  } catch (err) {
    logger.error('creditCommission error', { err: err.stack || err.message, userId, txnRef });
    throw err;
  }
}

/**
 * Provider Commission Service - handles platform commissions from providers
 */

const SUPER_ADMIN_USER_ID = 6; // Platform admin user ID

export async function calculateProviderCommission(operatorCode, amount, providerKey) {
  try {
    const pool = getPool();

    // Get commission config
    const [rows] = await pool.execute(
      'SELECT user_price, provider_cost FROM commission_config WHERE operator_code = ? AND provider_key = ? AND is_active = true LIMIT 1',
      [operatorCode, providerKey]
    );

    if (!rows || rows.length === 0) {
      logger.warn('CommissionService: No provider commission config found, using default', { operatorCode, providerKey });
      // Default: 2% commission
      return parseFloat(amount) * 0.02;
    }

    const config = rows[0];
    const userPrice = parseFloat(config.user_price);
    const providerCost = parseFloat(config.provider_cost);
    const commission = userPrice - providerCost;

    logger.info('CommissionService: Calculated provider commission', {
      operatorCode,
      providerKey,
      amount,
      userPrice,
      providerCost,
      commission
    });

    return commission;

  } catch (error) {
    logger.error('CommissionService: Error calculating provider commission', {
      operatorCode,
      providerKey,
      error: error.message
    });
    // Fallback to 2% commission
    return parseFloat(amount) * 0.02;
  }
}

export async function creditProviderCommission(operatorCode, amount, providerKey, referenceId) {
  try {
    const commission = await calculateProviderCommission(operatorCode, amount, providerKey);

    if (commission <= 0) {
      logger.info('CommissionService: No provider commission to credit', { operatorCode, amount, commission });
      return { credited: false, amount: 0 };
    }

    // Credit commission to super admin wallet
    const result = await walletService.creditWallet(
      SUPER_ADMIN_USER_ID,
      commission,
      'provider_commission',
      referenceId,
      `Provider commission for ${operatorCode} recharge via ${providerKey}`
    );

    logger.info('CommissionService: Credited provider commission', {
      operatorCode,
      amount,
      commission,
      referenceId,
      walletResult: result
    });

    return { credited: true, amount: commission, walletResult: result };

  } catch (error) {
    logger.error('CommissionService: Error crediting provider commission', {
      operatorCode,
      amount,
      error: error.message
    });
    throw error;
  }
}

export async function getProviderCommissionConfig(operatorCode, providerKey) {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT * FROM commission_config WHERE operator_code = ? AND provider_key = ? AND is_active = true LIMIT 1',
      [operatorCode, providerKey]
    );

    return rows && rows.length > 0 ? rows[0] : null;

  } catch (error) {
    logger.error('CommissionService: Error getting provider commission config', {
      operatorCode,
      providerKey,
      error: error.message
    });
    return null;
  }
}

export async function updateProviderCommissionConfig(operatorCode, providerKey, userPrice, providerCost) {
  try {
    const pool = getPool();

    await pool.execute(
      `INSERT INTO commission_config (operator_code, provider_key, user_price, provider_cost)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE user_price = VALUES(user_price), provider_cost = VALUES(provider_cost)`,
      [operatorCode, providerKey, userPrice, providerCost]
    );

    logger.info('CommissionService: Updated provider commission config', {
      operatorCode,
      providerKey,
      userPrice,
      providerCost,
      commission: userPrice - providerCost
    });

  } catch (error) {
    logger.error('CommissionService: Error updating provider commission config', {
      operatorCode,
      providerKey,
      error: error.message
    });
    throw error;
  }
}

export async function getAllProviderCommissionConfigs() {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT * FROM commission_config WHERE is_active = true ORDER BY operator_code, provider_key'
    );

    return rows || [];

  } catch (error) {
    logger.error('CommissionService: Error getting all provider commission configs', { error: error.message });
    return [];
  }
}