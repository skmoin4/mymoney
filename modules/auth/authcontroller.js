// src/controllers/authController.js
import Joi from 'joi';
import { createAndSendOtp } from '../../services/otpService.js';

import { query, getPool } from '../../config/db.js';
import { verifyOtpHash } from '../../services/otpService.js';
import redis from '../../config/redis.js';
import { createAccessToken } from '../../services/jwtService.js';
import dotenv from 'dotenv';
import logger from '../../utils/logger.js';
dotenv.config();

const VERIFY_MAX_ATTEMPTS = Number(process.env.OTP_MAX_VERIFY_ATTEMPTS || 5);
const OTP_TTL = Number(process.env.OTP_TTL_SECONDS || 300);

const requestOtpSchema = Joi.object({
  phone: Joi.string().pattern(/^[0-9+]{6,20}$/).required(),
  email: Joi.string().email().optional()
});
 
export async function requestOtp(req, res) {
  try {
    const { error, value } = requestOtpSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const { phone, email } = value;
    // create OTP + send SMS and email if provided
    const { requestId, ttl } = await createAndSendOtp(phone, email);
    return res.json({ request_id: requestId, ttl_seconds: ttl, message: 'OTP sent (mock)' });
  } catch (err) {
    console.error('requestOtp err', err);
    return res.status(500).json({ error: 'internal_server_error' });
  }
}

