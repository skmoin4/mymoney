// src/routes/adminReports.js
import express from 'express';
import auth from '../../middlewares/auth.js';
import { transactionsReportHandler } from './adminReports.controller.js';

const router = express.Router();

// admin-only
router.get('/reports/transactions', auth(true, ['admin']), transactionsReportHandler);

export default router;