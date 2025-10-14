// src/controllers/walletController.js
import Joi from 'joi';
import { getWallet, ensureWallet ,creditWallet,reserveAmount,finalizeDebit,refundReserved} from '../../services/walletService.js';
import walletService from '../../services/walletService.js';
import { getPool } from '../../config/db.js';
import logger from '../../utils/logger.js';

/**
 * GET /api/v1/wallet
 * Protected route - requires auth middleware
 */
export async function getWalletHandler(req, res) {
  try {
    const user = req.user;
    if (!user || !user.id) {
      return res.status(401).json({ error: 'unauthenticated' });
    }

    // try to get wallet; if not found we can optionally create it
    let wallet = await getWallet(user.id);

    // If walletId is null, optionally auto-create for the user.
    // Uncomment the next line if you want auto-creation behavior:
    // wallet = wallet.walletId ? wallet : await ensureWallet(user.id);

    return res.json({
      wallet: {
        id: wallet.walletId,
        user_id: wallet.userId,
        balance: Number(wallet.balance).toFixed(2),
        reserved: Number(wallet.reserved).toFixed(2),
        currency: wallet.currency
      }
    });
  } catch (err) {
    logger.error('getWalletHandler error', { err: err.message, userId: req.user?.id });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}

/**
 * GET /api/v1/wallet/ledger
 * Get wallet transaction history/ledger
 * Query params: page, limit, type, ref_type
 */
export async function getWalletLedgerHandler(req, res) {
  try {
    const user = req.user;
    if (!user || !user.id) {
      return res.status(401).json({ error: 'unauthenticated' });
    }

    const pool = getPool();
    const { page = 1, limit = 20, type, ref_type } = req.query;

    const offset = (page - 1) * limit;
    let whereClause = 'WHERE wl.wallet_id = w.id AND w.user_id = ?';
    const params = [user.id];

    if (type) {
      whereClause += ' AND wl.type = ?';
      params.push(type);
    }

    if (ref_type) {
      whereClause += ' AND wl.ref_type = ?';
      params.push(ref_type);
    }

    // Get total count
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) as total FROM wallet_ledger wl JOIN wallets w ON wl.wallet_id = w.id ${whereClause.replace('WHERE wl.wallet_id = w.id AND w.user_id = ?', 'WHERE w.user_id = ?')}`,
      [user.id, ...(type ? [type] : []), ...(ref_type ? [ref_type] : [])]
    );
    const total = countRows[0].total;

    // Get ledger entries
    const [rows] = await pool.execute(
      `SELECT wl.id, wl.type, wl.amount, wl.balance_after, wl.ref_type, wl.ref_id, wl.note, wl.metadata, wl.created_at
       FROM wallet_ledger wl
       JOIN wallets w ON wl.wallet_id = w.id
       ${whereClause}
       ORDER BY wl.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Parse metadata JSON
    const ledger = rows.map(row => ({
      ...row,
      amount: Number(row.amount),
      balance_after: Number(row.balance_after),
      metadata: row.metadata ? JSON.parse(row.metadata) : null
    }));

    return res.json({
      ok: true,
      data: ledger,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    logger.error('getWalletLedgerHandler error', { err: err.message, userId: req.user?.id });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}

export async function creditWalletHandler(req, res) {
  try {
    const caller = req.user;
    if (!caller || !caller.id) {
      return res.status(401).json({ error: 'unauthenticated' });
    }

    const { amount, ref_id, note, user_id } = req.body;
    if (!amount) {
      return res.status(400).json({ error: 'amount_required' });
    }

    let targetUserId;

    if (caller.role === 'admin') {
      // admin can credit any user's wallet
      if (!user_id) {
        return res.status(400).json({ error: 'user_id_required_for_admin' });
      }
      targetUserId = user_id;
    } else {
      // normal user can only credit self
      targetUserId = caller.id;
    }

    const result = await creditWallet(
      targetUserId,
      Number(amount),
      'manual',
      ref_id || null,
      note || 'test credit'
    );

    return res.json({ ok: true, wallet: result });
  } catch (err) {
    logger.error('creditWalletHandler error', { err: err.message, userId: req.user?.id });
    return res.status(500).json({ error: 'internal_server_error', detail: err.message });
  }
}



export async function reserveHandler(req, res) {
  try {
    const user = req.user;
    if (!user || !user.id) return res.status(401).json({ error: 'unauthenticated' });

    const { amount, ref_id, note } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount_required' });

    const result = await reserveAmount(user.id, Number(amount), {
      refType: 'test_reserve',
      refId: ref_id || null,
      note: note || 'test reserve'
    });

    return res.json({ ok: true, result });
  } catch (err) {
    // known errors
    if (err.message === 'insufficient_funds') return res.status(402).json({ error: 'insufficient_funds' });
    if (err.message === 'wallet_not_found') return res.status(404).json({ error: 'wallet_not_found' });
    return res.status(500).json({ error: 'internal_server_error', detail: err.message });
  }
}
export async function finalizeHandler(req, res) {
  try {
    const actor = req.user;
    if (!actor || actor.role !== 'admin') return res.status(403).json({ error: 'admin_required' });

    const { user_id: userId, amount, ref_id, note } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: 'user_id_and_amount_required' });

    const result = await walletService.finalizeDebit(Number(userId), Number(amount), {
      refType: 'txn_final',
      refId: ref_id || null,
      note: note || 'finalize after provider success'
    });

    return res.json({ ok: true, result });
  } catch (err) {
    logger.error('finalizeHandler error', { err: err.message, body: req.body });
    if (err.message === 'reserved_insufficient') return res.status(409).json({ error: 'reserved_insufficient' });
    if (err.message === 'wallet_not_found') return res.status(404).json({ error: 'wallet_not_found' });
    return res.status(500).json({ error: 'internal_server_error', detail: err.message });
  }
}
export async function refundHandler(req, res) {
  try {
    const actor = req.user;
    if (!actor || actor.role !== 'admin') return res.status(403).json({ error: 'admin_required' });

    const { user_id: userId, amount, ref_id, note } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: 'user_id_and_amount_required' });

    const result = await walletService.refundReserved(Number(userId), Number(amount), {
      refType: 'txn_refund',
      refId: ref_id || null,
      note: note || 'refund reserved on failure'
    });

    return res.json({ ok: true, result });
  } catch (err) {
    logger.error('refundHandler error', { err: err.message, body: req.body });
    if (err.message === 'reserved_insufficient') return res.status(409).json({ error: 'reserved_insufficient' });
    if (err.message === 'wallet_not_found') return res.status(404).json({ error: 'wallet_not_found' });
    return res.status(500).json({ error: 'internal_server_error', detail: err.message });
  }
}
