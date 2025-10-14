import { rechargeQueue } from '../../queues/index.js';
import logger from '../../utils/logger.js';

export async function enqueueRecharge(req, res) {
  try {
    const { user_id, amount, txn_ref } = req.body;
    if (!user_id || !amount) return res.status(400).json({ error: 'invalid_input' });

    const job = await rechargeQueue.add('recharge', {
      transaction_id: `txn-${Date.now()}`,
      user_id,
      amount,
      txn_ref
    });

    return res.json({ ok: true, jobId: job.id });
  } catch (err) {
    logger.error('enqueueRecharge error', { err: err.message });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}
