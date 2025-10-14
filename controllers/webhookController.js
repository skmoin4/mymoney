// apmoney/controllers/webhookController.js
import crypto from 'crypto';
import { getPool } from '../config/db.js';
import logger from '../utils/logger.js';

const TIME_TOLERANCE = Number(process.env.WEBHOOK_TIME_TOLERANCE_SEC || 300);
const TRUSTED_IPS = (process.env.WEBHOOK_TRUSTED_IPS || '').split(',').map(s => s.trim()).filter(Boolean);

/**
 * fetch provider secret(s) — simple example: from env or DB
 * Return array of secrets (allow multiple for rotation)
 */
async function loadProviderSecrets(providerKey) {
  // prefer DB if table exists
  try {
    const pool = getPool();
    const [rows] = await pool.execute('SELECT secret FROM provider_secrets WHERE provider_key = ? AND active = 1', [providerKey]);
    if (rows && rows.length) return rows.map(r => r.secret);
  } catch (e) {
    // fallback to env
  }
  // fallback to env: PROVIDER_SECRET_<providerKey>
  const envName = `PROVIDER_SECRET_${String(providerKey).replace(/[^A-Za-z0-9_]/g, '_')}`;
  if (process.env[envName]) return [process.env[envName]];
  return [];
}

/**
 * compute HMAC SHA256
 */
function computeHmac(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * get remote IP (respecting proxies if behind load balancer)
 */
function getRemoteIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.connection?.remoteAddress || req.socket?.remoteAddress || null;
}

/**
 * Main handler
 * - expects headers:
 *    X-Webhook-Signature -> signature hex (provider-specific format)
 *    X-Webhook-Timestamp -> unix or iso timestamp
 *    X-Webhook-Id -> unique idempotency id (optional but strongly recommended)
 */
