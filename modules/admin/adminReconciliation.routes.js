// src/routes/adminReconciliation.js
import express from 'express';
import multer from 'multer';
import auth from '../../middlewares/auth.js';
import { uploadSettlementFileHandler, listReconciliationReports, getSettlementFiles } from './adminReconciliation.controller.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// admin-only
router.post('/reconciliation/upload', auth(true, ['admin']), upload.single('file'), uploadSettlementFileHandler);
router.get('/reconciliation/reports', auth(true, ['admin']), listReconciliationReports);
router.get('/reconciliation/files', auth(true, ['admin']), getSettlementFiles);

export default router;