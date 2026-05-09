import type { OpenAPIV3 } from 'openapi-types';

export const openApiSpec: OpenAPIV3.Document = {
  openapi: '3.0.3',
  info: {
    title: 'On-Demand Jobs via BullMQ',
    version: '1.0.0',
    description:
      'Schedule one-time, delayed, interval, and cron-based background jobs using BullMQ backed by Redis.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local dev server' }],
  tags: [
    { name: 'Jobs', description: 'Schedule and manage jobs' },
    { name: 'Repeatable', description: 'Manage repeatable (interval / cron) jobs' },
  ],

  // ── Reusable schemas ────────────────────────────────────────────────────────
  components: {
    schemas: {
      ImmediateSchedule: {
        type: 'object',
        required: ['type'],
        properties: {
          type: { type: 'string', enum: ['immediate'] },
        },
        example: { type: 'immediate' },
      },
      DelayedSchedule: {
        type: 'object',
        required: ['type', 'when'],
        properties: {
          type: { type: 'string', enum: ['delayed'] },
          when: {
            type: 'string',
            description: 'ms notation ("2h", "30m", "1d") or natural language ("in 2 hours", "tomorrow at 9am", "next Monday at 09:00")',
            example: 'in 2 hours',
          },
        },
        example: { type: 'delayed', when: 'in 2 hours' },
      },
      IntervalSchedule: {
        type: 'object',
        required: ['type', 'every'],
        properties: {
          type: { type: 'string', enum: ['interval'] },
          every: {
            type: 'string',
            description: 'ms notation: "30m", "2h", "1d", "2 hours", "30 minutes"',
            example: '30m',
          },
        },
        example: { type: 'interval', every: '30m' },
      },
      CronSchedule: {
        type: 'object',
        required: ['type', 'pattern'],
        properties: {
          type: { type: 'string', enum: ['cron'] },
          pattern: {
            type: 'string',
            description: 'Standard 5-field cron expression',
            example: '0 9 * * 1',
          },
        },
        example: { type: 'cron', pattern: '0 9 * * 1' },
      },
      UserSchedule: {
        oneOf: [
          { $ref: '#/components/schemas/ImmediateSchedule' },
          { $ref: '#/components/schemas/DelayedSchedule' },
          { $ref: '#/components/schemas/IntervalSchedule' },
          { $ref: '#/components/schemas/CronSchedule' },
        ],
        discriminator: { propertyName: 'type' },
      },
      CreateJobRequest: {
        type: 'object',
        required: ['jobName', 'schedule'],
        properties: {
          jobName: { type: 'string', example: 'send-email' },
          data: {
            type: 'object',
            additionalProperties: true,
            example: { to: 'alice@example.com', subject: 'Hello!' },
          },
          schedule: { $ref: '#/components/schemas/UserSchedule' },
        },
      },
      JobSummary: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          data: { type: 'object', additionalProperties: true },
          state: { type: 'string' },
          timestamp: { type: 'integer' },
          processedOn: { type: 'integer', nullable: true },
          finishedOn: { type: 'integer', nullable: true },
          returnvalue: { type: 'object', nullable: true },
          failedReason: { type: 'string', nullable: true },
        },
      },
      RepeatableJob: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          name: { type: 'string' },
          endDate: { type: 'integer', nullable: true },
          tz: { type: 'string', nullable: true },
          pattern: { type: 'string', nullable: true },
          every: { type: 'integer', nullable: true },
          next: { type: 'integer' },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
    },
  },

  // ── Paths ───────────────────────────────────────────────────────────────────
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        operationId: 'healthCheck',
        responses: {
          200: {
            description: 'Server is up',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    ts: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/jobs': {
      post: {
        tags: ['Jobs'],
        summary: 'Schedule a new job',
        operationId: 'createJob',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateJobRequest' } },
          },
        },
        responses: {
          201: {
            description: 'Job scheduled',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    jobId: { type: 'string' },
                    jobName: { type: 'string' },
                    description: { type: 'string', example: 'runs after 2 hours' },
                    schedule: { $ref: '#/components/schemas/UserSchedule' },
                    bullOptions: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
          },
          400: { description: 'Bad request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      get: {
        tags: ['Jobs'],
        summary: 'List jobs by state',
        operationId: 'listJobs',
        parameters: [
          {
            name: 'state',
            in: 'query',
            schema: { type: 'string', enum: ['waiting', 'active', 'completed', 'failed', 'delayed'], default: 'waiting' },
          },
          { name: 'start', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'end', in: 'query', schema: { type: 'integer', default: 49 } },
        ],
        responses: {
          200: {
            description: 'Job list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    state: { type: 'string' },
                    count: { type: 'integer' },
                    jobs: { type: 'array', items: { $ref: '#/components/schemas/JobSummary' } },
                  },
                },
              },
            },
          },
          400: { description: 'Invalid state', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/jobs/repeatable': {
      get: {
        tags: ['Repeatable'],
        summary: 'List all repeatable job definitions',
        operationId: 'listRepeatableJobs',
        responses: {
          200: {
            description: 'Repeatable job list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    count: { type: 'integer' },
                    jobs: { type: 'array', items: { $ref: '#/components/schemas/RepeatableJob' } },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/jobs/{id}': {
      get: {
        tags: ['Jobs'],
        summary: 'Get a job by ID',
        operationId: 'getJob',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Job found', content: { 'application/json': { schema: { $ref: '#/components/schemas/JobSummary' } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      delete: {
        tags: ['Jobs'],
        summary: 'Remove a one-time job by ID',
        operationId: 'deleteJob',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Job removed', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/jobs/repeatable/{key}': {
      delete: {
        tags: ['Repeatable'],
        summary: 'Remove a repeatable job by key',
        operationId: 'deleteRepeatableJob',
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Repeatable job removed', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } } },
        },
      },
    },
  },
};
