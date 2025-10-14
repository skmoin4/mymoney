// src/routes/adminMetrics.js
import express from 'express';
import auth from '../../middlewares/auth.js';
import { adminMetricsHandler } from './adminMetrics.controller.js';

const router = express.Router();
router.get('/metrics', auth(true, ['admin']), adminMetricsHandler);
export default router;