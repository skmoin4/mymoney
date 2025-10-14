import express from 'express';
import auth from '../../middlewares/auth.js';
import { createTopup, topupStatus } from './topupcontroller.js';

const r = express.Router();
r.post('/topup', auth(true), createTopup);
r.get('/topup/:id/status', auth(true), topupStatus);
export default r;
