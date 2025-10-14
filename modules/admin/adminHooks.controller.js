// src/controllers/adminHooksController.js
import { getPool } from '../../config/db.js';
import logger from '../../utils/logger.js';
import { notificationQueue } from '../../queues/index.js';
import { emitAdminEvent } from '../../realTime/socket.js';

/**
 * GET /api/v1/admin/dashboard/summary
 * comprehensive dashboard statistics for admin UI
 */
export async function adminDashboardSummary(req, res) {
  try {
    const pool = getPool();

    // Get transaction counts and amounts by status
    const [statsRows] = await pool.execute(`
      SELECT
        status,
        COUNT(*) as count,
        SUM(amount) as total_amount,
        SUM(service_charge) as total_charges
      FROM transactions
      GROUP BY status
    `);

    // Get refund statistics
    const [refundRows] = await pool.execute(`
      SELECT
        COUNT(*) as refund_count,
        SUM(amount) as refund_amount
      FROM wallet_ledger wl
      JOIN wallets w ON wl.wallet_id = w.id
      WHERE wl.type = 'debit' AND wl.note LIKE '%refund%'
    `);

    // Get user statistics
    const [userStats] = await pool.execute(`
      SELECT
        COUNT(*) as total_users,
        SUM(CASE WHEN role = 'retailer' THEN 1 ELSE 0 END) as retailer_users,
        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admin_users,
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) as new_users_today,
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) as new_users_week
      FROM users
    `);

    // Get provider statistics
    const [providerStats] = await pool.execute(`
      SELECT
        COUNT(DISTINCT pa.id) as total_providers,
        COUNT(DISTINCT CASE WHEN pa.balance > 0 THEN pa.id END) as active_providers,
        SUM(pa.balance) as total_provider_balance
      FROM provider_accounts pa
      WHERE pa.is_active = true
    `);

    // Get alerts statistics
    const [alertStats] = await pool.execute(`
      SELECT
        COUNT(*) as total_alerts,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_alerts,
        SUM(CASE WHEN status = 'acknowledged' THEN 1 ELSE 0 END) as acknowledged_alerts,
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) as alerts_today
      FROM alerts
    `);

    // Get reconciliation statistics
    const [reconciliationStats] = await pool.execute(`
      SELECT
        COUNT(*) as total_discrepancies,
        SUM(CASE WHEN our_status = 'pending' THEN 1 ELSE 0 END) as pending_discrepancies,
        SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) as discrepancies_today
      FROM reconciliation_reports
    `);

    // Get recent transactions (last 5)
    const [recentTransactions] = await pool.execute(`
      SELECT
        id, txn_ref, mobile, amount, status, created_at
      FROM transactions
      ORDER BY created_at DESC
      LIMIT 5
    `);

    // Get platform wallet balance
    const [platformBalance] = await pool.execute(`
      SELECT balance, currency
      FROM wallets
      WHERE user_id IS NULL
      LIMIT 1
    `);

    // Get commission statistics
    const [commissionStats] = await pool.execute(`
      SELECT
        SUM(amount) as total_commission_earned,
        AVG(amount) as avg_commission_per_txn
      FROM wallet_ledger wl
      JOIN wallets w ON wl.wallet_id = w.id
      WHERE wl.type = 'credit' AND wl.note LIKE '%commission%'
    `);

    // Calculate totals
    const summary = {
      transactions: {},
      totals: {
        total_transactions: 0,
        total_amount: 0,
        total_charges: 0,
        total_refunds: refundRows[0]?.refund_amount || 0,
        refund_count: refundRows[0]?.refund_count || 0
      },
      users: {
        total_users: userStats[0]?.total_users || 0,
        retailer_users: userStats[0]?.retailer_users || 0,
        admin_users: userStats[0]?.admin_users || 0,
        new_users_today: userStats[0]?.new_users_today || 0,
        new_users_week: userStats[0]?.new_users_week || 0
      },
      providers: {
        total_providers: providerStats[0]?.total_providers || 0,
        active_providers: providerStats[0]?.active_providers || 0,
        total_provider_balance: providerStats[0]?.total_provider_balance || 0
      },
      system_health: {
        total_alerts: alertStats[0]?.total_alerts || 0,
        open_alerts: alertStats[0]?.open_alerts || 0,
        acknowledged_alerts: alertStats[0]?.acknowledged_alerts || 0,
        alerts_today: alertStats[0]?.alerts_today || 0,
        total_discrepancies: reconciliationStats[0]?.total_discrepancies || 0,
        pending_discrepancies: reconciliationStats[0]?.pending_discrepancies || 0,
        discrepancies_today: reconciliationStats[0]?.discrepancies_today || 0
      },
      financial: {
        platform_balance: platformBalance[0]?.balance || 0,
        platform_currency: platformBalance[0]?.currency || 'INR',
        total_commission_earned: commissionStats[0]?.total_commission_earned || 0,
        avg_commission_per_txn: commissionStats[0]?.avg_commission_per_txn || 0
      },
      recent_activity: {
        transactions: recentTransactions || []
      }
    };

    // Process transaction statistics
    statsRows.forEach(row => {
      const status = row.status || 'unknown';
      summary.transactions[status] = {
        count: Number(row.count),
        total_amount: Number(row.total_amount || 0),
        total_charges: Number(row.total_charges || 0)
      };
      summary.totals.total_transactions += Number(row.count);
      summary.totals.total_amount += Number(row.total_amount || 0);
      summary.totals.total_charges += Number(row.total_charges || 0);
    });

    return res.json({ ok: true, summary });
  } catch (err) {
    logger.error('adminDashboardSummary error', { err: err.stack || err.message });
    return res.status(500).json({ error: 'internal_server_error', details: err.message, stack: err.stack });
  }
}

/**
 * POST /api/v1/admin/notify/manual
 * Body: { type, payload }
 * enqueue admin notification + emit to admin room
 */
export async function adminNotifyManual(req, res) {
  try {
    const admin = req.user;
    const { type, payload } = req.body || {};
    if (!type) return res.status(400).json({ error: 'type_required' });

    // store to DB (optional)
    const pool = getPool();
    const [ins] = await pool.execute(
      `INSERT INTO admin_notifications (user_id, actor_admin_id, type, payload, is_read, created_at)
       VALUES (?, ?, ?, ?, 0, NOW())`,
      [payload?.user_id || null, admin?.id || null, type, JSON.stringify(payload || {})]
    );

    // emit to admin room realtime
    emitAdminEvent('admin_notification', { id: ins.insertId, type, payload, created_at: new Date().toISOString() });

    // also enqueue push to relevant admins (rare) - but we can just log/enqueue a job
    await notificationQueue.add('admin_notification', { type, payload, actor_admin_id: admin?.id || null });

    return res.json({ ok: true, id: ins.insertId });
  } catch (err) {
    logger.error('adminNotifyManual error', { err: err.stack || err.message, body: req.body });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}