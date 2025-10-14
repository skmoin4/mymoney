// src/utils/providerErrors.js
/**
 * Decide if an error is retryable (try next provider) or terminal.
 * - network/timeouts -> retryable
 * - provider returned explicit 'insufficient_funds' -> not retry on provider but try next
 * - validation/fatal -> terminal
 *
 * Adjust according to your provider error shapes.
 */
export function isRetryableError(err) {
  if (!err) return false;
  const msg = (err.message || '').toLowerCase();

  // network-like
  if (msg.includes('timeout') || msg.includes('ecconnrefused') || msg.includes('econnreset') || msg.includes('network') || msg.includes('socket') ) return true;

  // HTTP 5xx from provider clients (axios) can be in err.response.status
  if (err.response && err.response.status && Number(err.response.status) >= 500) return true;

  // treat provider-specific transient codes (example)
  if (err.code && ['ETIMEDOUT','ECONNRESET','ECONNREFUSED'].includes(err.code)) return true;

  // otherwise not retryable
  return false;
}