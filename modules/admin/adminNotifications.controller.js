// src/controllers/adminNotificationsController.js
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import Joi from 'joi';
import logger from '../../utils/logger.js';
import { getPool } from '../../config/db.js';

const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
const notificationQueue = new Queue('notification', { connection });

const sendManualNotificationSchema = Joi.object({
  target_type: Joi.string().valid('user', 'all_users').required(),
  target_user_id: Joi.number().integer().when('target_type', {
    is: 'user',
    then: Joi.required(),
    otherwise: Joi.forbidden()
  }),
  title: Joi.string().min(1).max(100).required(),
  body: Joi.string().min(1).max(500).required(),
  data: Joi.object().optional()
});

/**
 * POST /api/v1/admin/notify/manual
 * Send manual push notification to user(s)
 */
export async function sendManualNotification(req, res) {
  try {
    const { error, value } = sendManualNotificationSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.message });

    const { target_type, target_user_id, title, body, data } = value;

    const payload = {
      title,
      body,
      data: data || {}
    };

    if (target_type === 'user') {
      // Send to specific user
      await notificationQueue.add('manual-push', {
        type: 'push',
        targetUserId: target_user_id,
        payload
      });

      logger.info('Manual notification queued for user', {
        user_id: target_user_id,
        title,
        body
      });

      return res.json({
        ok: true,
        message: `Notification queued for user ${target_user_id}`
      });
    } else if (target_type === 'all_users') {
      // Send to all users - get all user IDs
      const pool = getPool();
      const [users] = await pool.execute(
        'SELECT id FROM users WHERE role = ?',
        ['retailer'] // Only send to retailers, not admins
      );

      if (!users || users.length === 0) {
        return res.status(400).json({ error: 'No users found to notify' });
      }

      // Queue notifications for all users
      const jobs = users.map(user =>
        notificationQueue.add('manual-push', {
          type: 'push',
          targetUserId: user.id,
          payload
        })
      );

      await Promise.all(jobs);

      logger.info('Manual notification queued for all users', {
        user_count: users.length,
        title,
        body
      });

      return res.json({
        ok: true,
        message: `Notification queued for ${users.length} users`
      });
    }
  } catch (err) {
    logger.error('sendManualNotification error', { err: err.stack || err.message });
    return res.status(500).json({ error: 'internal_server_error' });
  }
}