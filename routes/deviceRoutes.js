// apmoney/routes/deviceRoutes.js
import express from 'express';
import auth from '../middlewares/auth.js';
import {
  registerDevice,
  unregisterDevice,
  listDevicesForUser
} from '../modules/device/device.controller.js';

const router = express.Router();

router.post('/register', auth(), registerDevice);       // auth required user
router.post('/unregister', auth(), unregisterDevice);
router.get('/', auth(), listDevicesForUser);             // list own devices (admin can view others)
export default router;