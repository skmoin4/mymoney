// apmoney/routes/webhooks.js
import express from 'express';
import bodyParser from 'body-parser';
import { providerWebhookHandler } from '../controllers/webhookController.js';

const router = express.Router();


router.post('/webhook/:provider', bodyParser.raw({ type: '*/*', limit: '1mb' }), providerWebhookHandler);

export default router;