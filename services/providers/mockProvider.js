// src/services/providers/mockProvider.js
/**
 * Mock provider - useful for local dev & E2E tests.
 * Methods:
 *  - charge(jobData) => { status, provider_txn_id, raw }
 *  - getStatus(provider_txn_id) => { status, provider_txn_id, raw }
 *  - topupAccount(amount, opts) => { ok }
 *  - verifyWebhook(rawBody, headers) => boolean
 *  - parseWebhook(rawBody, headers) => { provider_txn_id, request_ref, status, raw }
 */

import crypto from 'crypto';

function randomOutcome() {
  const r = Math.random();
  if (r < 0.7) return 'success';   // 70% success
  if (r < 0.9) return 'pending';   // 20% pending
  return 'failed';                 // 10% fail
}

export default function createMockProvider(opts = {}) {
  const name = opts.name || 'mock';

  return {
    name,

    // Initiate a charge / topup at provider. jobData contains transaction details.
    async charge(jobData) {
      // simulate latency
      await new Promise(r => setTimeout(r, 200 + Math.floor(Math.random() * 600)));

      // Simulate transient HTTP failure 5% of the time
      if (Math.random() < 0.05) {
        const httpError = new Error('HTTP 500 Internal Server Error');
        httpError.code = 'HTTP_ERROR';
        throw httpError;
      }

      const provider_txn_id = `${name}_${Date.now()}_${Math.floor(Math.random()*1000)}`;
      const status = randomOutcome();

      const raw = { simulated: true, outcome: status, jobData, provider_txn_id };
      return { status, provider_txn_id, raw };
    },

    // Query provider for an existing provider_txn_id
    async getStatus(provider_txn_id) {
      await new Promise(r => setTimeout(r, 150));
      const status = randomOutcome();
      return { status, provider_txn_id, raw: { simulated: true, outcome: status } };
    },

    // For transfer/float topup - mock just returns ok
    async topupAccount(amount, opts = {}) {
      await new Promise(r => setTimeout(r, 100));
      return { ok: true, txn_id: `${name}_topup_${Date.now()}`, raw: { amount, opts } };
    },

    // Get current balance from provider (for health checks)
    async getBalance() {
      // pretend provider always has 1000 INR balance
      await new Promise(r => setTimeout(r, 50)); // simulate network delay
      return { balance: 1000, currency: 'INR' };
    },

    // Very basic webhook verification: HMAC using PROVIDER_SECRET_mock if present
    verifyWebhook(rawBody, headers = {}) {
      try {
        const secret = process.env.PROVIDER_SECRET_mock || 'devsecret';
        const signatureHeader = headers['x-provider-signature'] || headers['x-signature'] || null;
        if (!signatureHeader) {
          // in dev allow
          return (process.env.NODE_ENV || 'development') !== 'production';
        }
        const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        return computed === signatureHeader;
      } catch (e) {
        return false;
      }
    },

    // parse webhook payload (accepted formats: JSON with provider_payment_id/request_ref/status)
    parseWebhook(rawBody, headers = {}) {
      let obj;
      try {
        obj = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
      } catch (e) {
        obj = { raw: rawBody };
      }
      const provider_txn_id = obj.provider_payment_id || obj.provider_txn_id || obj.id || null;
      const request_ref = obj.request_ref || (obj.metadata && obj.metadata.request_ref) || null;
      const statusRaw = (obj.status || '').toString().toLowerCase();
      const status = ['paid','success','completed'].includes(statusRaw) ? 'success'
                   : ['failed','error','cancelled'].includes(statusRaw) ? 'failed'
                   : 'pending';
      return { provider_txn_id, request_ref, status, raw: obj };
    },

    // Parse settlement file content into normalized rows
    parseSettlementFile(content) {
      const lines = content.split(/\r?\n/).filter(Boolean);
      if (!lines.length) return [];
      const header = lines.shift().split(',').map(h => h.trim());
      const out = [];
      for (const line of lines) {
        const cols = line.split(',');
        const obj = {};
        for (let i = 0; i < header.length; i++) obj[header[i]] = cols[i] ? cols[i].trim() : null;
        out.push({
          provider_txn_ref: obj.provider_txn_ref || obj.id || null,
          request_ref: obj.request_ref || obj.txn_ref || null,
          provider_amount: obj.amount ? Number(obj.amount) : null,
          provider_status: obj.status || null,
          provider_txn_time: obj.timestamp || obj.date || null,
          metadata: obj
        });
      }
      return out;
    }
  };
}
