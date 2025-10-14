// src/routes/admin.js
import express from 'express';
import auth from '../../middlewares/auth.js';
import { listAdminTransactions, getAdminTransaction, getPlatformBalanceAPI, getPlatformTransactionsAPI } from './admin.controller.js';
import adminProviderRoutes from './adminProvider.routes.js';
import adminOperatorMappingRoutes from './adminOperatorMapping.routes.js';
import adminCommissionPacksRoutes from './adminCommissionPacks.routes.js';
import adminActionsRoutes from './adminActions.routes.js';
import adminHooksRoutes from './adminHooks.routes.js';
import adminNotificationsRoutes from './adminNotifications.routes.js';

const router = express.Router();

// admin-only GET routes
router.get('/transactions', auth(true, ['admin']), listAdminTransactions);
router.get('/transactions/:id', auth(true, ['admin']), getAdminTransaction);

// Platform wallet routes
router.get('/platform/balance', auth(true, ['admin']), getPlatformBalanceAPI);
router.get('/platform/transactions', auth(true, ['admin']), getPlatformTransactionsAPI);

// Include sub-routes
router.use('/', adminProviderRoutes);
router.use('/', adminOperatorMappingRoutes);
router.use('/', adminCommissionPacksRoutes);
router.use('/', adminActionsRoutes);
router.use('/', adminHooksRoutes);
router.use('/', adminNotificationsRoutes);

export default router;