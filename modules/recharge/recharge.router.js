import express from 'express';
import auth from '../../middlewares/auth.js';
import { initiateRecharge } from './recharge.controller.js';

const router = express.Router();

// user must be authenticated
router.post('/initiate', auth(true), initiateRecharge);

export default router;