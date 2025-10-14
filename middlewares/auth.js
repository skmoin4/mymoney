// src/middlewares/auth.js
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import redis from '../config/redis.js';
import { getPool } from '../config/db.js';

dotenv.config();
const JWT_SECRET = process.env.JWT_SECRET || 'change_me';

export default function authMiddleware(required = true, allowedRoles = []) {
  return async function (req, res, next) {
    try {
      const authHeader = req.headers.authorization || req.headers.Authorization;
      if (!authHeader) {
        if (required) return res.status(401).json({ error: 'missing_authorization' });
        req.user = null;
        return next();
      }

      const parts = authHeader.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer') {
        if (required) return res.status(401).json({ error: 'invalid_authorization_format' });
        req.user = null;
        return next();
      }

      const token = parts[1];

      let payload;
      try {
        payload = jwt.verify(token, JWT_SECRET);
      } catch (err) {
        return res.status(401).json({ error: 'invalid_or_expired_token' });
      }

      const jti = payload.jti;
      if (!jti) {
        return res.status(401).json({ error: 'invalid_token_payload' });
      }

      // Check blacklist in Redis
      const blkKey = `bl_jti:${jti}`;
      const isBlacklisted = await redis.get(blkKey);
      if (isBlacklisted) {
        return res.status(401).json({ error: 'token_revoked' });
      }

      // Optionally fetch user from DB and attach
      const pool = getPool();
      const conn = await pool.getConnection();
      try {
        const [rows] = await conn.execute(
          'SELECT id, phone, name, email, role, profile_complete, status FROM users WHERE id = ?',
          [payload.user_id]
        );

        if (!rows || rows.length === 0) {
          conn.release();
          return res.status(401).json({ error: 'user_not_found' });
        }

        const user = rows[0];
        if (user.status !== 'active') {
          conn.release();
          return res.status(403).json({ error: 'user_not_active' });
        }

        // Check role if roles are specified
        if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
          conn.release();
          return res.status(403).json({ error: 'insufficient_permissions' });
        }

        // Attach user & token payload for handlers
        req.user = {
          id: user.id,
          phone: user.phone,
          name: user.name,
          email: user.email,
          role: user.role,
          profile_complete: !!user.profile_complete
        };
        req.jwt = payload;
        conn.release();
        return next();
      } catch (dbErr) {
        conn.release();
        console.error('auth middleware db error', dbErr);
        return res.status(500).json({ error: 'internal_server_error' });
      }
    } catch (err) {
      console.error('auth middleware err', err);
      return res.status(500).json({ error: 'internal_server_error' });
    }
  };
}
