// src/services/providers/tuktukProvider.js
/**
 * Tuktuk Provider Adapter
 *
 * Integration for Tuktuk recharge provider.
 * Customize the config and API calls based on Tuktuk's documentation.
 */

import createGenericProvider from './genericProvider.js';

export default function createTuktukProvider(config) {
  // Use the generic provider as base
  const provider = createGenericProvider(config);

  // Override name
  provider.name = 'Tuktuk Provider';

  // Customize charge method for Tuktuk-specific API
  const originalCharge = provider.charge;
  provider.charge = async function(jobData) {
    try {
      console.log('TuktukProvider: Initiating charge', { txn_ref: jobData.txn_ref });

      // Tuktuk-specific payload format
      const payload = {
        request_ref: jobData.txn_ref,
        mobile_number: jobData.mobile, // Tuktuk might use mobile_number
        operator: jobData.operator_code,
        amount: parseFloat(jobData.amount),
        // Add Tuktuk-specific fields here
        circle: jobData.circle || 'DELHI', // If needed
        plan_type: jobData.plan_type || 'prepaid'
      };

      // Custom headers for Tuktuk
      const customHeaders = {};
      if (config.apiKey) {
        customHeaders['X-API-Key'] = config.apiKey;
      }

      // Make API call with customizations
      const response = await this.httpClient.post('/api/recharge', payload, {
        headers: customHeaders
      });

      // Tuktuk-specific response parsing
      const result = {
        status: this.normalizeStatus(response.data.status_code || response.data.status),
        provider_txn_id: response.data.txn_id || response.data.transaction_id,
        raw: response.data
      };

      console.log('TuktukProvider: Charge response', result);
      return result;

    } catch (error) {
      console.error('TuktukProvider: Charge failed', {
        error: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      throw error;
    }
  };

  // Customize webhook parsing for Tuktuk format
  const originalParseWebhook = provider.parseWebhook;
  provider.parseWebhook = function(rawBody) {
    try {
      const data = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;

      // Tuktuk-specific webhook format
      return {
        provider_txn_id: data.txn_id || data.transaction_id,
        request_ref: data.request_ref || data.reference_id,
        status: this.normalizeStatus(data.status || data.state),
        amount: data.amount ? parseFloat(data.amount) : null,
        operator: data.operator,
        raw: data
      };

    } catch (error) {
      console.error('TuktukProvider: Webhook parse failed', { error: error.message });
      return {
        provider_txn_id: null,
        request_ref: null,
        status: 'failed',
        raw: { error: 'parse_failed' }
      };
    }
  };

  // Tuktuk-specific status mapping
  const originalNormalizeStatus = provider.normalizeStatus;
  provider.normalizeStatus = function(status) {
    if (!status) return 'failed';

    // Tuktuk-specific status codes
    const tuktukStatusMap = {
      'SUCCESS': 'success',
      'PENDING': 'pending',
      'FAILED': 'failed',
      'CANCELLED': 'failed',
      'TIMEOUT': 'failed',
      'INSUFFICIENT_BALANCE': 'failed'
    };

    const upperStatus = status.toString().toUpperCase();
    if (tuktukStatusMap[upperStatus]) {
      return tuktukStatusMap[upperStatus];
    }

    // Fall back to generic normalization
    return originalNormalizeStatus.call(this, status);
  };

  return provider;
}