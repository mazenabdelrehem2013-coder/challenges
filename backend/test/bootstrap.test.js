import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { bootstrap } from '../src/bootstrap.js';

test('a new database gets its first admin from ADMIN_EMAIL and ADMIN_PASSWORD', async () => {
  const db = openDb(':memory:');
  assert.equal(bootstrap(db, {}), 'empty');
  assert.equal(bootstrap(db, { ADMIN_EMAIL: 'Boss@Company.com', ADMIN_PASSWORD: 'long-enough-1' }), 'admin');
  assert.equal(bootstrap(db, { ADMIN_EMAIL: 'other@company.com', ADMIN_PASSWORD: 'long-enough-2' }), 'existing');

  const app = createApp(db);
  const login = await request(app).post('/api/auth/login').send({ email: 'boss@company.com', password: 'long-enough-1' });
  assert.equal(login.status, 200, login.text);
  const org = await request(app).get('/api/admin/org').set('Authorization', `Bearer ${login.body.token}`);
  assert.equal(org.status, 200);
});

test('short admin passwords are refused and SEED_DEMO fills the demo company', () => {
  assert.throws(() => bootstrap(openDb(':memory:'), { ADMIN_EMAIL: 'a@b.co', ADMIN_PASSWORD: 'short' }), /at least 8/);
  const db = openDb(':memory:');
  assert.equal(bootstrap(db, { SEED_DEMO: 'true' }), 'demo');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 13);
});
