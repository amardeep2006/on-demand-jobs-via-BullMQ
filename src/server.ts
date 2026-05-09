import express, { Request, Response } from 'express';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import { startWorker } from './workers/jobWorker';
import jobsRouter from './routes/jobs';
import { openApiSpec } from './api-spec/openapi';

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

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/jobs', jobsRouter);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── Start worker (in-process; refactor to separate process later) ─────────────
startWorker();

// ── Start HTTP server ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[Server] 🌐 Express  → http://localhost:${PORT}`);
  console.log(`[Server] 🎨 UI       → http://localhost:${PORT}/`);
  console.log(`[Server] 📖 Swagger  → http://localhost:${PORT}/api-docs`);
});
