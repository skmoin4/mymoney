// src/utils/smsProvider.js
import twilio from 'twilio';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

const TWILIO_ACCOUNT_SID = 'AC48d5ad19800548f824c710c8acd1419d';
const TWILIO_AUTH_TOKEN = '6489957e69a2fc685221c56ffe489feb';
const TWILIO_PHONE_NUMBER = '+12708124820'; // Replace with actual Twilio number

// Initialize Twilio client
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

/**
 * Send OTP via Twilio SMS
 * @param {string} phone - Mobile number (with or without country code)
 * @param {string} otp - OTP to send
 * @returns {Promise<{ok: boolean, messageId?: string, error?: string}>}
 */
export async function sendOtpSms(phone, otp) {
  // Clean and format phone number
  let cleanPhone = phone.replace(/\D/g, ''); // Remove all non-digits

  // Add +91 if not present and it's a 10-digit Indian number
  if (cleanPhone.length === 10 && !cleanPhone.startsWith('91')) {
    cleanPhone = `+91${cleanPhone}`;
  } else if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
    cleanPhone = `+${cleanPhone}`;
  } else if (!cleanPhone.startsWith('+')) {
    cleanPhone = `+${cleanPhone}`;
  }

  // Validate phone number format
  if (!cleanPhone.match(/^\+\d{10,15}$/)) {
    logger.warn('Invalid phone number format for SMS', { phone: cleanPhone });
    return { ok: false, error: 'Invalid phone number format' };
  }

  // Development mode - just log OTP
  if (process.env.NODE_ENV === 'development') {
    logger.info(`[DEV ONLY] OTP for ${cleanPhone}: ${otp}`);
    return { ok: true, messageId: `dev-${Date.now()}` };
  }

  try {
    const message = await twilioClient.messages.create({
      body: `Your OTP code is: ${otp}. This code will expire in 5 minutes.`,
      from: TWILIO_PHONE_NUMBER,
      to: cleanPhone
    });

    logger.info('OTP SMS sent successfully via Twilio', {
      phone: cleanPhone,
      messageId: message.sid,
      status: message.status,
      price: message.price
    });

    return {  
      ok: true,
      messageId: message.sid,
      status: message.status,
      price: message.price
    };

  } catch (error) {
    logger.error('Twilio SMS error', {
      phone: cleanPhone,
      error: error.message,
      code: error.code,
      status: error.status
    });

    // Return error details
    return {
      ok: false,
      error: error.message,
      code: error.code,
      status: error.status
    };
  }
}
