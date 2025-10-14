// src/controllers/adminProviderController.js
import { getPool } from '../../config/db.js';
import providerFactory from '../../services/providers/providerFactory.js';
import { updateProviderHealth } from '../../services/routingService.js';
import logger from '../../utils/logger.js';
import { emitAdminEvent } from '../../realTime/socket.js';
import { notificationQueue } from '../../queues/index.js';

export async function adminProviderTopup(req, res) {
  /**
   * Body:
   * {
   *   provider_id: 'mock',
   *   account_name: 'default',
   *   mode: 'api' | 'bank',
   *   amount: 10000,
   *   currency: 'INR',
   *   reference: 'admin-topup-20250918-001'   // idempotency
   *   payload: {...}                          // optional extra
   * }
   */
  try {
    const admin = req.user || { id: 1 }; // Mock admin for testing
    const {
      provider_id,
      account_name = 'default',
      mode = 'api',
      amount,
      currency = 'INR',
      reference,
      payload = {}
    } = req.body || {};

    if (!provider_id) return res.status(400).json({ error: 'provider_id_required' });
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'invalid_amount' });
    if (!['api','bank'].includes(mode)) return res.status(400).json({ error: 'invalid_mode' });

    const pool = getPool();

    // idempotency: if reference provided, check existing provider_transactions
    if (reference) {
      const [existing] = await pool.execute('SELECT id, status FROM provider_transactions WHERE reference = ? LIMIT 1', [reference]);
      if (existing && existing.length > 0) {
        return res.json({ ok: true, note: 'already_exists', transaction: existing[0] });
      }
    }

    // create a provider_transactions row in 'processing' or 'pending' depending on mode
    const initialStatus = mode === 'api' ? 'processing' : 'pending';
    const insertSql = `INSERT INTO provider_transactions
      (provider_id, type, mode, amount, currency, reference, status, initiated_by, payload, created_at)
      VALUES (?, 'topup', ?, ?, ?, ?, ?, ?, ?, NOW())`;
    const [ins] = await pool.execute(insertSql, [provider_id, mode, Number(amount), currency, reference || null, initialStatus, admin?.id || null, JSON.stringify(payload || {})]);
    const providerTxnId = ins.insertId;

    // If mode=api => call provider.topupAccount() and update provider_accounts on success
    if (mode === 'api') {
      const provider = providerFactory.get(provider_id);
      let providerRes;
      try {
        providerRes = await provider.topupAccount(Number(amount), { currency, reference, initiated_by: admin?.id, payload });
      } catch (err) {
        logger.error('adminProviderTopup: provider.topupAccount failed', { err: err.stack || err.message, provider_id, providerTxnId });
        // mark transaction failed
        await pool.execute('UPDATE provider_transactions SET status = ?, payload = JSON_MERGE_PATCH(COALESCE(payload,"{}"), ?), updated_at = NOW() WHERE id = ?', ['failed', JSON.stringify({ error: err.message }), providerTxnId]);
        return res.status(500).json({ ok: false, error: 'provider_topup_failed', detail: err.message });
      }

      // providerRes should indicate success and possibly a provider_txn_id
      const providerTxRef = providerRes && (providerRes.txn_id || providerRes.txn || providerRes.txn_id || (providerRes.raw && providerRes.raw.txn_id)) || null;
      const providerStatus = providerRes && (providerRes.ok || providerRes.status === 'success' || providerRes.status === 'ok') ? 'success' : (providerRes.status || 'failed');

      // update provider_transactions
      await pool.execute('UPDATE provider_transactions SET status = ?, payload = JSON_MERGE_PATCH(COALESCE(payload,"{}"), ?), updated_at = NOW() WHERE id = ?', [providerStatus === 'success' ? 'success' : 'failed', JSON.stringify({ providerRes }), providerTxnId]);

      if (providerStatus === 'success') {
        // update or create provider_accounts row: atomic increment
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();

          // try select for update
          const [rows] = await conn.execute('SELECT id, balance FROM provider_accounts WHERE provider_id = ? AND account_name = ? FOR UPDATE', [provider_id, account_name]);
          if (rows && rows.length > 0) {
            const pa = rows[0];
            const newBal = Number(pa.balance) + Number(amount);
            await conn.execute('UPDATE provider_accounts SET balance = ?, updated_at = NOW() WHERE id = ?', [newBal, pa.id]);
          } else {
            await conn.execute('INSERT INTO provider_accounts (provider_id, account_name, balance, currency, created_at) VALUES (?, ?, ?, ?, NOW())', [provider_id, account_name, Number(amount), currency]);
          }

          await conn.commit();
        } catch (err) {
          try { await conn.rollback(); } catch(_) {}
          logger.error('adminProviderTopup: provider_accounts update failed', { err: err.stack || err.message, provider_id, providerTxnId });
          // mark provider_transactions as failed
          await pool.execute('UPDATE provider_transactions SET status = ?, payload = JSON_MERGE_PATCH(COALESCE(payload,"{}"), ?), updated_at = NOW() WHERE id = ?', ['failed', JSON.stringify({ error: 'provider_accounts_update_failed', message: err.message }), providerTxnId]);
          return res.status(500).json({ ok: false, error: 'provider_accounts_update_failed', detail: err.message });
        } finally {
          try { conn.release(); } catch(_) {}
        }

        // success: emit admin event and enqueue admin notification
        emitAdminEvent('provider_topup_success', { provider_id, amount: Number(amount), account_name, reference, providerTxnId });
        await notificationQueue.add('admin_notification', { type: 'provider_topup_success', payload: { provider_id, amount: Number(amount), account_name, reference, providerTxnId, initiated_by: admin?.id } });

        return res.json({ ok: true, transaction_id: providerTxnId, status: 'success' });
      } else {
        // provider reported failed
        emitAdminEvent('provider_topup_failed', { provider_id, amount: Number(amount), account_name, reference, providerTxnId });
        return res.status(400).json({ ok: false, error: 'provider_topup_failed', providerRes });
      }
    }

    // If mode = bank -> leave transaction in pending for admin manual approval
    // We return created provider_transactions row
    emitAdminEvent('provider_topup_pending', { id: providerTxnId, provider_id, amount: Number(amount), account_name, reference, initiated_by: admin?.id });
    return res.json({ ok: true, transaction_id: providerTxnId, status: 'pending' });

  } catch (err) {
    logger.error('adminProviderTopup error', { err: err.stack || err.message, body: req.body });
    return res.status(500).json({ ok: false, error: 'internal_server_error', detail: err.message });
  }
}

