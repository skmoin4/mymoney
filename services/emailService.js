// import nodemailer from 'nodemailer';
// import dotenv from 'dotenv';
// import logger from '../utils/logger.js';

// dotenv.config();

// const transporter = nodemailer.createTransport({
//   host: 'smtp.gmail.com',
//   port: 587,
//   secure: false, // true for 465, false for other ports
//   auth: {
//     user: 'skmoeen1436@gmail.com',
//     pass: process.env.EMAIL_PASSWORD // You'll need to set this in .env
//   },
//   // Add connection timeout and other options to prevent hanging
//   connectionTimeout: 30000, // 30 seconds for server
//   greetingTimeout: 30000,
//   socketTimeout: 45000, // 45 seconds for server
//   // Additional options for better server compatibility
//   tls: {
//     rejectUnauthorized: false, // Allow self-signed certificates if needed
//     ciphers: 'SSLv3'
//   },
//   // Retry options
//   retryDelay: 5000,
//   maxRetries: 3
// });

// export async function sendOtpEmail(email, otp) {
//   try {
//     // Check if we're in production/server environment
//     const isProduction = process.env.NODE_ENV === 'development';

//     const mailOptions = {
//       from: 'skmoeen1436@gmail.com',
//       to: email,
//       subject: 'Your OTP Code',
//       text: `Your OTP code is: ${otp}. This code will expire in 5 minutes.`,
//       html: `
//         <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
//           <h2>Your OTP Code</h2>
//           <p>Your OTP code is:</p>
//           <h1 style="color: #007bff; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
//           <p>This code will expire in 5 minutes.</p>
//           <p>If you didn't request this code, please ignore this email.</p>
//           <p>Environment: ${isProduction ? 'Production' : 'Development'}</p>
//         </div>
//       `
//     };

//     // Set timeout to prevent hanging - longer for server
//     const timeoutPromise = new Promise((_, reject) => {
//       setTimeout(() => reject(new Error('Email send timeout')), 60000); // 60 second timeout for server
//     });

//     await Promise.race([
//       transporter.sendMail(mailOptions),
//       timeoutPromise
//     ]);

//     logger.info('OTP email sent successfully', { email, environment: isProduction ? 'production' : 'development' });
//   } catch (error) {
//     logger.error('Failed to send OTP email', {
//       email,
//       error: error.message,
//       code: error.code,
//       command: error.command,
//       environment: process.env.NODE_ENV
//     });
//     throw error;
//   }
// }

 // mailer.js
import nodemailer from 'nodemailer';
import dns from 'dns/promises';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || 'skmoeen1436@gmail.com';
const SMTP_PASS = process.env.SMTP_PASS || process.env.EMAIL_PASSWORD || 'zyivxdcfgondbong';
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

// Create transporter with sane options
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465, // true for 465
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS
  },
  pool: true,                // reuse connections
  maxConnections: 5,
  maxMessages: 1000,
  // timeouts (ms)
  connectionTimeout: 20000,  // connect timeout
  greetingTimeout: 10000,    // wait for SMTP server greeting
  socketTimeout: 60000,      // read/write socket timeout
  requireTLS: SMTP_PORT === 587 // use STARTTLS on 587
});

// Verify on startup to get early failure info
async function verifyTransporter() {
  try {
    await transporter.verify();
    logger.info('SMTP transporter verified', { host: SMTP_HOST, port: SMTP_PORT });
  } catch (err) {
    logger.error('SMTP verify failed', { host: SMTP_HOST, port: SMTP_PORT, message: err.message, code: err.code });
    // don't throw here - allow app to start but keep logs for ops
  }
}
verifyTransporter();

// small helper: exponential backoff
function wait(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function resolveHost(host) {
  try {
    const addrs = await dns.lookup(host, { all: true });
    const ips = addrs.map(a => a.address);
    return ips;
  } catch (err) {
    logger.warn('DNS lookup failed', { host, message: err.message });
    return [];
  }
}

/**
 * sendOtpEmail(email, otp, options)
 * - retries with exponential backoff on transient errors (like ETIMEDOUT)
 */
export async function sendOtpEmail(email, otp, { maxRetries = 3 } = {}) {
  const resolvedIps = await resolveHost(SMTP_HOST);
  logger.info('SMTP resolved', { host: SMTP_HOST, ips: resolvedIps });

  const mailOptions = {
    from: SMTP_USER,
    to: email,
    subject: 'Your OTP Code',
    text: `Your OTP code is: ${otp}. This code will expire in 5 minutes.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Your OTP Code</h2>
        <p>Your OTP code is:</p>
        <h1 style="color: #007bff; font-size: 32px; letter-spacing: 5px;">${otp}</h1>
        <p>This code will expire in 5 minutes.</p>
        <p>If you didn't request this code, please ignore this email.</p>
        <p>Environment: ${IS_PRODUCTION ? 'Production' : 'Development'}</p>
      </div>
    `
  };

  let attempt = 0;
  let lastErr = null;

  while (attempt <= maxRetries) {
    try {
      attempt += 1;
      logger.info('Attempting to send OTP email', { attempt, to: email, host: SMTP_HOST, port: SMTP_PORT });

      // transporter.sendMail returns a Promise
      const info = await transporter.sendMail(mailOptions);

      // success
      logger.info('OTP email sent', { to: email, messageId: info.messageId, attempt });
      return info;
    } catch (err) {
      lastErr = err;
      // Log full socket-level details (but never log passwords)
      logger.error('Failed to send OTP email attempt', {
        attempt,
        to: email,
        message: err.message,
        code: err.code,
        errno: err.errno,
        syscall: err.syscall,
        command: err.command
      });

      // If it's unrecoverable (auth failure, invalid recipient format), bail out immediately
      const nonRetryable = ['EAUTH', 'EENVELOPE', 'ERR_INVALID_ARG_TYPE'].includes(err.code) || (err.response && /Authentication|Invalid/.test(err.response));
      if (nonRetryable) throw err;

      // If last attempt, break and throw
      if (attempt > maxRetries) break;

      // Exponential backoff: base 1000ms * 2^(attempt-1)
      const delay = Math.min(30000, 1000 * Math.pow(2, attempt - 1));
      logger.info('Will retry sendMail after backoff', { attempt, delayMs: delay });
      await wait(delay);
    }
  }

  // after retries
  logger.error('All retries exhausted for OTP email', { to: email, attempts: attempt, lastMessage: lastErr && lastErr.message, code: lastErr && lastErr.code });
  throw lastErr || new Error('Failed to send email - unknown error');
}
