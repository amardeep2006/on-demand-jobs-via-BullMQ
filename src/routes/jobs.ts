import { Router, Request, Response } from 'express';
import { JobType } from 'bullmq';
import { jobQueue } from '../queues/jobQueue';
import { CreateJobRequestSchema, translateSchedule } from '../utils/scheduleTranslator';

const router = Router();

// ── POST /jobs ────────────────────────────────────────────────────────────────
/**
 * Schedule a new job.
 *
 * Body:
 * { "jobName": "send-email", "data": {...}, "schedule": <UserSchedule> }
 *
 * Schedule types:
 *   { "type": "immediate" }
 *   { "type": "delayed",  "when": "2h" | "30m" | "in 2 hours" | "tomorrow at 9am" }
 *   { "type": "interval", "every": "30m" | "2h" | "1 day" }
 *   { "type": "cron",     "pattern": "0 9 * * 1" }
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  // ── 1. Zod schema validation ────────────────────────────────────────────────
  const parsed = CreateJobRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Validation failed',
      issues: parsed.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    });
    return;
  }

  const { jobName, data, schedule } = parsed.data;

  // ── 2. Schedule translation + semantic validation ────────────────────────────
  let bullOptions, description: string;
  try {
    ({ bullOptions, description } = translateSchedule(schedule));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  // ── 3. Enqueue ───────────────────────────────────────────────────────────────
  const job = await jobQueue.add(jobName, data, bullOptions);

  res.status(201).json({
    message: 'Job scheduled',
    jobId: job.id,
    jobName: job.name,
    schedule,
    bullOptions,
    description,          // ← human-readable: "runs after 2 hours"
  });
});

// ── GET /jobs ─────────────────────────────────────────────────────────────────
const VALID_STATES: JobType[] = ['waiting', 'active', 'completed', 'failed', 'delayed'];

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const state = (req.query.state as string) ?? 'waiting';
  const start = Number(req.query.start) || 0;
  const end   = Number(req.query.end)   || 49;

  if (!VALID_STATES.includes(state as JobType)) {
    res.status(400).json({ error: `Invalid state. Valid: ${VALID_STATES.join(', ')}` });
    return;
  }

  const jobs   = await jobQueue.getJobs([state as JobType], start, end);
  const result = jobs.map((j) => ({
    id:          j.id,
    name:        j.name,
    data:        j.data,
    state,
    timestamp:   j.timestamp,
    processedOn: j.processedOn,
    finishedOn:  j.finishedOn,
    returnvalue: j.returnvalue,
    failedReason:j.failedReason,
  }));

  res.json({ state, count: result.length, jobs: result });
});

// ── GET /jobs/repeatable ──────────────────────────────────────────────────────
router.get('/repeatable', async (_req: Request, res: Response): Promise<void> => {
  const repeatableJobs = await jobQueue.getRepeatableJobs();
  res.json({ count: repeatableJobs.length, jobs: repeatableJobs });
});

// ── GET /jobs/:id ─────────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const id  = req.params['id'] as string;
  const job = await jobQueue.getJob(id);
  if (!job) {
    res.status(404).json({ error: `Job "${id}" not found` });
    return;
  }
  const state = await job.getState();
  res.json({ id: job.id, name: job.name, data: job.data, state });
});

// ── DELETE /jobs/repeatable/:key ──────────────────────────────────────────────
router.delete('/repeatable/:key', async (req: Request, res: Response): Promise<void> => {
  const key = req.params['key'] as string;
  await jobQueue.removeRepeatableByKey(key);
  res.json({ message: `Repeatable job "${key}" removed` });
});

// ── DELETE /jobs/:id ──────────────────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const id  = req.params['id'] as string;
  const job = await jobQueue.getJob(id);
  if (!job) {
    res.status(404).json({ error: `Job "${id}" not found` });
    return;
  }
  await job.remove();
  res.json({ message: `Job "${id}" removed` });
});

export default router;
