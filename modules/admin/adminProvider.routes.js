// src/routes/adminProvider.js
import express from 'express';
import auth from '../../middlewares/auth.js';
import {
  addProvider,
  getProviders,
  getProviderBalance,
  topupProvider,
  getProviderTransactions,
  adminProviderTopup
} from './adminProvider.controller.js';

const router = express.Router();

// Provider management
router.post('/providers', auth(true, ['admin']), addProvider);
router.get('/providers', auth(true, ['admin']), getProviders);
router.get('/providers/:provider_key/balance', auth(true, ['admin']), getProviderBalance);
router.post('/providers/topup', auth(true, ['admin']), topupProvider);
router.get('/providers/transactions', auth(true, ['admin']), getProviderTransactions);

// Legacy route (keeping for backward compatibility)
router.post('/provider/topup', auth(true, ['admin']), adminProviderTopup);

// manual health check trigger
router.post('/providers/health-check', auth(true, ['admin']), async (req, res) => {
  const { runProviderHealthCheck } = await import('../../workers/providerHealthWorker.js');
  await runProviderHealthCheck();
  return res.json({ ok: true });
});

export default router;