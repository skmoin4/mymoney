import express from 'express';
import { paymentWebhook, providerWebhook } from './webookcontroller.js';
const r = express.Router();
// provider name in URL, e.g., /api/v1/webhook/payment/razorpay
r.post('/payment/:provider', paymentWebhook);
// provider webhook for recharge transactions, e.g., /api/v1/webhook/provider/mock
r.post('/provider/:provider_key', providerWebhook);
export default r;
