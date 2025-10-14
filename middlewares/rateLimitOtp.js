// src/middlewares/rateLimitOtp.js
import connection from '../config/redis.js';
import dotenv from 'dotenv';
dotenv.config();

const WINDOW_SECONDS = Number(process.env.OTP_MAX_REQUESTS_WINDOW_SECONDS || 900); // 15m
const MAX_PER_WINDOW = Number(process.env.OTP_MAX_REQUESTS_PER_WINDOW || 3);

export default async function rateLimitOtp(req, res, next) {
  try {
    const phone = req.body?.phone;
    if (!phone) return res.status(400).json({ error: 'phone is required' });

    const key = `otp:rl:${phone}`;
    const cur = await connection.incr(key);
    if (cur === 1) {
      // set expiry when first seen
      await connection.expire(key, WINDOW_SECONDS);
    }
    if (cur > MAX_PER_WINDOW) {
      const ttl = await connection.ttl(key);
      return res.status(429).json({
        error: 'Too many OTP requests. Try again later.',
        retry_after_seconds: ttl > 0 ? ttl : WINDOW_SECONDS
      });
    }
    return next();
  } catch (err) {
    console.error('rateLimitOtp error', err);
    // fail-open: allow request if redis error, but log it
    return next();
  }
}
