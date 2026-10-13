import fs from 'node:fs';

// Keeps the database safe on hosts without a permanent disk (such as Render's free plan)
// by copying it to Supabase Storage after changes and restoring it when the server starts.
// Turned on by SUPABASE_URL and SUPABASE_SERVICE_KEY; does nothing without them.

const BUCKET = 'challenges-backup';
const OBJECT = 'challenges.db';

export function backupConfig(env = process.env) {
  const url = (env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_KEY || '';
  return url && key ? { url, key } : null;
}

function headers(cfg, extra = {}) {
  return { Authorization: `Bearer ${cfg.key}`, apikey: cfg.key, ...extra };
}

async function ensureBucket(cfg, fetchImpl) {
  const res = await fetchImpl(`${cfg.url}/storage/v1/bucket`, {
    method: 'POST',
    headers: headers(cfg, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });
  if (res.ok) return;
  const text = await res.text();
  if (!/already exists|Duplicate/i.test(text)) throw new Error(`Supabase bucket setup failed (${res.status}): ${text}`);
}

// Before the database opens: fetch the latest copy, if there is one.
export async function restoreDb(cfg, file, fetchImpl = fetch) {
  await ensureBucket(cfg, fetchImpl);
  const res = await fetchImpl(`${cfg.url}/storage/v1/object/${BUCKET}/${OBJECT}`, { headers: headers(cfg) });
  if (res.status === 404 || res.status === 400) return false; // first start: nothing saved yet
  if (!res.ok) throw new Error(`Supabase download failed (${res.status}): ${await res.text()}`);
  for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return true;
}

export async function uploadDb(cfg, db, fetchImpl = fetch) {
  const res = await fetchImpl(`${cfg.url}/storage/v1/object/${BUCKET}/${OBJECT}`, {
    method: 'POST',
    headers: headers(cfg, { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }),
    body: db.serialize(),
  });
  if (!res.ok) throw new Error(`Supabase upload failed (${res.status}): ${await res.text()}`);
}

// After the database opens: upload a fresh copy a few seconds after anything changes,
// and once more when the host shuts the server down.
export function startBackups(cfg, db, { everyMs = 5000, fetchImpl = fetch, log = console } = {}) {
  const changes = db.prepare('SELECT total_changes() AS n');
  let saved = -1;
  let busy = false;
  const tick = async () => {
    const n = changes.get().n;
    if (busy || n === saved) return;
    busy = true;
    try {
      await uploadDb(cfg, db, fetchImpl);
      saved = n;
    } catch (err) {
      log.error(err.message);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, everyMs);
  timer.unref();
  const final = async () => {
    clearInterval(timer);
    await tick();
    process.exit(0);
  };
  process.once('SIGTERM', final);
  process.once('SIGINT', final);
  return { tick, stop: () => clearInterval(timer) };
}
