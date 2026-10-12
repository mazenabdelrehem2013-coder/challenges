// Runs the real back end (routes, scoring, seed data) inside the browser for the live demo.
// Requests to any URL containing /api/ are answered here instead of going over the network.
import initSqlJs from 'sql.js/dist/sql-asm.js';
import { Router } from './shims/express.js';

globalThis.process = globalThis.process || { env: {}, argv: [] };
globalThis.process.env = { ...(globalThis.process.env || {}), DISABLE_PUSH: '1', JWT_SECRET: 'demo-only' };

function makeHandler(app) {
  return (method, url, headers = {}, body) =>
    new Promise((resolve) => {
      const u = new URL(url, 'http://demo.local');
      const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
      let parsed = {};
      if (body) {
        try { parsed = JSON.parse(body); } catch { return resolve({ status: 400, headers: {}, body: '{"error":"Invalid JSON"}' }); }
      }
      const req = {
        method: method.toUpperCase(),
        path: u.pathname,
        query: Object.fromEntries(u.searchParams),
        params: {},
        body: parsed,
        ip: 'demo',
        get: (k) => lower[k.toLowerCase()],
      };
      const outHeaders = { 'content-type': 'application/json' };
      const res = {
        statusCode: 200,
        finished: false,
        status(c) { this.statusCode = c; return this; },
        set(k, v) { outHeaders[k.toLowerCase()] = v; return this; },
        json(o) { this.finished = true; resolve({ status: this.statusCode, headers: outHeaders, body: JSON.stringify(o) }); return this; },
        send(s) {
          this.finished = true;
          if (!outHeaders['content-type'] || outHeaders['content-type'] === 'application/json') outHeaders['content-type'] = 'text/plain';
          resolve({ status: this.statusCode, headers: outHeaders, body: String(s) });
          return this;
        },
      };
      app(req, res, (err) => {
        if (res.finished) return;
        if (!err) return res.status(404).json({ error: 'Not found' });
        if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
        console.error(err);
        res.status(500).json({ error: 'Something went wrong' });
      });
    });
}

async function boot() {
  globalThis.__SQL = await initSqlJs();
  const { openDb } = await import('../backend/src/db.js');
  const { seed } = await import('../backend/src/seed.js');
  const { requireAuth } = await import('../backend/src/http.js');
  const { settleDue } = await import('../backend/src/game.js');
  const { default: challengesRouter } = await import('../backend/src/routes/challenges.js');
  const { default: adminRouter } = await import('../backend/src/routes/admin.js');
  const { authRouter, socialRouter } = await import('../backend/src/routes/social.js');

  const db = openDb(':memory:');
  seed(db);
  const app = Router();
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter(db));
  app.use('/api/challenges', requireAuth(db), challengesRouter(db));
  app.use('/api/admin', adminRouter(db));
  app.use('/api', socialRouter(db));
  setInterval(() => settleDue(db), 60 * 1000);
  return makeHandler(app);
}

// Share one in-browser server between the demo page and its frames when they are same-origin.
function findShared() {
  let w = window;
  try {
    while (w.parent && w.parent !== w) {
      w = w.parent;
      if (w.__demoServer) return w.__demoServer;
    }
  } catch { /* cross-origin parent */ }
  return null;
}

const server = findShared() || (window.__demoServer = boot());

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!/\/api\//.test(url)) return realFetch(input, init);
  const handle = await server;
  let headers = init.headers || (typeof input !== 'string' ? input.headers : {}) || {};
  if (headers instanceof Headers) headers = Object.fromEntries(headers.entries());
  const out = await handle(init.method || 'GET', url, headers, init.body);
  return new Response(out.status === 204 ? null : out.body, { status: out.status, headers: out.headers });
};
