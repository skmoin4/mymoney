// src/routes/adminOperatorMapping.js
import express from 'express';
import auth from '../../middlewares/auth.js';
import {
  createOperatorMapping,
  listOperatorMappings,
  getOperatorMapping,
  updateOperatorMapping,
  deleteOperatorMapping
} from './adminOperatorMapping.controller.js';

const router = express.Router();

// admin-only endpoints
router.post('/admin/operator-mapping', auth(true, ['admin']), createOperatorMapping);
router.get('/admin/operator-mapping', auth(true, ['admin']), listOperatorMappings);
router.get('/admin/operator-mapping/:id', auth(true, ['admin']), getOperatorMapping);
router.put('/admin/operator-mapping/:id', auth(true, ['admin']), updateOperatorMapping);
router.delete('/admin/operator-mapping/:id', auth(true, ['admin']), deleteOperatorMapping);

export default router;