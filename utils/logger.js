// apmoney/utils/logger.js
import { createLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

const LOG_DIR = process.env.LOG_DIR || './logs';
const level = process.env.LOG_LEVEL || 'info';

const redactFields = ['password','otp','authorization','token','card_number','cvv'];

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  try {
    const out = JSON.parse(JSON.stringify(obj));
    function walk(v) {
      if (v && typeof v === 'object') {
        for (const k of Object.keys(v)) {
          if (redactFields.includes(k.toLowerCase())) v[k] = '[REDACTED]';
          else walk(v[k]);
        }
      }
    }
    walk(out);
    return out;
  } catch (e) { return obj; }
}

const jsonFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.splat(),
  format.printf(info => {
    // message may be object
    const base = {
      timestamp: info.timestamp,
      level: info.level,
      message: info.message,
      pid: process.pid,
      service: process.env.APP_NAME || 'app'
    };
    const meta = info.meta || info;
    const safeMeta = redact(meta);
    return JSON.stringify(Object.assign(base, safeMeta));
  })
);

const logger = createLogger({
  level,
  format: jsonFormat,
  transports: [
    new transports.Console(),
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      maxSize: '20m',
      zippedArchive: true
    })
  ],
  exitOnError: false
});

export default logger;
