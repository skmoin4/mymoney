// apmoney/middlewares/errorHandler.js
import logger from '../utils/logger.js';

export default function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const requestId = req?.id;
  const status = err.statusCode || err.status || 500;
  const isDev = process.env.NODE_ENV !== 'production';

  // Log full error with stack and context (but avoid logging PII)
  logger.error(`Unhandled error`, {
    requestId,
    path: req.path,
    stack: err.stack,
    message: err.message
  });

  res.status(status).json({
    error: 'internal_server_error',
    message: isDev ? err.message : 'Something went wrong.',
    request_id: requestId
  });
}
