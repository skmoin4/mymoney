// src/services/providers/genericProvider.js
/**
 * Generic Provider Adapter Template
 *
 * This is a template for integrating any recharge provider.
 * Copy this file and customize for each provider (tuktukProvider.js, etc.)
 *
 * Required config in provider_accounts.config JSON:
 * {
 *   "baseUrl": "https://api.provider.com/v1",
 *   "apiKey": "your_api_key",
 *   "secret": "your_secret_key",
 *   "timeout": 30000,
 *   "webhookSecret": "webhook_secret_for_verification"
 * }
 */

import axios from 'axios';
import crypto from 'crypto';
import logger from '../../utils/logger.js';

export default function createGenericProvider(config) {
  const {
    baseUrl,
    apiKey,
    secret,
    timeout = 30000,
    webhookSecret
  } = config;

  // Axios instance with default config
  const httpClient = axios.create({
    baseURL: baseUrl,
    timeout,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'APMoney-Backend/1.0'
    }
  });

  // Add auth headers if API key provided
  if (apiKey) {
    httpClient.defaults.headers.common['Authorization'] = `Bearer ${apiKey}`;
  }

  return {
    name: 'Generic Provider',

    /**
     * Initiate a recharge/topup
     * @param {Object} jobData - { txn_ref, mobile, operator_code, amount, ... }
     */
    async charge(jobData) {
      try {
        logger.info('GenericProvider: Initiating charge', { txn_ref: jobData.txn_ref });

        const payload = {
          request_ref: jobData.txn_ref,
          mobile: jobData.mobile,
          operator_code: jobData.operator_code,
          amount: parseFloat(jobData.amount),
          // Add any additional fields your provider needs
          customer_info: jobData.customer_info || {}
        };

        const response = await httpClient.post('/recharge', payload);

        // Standardize response format
        const result = {
          status: this.normalizeStatus(response.data.status),
          provider_txn_id: response.data.provider_txn_id || response.data.transaction_id,
          raw: response.data
        };

        logger.info('GenericProvider: Charge response', result);
        return result;

      } catch (error) {
        logger.error('GenericProvider: Charge failed', {
          error: error.message,
          status: error.response?.status,
          data: error.response?.data
        });

        // Check if it's a retryable error
        if (this.isRetryableError(error)) {
          throw error; // Let BullMQ retry
        }

        // Terminal error - return failed
        return {
          status: 'failed',
          provider_txn_id: null,
          raw: { error: error.message, code: error.code }
        };
      }
    },

    /**
     * Check transaction status
     * @param {string} providerTxnId - Provider's transaction ID
     */
    async getStatus(providerTxnId) {
      try {
        const response = await httpClient.get(`/status/${providerTxnId}`);

        return {
          status: this.normalizeStatus(response.data.status),
          provider_txn_id: providerTxnId,
          raw: response.data
        };

      } catch (error) {
        logger.error('GenericProvider: Status check failed', { providerTxnId, error: error.message });
        throw error;
      }
    },

    /**
     * Get provider balance/float
     */
    async getBalance() {
      try {
        const response = await httpClient.get('/balance');

        return {
          balance: parseFloat(response.data.balance || 0),
          currency: response.data.currency || 'INR',
          raw: response.data
        };

      } catch (error) {
        logger.error('GenericProvider: Balance check failed', { error: error.message });
        throw error;
      }
    },

    /**
     * Topup provider account (if supported)
     * @param {number} amount - Amount to add
     * @param {Object} opts - Additional options
     */
    async topupAccount(amount, opts = {}) {
      try {
        const payload = {
          amount: parseFloat(amount),
          reference: opts.reference || `topup_${Date.now()}`,
          mode: opts.mode || 'bank' // 'api' or 'bank'
        };

        const response = await httpClient.post('/topup', payload);

        return {
          ok: true,
          txn_id: response.data.topup_txn_id,
          raw: response.data
        };

      } catch (error) {
        logger.error('GenericProvider: Topup failed', { amount, error: error.message });
        return { ok: false, error: error.message };
      }
    },

    /**
     * Verify webhook signature
     * @param {string} rawBody - Raw request body
     * @param {Object} headers - Request headers
     */
    verifyWebhook(rawBody, headers) {
      try {
        if (!webhookSecret) {
          // In development, allow unsigned webhooks
          return process.env.NODE_ENV !== 'production';
        }

        const signature = headers['x-provider-signature'] ||
                         headers['x-signature'] ||
                         headers['x-webhook-signature'];

        if (!signature) {
          return false;
        }

        // HMAC SHA256 verification
        const expectedSignature = crypto
          .createHmac('sha256', webhookSecret)
          .update(rawBody)
          .digest('hex');

        return crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(expectedSignature)
        );

      } catch (error) {
        logger.error('GenericProvider: Webhook verification failed', { error: error.message });
        return false;
      }
    },

    /**
     * Parse webhook payload
     * @param {string|Object} rawBody - Raw webhook body
     */
    parseWebhook(rawBody) {
      try {
        const data = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;

        return {
          provider_txn_id: data.provider_txn_id || data.transaction_id || data.id,
          request_ref: data.request_ref || data.reference_id,
          status: this.normalizeStatus(data.status),
          amount: data.amount ? parseFloat(data.amount) : null,
          raw: data
        };

      } catch (error) {
        logger.error('GenericProvider: Webhook parse failed', { error: error.message });
        return {
          provider_txn_id: null,
          request_ref: null,
          status: 'failed',
          raw: { error: 'parse_failed' }
        };
      }
    },

    /**
     * Normalize provider status to standard format
     * @param {string} status - Provider-specific status
     */
    normalizeStatus(status) {
      if (!status) return 'failed';

      const statusMap = {
        'success': ['success', 'completed', 'delivered', 'done'],
        'pending': ['pending', 'processing', 'initiated', 'in_progress'],
        'failed': ['failed', 'error', 'cancelled', 'rejected', 'refunded']
      };

      const normalized = status.toString().toLowerCase();

      for (const [standardStatus, variants] of Object.entries(statusMap)) {
        if (variants.includes(normalized)) {
          return standardStatus;
        }
      }

      return 'failed'; // Default to failed for unknown statuses
    },

    /**
     * Check if error is retryable
     * @param {Error} error - Axios error
     */
    isRetryableError(error) {
      // Network errors, 5xx server errors, timeouts are retryable
      if (!error.response) return true; // Network error
      const status = error.response.status;
      return status >= 500 || status === 429; // Server errors or rate limit
    }
  };
}