import express from 'express';
import { enqueueRecharge } from './queueController.js';
import auth from '../../middlewares/auth.js';
const queuerouter = express.Router();
queuerouter.post('/recharge', auth(true), enqueueRecharge);
export default queuerouter;
