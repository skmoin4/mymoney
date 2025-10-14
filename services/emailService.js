import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: 'skmoeen1436@gmail.com',
    pass: process.env.EMAIL_PASSWORD // You'll need to set this in .env
  },
  // Add connection timeout and other options to prevent hanging
  connectionTimeout: 10000, // 10 seconds for server
  greetingTimeout: 10000,
  socketTimeout: 15000, // 15 seconds for server
  // Additional options for better server compatibility
  tls: {
    rejectUnauthorized: false // Allow self-signed certificates if needed
  }
});

export async function sendOtpEmail(email, otp) {
  try {
    // Check if we're in production/server environment
    const isProduction = process.env.NODE_ENV === 'development';

    const mailOptions = {
      from: 'skmoeen1436@gmail.com',
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
          <p>Environment: ${isProduction ? 'Production' : 'Development'}</p>
        </div>
      `
    };

    // Set timeout to prevent hanging - longer for server
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Email send timeout')), 20000); // 20 second timeout for server
    });

    await Promise.race([
      transporter.sendMail(mailOptions),
      timeoutPromise
    ]);

    logger.info('OTP email sent successfully', { email, environment: isProduction ? 'production' : 'development' });
  } catch (error) {
    logger.error('Failed to send OTP email', {
      email,
      error: error.message,
      code: error.code,
      command: error.command,
      environment: process.env.NODE_ENV
    });
    throw error;
  }
}