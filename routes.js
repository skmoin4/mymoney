import express from 'express';
import authRouter from './modules/auth/authrouter.js';
import { query } from './config/db.js';
import redis from './config/redis.js';
import walletRouter from './modules/wallet/wallet.routes.js';
import topupRouter from './modules/topup/topup.routes.js';
import webhookRouter from './modules/webook/webook.routes.js';
import queuerouter from './modules/queue/queue.route.js';
import rechargeRouter from './modules/recharge/recharge.router.js';
import devicerouter from './modules/device/device.routes.js';
import adminRouter from './modules/admin/admin.routes.js';
import adminActionsRouter from './modules/admin/adminActions.routes.js';
import adminHooksRouter from './modules/admin/adminHooks.routes.js';
import adminProviderRouter from './modules/admin/adminProvider.routes.js';
import adminOperatorMappingRouter from './modules/admin/adminOperatorMapping.routes.js';
import adminCommissionPacksRouter from './modules/admin/adminCommissionPacks.routes.js';
import adminReportsRouter from './modules/admin/adminReports.routes.js';
import adminMetricsRouter from './modules/admin/adminMetrics.routes.js';
import adminReconciliationRouter from './modules/admin/adminReconciliation.routes.js';
import adminReconciliationActionsRouter from './modules/admin/adminReconciliationActions.routes.js';
import adminAlertsRouter from './modules/admin/adminAlerts.routes.js';
import deviceRouter from './routes/deviceRoutes.js';
import devSocketRouter from './routes/devSocket.js';
import devPushRouter from './routes/devPush.js';
import secureWebhookRouter from './routes/webhooks.js';
import { testNotify } from './test/testcon.js';
const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    // quick DB ping (optional)
    await query('SELECT 1');
    // quick Redis ping
    await redis.ping();
    return res.json({ status: 'ok', db: 'ok', redis: 'ok', ts: Date.now() });
  } catch (err) {
    console.error('Health check error:', err);
    return res.status(500).json({ status: 'error', error: err.message });
  }
});

router.use('/v1/auth', authRouter);
router.use('/v1/wallet', walletRouter);
router.use('/v1/wallet', topupRouter);
router.use('/v1/webhook', webhookRouter);
router.use('/v1/queue', queuerouter);
router.use('/v1/recharge', rechargeRouter);
router.use('/v1/device', devicerouter);
router.use('/admin', adminRouter);
router.use('/admin', adminProviderRouter);
router.use('/admin', adminActionsRouter);
router.use('/v1', adminHooksRouter);
router.use('/v1', adminOperatorMappingRouter);
router.use('/admin', adminCommissionPacksRouter);
router.use('/admin', adminReportsRouter);
router.use('/admin', adminMetricsRouter);
router.use('/admin', adminReconciliationRouter);
router.use('/admin', adminReconciliationActionsRouter);
router.use('/admin', adminAlertsRouter);
router.use('/v1/devices', deviceRouter);
router.use('/dev', devSocketRouter);
router.use('/dev', devPushRouter);
router.use('/', secureWebhookRouter);
router.post('/notify/test', testNotify);
export default router;


