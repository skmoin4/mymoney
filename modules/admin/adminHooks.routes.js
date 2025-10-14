// src/routes/adminHooks.js
import express from 'express';
import auth from '../../middlewares/auth.js';
import { adminDashboardSummary, adminNotifyManual } from './adminHooks.controller.js';

const router = express.Router();
router.get('/admin/dashboard/summary', auth(true, ['admin']), adminDashboardSummary);
router.post('/admin/notify/manual', auth(true, ['admin']), adminNotifyManual);

export default router;