export async function providerWebhookHandler(req, res) {
  const pool = getPool();
  const providerKey = req.params.provider; // route: /webhook/:provider
  const signatureHeader = req.get('X-Webhook-Signature') || req.get('x-webhook-signature') || req.get('signature') || '';
  const timestampHeader = req.get('X-Webhook-Timestamp') || req.get('x-webhook-timestamp') || '';
  const webhookId = req.get('X-Webhook-Id') || req.get('x-webhook-id') || null;
  const remoteIp = getRemoteIp(req);

  const rawPayload = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}), 'utf8');
  const payloadText = rawPayload.toString('utf8');

  // 1) Optional IP whitelist
  if (TRUSTED_IPS.length > 0) {
    if (!remoteIp || !TRUSTED_IPS.includes(remoteIp)) {
      logger.warn('webhook rejected: ip not in whitelist', { providerKey, remoteIp });
      // log attempt
      await pool.execute(
        `INSERT INTO provider_webhook_logs (provider_key, webhook_id, signature_header, timestamp_header, ip_address, payload, processed, processing_result) VALUES (?,?,?,?,?,?,0,?)`,
        [providerKey, webhookId, signatureHeader.substring(0,255), timestampHeader, remoteIp, payloadText, 'ip_not_allowed']
      );
      return res.status(403).json({ error: 'forbidden' });
    }
  }

  // 2) Timestamp check to avoid replay
  if (!timestampHeader) {
    logger.warn('webhook missing timestamp', { providerKey, webhookId });
    await pool.execute(
      `INSERT INTO provider_webhook_logs (provider_key, webhook_id, signature_header, timestamp_header, ip_address, payload, processed, processing_result) VALUES (?,?,?,?,?,?,0,?)`,
      [providerKey, webhookId, signatureHeader.substring(0,255), timestampHeader, remoteIp, payloadText, 'missing_timestamp']
    );
    return res.status(400).json({ error: 'missing_timestamp' });
  }
  let tsUnix = parseInt(timestampHeader, 10);
  if (isNaN(tsUnix)) {
    // try ISO parse
    const t = Date.parse(timestampHeader);
    if (!isNaN(t)) tsUnix = Math.floor(t / 1000);
  }
  if (isNaN(tsUnix)) {
    await pool.execute(
      `INSERT INTO provider_webhook_logs (provider_key, webhook_id, signature_header, timestamp_header, ip_address, payload, processed, processing_result) VALUES (?,?,?,?,?,?,0,?)`,
      [providerKey, webhookId, signatureHeader.substring(0,255), timestampHeader, remoteIp, payloadText, 'invalid_timestamp']
    );
    return res.status(400).json({ error: 'invalid_timestamp' });
  }
  const nowUnix = Math.floor(Date.now() / 1000);
  if (Math.abs(nowUnix - tsUnix) > TIME_TOLERANCE) {
    logger.warn('webhook timestamp outside tolerance', { providerKey, webhookId, tsUnix, nowUnix });
    await pool.execute(
      `INSERT INTO provider_webhook_logs (provider_key, webhook_id, signature_header, timestamp_header, ip_address, payload, processed, processing_result) VALUES (?,?,?,?,?,?,0,?)`,
      [providerKey, webhookId, signatureHeader.substring(0,255), timestampHeader, remoteIp, payloadText, 'timestamp_out_of_range']
    );
    return res.status(400).json({ error: 'timestamp_out_of_range' });
  }

  // 3) Signature verification (support multiple secrets for rotation)
  const secrets = await loadProviderSecrets(providerKey);
  if (!secrets || secrets.length === 0) {
    logger.error('no webhook secret configured for provider', { providerKey });
    await pool.execute(
      `INSERT INTO provider_webhook_logs (provider_key, webhook_id, signature_header, timestamp_header, ip_address, payload, processed, processing_result) VALUES (?,?,?,?,?,?,0,?)`,
      [providerKey, webhookId, signatureHeader.substring(0,255), timestampHeader, remoteIp, payloadText, 'no_secret']
    );
    return res.status(500).json({ error: 'server_config' });
  }

  // common signature format: provider signs `${timestamp}.${payload}` (or raw payload) — adapt if provider differs
  const signedInput = `${timestampHeader}.${payloadText}`;

  let valid = false;
  for (const secret of secrets) {
    const expected = computeHmac(secret, signedInput);
    if (crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signatureHeader, 'utf8'))) {
      valid = true;
      break;
    }
  }
  if (!valid) {
    logger.warn('webhook signature invalid', { providerKey, webhookId });
    await pool.execute(
      `INSERT INTO provider_webhook_logs (provider_key, webhook_id, signature_header, timestamp_header, ip_address, payload, processed, processing_result) VALUES (?,?,?,?,?,?,0,?)`,
      [providerKey, webhookId, signatureHeader.substring(0,255), timestampHeader, remoteIp, payloadText, 'invalid_signature']
    );
    return res.status(401).json({ error: 'invalid_signature' });
  }

  // 4) Idempotency: check webhook_id processed
  if (webhookId) {
    const [prev] = await pool.execute('SELECT id, processed FROM provider_webhook_logs WHERE provider_key = ? AND webhook_id = ? LIMIT 1', [providerKey, webhookId]);
    if (prev && prev.length > 0) {
      const row = prev[0];
      if (row.processed) {
        logger.info('webhook already processed idempotent', { providerKey, webhookId });
        return res.status(200).json({ ok: true, note: 'already_processed' });
      }
    }
  }

  // 5) Insert log row (mark processed = 0 for now)
  const [ins] = await pool.execute(
    `INSERT INTO provider_webhook_logs (provider_key, webhook_id, signature_header, timestamp_header, ip_address, payload, processed) VALUES (?,?,?,?,?,?,0)`,
    [providerKey, webhookId, signatureHeader.substring(0,255), timestampHeader, remoteIp, payloadText]
  );
  const logId = ins.insertId;

  // 6) Enqueue processing job (worker will update log.processed = 1 on success)
  try {
    // Example: push to job queue (BullMQ) for idempotent processing
    // await jobQueue.add('provider_webhook', { providerKey, webhookId, payload: req.body, logId });

    // For simple synchronous processing you can call handler (but keep it idempotent)
    // await processProviderWebhook(providerKey, req.body, { webhookId, logId });

    // respond 200 quickly to provider to avoid retries
    res.status(200).json({ ok: true });
    logger.info('webhook accepted & queued', { providerKey, webhookId, logId });
    return;
  } catch (procErr) {
    logger.error('webhook enqueue failed', { err: procErr.stack || procErr.message, providerKey, webhookId });
    // update log with failure
    await pool.execute('UPDATE provider_webhook_logs SET processed = 0, processing_result = ? WHERE id = ?', ['enqueue_failed', logId]);
    return res.status(500).json({ error: 'enqueue_failed' });
  }
}