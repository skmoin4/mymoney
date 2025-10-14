// apmoney/metrics/metrics.js
import client from 'prom-client';

const collectDefault = client.collectDefaultMetrics;
collectDefault({ timeout: 5000 });

export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005,0.01,0.05,0.1,0.3,0.5,1,2,5]
});

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Count of HTTP requests',
  labelNames: ['method', 'route', 'status_code']
});

export const errorCount = new client.Counter({
  name: 'app_errors_total',
  help: 'Count of application errors',
  labelNames: ['type']
});

export function setupMetricsEndpoint(app, path = (process.env.PROM_METRICS_PATH || '/metrics')) {
  app.get(path, async (req, res) => {
    try {
      res.set('Content-Type', client.register.contentType);
      res.end(await client.register.metrics());
    } catch (e) {
      res.status(500).end(e.message);
    }
  });
}