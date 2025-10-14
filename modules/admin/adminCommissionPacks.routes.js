// src/modules/admin/adminCommissionPacks.routes.js
import express from 'express';
import auth from '../../middlewares/auth.js';
import {
  createCommissionPack,
  listCommissionPacks
} from './adminCommissionPacks.controller.js';

const router = express.Router();

router.post('/commission-packs', auth(true, ['admin']), createCommissionPack);
router.get('/commission-packs', auth(true, ['admin']), listCommissionPacks);

export default router;