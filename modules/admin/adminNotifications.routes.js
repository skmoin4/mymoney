// src/routes/adminNotifications.js
import express from 'express';
import auth from '../../middlewares/auth.js';
import { sendManualNotification } from './adminNotifications.controller.js';

const router = express.Router();

// admin-only
router.post('/notify/manual', auth(true, ['admin']), sendManualNotification);

export default router;