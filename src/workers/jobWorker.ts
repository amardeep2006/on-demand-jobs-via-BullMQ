import { Worker, Job } from 'bullmq';
import { redisConnection } from '../config/redis';
import { QUEUE_NAME } from '../queues/jobQueue';

interface JobResult {
  processedAt: string;
}

/**
 * Job processor — replace the body of this function with real business logic.
 * BullMQ calls this once per job (and re-calls for repeatable jobs on each tick).
 */
async function processJob(job: Job): Promise<JobResult> {
  const timestamp = new Date().toISOString();
  console.log(`[Worker][${timestamp}] Processing job`);
  console.log(`  id   : ${job.id}`);
  console.log(`  name : ${job.name}`);
  console.log(`  data : ${JSON.stringify(job.data)}`);

  // TODO: dispatch to real handlers based on job.name
  // e.g. if (job.name === 'send-email') await sendEmail(job.data);

  // Simulated async work
  await new Promise<void>((resolve) => setTimeout(resolve, 100));

  return { processedAt: timestamp };
}

/**
 * Creates and starts the BullMQ Worker.
 * Called once from server.ts at startup.
 */
export function startWorker(): Worker {
  const worker = new Worker(QUEUE_NAME, processJob, { connection: redisConnection });

  worker.on('completed', (job: Job, result: JobResult) => {
    console.log(`[Worker] ✅ job ${job.id} (${job.name}) completed:`, result);
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    console.error(`[Worker] ❌ job ${job?.id} failed: ${err.message}`);
  });

  worker.on('error', (err: Error) => {
    console.error('[Worker] connection error:', err.message);
  });

  console.log(`[Worker] 🚀 Listening on queue "${QUEUE_NAME}"`);
  return worker;
}
