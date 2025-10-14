// src/routes/adminAlerts.js
import express from 'express';
import auth from '../../middlewares/auth.js';
import { listAlerts, acknowledgeAlert, closeAlert } from './adminAlerts.controller.js';

const router = express.Router();

// Admin-only routes
router.get('/alerts', auth(true, ['admin']), listAlerts);
router.post('/alerts/:id/ack', auth(true, ['admin']), acknowledgeAlert);
router.post('/alerts/:id/close', auth(true, ['admin']), closeAlert);

export default router;