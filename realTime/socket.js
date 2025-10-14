// apmoney/realTime/socket.js
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import logger from '../utils/logger.js';
import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';

let io;

/**
 * Initialize Socket.IO and attach to existing httpServer.
 * Call initSocket(server) from your main server bootstrap.
 */
export async function initSocket(httpServer) {
  if (io) return io;

  // create io with CORS safe defaults - adjust origin(s)
  io = new Server(httpServer, {
    cors: {
      origin: process.env.SOCKET_ORIGINS ? process.env.SOCKET_ORIGINS.split(',') : ['http://localhost:3000'],
      methods: ['GET', 'POST'],
      credentials: true
    },
    // pingTimeout / pingInterval tune if needed
  });

  // optional: use redis adapter if env configured (for multi-node)
  if (process.env.REDIS_URL) {
    const pubClient = new Redis(process.env.REDIS_URL);
    const subClient = pubClient.duplicate();
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('Socket.IO using Redis adapter');
  }

  // middleware: authenticate socket connection via JWT in auth payload
  io.use(async (socket, next) => {
    try {
      // client should send token in auth: { token: 'Bearer ...' } or { token: '<jwt>' }
      const raw = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!raw) return next(new Error('auth_required'));
      const token = String(raw).replace(/^Bearer\s+/i, '').trim();

      const secret = process.env.JWT_SECRET || 'devsecret';
      const payload = jwt.verify(token, secret);
      // minimal checks
      if (!payload || !payload.sub) return next(new Error('invalid_token'));
      // attach user info
      socket.user = { id: Number(payload.sub), role: payload.role || 'user' };
      return next();
    } catch (err) {
      logger.warn('socket auth failed', { err: err.message });
      return next(new Error('authentication_error'));
    }
  });

  // on connection: join user room
  io.on('connection', (socket) => {
    try {
      const uid = socket.user?.id;
      const room = `user:${uid}`;
      socket.join(room);
      logger.info('socket connected', { id: socket.id, user: uid });

      // optional: let client request joining extra rooms (admin)
      socket.on('join_admin_room', () => {
        if (socket.user && socket.user.role === 'admin') socket.join('admin:room');
      });

      socket.on('disconnect', (reason) => {
        logger.info('socket disconnect', { id: socket.id, reason });
      });
    } catch (e) {
      logger.error('socket connection handler error', { err: e.stack || e.message });
    }
  });

  return io;
}

/**
 * Helper to emit transaction updates to a user room.
 * txn should be an object with at least { txn_ref, status, amount, provider_txn_id, ... }
 */
export function emitTransactionUpdate(txn) {
  if (!io) {
    logger.warn('emitTransactionUpdate: io not initialized');
    return;
  }
  try {
    const userId = txn.user_id || txn.userId || txn.user;
    if (!userId) {
      logger.warn('emitTransactionUpdate: no user_id in txn', { txn_ref: txn.txn_ref });
      return;
    }
    const room = `user:${userId}`;
    io.to(room).emit('transaction_update', {
      txn_ref: txn.txn_ref,
      status: txn.status,
      amount: txn.amount,
      operator_code: txn.operator_code,
      provider_txn_id: txn.provider_txn_id,
      updated_at: txn.updated_at || new Date().toISOString(),
      note: txn.note || null,
      extra: txn.extra || null
    });
    logger.info('emitted transaction_update', { txn_ref: txn.txn_ref, user: userId });
  } catch (err) {
    logger.error('emitTransactionUpdate error', { err: err.stack || err.message, txn_ref: txn.txn_ref });
  }
}

export function emitAdminEvent(eventName, payload) {
  if (!io) {
    logger.warn('emitAdminEvent: io not initialized');
    return;
  }
  try {
    io.to('admin:room').emit(eventName, payload);
    logger.info('emitted admin event', { event: eventName });
  } catch (err) {
    logger.error('emitAdminEvent error', { err: err.stack || err.message, event: eventName });
  }
}

export default { initSocket, emitTransactionUpdate, emitAdminEvent };
