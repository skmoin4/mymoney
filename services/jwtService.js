// apmoney/services/jwtService.js
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const JWT_EXPIRY = '1h';
const JWT_ALGO = 'HS256';
const JWT_SECRET = process.env.JWT_SECRET || 'change_me';

export function createAccessToken(payload) {
  // payload should be small (user id, role)
  const jti = `${Date.now()}:${Math.random().toString(36).substring(2, 8)}`;
  const token = jwt.sign({ ...payload, jti }, JWT_SECRET, {
    expiresIn: JWT_EXPIRY,
    algorithm: JWT_ALGO
  });
  return { token, expires_in: 3600, jti }; // 1 hour
}
