// src/services/walletService.js
import { getPool } from '../config/db.js';
import logger from '../utils/logger.js';
import { creditCommission } from './commissionService.js';

/**
 * Wallet service - full implementation for:
 * - getWallet(userId)
 * - ensureWallet(userId)
 * - insertLedger(conn, {...})
 * - creditWallet(userId, amount, refType, refId, note, metadata)
 * - reserveAmount(userId, amount, options)
 * - finalizeDebit(userId, amount, options)
 * - refundReserved(userId, amount, options)
 *
 * All mutating operations are atomic transactions using SELECT ... FOR UPDATE.
 */

/* ---------------------- helper: insert ledger ---------------------- */
async function insertLedger(conn, { walletId, type, amount, balanceAfter, refType, refId, note, metadata }) {
  const sql = `INSERT INTO wallet_ledger 
    (wallet_id, type, amount, balance_after, ref_type, ref_id, note, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`;

  const params = [
    walletId,
    type,
    amount,
    balanceAfter,
    refType || null,
    refId || null,
    note || null,
    metadata ? JSON.stringify(metadata) : null
  ];

  await conn.execute(sql, params);
}

/* ---------------------- getWallet / ensureWallet ---------------------- */
export async function getWallet(userId) {
  const pool = getPool();
  try {
    const [rows] = await pool.execute('SELECT id, user_id, balance, reserved, currency FROM wallets WHERE user_id = ? LIMIT 1', [userId]);
    if (!rows || rows.length === 0) {
      return {
        walletId: null,
        userId,
        balance: 0.00,
        reserved: 0.00,
        currency: 'INR'
      };
    }
    const w = rows[0];
    return {
      walletId: w.id,
      userId: w.user_id,
      balance: Number(w.balance || 0),
      reserved: Number(w.reserved || 0),
      currency: w.currency || 'INR'
    };
  } catch (err) {
    logger.error('getWallet error', { err: err.message, userId });
    throw err;
  }
}

export async function ensureWallet(userId) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT id, user_id, balance, reserved, currency FROM wallets WHERE user_id = ? FOR UPDATE', [userId]);
    if (rows && rows.length > 0) {
      await conn.commit();
      const w = rows[0];
      return {
        walletId: w.id,
        userId: w.user_id,
        balance: Number(w.balance || 0),
        reserved: Number(w.reserved || 0),
        currency: w.currency || 'INR'
      };
    }
    const currency = 'INR';
    const [ins] = await conn.execute('INSERT INTO wallets (user_id, balance, reserved, currency, created_at) VALUES (?, 0, 0, ?, NOW())', [userId, currency]);
    const walletId = ins.insertId;
    await conn.commit();
    return { walletId, userId, balance: 0.00, reserved: 0.00, currency };
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    logger.error('ensureWallet error', { err: err.message, userId });
    throw err;
  } finally {
    conn.release();
  }
}

/* ---------------------- creditWallet ---------------------- */
export async function creditWallet(userId, amount, refType, refId, note, metadata, externalConn = null) {
  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) throw new Error('invalid_amount');

  const useExternalConn = externalConn !== null;
  const conn = useExternalConn ? externalConn : await getPool().getConnection();

  try {
    if (!useExternalConn) {
      await conn.beginTransaction();
    }

    const [rows] = await conn.execute('SELECT id, balance, reserved FROM wallets WHERE user_id = ? FOR UPDATE', [userId]);
    if (!rows || rows.length === 0) {
      if (!useExternalConn) await conn.rollback();
      throw new Error('wallet_not_found');
    }

    const wallet = rows[0];
    const prevBalance = Number(wallet.balance || 0);
    const newBalance = +(prevBalance + numericAmount);

    await conn.execute('UPDATE wallets SET balance = ?, updated_at = NOW() WHERE id = ?', [newBalance, wallet.id]);

    await insertLedger(conn, {
      walletId: wallet.id,
      type: 'credit',
      amount: numericAmount,
      balanceAfter: newBalance,
      refType,
      refId,
      note,
      metadata
    });

    if (!useExternalConn) {
      await conn.commit();
    }
    return { walletId: wallet.id, previousBalance: prevBalance, balance: newBalance };
  } catch (err) {
    if (!useExternalConn) {
      try { await conn.rollback(); } catch (_) {}
    }
    logger.error('creditWallet error', { err: err.message, userId, amount, refType, refId });
    throw err;
  } finally {
    if (!useExternalConn) {
      conn.release();
    }
  }
}

