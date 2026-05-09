import ms from 'ms';
import * as chrono from 'chrono-node';
import CronParser from 'cron-parser';
import { z } from 'zod';
import type { JobsOptions } from 'bullmq';

// ── BullMQ minimum for repeat.every ─────────────────────────────────────────
const MIN_INTERVAL_MS = 1_000;

// ── Zod schemas (used for HTTP request validation) ───────────────────────────

export const ImmediateScheduleSchema = z.object({
  type: z.literal('immediate'),
});

/**
 * delayed — two accepted input styles:
 *   duration : "2h" | "30m" | "1d"   (ms-style short or long)
 *   natural  : "in 2 hours" | "tomorrow at 9am" | "next Monday at 9:00"
 * Both are passed as the single `when` field.
 */
export const DelayedScheduleSchema = z.object({
  type: z.literal('delayed'),
  when: z.string().min(1, 'when is required for delayed schedule'),
});

/**
 * interval — accepted input styles:
 *   "30m" | "2h" | "1 day" | "2 hours"  (ms package handles both)
 * Must resolve to at least 1 000 ms (BullMQ minimum).
 */
export const IntervalScheduleSchema = z.object({
  type: z.literal('interval'),
  every: z.string().min(1, 'every is required for interval schedule'),
});

/**
 * cron — standard 5-field cron expression.
 * Validated with cron-parser before passing to BullMQ.
 */
export const CronScheduleSchema = z.object({
  type: z.literal('cron'),
  pattern: z.string().min(1, 'pattern is required for cron schedule'),
});

export const UserScheduleSchema = z.discriminatedUnion('type', [
  ImmediateScheduleSchema,
  DelayedScheduleSchema,
  IntervalScheduleSchema,
  CronScheduleSchema,
]);

export const CreateJobRequestSchema = z.object({
  jobName: z.string().min(1, 'jobName is required'),
  data: z.record(z.string(), z.unknown()).optional().transform((v) => v ?? {}),
  schedule: UserScheduleSchema,
});

// ── Inferred types from Zod ──────────────────────────────────────────────────

export type ImmediateSchedule = z.infer<typeof ImmediateScheduleSchema>;
export type DelayedSchedule   = z.infer<typeof DelayedScheduleSchema>;
export type IntervalSchedule  = z.infer<typeof IntervalScheduleSchema>;
export type CronSchedule      = z.infer<typeof CronScheduleSchema>;
export type UserSchedule      = z.infer<typeof UserScheduleSchema>;
export type CreateJobRequest  = z.infer<typeof CreateJobRequestSchema>;

// ── Translation result — includes human-readable description ─────────────────

export interface TranslateResult {
  bullOptions: JobsOptions;
  /** Human-readable description of what was resolved, e.g. "runs in 2 hours" */
  description: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolves a `when` string for a delayed job.
 * Priority: ms() first → chrono-node fallback
 */
function resolveDelay(when: string): { delayMs: number; description: string } {
  // 1. Try ms() — handles "2h", "30m", "1 day", "2 hours", etc.
  const fromMs = ms(when as Parameters<typeof ms>[0]);
  if (fromMs !== undefined && fromMs > 0) {
    return {
      delayMs: fromMs,
      description: `runs after ${ms(fromMs, { long: true })}`,
    };
  }

  // 2. Try chrono-node — handles "in 2 hours", "tomorrow at 9am", "next Monday"
  const parsed = chrono.parseDate(when);
  if (!parsed) {
    throw new Error(
      `Cannot parse "${when}" as a delay. ` +
      `Use ms notation ("2h", "30m") or natural language ("in 2 hours", "tomorrow at 9am").`
    );
  }
  const delayMs = parsed.getTime() - Date.now();
  if (delayMs <= 0) {
    throw new Error(`"${when}" resolves to a time in the past (${parsed.toISOString()}). Use a future time.`);
  }
  return {
    delayMs,
    description: `runs at ${parsed.toLocaleString()} (in ${ms(delayMs, { long: true })})`,
  };
}

/**
 * Resolves an `every` string for a repeating interval job.
 * Only ms() is used — chrono-node is for one-time dates, not recurring intervals.
 */
function resolveInterval(every: string): { everyMs: number; description: string } {
  const fromMs = ms(every as Parameters<typeof ms>[0]);
  if (fromMs === undefined || isNaN(fromMs)) {
    throw new Error(
      `Cannot parse "${every}" as an interval. ` +
      `Use ms notation: "30m", "2h", "1d", "2 hours", "30 minutes".`
    );
  }
  if (fromMs <= 0) {
    throw new Error(`Interval must be positive. Got: "${every}"`);
  }
  if (fromMs < MIN_INTERVAL_MS) {
    throw new Error(
      `Interval "${every}" (${fromMs}ms) is below BullMQ's minimum of ${MIN_INTERVAL_MS}ms.`
    );
  }
  return {
    everyMs: fromMs,
    description: `repeats every ${ms(fromMs, { long: true })}`,
  };
}

/**
 * Validates a cron pattern using cron-parser.
 */
function validateCron(pattern: string): void {
  try {
    CronParser.parse(pattern);
  } catch {
    throw new Error(
      `Invalid cron pattern: "${pattern}". ` +
      `Expected 5-field format: "minute hour day month weekday" (e.g. "0 9 * * 1" = Mon at 09:00).`
    );
  }
}

// ── Main translator ──────────────────────────────────────────────────────────

/**
 * Translates a validated {@link UserSchedule} into BullMQ {@link JobsOptions}
 * plus a human-readable description of what was resolved.
 *
 * @throws {Error} With a user-friendly message on invalid/unparseable input.
 */
export function translateSchedule(schedule: UserSchedule): TranslateResult {
  switch (schedule.type) {
    case 'immediate':
      return {
        bullOptions: {},
        description: 'runs immediately',
      };

    case 'delayed': {
      const { delayMs, description } = resolveDelay(schedule.when);
      return { bullOptions: { delay: delayMs }, description };
    }

    case 'interval': {
      const { everyMs, description } = resolveInterval(schedule.every);
      return { bullOptions: { repeat: { every: everyMs } }, description };
    }

    case 'cron': {
      validateCron(schedule.pattern);
      // Compute next run for description
      const next = CronParser.parse(schedule.pattern).next().toDate();
      return {
        bullOptions: { repeat: { pattern: schedule.pattern } },
        description: `repeats on cron "${schedule.pattern}" (next: ${next.toLocaleString()})`,
      };
    }

    default: {
      const _exhaustive: never = schedule;
      throw new Error(`Unknown schedule type: "${(_exhaustive as UserSchedule).type}"`);
    }
  }
}
