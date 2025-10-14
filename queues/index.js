// src/queues/index.js
import { Queue } from 'bullmq';
import { getRedis } from '../config/redis.js';

/**
 * Central place to create queues.
 * Export queues you need in producers/workers.
 */

const connection = getRedis();

export const RECHARGE_QUEUE_NAME = 'recharge-queue';
export const NOTIFICATION_QUEUE_NAME = 'notification-queue';
export const rechargeQueue = new Queue(RECHARGE_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    removeOnComplete: 1000, // keep last 1000 completed entries
    removeOnFail: 10000,
    attempts: 5, // increased for robustness
    backoff: {
      type: 'exponential',
      delay: 2000, // start with 2s delay
      maxDelay: 60000 // cap at 1 minute
    }
  }
});



export const notificationQueue = new Queue(NOTIFICATION_QUEUE_NAME, { connection, defaultJobOptions: { removeOnComplete: true } });

export default { rechargeQueue, notificationQueue };

