// apmoney/routes/devPush.js
import express from 'express';
import auth from '../middlewares/auth.js';
import { notificationQueue } from '../queues/index.js';

const router = express.Router();

router.post('/push', auth(true, ['admin']), async (req, res) => {
  const { user_id, title, body } = req.body;
  await notificationQueue.add('push-' + Date.now(), { type: 'push', targetUserId: Number(user_id), payload: { title, body, data: {} }});
  return res.json({ ok: true });
});

export default router;