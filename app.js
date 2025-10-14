import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import xssClean from 'xss-clean';
import hpp from 'hpp';
import dotenv from 'dotenv';
import morgan from 'morgan';
import routes from './routes.js';
import requestIdMiddleware from './middlewares/requestId.js';
import errorHandler from './middlewares/errorHandler.js';
import { initSentry } from './utils/sentry.js';
import logger from './utils/logger.js';
import * as Sentry from '@sentry/node';
import { httpRequestDuration, httpRequestsTotal, setupMetricsEndpoint } from './metrics/metrics.js';
import { healthHandler } from './controllers/healthController.js';

dotenv.config();

// Init Sentry if DSN present
initSentry();

const app = express();

// ---------------- Security Middlewares ----------------

// ✅ Helmet — secure headers
app.use(
  helmet({
    contentSecurityPolicy: false, // disable if causing WebSocket issues
    crossOriginEmbedderPolicy: false,
  })
);

// ✅ Strong CORS
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : ['http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ✅ XSS Protection (disabled for Express 5 compatibility)
// app.use(xssClean());

// ✅ HTTP Parameter Pollution protection
app.use(hpp());

// ✅ Rate limiter (auth APIs especially)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10, // 10 requests per IP per 15 min
  message: { error: 'Too many requests, try again later.' },
});

app.use('/api/v1/auth', authLimiter);

// ✅ Global JSON parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'production') { 
  app.use(morgan('dev'));
}

app.use(express.json({
  verify: (req, res, buf) => {
    // store raw body as utf8 string
    req.rawBody = buf && buf.length ? buf.toString('utf8') : '';
  },
  limit: '1mb'
}));

// Sentry request handler (must be first middleware after body parser if you want request body in Sentry)
if (process.env.SENTRY_DSN) app.use(Sentry.Handlers.requestHandler());
if (process.env.SENTRY_DSN) app.use(Sentry.Handlers.tracingHandler());

// Request logging middleware
app.use((req, res, next) => {
  // log request start
  logger.info('http_request_start', { method: req.method, url: req.originalUrl, ip: req.ip });
  // store start time
  req._startAt = process.hrtime();
  next();
});

// Metrics middleware
app.use((req, res, next) => {
  const end = res.end;
  const start = process.hrtime();
  res.end = function (...args) {
    const [sec, ns] = process.hrtime(start);
    const duration = sec + ns / 1e9;
    const route = req.route?.path || req.originalUrl.split('?')[0];
    httpRequestDuration.labels(req.method, route, String(res.statusCode)).observe(duration);
    httpRequestsTotal.labels(req.method, route, String(res.statusCode)).inc();
    end.apply(this, args);
  };
  next();
});

// Routes
app.use('/api', routes);
app.use(requestIdMiddleware);

// Serve static files from dist folder
app.use(express.static('dist'));


// Health endpoints
app.get('/health', healthHandler);
app.get('/ready', healthHandler);

// Metrics endpoint 
setupMetricsEndpoint(app);

// Legacy webhook (keep for Razorpay)
app.post("/api/webhooks", (req, res) => {
  const secret = "moinsakhi"; // jo tumne Razorpay dashboard me dala hai

  const shasum = crypto.createHmac("sha256", secret);
  shasum.update(JSON.stringify(req.body));
  const digest = shasum.digest("hex");

  if (digest === req.headers["x-razorpay-signature"]) {
    console.log("Webhook verified:", req.body);
    res.status(200).send("OK");
  } else {
    console.log("Webhook signature mismatch");
    res.status(400).send("Invalid signature");
  }
});

// Error handling
app.use((err, req, res, next) => {
  // send to Sentry (if configured) with some context
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err, scope => {
      scope.setUser({ id: req.user?.id || null });
      scope.setTag('path', req.path);
      return scope;
    });
  }
  logger.error('unhandled_error', { message: err.message, stack: err.stack, path: req.path });
  // call next error handler
  next(err);
});

// Sentry error handler (final)
if (process.env.SENTRY_DSN) app.use(Sentry.Handlers.errorHandler());

app.use(errorHandler);

// Catch all handler: send back index.html for client-side routing
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/health' || req.path === '/ready' || req.path.startsWith('/metrics')) {
    return next();
  }
  res.sendFile('index.html', { root: 'dist' });
});


// Basic root
app.get('/', (req, res) => res.json({ ok: true, service: 'apmoney-backend' }));

export default app;
