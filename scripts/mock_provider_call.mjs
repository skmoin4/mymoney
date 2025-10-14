// scripts/mock_provider_call.mjs
import fetch from 'node-fetch';
const base = process.env.BASE_URL || 'http://localhost:3000';
const requestRef = process.argv[2] || 'topup-test-0051';
const payload = {
  provider_payment_id: 'mock_' + Date.now(),
  request_ref: requestRef,
  status: 'paid'
};
// compute HMAC if your webhook requires signature: use PROVIDER_SECRET_mock
const crypto = await import('crypto');
const secret = process.env.PROVIDER_SECRET_mock || 'devsecret';
const sign = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');

const res = await fetch(`${base}/api/v1/webhook/payment/mock`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Provider-Signature': sign },
  body: JSON.stringify(payload)
});
console.log('status', res.status, await res.text());
