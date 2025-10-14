// src/routes/adminActions.js
import express from 'express';
import auth from '../../middlewares/auth.js';
import { adminRefund, adminForceStatus } from './adminActions.controller.js';

const router = express.Router();

// admin-only
router.post('/transactions/:id/refund', auth(true, ['admin']), adminRefund);
router.post('/transactions/:id/force-status', auth(true, ['admin']), adminForceStatus);

export default router;