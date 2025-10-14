// src/services/providerService.js
import { getPool } from '../config/db.js';
import logger from '../utils/logger.js';

/**
 * Provider service for balance adjustments and account management
 */

/**
 * Credit provider account balance
 */
export async function creditProviderAccount(providerAccountId, amount, reason, refId, externalConn = null) {
  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) throw new Error('invalid_amount');

  const useExternalConn = externalConn !== null;
  const conn = useExternalConn ? externalConn : await getPool().getConnection();

  try {
    if (!useExternalConn) {
      await conn.beginTransaction();
    }

    // Lock provider account row
    const [rows] = await conn.execute('SELECT id, provider_key, balance FROM provider_accounts WHERE id = ? FOR UPDATE', [providerAccountId]);
    if (!rows || rows.length === 0) {
      throw new Error('provider_account_not_found');
    }

    const account = rows[0];
    const prevBalance = Number(account.balance || 0);
    const newBalance = +(prevBalance + numericAmount);

    // Update balance
    await conn.execute('UPDATE provider_accounts SET balance = ?, updated_at = NOW() WHERE id = ?', [newBalance, account.id]);

    // Insert provider transaction record
    await conn.execute(
      `INSERT INTO provider_transactions (provider_account_id, type, amount, provider_txn_id, reference_id, status, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [account.id, 'adjustment', numericAmount, null, refId, 'success', JSON.stringify({ reason, type: 'credit' })]
    );

    if (!useExternalConn) {
      await conn.commit();
    }

    logger.info('Provider account credited', {
      providerAccountId,
      provider_key: account.provider_key,
      amount: numericAmount,
      previousBalance: prevBalance,
      newBalance,
      reason,
      refId
    });

    return {
      providerAccountId: account.id,
      provider_key: account.provider_key,
      previousBalance: prevBalance,
      balance: newBalance
    };
  } catch (err) {
    if (!useExternalConn) {
      try { await conn.rollback(); } catch (_) {}
    }
    logger.error('creditProviderAccount error', { err: err.message, providerAccountId, amount });
    throw err;
  } finally {
    if (!useExternalConn) {
      conn.release();
    }
  }
}

/**
 * Debit provider account balance
 */
export async function debitProviderAccount(providerAccountId, amount, reason, refId, externalConn = null) {
  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) throw new Error('invalid_amount');

  const useExternalConn = externalConn !== null;
  const conn = useExternalConn ? externalConn : await getPool().getConnection();

  try {
    if (!useExternalConn) {
      await conn.beginTransaction();
    }

    // Lock provider account row
    const [rows] = await conn.execute('SELECT id, provider_key, balance FROM provider_accounts WHERE id = ? FOR UPDATE', [providerAccountId]);
    if (!rows || rows.length === 0) {
      throw new Error('provider_account_not_found');
    }

    const account = rows[0];
    const prevBalance = Number(account.balance || 0);

    if (prevBalance < numericAmount) {
      throw new Error('insufficient_provider_balance');
    }

    const newBalance = +(prevBalance - numericAmount);

    // Update balance
    await conn.execute('UPDATE provider_accounts SET balance = ?, updated_at = NOW() WHERE id = ?', [newBalance, account.id]);

    // Insert provider transaction record
    await conn.execute(
      `INSERT INTO provider_transactions (provider_account_id, type, amount, provider_txn_id, reference_id, status, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [account.id, 'adjustment', numericAmount, null, refId, 'success', JSON.stringify({ reason, type: 'debit' })]
    );

    if (!useExternalConn) {
      await conn.commit();
    }

    logger.info('Provider account debited', {
      providerAccountId,
      provider_key: account.provider_key,
      amount: numericAmount,
      previousBalance: prevBalance,
      newBalance,
      reason,
      refId
    });

    return {
      providerAccountId: account.id,
      provider_key: account.provider_key,
      previousBalance: prevBalance,
      balance: newBalance
    };
  } catch (err) {
    if (!useExternalConn) {
      try { await conn.rollback(); } catch (_) {}
    }
    logger.error('debitProviderAccount error', { err: err.message, providerAccountId, amount });
    throw err;
  } finally {
    if (!useExternalConn) {
      conn.release();
    }
  }
}

/**
 * Get provider account info
 */
export async function getProviderAccount(providerAccountId) {
  const pool = getPool();
  const [rows] = await pool.execute('SELECT * FROM provider_accounts WHERE id = ? LIMIT 1', [providerAccountId]);
  return rows && rows.length > 0 ? rows[0] : null;
}

export default {
  creditProviderAccount,
  debitProviderAccount,
  getProviderAccount
};