// src/socket.js
import { Server as IOServer } from 'socket.io';
let ioInstance = null;

/**
 * initSocket(server, options)
 * Call from src/server.js after express server listen returns.
 */
export function initSocket(httpServer, options = {}) {
  if (ioInstance) return ioInstance;
  const io = new IOServer(httpServer, {
    cors: {
      origin: options.corsOrigin || '*',
      methods: ['GET', 'POST']
    },
    path: options.path || '/socket.io'
  });

  io.on('connection', (socket) => {
    // Attach simple auth info if provided by client (token)
    const token = socket.handshake.auth?.token;
    // you may validate token here and join rooms based on user id
    // e.g., socket.join(`user:${userId}`)
    console.log('Socket connected id=', socket.id, 'token=', Boolean(token));

    socket.on('join_user_room', (userId) => {
      if (userId) socket.join(`user:${userId}`);
    });

    socket.on('disconnect', () => {});
  });

  ioInstance = io;
  return ioInstance;
}

/**
 * Get existing io instance
 */
export function getIo() {
  return ioInstance;
}

/**
 * Emit helper for payment_request status updates
 * Emits to room `user:<userId>` and a global channel `payment_request:<id>`
 */
export function emitPaymentStatus(paymentRequestId, userId, payload) {
  if (!ioInstance) return;
  const room = `user:${userId}`;
  ioInstance.to(room).emit('payment_request_status', { payment_request_id: paymentRequestId, ...payload });
  ioInstance.emit(`payment_request:${paymentRequestId}`, { payment_request_id: paymentRequestId, ...payload });
}
