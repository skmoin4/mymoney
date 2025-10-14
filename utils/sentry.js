// apmoney/utils/sentry.js
import * as Sentry from '@sentry/node';
import * as Tracing from '@sentry/tracing';

export function initSentry() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // no-op in local/dev
    return Sentry;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || 'production',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.05), // adjust
    release: `${process.env.APP_NAME || 'app'}@${process.env.npm_package_version || 'dev'}`,
    attachStacktrace: true,
    beforeSend(event) {
      // drop/sanitize sensitive fields in event.request.data if present
      if (event.request && event.request.data) {
        const data = event.request.data;
        const redact = ['password','otp','card_number','cvv','token','authorization'];
        redact.forEach(k => {
          if (data[k]) data[k] = '[REDACTED]';
        });
        event.request.data = data;
      }
      return event;
    }
  });

  return Sentry;
}