/**
 * Add or update a provider configuration
 */
export async function addProvider(req, res) {
  try {
    logger.info('addProvider called', { body: req.body, user: req.user });

    const {
      provider_key,
      name,
      baseUrl,
      apiKey,
      secret,
      webhookSecret,
      callbackUrl,
      timeout = 30000,
      is_active = true
    } = req.body;

    if (!provider_key || !name) {
      return res.status(400).json({ error: 'provider_key and name are required' });
    }

    const pool = getPool();
    const config = {
      baseUrl,
      apiKey,
      secret,
      webhookSecret,
      callbackUrl,
      timeout: parseInt(timeout)
    };

    logger.info('Config built', { config });

    // Insert or update provider account
    await pool.execute(
      `INSERT INTO provider_accounts (provider_id, provider_key, account_name, name, balance, currency, is_healthy, config, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE account_name = VALUES(account_name), name = VALUES(name), balance = VALUES(balance), currency = VALUES(currency), is_healthy = VALUES(is_healthy), config = VALUES(config), is_active = VALUES(is_active)`,
      [provider_key, provider_key, 'default', name, 0, 'INR', true, JSON.stringify(config), is_active]
    );

    // Clear provider factory cache
    providerFactory.clearCache(provider_key);

    logger.info('Provider added/updated', { provider_key, name });
    res.json({ ok: true, message: 'Provider configuration saved' });

  } catch (error) {
    logger.error('addProvider error', { error: error.message });
    res.status(500).json({ ok: false, error: 'internal_server_error', details: error.message, stack: error.stack });
  }
}

/**
 * Get all providers
 */
export async function getProviders(req, res) {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT id, provider_key, name, balance, currency, is_active, is_healthy, last_health_check, JSON_UNQUOTE(JSON_EXTRACT(config, "$.baseUrl")) as api_url FROM provider_accounts ORDER BY provider_key'
    );

    res.json({ ok: true, data: rows });

  } catch (error) {
    logger.error('getProviders error', { error: error.message });
    res.status(500).json({ ok: false, error: 'internal_server_error' });
  }
}

/**
 * Get provider balance and health
 */
