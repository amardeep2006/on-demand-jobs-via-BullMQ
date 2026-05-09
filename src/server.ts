import express, { Request, Response } from 'express';
import path from 'path';
import swaggerUi from 'swagger-ui-express';

import jobsRouter from './routes/jobs';
import { openApiSpec } from './api-spec/openapi';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { jobQueue } from './queues/jobQueue';

const PORT = Number(process.env.PORT) || 3000;
const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Swagger UI ────────────────────────────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, {
  customSiteTitle: 'BullMQ Jobs API',
  customCss: '.swagger-ui .topbar { background: #1e1b4b; }',
}));

// Expose raw spec as JSON (useful for external tooling)
app.get('/api-spec.json', (_req: Request, res: Response) => {
  res.json(openApiSpec);
});

// ── Bull-Board UI ─────────────────────────────────────────────────────────────
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(jobQueue)],
  serverAdapter: serverAdapter,
});

app.use('/admin/queues', serverAdapter.getRouter());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/jobs', jobsRouter);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});



// ── Start HTTP server ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Server] 🌐 Express  → http://localhost:${PORT}`);
  console.log(`[Server] 🎨 UI       → http://localhost:${PORT}/`);
  console.log(`[Server] 📊 Bull-Board→ http://localhost:${PORT}/admin/queues`);
  console.log(`[Server] 📖 Swagger  → http://localhost:${PORT}/api-docs`);
});
