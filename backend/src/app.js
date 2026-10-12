import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requireAuth } from './http.js';
import challengesRouter from './routes/challenges.js';
import adminRouter from './routes/admin.js';
import { authRouter, socialRouter } from './routes/social.js';

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const origins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors(origins.length ? { origin: origins } : {}));
  app.use(express.json({ limit: '100kb' }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter(db));
  app.use('/api/challenges', requireAuth(db), challengesRouter(db));
  app.use('/api/admin', adminRouter(db));
  app.use('/api', socialRouter(db));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built manager/HR dashboard from the same server when it exists.
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dashboard/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });
  return app;
}