/* ---------------------- reserveAmount ---------------------- */
export async function reserveAmount(userId, totalAmount, options = {}) {
  const amount = Number(totalAmount);
  if (isNaN(amount) || amount <= 0) throw new Error('invalid_amount');

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute('SELECT id, balance, reserved FROM wallets WHERE user_id = ? FOR UPDATE', [userId]);
    if (!rows || rows.length === 0) {
      await conn.rollback();
      throw new Error('wallet_not_found');
    }

    const w = rows[0];
    const prevBalance = Number(w.balance || 0);
    const prevReserved = Number(w.reserved || 0);
    const available = +(prevBalance - prevReserved);

    if (available < amount) {
      await conn.rollback();
      throw new Error('insufficient_funds');
    }

    const newReserved = +(prevReserved + amount);
    await conn.execute('UPDATE wallets SET reserved = ?, updated_at = NOW() WHERE id = ?', [newReserved, w.id]);

    const balanceAfter = +(prevBalance - newReserved);
    await insertLedger(conn, {
      walletId: w.id,
      type: 'reserve',
      amount,
      balanceAfter,
      refType: options.refType || 'reserve',
      refId: options.refId || null,
      note: options.note || 'reserved for transaction',
      metadata: options.metadata || null
    });

    await conn.commit();
    return {
      walletId: w.id,
      previousBalance: prevBalance,
      previousReserved: prevReserved,
      newReserved,
      availableAfter: +(prevBalance - newReserved)
    };
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    logger.error('reserveAmount error', { err: err.message, userId, totalAmount });
    throw err;
  } finally {
    conn.release();
  }
}

/* ---------------------- finalizeDebit ---------------------- */
export async function finalizeDebit(userId, amount, options = {}) {
  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) throw new Error('invalid_amount');

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute('SELECT id, balance, reserved FROM wallets WHERE user_id = ? FOR UPDATE', [userId]);
    if (!rows || rows.length === 0) {
      await conn.rollback();
      throw new Error('wallet_not_found');
    }

    const w = rows[0];
    const prevBalance = Number(w.balance || 0);
    const prevReserved = Number(w.reserved || 0);

    if (prevReserved < numericAmount) {
      await conn.rollback();
      throw new Error('reserved_insufficient');
    }

    const newReserved = +(prevReserved - numericAmount);
    const newBalance = +(prevBalance - numericAmount);

    await conn.execute('UPDATE wallets SET reserved = ?, balance = ?, updated_at = NOW() WHERE id = ?', [newReserved, newBalance, w.id]);

    await insertLedger(conn, {
      walletId: w.id,
      type: 'debit',
      amount: numericAmount,
      balanceAfter: newBalance,
      refType: options.refType || 'finalize',
      refId: options.refId || null,
      note: options.note || 'finalized debit on success',
      metadata: options.metadata || null
    });

    await conn.commit();

    // Credit commission if applicable
    const { refId: txnRef, operator_code } = options;
    if (txnRef && operator_code) {
      try {
        await creditCommission(userId, txnRef, operator_code, numericAmount);
      } catch (err) {
        logger.error('commission credit failed', { txnRef, operator_code, err: err.message });
      }
    }

    return { walletId: w.id, previousBalance: prevBalance, previousReserved: prevReserved, balance: newBalance, reserved: newReserved };
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    logger.error('finalizeDebit error', { err: err.message, userId, amount });
    throw err;
  } finally {
    conn.release();
  }
}

