// src/config/redis.js
import IORedis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT || 6379),
  db: Number(process.env.REDIS_DB || 0),
  password: process.env.REDIS_PASSWORD || undefined,
  lazyConnect: false,
  maxRetriesPerRequest: null, // Required by BullMQ
  // add other options if needed
};

const connection = new IORedis(redisConfig);

connection.on('connect', () => console.log('Redis connected'));
connection.on('error', (err) => console.error('Redis error', err));
export default connection;
export function getRedis() {
  return connection;
}
