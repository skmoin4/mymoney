// apmoney/routes/devSocket.js
import express from 'express';
import auth from '../middlewares/auth.js';
import socketSvc from '../realTime/socket.js';

const router = express.Router();

router.post('/dev/socket/test', auth(true, ['admin']), async (req, res) => {
  const { user_id, txn_ref, status = 'success', amount = 10 } = req.body;
  socketSvc.emitTransactionUpdate({ user_id, txn_ref, status, amount, updated_at: new Date().toISOString() });
  return res.json({ ok: true });
});

export default router;