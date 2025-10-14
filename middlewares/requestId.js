// src/middlewares/requestId.js
import { v4 as uuidv4 } from 'uuid';

export default function requestIdMiddleware(req, res, next) {
  const incoming = req.headers['x-request-id'];
  const id = incoming || uuidv4();
  req.id = id;
  // set header for downstream services / clients
  res.setHeader('X-Request-Id', id);
  next();
}
