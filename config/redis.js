// // src/config/redis.js
// import IORedis from 'ioredis';
// import dotenv from 'dotenv';
// dotenv.config();

// const redisConfig = {
//   host: process.env.REDIS_HOST || '127.0.0.1',
//   port: Number(process.env.REDIS_PORT || 6379),
//   db: Number(process.env.REDIS_DB || 0),
//   password: process.env.REDIS_PASSWORD || undefined,
//   lazyConnect: false,
//   maxRetriesPerRequest: null, // Required by BullMQ
//   // add other options if needed
// };

// const connection = new IORedis(redisConfig);

// connection.on('connect', () => console.log('Redis connected'));
// connection.on('error', (err) => console.error('Redis error', err));
// export default connection;
// export function getRedis() {
//   return connection;
// }

// src/config/redis.js
import IORedis from 'ioredis';

const redisConfig = {
  host: 'redis-16328.crce206.ap-south-1-1.ec2.redns.redis-cloud.com',
  port: 16328,
  db: 0,
  username: 'default',
  password: 'jGlW6xVJCdRH8HQe6TIgBrfygTmFmOo1',
  lazyConnect: false,
  maxRetriesPerRequest: null, // Required by BullMQ or other queue libraries
};

const connection = new IORedis(redisConfig);

connection.on('connect', () => console.log('✅ Redis connected'));
connection.on('error', (err) => console.error('❌ Redis error', err));

export default connection;
export function getRedis() {
  return connection;
}