/* ---------------------- refundReserved ---------------------- */
export async function refundReserved(userId, amount, options = {}) {
  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) throw new Error('invalid_amount');

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute('SELECT id, balance, reserved FROM wallets WHERE user_id = ? FOR UPDATE', [userId]);
    if (!rows || rows.length === 0) {
      await conn.rollback();
      throw new Error('wallet_not_found');
    }

    const w = rows[0];
    const prevBalance = Number(w.balance || 0);
    const prevReserved = Number(w.reserved || 0);

    if (prevReserved < numericAmount) {
      await conn.rollback();
      throw new Error('reserved_insufficient');
    }

    const newReserved = +(prevReserved - numericAmount);
    // Balance remains unchanged because we only reserved earlier (didn't debit)
    const balanceAfter = +(prevBalance - newReserved);

    await conn.execute('UPDATE wallets SET reserved = ?, updated_at = NOW() WHERE id = ?', [newReserved, w.id]);

    await insertLedger(conn, {
      walletId: w.id,
      type: 'refund',
      amount: numericAmount,
      balanceAfter,
      refType: options.refType || 'refund',
      refId: options.refId || null,
      note: options.note || 'refund reserved amount',
      metadata: options.metadata || null
    });

    await conn.commit();
    return { walletId: w.id, previousBalance: prevBalance, previousReserved: prevReserved, balance: prevBalance, reserved: newReserved };
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    logger.error('refundReserved error', { err: err.message, userId, amount });
    throw err;
  } finally {
    conn.release();
  }
}

/* ---------------------- admin adjustment functions ---------------------- */

/**
 * Credit wallet immediately (admin)
 * returns wallet row / ledger info
 */
export async function creditWalletAdmin(userId, amount, ref, note, externalConn = null) {
  return creditWallet(userId, amount, 'admin_adjustment', ref, note, null, externalConn);
}

/**
 * Debit wallet immediately (admin)
 * Should check balance
 */
export async function debitWalletAdmin(userId, amount, ref, note, externalConn = null) {
  const numericAmount = Number(amount);
  if (isNaN(numericAmount) || numericAmount <= 0) throw new Error('invalid_amount');

  const useExternalConn = externalConn !== null;
  const conn = useExternalConn ? externalConn : await getPool().getConnection();

  try {
    if (!useExternalConn) {
      await conn.beginTransaction();
    }

    // lock wallet row
    const [wrows] = await conn.execute('SELECT id, balance FROM wallets WHERE user_id = ? FOR UPDATE', [userId]);
    if (!wrows || wrows.length === 0) throw new Error('wallet_not_found');

    const w = wrows[0];
    const prevBalance = Number(w.balance || 0);

    if (prevBalance < numericAmount) throw new Error('insufficient_funds');

    const newBalance = +(prevBalance - numericAmount);
    await conn.execute('UPDATE wallets SET balance = ? WHERE id = ?', [newBalance, w.id]);

    // insert ledger row
    await insertLedger(conn, {
      walletId: w.id,
      type: 'debit',
      amount: numericAmount,
      balanceAfter: newBalance,
      refType: 'admin_adjustment',
      refId: ref,
      note,
      metadata: null
    });

    if (!useExternalConn) {
      await conn.commit();
    }
    return { walletId: w.id, previousBalance: prevBalance, balance: newBalance };
  } catch (err) {
    if (!useExternalConn) {
      try { await conn.rollback(); } catch (_) {}
    }
    logger.error('debitWalletAdmin error', { err: err.message, userId, amount });
    throw err;
  } finally {
    if (!useExternalConn) {
      conn.release();
    }
  }
}

/* ---------------------- exports ---------------------- */
export default {
  getWallet,
  ensureWallet,
  creditWallet,
  reserveAmount,
  finalizeDebit,
  refundReserved,
  creditWalletAdmin,
  debitWalletAdmin
};
