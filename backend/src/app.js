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

  // Serve the built web apps from the same server when they exist:
  // the manager/HR dashboard at /admin and the employee app (web version) at /.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = process.env.PUBLIC_DIR || path.resolve(here, '../../public');
  const dashboard = fs.existsSync(path.join(publicDir, 'admin')) ? path.join(publicDir, 'admin') : path.resolve(here, '../../dashboard/dist');
  const phone = path.join(publicDir, 'app');
  if (fs.existsSync(dashboard)) {
    app.use('/admin', express.static(dashboard));
    app.get(/^\/admin(\/.*)?$/, (req, res) => res.sendFile(path.join(dashboard, 'index.html')));
  }
  if (fs.existsSync(phone)) {
    app.use(express.static(phone));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(phone, 'index.html')));
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
