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

import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

// Railway deployment - use SendGrid for better reliability
let emailService;

if (IS_PRODUCTION && process.env.SENDGRID_API_KEY) {
  // Production: Use SendGrid (recommended for Railway)
  try {
    const sgMail = (await import('@sendgrid/mail')).default;
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    emailService = 'sendgrid';
    logger.info('Email service initialized with SendGrid');
  } catch (err) {
    logger.warn('SendGrid not available, falling back to nodemailer', { error: err.message });
    emailService = 'nodemailer';
  }
} else {
  emailService = 'nodemailer';
}

// Fallback nodemailer configuration for development/local
let transporter = null;
if (emailService === 'nodemailer') {
  const nodemailer = (await import('nodemailer')).default;

  const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
  const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
  const SMTP_USER = process.env.SMTP_USER || 'skmoeen1436@gmail.com';
  const SMTP_PASS = process.env.SMTP_PASS || process.env.EMAIL_PASSWORD || 'zyivxdcfgondbong';

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS
    },
    // Conservative settings for Railway
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
    connectionTimeout: 30000,
    greetingTimeout: 15000,
    socketTimeout: 60000,
    requireTLS: SMTP_PORT === 587,
    tls: {
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2'
    }
  });
}

/**
 * sendOtpEmail(email, otp, options)
 * - Uses SendGrid in production (Railway), nodemailer in development
 */
export async function sendOtpEmail(email, otp, { maxRetries = 3 } = {}) {
  const mailOptions = {
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

  if (emailService === 'sendgrid' && IS_PRODUCTION) {
    // Use SendGrid for Railway production
    const sgMail = (await import('@sendgrid/mail')).default;
    const msg = {
      to: email,
      from: process.env.FROM_EMAIL || 'noreply@yourdomain.com', // Set this in Railway env vars
      subject: mailOptions.subject,
      text: mailOptions.text,
      html: mailOptions.html
    };

    try {
      const result = await sgMail.send(msg);
      logger.info('OTP email sent via SendGrid', { to: email, messageId: result[0]?.headers?.['x-message-id'] });
      return result;
    } catch (error) {
      logger.error('SendGrid email failed', {
        to: email,
        error: error.message,
        code: error.code
      });
      throw error;
    }
  } else {
    // Fallback to nodemailer for development
    mailOptions.from = process.env.SMTP_USER || 'skmoeen1436@gmail.com';

    let attempt = 0;
    let lastErr = null;

    while (attempt <= maxRetries) {
      try {
        attempt += 1;
        logger.info('Attempting to send OTP email via nodemailer', { attempt, to: email });

        const info = await transporter.sendMail(mailOptions);
        logger.info('OTP email sent via nodemailer', { to: email, messageId: info.messageId, attempt });
        return info;
      } catch (err) {
        lastErr = err;
        logger.error('Failed to send OTP email attempt', {
          attempt,
          to: email,
          message: err.message,
          code: err.code
        });

        if (attempt > maxRetries) break;

        // Simple backoff
        const delay = Math.min(10000, 1000 * attempt);
        await new Promise(res => setTimeout(res, delay));
      }
    }

    logger.error('All retries exhausted for OTP email', {
      to: email,
      attempts: attempt,
      lastMessage: lastErr?.message,
      code: lastErr?.code
    });
    throw lastErr || new Error('Failed to send email');
  }
}
