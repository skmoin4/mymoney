// src/routes/auth.js
import express from 'express';
import rateLimitOtp from '../../middlewares/rateLimitOtp.js';
import { requestOtp, verifyOtp } from './authcontroller.js';
import { completeProfile, logout } from './authcontroller.js';
import auth from '../../middlewares/auth.js';

const router = express.Router();

router.post('/request-otp', rateLimitOtp, requestOtp);
router.post('/verify-otp', verifyOtp);
router.post('/complete-profile', completeProfile);
// logout: protected endpoint (requires valid token)
router.post('/logout', auth(true), logout);

export default router;