export async function getProviderBalance(req, res) {
  try {
    const { provider_key } = req.params;

    if (!provider_key) {
      return res.status(400).json({ error: 'provider_key is required' });
    }

    const accountInfo = await providerFactory.getAccountInfo(provider_key);

    if (!accountInfo) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    // Try to get live balance from provider
    try {
      const provider = await providerFactory.get(provider_key);
      const balanceInfo = await provider.getBalance();

      // Update health and balance
      await updateProviderHealth(provider_key, true, balanceInfo.balance);

      res.json({
        ok: true,
        data: {
          ...accountInfo,
          live_balance: balanceInfo.balance,
          live_currency: balanceInfo.currency,
          last_updated: new Date()
        }
      });

    } catch (error) {
      // Mark as unhealthy but still return cached data
      await updateProviderHealth(provider_key, false);

      res.json({
        ok: true,
        data: {
          ...accountInfo,
          live_balance: null,
          error: 'Failed to fetch live balance',
          last_updated: new Date()
        }
      });
    }

  } catch (error) {
    logger.error('getProviderBalance error', { error: error.message });
    res.status(500).json({ ok: false, error: 'internal_server_error' });
  }
}

/**
 * Topup provider account (updated for new schema)
 */
export async function topupProvider(req, res) {
  try {
    const {
      provider_key,
      mode = 'bank', // 'api' or 'bank'
      amount,
      reference
    } = req.body;

    if (!provider_key || !amount || amount <= 0) {
      return res.status(400).json({ error: 'provider_key and valid amount are required' });
    }

    const pool = getPool();

    // Check if provider exists
    const accountInfo = await providerFactory.getAccountInfo(provider_key);
    if (!accountInfo) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    // Create provider transaction record
    const [ins] = await pool.execute(
      `INSERT INTO provider_transactions
       (provider_account_id, type, amount, reference, status, metadata, created_at)
       VALUES (?, 'topup', ?, ?, 'pending', '{}', NOW())`,
      [accountInfo.id, parseFloat(amount), reference || null]
    );

    const txnId = ins.insertId;

    if (mode === 'api') {
      // Call provider API for topup
      try {
        const provider = await providerFactory.get(provider_key);
        const result = await provider.topupAccount(parseFloat(amount), { reference });

        if (result.ok) {
          // Update transaction and balance
          await pool.execute(
            'UPDATE provider_transactions SET status = ?, provider_txn_id = ?, metadata = ?, updated_at = NOW() WHERE id = ?',
            ['success', result.txn_id, JSON.stringify(result.raw), txnId]
          );

          // Update provider balance
          await pool.execute(
            'UPDATE provider_accounts SET balance = balance + ? WHERE id = ?',
            [parseFloat(amount), accountInfo.id]
          );

          res.json({ ok: true, transaction_id: txnId, status: 'success' });
        } else {
          await pool.execute(
            'UPDATE provider_transactions SET status = ?, metadata = ?, updated_at = NOW() WHERE id = ?',
            ['failed', JSON.stringify(result), txnId]
          );
          res.status(400).json({ ok: false, error: 'Provider topup failed' });
        }

      } catch (error) {
        await pool.execute(
          'UPDATE provider_transactions SET status = ?, metadata = ?, updated_at = NOW() WHERE id = ?',
          ['failed', JSON.stringify({ error: error.message }), txnId]
        );
        res.status(500).json({ ok: false, error: 'Provider API error' });
      }

    } else {
      // Bank mode - just record the transaction as pending for manual processing
      res.json({ ok: true, transaction_id: txnId, status: 'pending', message: 'Awaiting bank transfer confirmation' });
    }

  } catch (error) {
    logger.error('topupProvider error', { error: error.message });
    res.status(500).json({ ok: false, error: 'internal_server_error' });
  }
}

/**
 * Get provider transactions
 */
export async function getProviderTransactions(req, res) {
  try {
    const { provider_key, page = 1, limit = 20 } = req.query;
    const pool = getPool();

    const offset = (page - 1) * limit;
    let whereClause = '';
    const params = [];

    if (provider_key) {
      whereClause = 'WHERE pa.provider_key = ?';
      params.push(provider_key);
    }

    const [rows] = await pool.execute(
      `SELECT pt.*, pa.provider_key, pa.name as provider_name
       FROM provider_transactions pt
       JOIN provider_accounts pa ON pt.provider_account_id = pa.id
       ${whereClause}
       ORDER BY pt.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({ ok: true, data: rows });

  } catch (error) {
    logger.error('getProviderTransactions error', { error: error.message });
    res.status(500).json({ ok: false, error: 'internal_server_error' });
  }
}