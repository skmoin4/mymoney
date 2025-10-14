// src/routes/adminReconciliationActions.js
import express from 'express';
import auth from '../../middlewares/auth.js';
import {
  getReconciliationItem,
  resolveReconciliationItem,
  adjustReconciliationItem
} from './adminReconciliationActions.controller.js';

const router = express.Router();

router.get('/reconciliation/:id', auth(true, ['admin']), getReconciliationItem);
router.post('/reconciliation/:id/resolve', auth(true, ['admin']), resolveReconciliationItem);
router.post('/reconciliation/:id/adjust', auth(true, ['admin']), adjustReconciliationItem);

export default router;