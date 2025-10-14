// src/utils/smsProvider.js
import dotenv from 'dotenv';
dotenv.config();

export async function sendOtpSms(phone, otp) {
  if (process.env.NODE_ENV === 'development') {
    // Dev में पूरा OTP दिखाओ
    console.log(`[DEV ONLY] OTP for ${phone}: ${otp}`);
  } else {
    // Production में mask रखो
    const masked = `****${String(otp).slice(-2)}`;
    console.log(`[Mock SMS] Sent OTP to ${phone}: ${masked}`);
  }
  return { ok: true, messageId: `mock-${Date.now()}` };
}
