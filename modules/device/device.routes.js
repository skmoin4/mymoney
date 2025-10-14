import express from 'express';
import auth from '../../middlewares/auth.js';
import { registerDevice } from './device.controller.js';
const devicerouter = express.Router();

devicerouter.post('/register', auth(true), registerDevice);
export default devicerouter;
