import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { bootstrap } from '../src/bootstrap.js';
import { backupConfig, restoreDb, uploadDb } from '../src/backup.js';

// A stand-in for Supabase Storage that keeps objects in memory.
function fakeSupabase() {
  const objects = new Map();
  const buckets = new Set();
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    assert.equal(opts.headers.Authorization, 'Bearer secret');
    if (u.pathname === '/storage/v1/bucket') {
      const { id } = JSON.parse(opts.body);
      if (buckets.has(id)) return new Response('{"message":"The resource already exists"}', { status: 409 });
      buckets.add(id);
      return new Response('{}', { status: 200 });
    }
    const key = u.pathname.replace('/storage/v1/object/', '');
    if ((opts.method || 'GET') === 'POST') {
      objects.set(key, Buffer.from(opts.body));
      return new Response('{}', { status: 200 });
    }
    return objects.has(key) ? new Response(objects.get(key)) : new Response('{"error":"not_found"}', { status: 400 });
  };
  return { fetchImpl, objects };
}

test('the database survives a restart through Supabase Storage', async () => {
  assert.equal(backupConfig({}), null);
  const cfg = backupConfig({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_SERVICE_KEY: 'secret' });
  assert.equal(cfg.url, 'https://x.supabase.co');
  const { fetchImpl, objects } = fakeSupabase();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'challenges-'));

  // First start: nothing saved yet.
  const first = path.join(dir, 'a.db');
  assert.equal(await restoreDb(cfg, first, fetchImpl), false);
  const db = openDb(first);
  bootstrap(db, { ADMIN_EMAIL: 'boss@company.com', ADMIN_PASSWORD: 'long-enough-1' });
  await uploadDb(cfg, db, fetchImpl);
  assert.equal(objects.size, 1);
  db.close();

  // Fresh machine: the copy comes back with the admin in it.
  const second = path.join(dir, 'b.db');
  assert.equal(await restoreDb(cfg, second, fetchImpl), true);
  const again = openDb(second);
  assert.equal(again.prepare('SELECT email FROM users').get().email, 'boss@company.com');
  assert.equal(bootstrap(again, {}), 'existing');
  again.close();
});
