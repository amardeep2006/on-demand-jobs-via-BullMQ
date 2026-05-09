import { Queue } from 'bullmq';
import { redisConnection } from '../config/redis';

export const QUEUE_NAME = 'user-jobs';

/**
 * Singleton Queue instance shared across the application.
 * Using a singleton avoids opening multiple Redis connections.
 */
export const jobQueue = new Queue(QUEUE_NAME, { connection: redisConnection });
