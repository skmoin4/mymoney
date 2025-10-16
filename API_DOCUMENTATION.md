# API Documentation - APMoney Project

Complete API documentation for the APMoney payment and recharge platform.

---

## Base URL
```
http://localhost:PORT/api
```

## Authentication
Most endpoints require JWT token authentication. Include the token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

Admin-only endpoints require user to have 'admin' role.

---

## Table of Contents
1. [Health Check](#health-check)
2. [Authentication APIs](#authentication-apis)
3. [Wallet APIs](#wallet-apis)
4. [Topup APIs](#topup-apis)
5. [Recharge APIs](#recharge-apis)
6. [Webhook APIs](#webhook-apis)
7. [Queue APIs](#queue-apis)
8. [Device APIs](#device-apis)
9. [Admin - Transaction Management](#admin---transaction-management)
10. [Admin - Platform Wallet](#admin---platform-wallet)
11. [Admin - Transaction Actions](#admin---transaction-actions)
12. [Admin - Dashboard & Notifications](#admin---dashboard--notifications)
13. [Admin - Provider Management](#admin---provider-management)
14. [Admin - Operator Mapping](#admin---operator-mapping)
15. [Admin - Commission Packs](#admin---commission-packs)
16. [Admin - Reports](#admin---reports)
17. [Admin - Metrics](#admin---metrics)
18. [Admin - Reconciliation](#admin---reconciliation)
19. [Admin - Alerts](#admin---alerts)

---

## Health Check

### Check System Health
**Endpoint:** `GET /health`  
**Authentication:** None  
**Description:** Checks the health status of the system including database and Redis connectivity.

**Response:**
```json
{
  "status": "ok",
  "db": "ok",
  "redis": "ok",
  "ts": 1234567890
}
```

---

## Authentication APIs

Base Path: `/v1/auth`

### 1. Request OTP
**Endpoint:** `POST /v1/auth/request-otp`
**Authentication:** None
**Rate Limited:** Yes
**Description:** Request OTP for phone number authentication. OTP is sent via SMS (Fast2SMS) and email if provided.

**Request Body:**
```json
{
  "phoneNumber": "+1234567890"
}
```

**Response:**
```json
{
  "requestId": "uuid_here",
  "ttl": 300,
  "message": "OTP sent successfully"
}
```

### 2. Verify OTP
**Endpoint:** `POST /v1/auth/verify-otp`  
**Authentication:** None  
**Description:** Verify the OTP sent to user's phone number.

**Request Body:**
```json
{
  "phoneNumber": "+1234567890",
  "otp": "123456"
}
```

**Response:**
```json
{
  "token": "jwt_token_here",
  "user": {
    "id": "user_id",
    "phoneNumber": "+1234567890"
  }
}
```

### 3. Complete Profile
**Endpoint:** `POST /v1/auth/complete-profile`  
**Authentication:** None  
**Description:** Complete user profile information after OTP verification.

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com"
}
```

### 4. Logout
**Endpoint:** `POST /v1/auth/logout`  
**Authentication:** Required (Bearer Token)  
**Description:** Logout the current user and invalidate the token.

---

## Wallet APIs

Base Path: `/v1/wallet`

### 1. Get Wallet Balance
**Endpoint:** `GET /v1/wallet`  
**Authentication:** Required  
**Description:** Get current user's wallet balance and details.

**Response:**
```json
{
  "walletId": "wallet_id",
  "balance": 1000.00,
  "currency": "INR"
}
```

### 2. Get Wallet Ledger
**Endpoint:** `GET /v1/wallet/ledger`  
**Authentication:** Required  
**Description:** Get wallet transaction ledger/history for the current user.

**Query Parameters:**
- `limit` (optional): Number of records to fetch
- `offset` (optional): Pagination offset

### 3. Credit Wallet
**Endpoint:** `POST /v1/wallet/credit`  
**Authentication:** Required  
**Description:** Credit amount to user's wallet.

**Request Body:**
```json
{
  "amount": 500.00,
  "description": "Payment received"
}
```

### 4. Reserve Amount
**Endpoint:** `POST /v1/wallet/reserve`  
**Authentication:** Required  
**Description:** Reserve amount from wallet for a transaction (temporary hold).

**Request Body:**
```json
{
  "amount": 100.00,
  "referenceId": "txn_ref_123"
}
```

### 5. Finalize Transaction
**Endpoint:** `POST /v1/wallet/finalize`  
**Authentication:** Required  
**Description:** Finalize a reserved transaction (complete the hold).

**Request Body:**
```json
{
  "reservationId": "reservation_id",
  "amount": 100.00
}
```

### 6. Refund Transaction
**Endpoint:** `POST /v1/wallet/refund`  
**Authentication:** Required  
**Description:** Refund amount back to user's wallet.

**Request Body:**
```json
{
  "transactionId": "txn_id",
  "amount": 100.00,
  "reason": "Transaction failed"
}
```

---

## Topup APIs

Base Path: `/v1/wallet`

### 1. Create Topup
**Endpoint:** `POST /v1/wallet/topup`  
**Authentication:** Required  
**Description:** Create a wallet topup request.

**Request Body:**
```json
{
  "amount": 1000.00,
  "paymentMethod": "upi",
  "returnUrl": "https://yourapp.com/success"
}
```

### 2. Get Topup Status
**Endpoint:** `GET /v1/wallet/topup/:id/status`  
**Authentication:** Required  
**Description:** Check the status of a topup transaction.

**URL Parameters:**
- `id`: Topup transaction ID

**Response:**
```json
{
  "topupId": "topup_id",
  "status": "success",
  "amount": 1000.00,
  "timestamp": "2024-01-01T00:00:00Z"
}
```

---

## Recharge APIs

Base Path: `/v1/recharge`

### 1. Initiate Recharge
**Endpoint:** `POST /v1/recharge/initiate`  
**Authentication:** Required  
**Description:** Initiate a mobile/DTH recharge transaction.

**Request Body:**
```json
{
  "phoneNumber": "+1234567890",
  "operator": "airtel",
  "amount": 99.00,
  "circle": "delhi"
}
```

**Response:**
```json
{
  "transactionId": "txn_123",
  "status": "pending",
  "amount": 99.00,
  "phoneNumber": "+1234567890"
}
```

---

## Webhook APIs

Base Path: `/v1/webhook`

### 1. Payment Webhook
**Endpoint:** `POST /v1/webhook/payment/:provider`  
**Authentication:** None (Provider signature verification)  
**Description:** Webhook endpoint for payment gateway callbacks.

**URL Parameters:**
- `provider`: Payment provider name (e.g., razorpay, paytm)

**Request Body:** Provider-specific payload

### 2. Provider Webhook
**Endpoint:** `POST /v1/webhook/provider/:provider_key`  
**Authentication:** None (Provider signature verification)  
**Description:** Webhook endpoint for recharge provider callbacks.

**URL Parameters:**
- `provider_key`: Provider key identifier (e.g., mock, tuktuk)

**Request Body:** Provider-specific payload

---

## Queue APIs

Base Path: `/v1/queue`

### 1. Enqueue Recharge
**Endpoint:** `POST /v1/queue/recharge`  
**Authentication:** Required  
**Description:** Add a recharge request to the processing queue.

**Request Body:**
```json
{
  "phoneNumber": "+1234567890",
  "operator": "airtel",
  "amount": 99.00,
  "priority": "normal"
}
```

---

## Device APIs

Base Path: `/v1/device`

### 1. Register Device
**Endpoint:** `POST /v1/device/register`  
**Authentication:** Required  
**Description:** Register a device for push notifications.

**Request Body:**
```json
{
  "deviceToken": "fcm_token_here",
  "deviceType": "android",
  "deviceInfo": {
    "model": "Samsung Galaxy",
    "os": "Android 12"
  }
}
```

---

## Admin - Transaction Management

Base Path: `/admin`  
**Authentication:** Required (Admin role)

### 1. List All Transactions
**Endpoint:** `GET /admin/transactions`  
**Description:** List all transactions in the system with pagination.

**Query Parameters:**
- `page` (optional): Page number
- `limit` (optional): Records per page
- `status` (optional): Filter by status
- `userId` (optional): Filter by user ID
- `startDate` (optional): Filter from date
- `endDate` (optional): Filter to date

### 2. Get Transaction Details
**Endpoint:** `GET /admin/transactions/:id`  
**Description:** Get detailed information about a specific transaction.

**URL Parameters:**
- `id`: Transaction ID

---

## Admin - Platform Wallet

Base Path: `/admin/platform`  
**Authentication:** Required (Admin role)

### 1. Get Platform Balance
**Endpoint:** `GET /admin/platform/balance`  
**Description:** Get the total platform wallet balance.

**Response:**
```json
{
  "balance": 100000.00,
  "currency": "INR",
  "lastUpdated": "2024-01-01T00:00:00Z"
}
```

### 2. Get Platform Transactions
**Endpoint:** `GET /admin/platform/transactions`  
**Description:** Get all platform wallet transactions.

**Query Parameters:**
- `page` (optional): Page number
- `limit` (optional): Records per page
- `startDate` (optional): Filter from date
- `endDate` (optional): Filter to date

---

## Admin - Transaction Actions

Base Path: `/admin/transactions/:id`  
**Authentication:** Required (Admin role)

### 1. Refund Transaction
**Endpoint:** `POST /admin/transactions/:id/refund`  
**Description:** Process a refund for a specific transaction.

**URL Parameters:**
- `id`: Transaction ID

**Request Body:**
```json
{
  "reason": "Customer request",
  "amount": 99.00
}
```

### 2. Force Transaction Status
**Endpoint:** `POST /admin/transactions/:id/force-status`  
**Description:** Manually update transaction status (use with caution).

**URL Parameters:**
- `id`: Transaction ID

**Request Body:**
```json
{
  "status": "success",
  "reason": "Manual verification completed"
}
```

---

## Admin - Dashboard & Notifications

Base Path: `/v1/admin`  
**Authentication:** Required (Admin role)

### 1. Dashboard Summary
**Endpoint:** `GET /v1/admin/dashboard/summary`  
**Description:** Get dashboard summary with key metrics.

**Response:**
```json
{
  "totalTransactions": 1000,
  "successfulTransactions": 950,
  "failedTransactions": 50,
  "totalRevenue": 50000.00,
  "activeUsers": 500
}
```

### 2. Manual Notification
**Endpoint:** `POST /v1/admin/notify/manual`  
**Description:** Send manual notification to users or admins.

**Request Body:**
```json
{
  "userId": "user_id",
  "title": "Important Update",
  "message": "Your notification message here",
  "type": "info"
}
```

---

## Admin - Provider Management

Base Path: `/admin`  
**Authentication:** Required (Admin role)

### 1. Add Provider
**Endpoint:** `POST /admin/providers`  
**Description:** Add a new recharge provider to the system.

**Request Body:**
```json
{
  "providerKey": "provider_key",
  "providerName": "Provider Name",
  "apiUrl": "https://provider-api.com",
  "apiKey": "api_key_here",
  "isActive": true,
  "config": {
    "timeout": 30000,
    "retries": 3
  }
}
```

### 2. Get All Providers
**Endpoint:** `GET /admin/providers`  
**Description:** List all recharge providers.

**Response:**
```json
{
  "providers": [
    {
      "providerKey": "mock",
      "providerName": "Mock Provider",
      "isActive": true,
      "balance": 10000.00
    }
  ]
}
```

### 3. Get Provider Balance
**Endpoint:** `GET /admin/providers/:provider_key/balance`  
**Description:** Get balance of a specific provider.

**URL Parameters:**
- `provider_key`: Provider key identifier

### 4. Topup Provider
**Endpoint:** `POST /admin/providers/topup`  
**Description:** Add balance to a provider account.

**Request Body:**
```json
{
  "providerKey": "provider_key",
  "amount": 5000.00,
  "reference": "topup_ref_123"
}
```

### 5. Get Provider Transactions
**Endpoint:** `GET /admin/providers/transactions`  
**Description:** Get all provider-related transactions.

**Query Parameters:**
- `providerKey` (optional): Filter by provider
- `startDate` (optional): Filter from date
- `endDate` (optional): Filter to date

### 6. Provider Topup (Legacy)
**Endpoint:** `POST /admin/provider/topup`  
**Description:** Legacy endpoint for provider topup (kept for backward compatibility).

### 7. Trigger Provider Health Check
**Endpoint:** `POST /admin/providers/health-check`  
**Description:** Manually trigger health check for all providers.

---

## Admin - Operator Mapping

Base Path: `/v1/admin/operator-mapping`  
**Authentication:** Required (Admin role)

### 1. Create Operator Mapping
**Endpoint:** `POST /v1/admin/operator-mapping`  
**Description:** Create a mapping between operator and provider.

**Request Body:**
```json
{
  "operatorCode": "AIR",
  "operatorName": "Airtel",
  "providerKey": "tuktuk",
  "providerOperatorCode": "AIR_TT",
  "circle": "delhi"
}
```

### 2. List Operator Mappings
**Endpoint:** `GET /v1/admin/operator-mapping`  
**Description:** List all operator mappings.

**Query Parameters:**
- `operatorCode` (optional): Filter by operator code
- `providerKey` (optional): Filter by provider

### 3. Get Operator Mapping
**Endpoint:** `GET /v1/admin/operator-mapping/:id`  
**Description:** Get details of a specific operator mapping.

**URL Parameters:**
- `id`: Mapping ID

### 4. Update Operator Mapping
**Endpoint:** `PUT /v1/admin/operator-mapping/:id`  
**Description:** Update an existing operator mapping.

**URL Parameters:**
- `id`: Mapping ID

**Request Body:**
```json
{
  "providerOperatorCode": "AIR_NEW",
  "isActive": true
}
```

### 5. Delete Operator Mapping
**Endpoint:** `DELETE /v1/admin/operator-mapping/:id`  
**Description:** Delete an operator mapping.

**URL Parameters:**
- `id`: Mapping ID

---

## Admin - Commission Packs

Base Path: `/admin/commission-packs`  
**Authentication:** Required (Admin role)

### 1. Create Commission Pack
**Endpoint:** `POST /admin/commission-packs`  
**Description:** Create a new commission pack for operators.

**Request Body:**
```json
{
  "packName": "Basic Pack",
  "operatorCode": "AIR",
  "commissionType": "percentage",
  "commissionValue": 2.5,
  "minAmount": 10.00,
  "maxAmount": 1000.00,
  "isActive": true
}
```

### 2. List Commission Packs
**Endpoint:** `GET /admin/commission-packs`  
**Description:** List all commission packs.

**Query Parameters:**
- `operatorCode` (optional): Filter by operator code
- `isActive` (optional): Filter by active status

---

## Admin - Reports

Base Path: `/admin/reports`  
**Authentication:** Required (Admin role)

### 1. Transaction Report
**Endpoint:** `GET /admin/reports/transactions`  
**Description:** Generate transaction reports with various filters.

**Query Parameters:**
- `startDate` (required): Start date for report
- `endDate` (required): End date for report
- `status` (optional): Filter by status
- `operator` (optional): Filter by operator
- `format` (optional): Report format (json, csv, excel)

**Response:** Report data in requested format

---

## Admin - Metrics

Base Path: `/admin/metrics`  
**Authentication:** Required (Admin role)

### 1. Get System Metrics
**Endpoint:** `GET /admin/metrics`  
**Description:** Get comprehensive system metrics and analytics.

**Query Parameters:**
- `period` (optional): Time period (today, week, month, custom)
- `startDate` (optional): For custom period
- `endDate` (optional): For custom period

**Response:**
```json
{
  "transactionMetrics": {
    "total": 1000,
    "successful": 950,
    "failed": 50,
    "pending": 0,
    "successRate": 95.0
  },
  "revenueMetrics": {
    "totalRevenue": 50000.00,
    "totalCommission": 1250.00,
    "netRevenue": 48750.00
  },
  "userMetrics": {
    "activeUsers": 500,
    "newUsers": 50,
    "totalUsers": 1000
  },
  "providerMetrics": {
    "providers": [
      {
        "name": "Mock Provider",
        "transactions": 500,
        "successRate": 98.0
      }
    ]
  }
}
```

---

## Admin - Reconciliation

Base Path: `/admin/reconciliation`  
**Authentication:** Required (Admin role)

### 1. Upload Settlement File
**Endpoint:** `POST /admin/reconciliation/upload`  
**Description:** Upload provider settlement file for reconciliation.

**Request Body:** Multipart form-data
- `file`: CSV/Excel file containing settlement data
- `provider`: Provider key
- `settlementDate`: Settlement date

### 2. List Reconciliation Reports
**Endpoint:** `GET /admin/reconciliation/reports`  
**Description:** List all reconciliation reports.

**Query Parameters:**
- `provider` (optional): Filter by provider
- `status` (optional): Filter by status (matched, unmatched, disputed)
- `startDate` (optional): Filter from date
- `endDate` (optional): Filter to date

### 3. Get Settlement Files
**Endpoint:** `GET /admin/reconciliation/files`  
**Description:** Get list of uploaded settlement files.

**Query Parameters:**
- `provider` (optional): Filter by provider
- `startDate` (optional): Filter from date
- `endDate` (optional): Filter to date

### 4. Get Reconciliation Item
**Endpoint:** `GET /admin/reconciliation/:id`  
**Description:** Get details of a specific reconciliation item.

**URL Parameters:**
- `id`: Reconciliation item ID

### 5. Resolve Reconciliation Item
**Endpoint:** `POST /admin/reconciliation/:id/resolve`  
**Description:** Resolve a reconciliation discrepancy.

**URL Parameters:**
- `id`: Reconciliation item ID

**Request Body:**
```json
{
  "resolution": "provider_error",
  "notes": "Provider confirmed transaction failed",
  "action": "refund"
}
```

### 6. Adjust Reconciliation Item
**Endpoint:** `POST /admin/reconciliation/:id/adjust`  
**Description:** Make manual adjustment to reconciliation item.

**URL Parameters:**
- `id`: Reconciliation item ID

**Request Body:**
```json
{
  "adjustmentType": "credit",
  "amount": 99.00,
  "reason": "Manual verification completed"
}
```

---

## Admin - Alerts

Base Path: `/admin/alerts`  
**Authentication:** Required (Admin role)

### 1. List Alerts
**Endpoint:** `GET /admin/alerts`  
**Description:** List all system alerts and notifications.

**Query Parameters:**
- `status` (optional): Filter by status (open, acknowledged, closed)
- `severity` (optional): Filter by severity (low, medium, high, critical)
- `type` (optional): Filter by alert type
- `startDate` (optional): Filter from date
- `endDate` (optional): Filter to date

**Response:**
```json
{
  "alerts": [
    {
      "id": "alert_123",
      "type": "provider_balance_low",
      "severity": "high",
      "message": "Provider balance below threshold",
      "status": "open",
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### 2. Acknowledge Alert
**Endpoint:** `POST /admin/alerts/:id/ack`  
**Description:** Acknowledge an alert (mark as seen).

**URL Parameters:**
- `id`: Alert ID

**Request Body:**
```json
{
  "acknowledgedBy": "admin_user_id",
  "notes": "Investigating the issue"
}
```

### 3. Close Alert
**Endpoint:** `POST /admin/alerts/:id/close`  
**Description:** Close/resolve an alert.

**URL Parameters:**
- `id`: Alert ID

**Request Body:**
```json
{
  "closedBy": "admin_user_id",
  "resolution": "Issue resolved - provider balance topped up",
  "resolutionType": "resolved"
}
```

---

## Test Endpoint

### Test Notification
**Endpoint:** `POST /notify/test`  
**Authentication:** None  
**Description:** Test endpoint for notification system (development/testing only).

**Request Body:**
```json
{
  "userId": "user_id",
  "message": "Test notification"
}
```

---

## Error Responses

All endpoints may return error responses in the following format:

```json
{
  "error": true,
  "message": "Error description",
  "code": "ERROR_CODE",
  "details": {}
}
```

### Common HTTP Status Codes:
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `409` - Conflict
- `422` - Unprocessable Entity
- `429` - Too Many Requests
- `500` - Internal Server Error
- `503` - Service Unavailable

---

## Rate Limiting

Some endpoints have rate limiting:
- OTP requests: Limited per phone number
- API calls: May have per-user or global rate limits

Rate limit information is included in response headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1234567890
```

---

## Webhooks

The system sends webhooks for various events. Configure webhook URLs in admin panel.

### Webhook Events:
- `transaction.completed` - Transaction completed successfully
- `transaction.failed` - Transaction failed
- `wallet.credited` - Wallet credited
- `wallet.debited` - Wallet debited
- `topup.completed` - Topup completed
- `alert.created` - New alert created

### Webhook Payload Format:
```json
{
  "event": "transaction.completed",
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    "transactionId": "txn_123",
    "status": "success",
    "amount": 99.00
  }
}
```

---

## Pagination

List endpoints support pagination with the following parameters:
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20, max: 100)

Response includes pagination metadata:
```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

---

## SMS Integration

The system uses Twilio for OTP delivery via SMS. Configure the following environment variables:

```
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890  # Your Twilio phone number
```

### SMS Features:
- OTP delivery via SMS ($0.03-0.05 per SMS to India)
- Automatic phone number formatting (+91 prefix handling)
- Delivery status tracking
- Fallback to email if SMS fails
- Development mode logging (no actual SMS sent)

### SMS Response Format:
```json
{
  "ok": true,
  "messageId": "SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "status": "queued",
  "price": "-0.00750"
}
```

## Notes

1. All timestamps are in ISO 8601 format (UTC)
2. All monetary amounts are in decimal format (e.g., 99.00)
3. Phone numbers should be in E.164 format (e.g., +1234567890)
4. Admin endpoints require admin role in JWT token
5. Some endpoints may have additional validation rules
6. Test endpoints should not be used in production
7. SMS OTP is sent via Fast2SMS service

---

## Support

For API support and questions, please contact the development team.

**Version:** 1.0  
**Last Updated:** January 2025
