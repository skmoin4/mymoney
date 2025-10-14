// scripts/e2e_topup_and_webhook.mjs
// Usage: node scripts/e2e_topup_and_webhook.mjs <USER_TOKEN> <REQUEST_REF> <BASE_URL>
// BASE_URL defaults to http://localhost:3000 if not provided
import fetch from 'node-fetch';
import crypto from 'crypto';

const USER_TOKEN = process.argv[2];
const REQUEST_REF = process.argv[3] || 'topup-test-001';
const BASE = process.argv[4] || process.env.BASE_URL || 'http://localhost:3000';
const SECRET = process.env.PROVIDER_SECRET_mock || 'devsecret';

if (!USER_TOKEN) {
  console.error('Usage: node scripts/e2e_topup_and_webhook.mjs <USER_TOKEN> <REQUEST_REF> <BASE_URL>');
  process.exit(1);
}

async function createTopup() {
  const res = await fetch(`${BASE}/api/v1/wallet/topup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${USER_TOKEN}` },
    body: JSON.stringify({ amount: 250, method: 'mock', request_ref: REQUEST_REF })
  });
  const j = await res.json();
  console.log('createTopup response:', j);
  return j;
}

async function callWebhook(request_ref) {
  const payload = { provider_payment_id: 'mock_' + Date.now(), request_ref, status: 'paid' };
  const raw = JSON.stringify(payload);
  const sign = crypto.createHmac('sha256', SECRET).update(raw).digest('hex');

  const res = await fetch(`${BASE}/api/v1/webhook/payment/mock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Provider-Signature': sign },
    body: raw
  });
  console.log('webhook status', res.status);
  const text = await res.text();
  console.log('webhook response body:', text);
}

(async () => {
  console.log('BASE:', BASE, 'REQUEST_REF:', REQUEST_REF);
  const topup = await createTopup();
  const request_ref = topup.request_ref;
  await new Promise(r => setTimeout(r, 400)); // small wait
  await callWebhook(request_ref);
})();
