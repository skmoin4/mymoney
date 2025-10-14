// src/controllers/testNotifyController.js
import { notificationQueue } from '../queues/index.js';
import { emitTransactionUpdate } from '../realTime/socket.js';

export async function testNotify(req, res) {
  try {
    const { user_id, title, body, data } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id_required' });

    // enqueue push notification
    await notificationQueue.add('manual_test_notification', {
      user_id,
      title: title || 'Test Notification',
      body: body || 'This is a test notification',
      data: data || { foo: 'bar' }
    });

    // also emit socket event
    emitTransactionUpdate({
      user_id: user_id,
      txn_ref: 'test-manual',
      status: 'test',
      amount: 0,
      updated_at: new Date().toISOString(),
      note: JSON.stringify({
        title: title || 'Test Notification',
        body: body || 'This is a test notification',
        data: data || { foo: 'bar' }
      })
    });

    return res.json({ ok: true, enqueued: true });
  } catch (err) {
    return res.status(500).json({ error: 'internal_server_error', detail: err.message });
  }
}