export async function verifyOtp(req, res) {
  const schema = Joi.object({
    phone: Joi.string().pattern(/^[0-9+]{6,20}$/).required(),
    request_id: Joi.string().uuid().required(),
    otp: Joi.string().pattern(/^[0-9]{4,8}$/).required(),
    name: Joi.string().min(2).max(100).optional(),
    email: Joi.string().email().optional(),
    device_id: Joi.string().optional()
  });

  try {
    logger.info('Starting verifyOtp', { phone: req.body.phone, request_id: req.body.request_id });
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const { phone, request_id: requestId, otp, name, email, device_id } = value;

    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();

      // Lock the OTP row to avoid race conditions
      const [otpRows] = await conn.execute(
        'SELECT id, request_id, phone, otp_hash, expires_at, attempts, consumed FROM otps WHERE request_id = ? FOR UPDATE',
        [requestId]
      );

      if (!otpRows || otpRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'invalid_request_id_or_expired' });
      }

      const otpRow = otpRows[0];

      // basic checks
      if (String(otpRow.phone) !== String(phone)) {
        // phone mismatch — don't reveal details
        // increment attempts maybe
        const updAttempts = otpRow.attempts + 1;
        await conn.execute('UPDATE otps SET attempts = ? WHERE id = ?', [updAttempts, otpRow.id]);
        await conn.commit();
        return res.status(400).json({ error: 'invalid_otp_or_request' });
      }

      if (otpRow.consumed) {
        await conn.rollback();
        return res.status(400).json({ error: 'otp_already_used' });
      }

      const now = new Date();
      if (otpRow.expires_at && new Date(otpRow.expires_at) < now) {
        // expired
        await conn.execute('UPDATE otps SET consumed = 1 WHERE id = ?', [otpRow.id]);
        await conn.commit();
        return res.status(400).json({ error: 'otp_expired' });
      }

      // verify hash
      const ok = verifyOtpHash(otp, requestId, otpRow.otp_hash);
      if (!ok) {
        const newAttempts = (otpRow.attempts || 0) + 1;
        const updates = ['attempts = ?'];
        const params = [newAttempts, otpRow.id];
        await conn.execute('UPDATE otps SET attempts = ? WHERE id = ?', [newAttempts, otpRow.id]);
        // if attempts exceed maximum, consume it
        if (newAttempts >= VERIFY_MAX_ATTEMPTS) {
          await conn.execute('UPDATE otps SET consumed = 1 WHERE id = ?', [otpRow.id]);
        }
        await conn.commit();
        return res.status(400).json({ error: 'invalid_otp', attempts: newAttempts });
      }

      // OTP is valid — mark consumed
      await conn.execute('UPDATE otps SET consumed = 1 WHERE id = ?', [otpRow.id]);

      // Now check if user exists; lock user row if exists to prevent race
      const [userRows] = await conn.execute('SELECT id, phone, name, email, role, profile_complete, status FROM users WHERE phone = ? FOR UPDATE', [phone]);

      let user;
      if (userRows && userRows.length > 0) {
        user = userRows[0];
        logger.info('User exists, logging in', { phone, user_id: user.id });
        // commit after creating token
      } else {
        // user does not exist — if name/email provided create user and wallet
        if (!(name && email)) {
          // require profile
          logger.info('New user needs profile', { phone, requestId });
          await conn.commit(); // otp consumed, but user not created
          return res.json({ needs_profile: true, request_id: requestId });
        }
        logger.info('Creating new user', { phone, name, email });

        // create user
        const role = 'retailer';
        const profileComplete = 1;
        const status = 'active';
        const createSql = 'INSERT INTO users (phone, name, email, role, profile_complete, status, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())';
        const [insRes] = await conn.execute(createSql, [phone, name, email, role, profileComplete, status]);
        const newUserId = insRes.insertId;
        logger.info('User created in DB', { user_id: newUserId, phone, name, email });

        // create wallet for user
        const wSql = 'INSERT INTO wallets (user_id, balance, reserved, currency, created_at) VALUES (?, 0, 0, ?, NOW())';
        const currency = 'INR';
        await conn.execute(wSql, [newUserId, currency]);
        logger.info('Wallet created for user', { user_id: newUserId });

        // fetch created user
        const [newRows] = await conn.execute('SELECT id, phone, name, email, role, profile_complete, status FROM users WHERE id = ? FOR UPDATE', [newUserId]);
        user = newRows[0];
      }

      // commit everything
      await conn.commit();

      // issue JWT token
      const tokenPayload = { user_id: user.id, role: user.role, phone: user.phone };
      const { token, expires_in, jti } = createAccessToken(tokenPayload);

      // return user minimal info
      const userPublic = {
        id: user.id,
        phone: user.phone,
        name: user.name,
        email: user.email,
        role: user.role,
        profile_complete: !!user.profile_complete
      };

      return res.json({ access_token: token, expires_in, user: userPublic });
    } catch (innerErr) {
      try { await conn.rollback(); } catch (e) { /* ignore */ }
      console.error('verifyOtp inner error', innerErr);
      return res.status(500).json({ error: 'internal_server_error' });
    } finally {
      conn.release();
    }
  } catch (err) {
    logger.error('verifyOtp error', { error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}

export async function completeProfile(req, res) {
  const schema = Joi.object({
    phone: Joi.string().pattern(/^[0-9+]{6,20}$/).required(),
    request_id: Joi.string().uuid().required(),
    name: Joi.string().min(2).max(150).required(),
    email: Joi.string().email().required(),
    device_id: Joi.string().optional()
  });

  try {
    const { error, value } = schema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const { phone, request_id: requestId, name, email } = value;

    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // find OTP row locked
      const [otpRows] = await conn.execute(
        'SELECT id, phone, consumed, created_at FROM otps WHERE request_id = ? FOR UPDATE',
        [requestId]
      );

      if (!otpRows || otpRows.length === 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'invalid_request_id' });
      }

      const otpRow = otpRows[0];

      if (String(otpRow.phone) !== String(phone)) {
        await conn.rollback();
        return res.status(400).json({ error: 'phone_mismatch' });
      }

      // require that the otp was consumed by verify step and is recent
      if (!otpRow.consumed) {
        await conn.rollback();
        return res.status(400).json({ error: 'otp_not_verified' });
      }

      const created = new Date(otpRow.created_at);
      const ageMs = Date.now() - created.getTime();
      if (ageMs > OTP_TTL * 1000) {
        await conn.rollback();
        return res.status(400).json({ error: 'otp_too_old' });
      }

      // Check whether user exists already
      const [userRows] = await conn.execute('SELECT id, phone, name, email, role, profile_complete FROM users WHERE phone = ? FOR UPDATE', [phone]);

      let user;
      if (userRows && userRows.length > 0) {
        // If user exists, update name/email and profile_complete
        user = userRows[0];
        const updateSql = 'UPDATE users SET name = ?, email = ?, profile_complete = 1, updated_at = NOW() WHERE id = ?';
        await conn.execute(updateSql, [name, email, user.id]);
      } else {
        // create user
        const insertSql = 'INSERT INTO users (phone, name, email, role, profile_complete, status, created_at) VALUES (?, ?, ?, ?, 1, ?, NOW())';
        const role = 'retailer';
        const status = 'active';
        const [insRes] = await conn.execute(insertSql, [phone, name, email, role, status]);
        const newUserId = insRes.insertId;

        // create wallet
        const walletSql = 'INSERT INTO wallets (user_id, balance, reserved, currency, created_at) VALUES (?, 0, 0, ?, NOW())';
        await conn.execute(walletSql, [newUserId, 'INR']);

        // fetch new user
        const [newRows] = await conn.execute('SELECT id, phone, name, email, role, profile_complete FROM users WHERE id = ?', [newUserId]);
        user = newRows[0];
      }

      await conn.commit();

      // Issue JWT
      const payload = { user_id: user.id, role: user.role, phone: user.phone };
      const { token, expires_in } = createAccessToken(payload);

      return res.json({
        access_token: token,
        expires_in,
        user: {
          id: user.id,
          phone: user.phone,
          name,
          email,
          role: user.role,
          profile_complete: true
        }
      });
    } catch (inner) {
      try { await conn.rollback(); } catch (e) { /* ignore */ }
      console.error('completeProfile inner error', inner);
      return res.status(500).json({ error: 'internal_server_error' });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('completeProfile err', err);
    return res.status(500).json({ error: 'internal_server_error' });
  }
}

/**
 * POST /api/v1/auth/logout
 * Header: Authorization: Bearer <token>
 * Blacklists current token JTI in Redis for the remaining TTL
 */
export async function logout(req, res) {
  try {
    // auth middleware should have attached req.jwt (payload)
    const jwtPayload = req.jwt;
    if (!jwtPayload || !jwtPayload.jti) {
      return res.status(400).json({ error: 'invalid_token_payload' });
    }

    const jti = jwtPayload.jti;
    // compute TTL from token exp (payload.exp is in seconds)
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = jwtPayload.exp || 0;
    const ttl = Math.max(1, exp - nowSec);

    const blkKey = `bl_jti:${jti}`;
    await redis.set(blkKey, '1', 'EX', ttl);

    return res.json({ ok: true, message: 'logged_out' });
  } catch (err) {
    console.error('logout err', err);
    return res.status(500).json({ error: 'internal_server_error' });
  }
}