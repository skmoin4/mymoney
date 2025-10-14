// src/services/superAdminWalletService.js
import { getPool } from '../config/db.js';
import walletService from './walletService.js';
import logger from '../utils/logger.js';

const SUPER_ADMIN_USER_ID = 6; // आपने database में 6 use किया है

/**
 * Initialize super admin wallet if it doesn't exist
 */
export async function initializeSuperAdminWallet() {
  try {
    const pool = getPool();

    // Check if super admin wallet exists
    const [rows] = await pool.execute(
      'SELECT id FROM wallets WHERE user_id = ? LIMIT 1',
      [SUPER_ADMIN_USER_ID]
    );

    if (rows.length === 0) {
      // Create super admin wallet
      await pool.execute(
        'INSERT INTO wallets (user_id, balance, reserved, currency, created_at) VALUES (?, 0, 0, ?, NOW())',
        [SUPER_ADMIN_USER_ID, 'INR']
      );
      logger.info('Super admin wallet created');
    }

    return true;
  } catch (err) {
    logger.error('initializeSuperAdminWallet error', { err: err.message });
    throw err;
  }
}

/**
 * Credit platform revenue (commissions, fees, etc.)
 */
export async function creditPlatformRevenue(amount, source, reference) {
  try {
    const result = await walletService.creditWallet(
      SUPER_ADMIN_USER_ID,
      amount,
      'platform_revenue',
      reference,
      `Platform revenue from ${source}`
    );

    logger.info('Platform revenue credited', { amount, source, reference });
    return result;
  } catch (err) {
    logger.error('creditPlatformRevenue error', { err: err.message, amount, source });
    throw err;
  }
}

/**
 * Debit for provider settlements
 */
export async function debitForSettlement(amount, provider, reference) {
  try {
    const result = await walletService.debitWallet(
      SUPER_ADMIN_USER_ID,
      amount,
      'provider_settlement',
      reference,
      `Settlement payment to ${provider}`
    );

    logger.info('Provider settlement debited', { amount, provider, reference });
    return result;
  } catch (err) {
    logger.error('debitForSettlement error', { err: err.message, amount, provider });
    throw err;
  }
}

/**
 * Get platform balance
 */
export async function getPlatformBalance() {
  try {
    return await walletService.getWallet(SUPER_ADMIN_USER_ID);
  } catch (err) {
    logger.error('getPlatformBalance error', { err: err.message });
    throw err;
  }
}

/**
 * Get platform transaction history
 */
export async function getPlatformTransactions(page = 1, limit = 20) {
  const pool = getPool();
  const offset = (page - 1) * limit;

  try {
    // First get the wallet_id
    const [walletRows] = await pool.execute('SELECT id FROM wallets WHERE user_id = ?', [SUPER_ADMIN_USER_ID]);
    if (!walletRows || walletRows.length === 0) {
      logger.warn('No super admin wallet found', { userId: SUPER_ADMIN_USER_ID });
      return [];
    }

    const walletId = walletRows[0].id;
    logger.info('Super admin wallet found', { walletId, userId: SUPER_ADMIN_USER_ID });

    const sql = `
      SELECT id, wallet_id, type, amount, balance_after, ref_type, ref_id, note, created_at
      FROM wallet_ledger
      WHERE wallet_id = ?
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    logger.info('Executing platform transactions query', { walletId, limit, offset });

    const [rows] = await pool.execute(sql, [walletId]);

    logger.info('Platform transactions query successful', { count: rows.length, walletId });
    return rows;
  } catch (err) {
    logger.error('getPlatformTransactions error', {
      err: err.message,
      stack: err.stack,
      page,
      limit,
      offset
    });
    throw err;
  }
}