/**
 * Shared Redis connection options for BullMQ.
 * All Queue and Worker instances must use the same object.
 */
export const redisConnection = {
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
};
