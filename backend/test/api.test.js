import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seed, DEMO_PASSWORD } from '../src/seed.js';
import { settleDue } from '../src/game.js';

let db, app, org;

beforeEach(() => {
  db = openDb(':memory:');
  org = seed(db);
  app = createApp(db);
});

async function login(email) {
  const res = await request(app).post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  assert.equal(res.status, 200, res.text);
  return (req) => req.set('Authorization', `Bearer ${res.body.token}`);
}

const inDays = (d) => new Date(Date.now() + d * 864e5).toISOString();

test('login rejects a wrong password and accepts the right one', async () => {
  const bad = await request(app).post('/api/auth/login').send({ email: 'sara@example.com', password: 'nope' });
  assert.equal(bad.status, 401);
  const asSara = await login('sara@example.com');
  const me = await asSara(request(app).get('/api/me'));
  assert.equal(me.body.name, 'Sara Adel');
  assert.equal(me.body.branch.name, 'Cairo branch');
  assert.equal(me.body.region.name, 'North');
});

test('requests without a token are refused', async () => {
  const res = await request(app).get('/api/challenges');
  assert.equal(res.status, 401);
});

test('person vs person: invite, accept, log progress, finish, points and badges', async () => {
  const asSara = await login('sara@example.com');
  const asRana = await login('rana@example.com');
  const asMgr = await login('manager@example.com');

  const created = await asSara(request(app).post('/api/challenges')).send({
    title: 'Most steps this week', type: 'fitness', scope: 'person', unit: 'steps',
    opponents: [org.user['Rana Kamal']], points: 120, endsAt: inDays(3),
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.status, 'invited');
  const id = created.body.id;

  const early = await asSara(request(app).post(`/api/challenges/${id}/progress`)).send({ value: 10 });
  assert.equal(early.status, 409);

  const feed = await asRana(request(app).get('/api/feed'));
  assert.ok(feed.body.invites.some((c) => c.id === id));

  const acc = await asRana(request(app).post(`/api/challenges/${id}/accept`));
  assert.equal(acc.body.status, 'active');

  await asSara(request(app).post(`/api/challenges/${id}/progress`)).send({ value: 9000 }).expect(201);
  await asRana(request(app).post(`/api/challenges/${id}/progress`)).send({ value: 7000 }).expect(201);
  const outsider = await login('omar@example.com');
  await outsider(request(app).post(`/api/challenges/${id}/progress`)).send({ value: 1 }).expect(403);

  const fin = await asMgr(request(app).post(`/api/challenges/${id}/finish`)).send({});
  assert.equal(fin.status, 200, fin.text);
  assert.equal(fin.body.challenge.status, 'completed');
  assert.equal(fin.body.draw, false);

  const sara = await asSara(request(app).get('/api/me'));
  assert.equal(sara.body.points, 120 + 10);
  assert.deepEqual(sara.body.record, { won: 1, lost: 0, draw: 0 });
  assert.ok(sara.body.badges.find((b) => b.code === 'first_win').earned);

  const rana = await asRana(request(app).get('/api/me'));
  assert.equal(rana.body.points, 10);
  assert.equal(rana.body.record.lost, 1);
});

test('declining a two-sided challenge closes it', async () => {
  const asSara = await login('sara@example.com');
  const asRana = await login('rana@example.com');
  const c = await asSara(request(app).post('/api/challenges')).send({
    title: 'Quiz', scope: 'person', opponents: [org.user['Rana Kamal']], endsAt: inDays(2),
  });
  const dec = await asRana(request(app).post(`/api/challenges/${c.body.id}/decline`));
  assert.equal(dec.body.status, 'declined');
});

test('branch vs branch needs HR approval and is scored by exact totals', async () => {
  const asSara = await login('sara@example.com'); // Cairo
  const asLina = await login('lina@example.com'); // Alexandria
  const asKarim = await login('karim@example.com'); // Alexandria
  const asMgr = await login('manager@example.com');
  const asHr = await login('hr@example.com');

  const c = await asSara(request(app).post('/api/challenges')).send({
    title: 'Branch steps', scope: 'branch', opponents: [org.branch.Alexandria], points: 200, endsAt: inDays(5),
  });
  assert.equal(c.status, 201, c.text);
  assert.equal(c.body.status, 'pending_approval');

  // Managers cannot approve branch challenges; HR can.
  await asMgr(request(app).post(`/api/challenges/${c.body.id}/approve`)).expect(403);
  const approvals = await asHr(request(app).get('/api/admin/approvals'));
  assert.ok(approvals.body.challenges.some((x) => x.id === c.body.id));
  const ok = await asHr(request(app).post(`/api/challenges/${c.body.id}/approve`));
  assert.equal(ok.body.status, 'active');

  // Groups score the exact total of what their members logged, and show each member's score.
  await asSara(request(app).post(`/api/challenges/${c.body.id}/progress`)).send({ value: 7000 }).expect(201);
  await asLina(request(app).post(`/api/challenges/${c.body.id}/progress`)).send({ value: 2000 }).expect(201);
  await asKarim(request(app).post(`/api/challenges/${c.body.id}/progress`)).send({ value: 1000 }).expect(201);

  const detail = await asSara(request(app).get(`/api/challenges/${c.body.id}`));
  const cairo = detail.body.sides.find((s) => s.entityId === org.branch.Cairo);
  const alex = detail.body.sides.find((s) => s.entityId === org.branch.Alexandria);
  assert.equal(cairo.members, 7);
  assert.equal(cairo.score, 7000);
  assert.equal(alex.score, 3000);
  assert.equal(cairo.people.length, 7);
  assert.deepEqual(alex.people.map((p) => [p.name, p.score]), [['Lina Farouk', 2000], ['Karim Said', 1000]]);

  const fin = await asHr(request(app).post(`/api/challenges/${c.body.id}/finish`)).send({});
  assert.deepEqual(fin.body.winners, [cairo.sideId]);
  const sara = await asSara(request(app).get('/api/me'));
  assert.ok(sara.body.badges.find((b) => b.code === 'team_player').earned);
});

test('employees cannot create official challenges or stake too many points', async () => {
  const asSara = await login('sara@example.com');
  const official = await asSara(request(app).post('/api/challenges')).send({
    title: 'X', scope: 'branch', official: true, endsAt: inDays(2),
  });
  assert.equal(official.status, 403);
  const tooMuch = await asSara(request(app).post('/api/challenges')).send({
    title: 'X', scope: 'person', opponents: [org.user['Rana Kamal']], points: 99999, endsAt: inDays(2),
  });
  assert.equal(tooMuch.status, 400);
});

test('HR official region challenge includes every region and starts at once', async () => {
  const asHr = await login('hr@example.com');
  const c = await asHr(request(app).post('/api/challenges')).send({
    title: 'Safety quiz', scope: 'region', official: true, points: 300, reward: 'Pizza party', endsAt: inDays(7),
  });
  assert.equal(c.status, 201, c.text);
  assert.equal(c.body.status, 'active');
  assert.equal(c.body.sides.length, 2);
  const asNour = await login('nour@example.com');
  const mine = await asNour(request(app).get('/api/challenges'));
  assert.ok(mine.body.some((x) => x.id === c.body.id && x.mySideId));
});

test('manager-judged challenges need a picked winner', async () => {
  const asHr = await login('hr@example.com');
  const approvals = await asHr(request(app).get('/api/admin/approvals'));
  const kudos = approvals.body.challenges.find((x) => x.title === 'Most customer kudos');
  await asHr(request(app).post(`/api/challenges/${kudos.id}/approve`)).expect(200);
  const noPick = await asHr(request(app).post(`/api/challenges/${kudos.id}/finish`)).send({});
  assert.equal(noPick.status, 400);
  const sales = kudos.sides.find((s) => s.entityId === org.dept.Sales);
  const fin = await asHr(request(app).post(`/api/challenges/${kudos.id}/finish`)).send({ winnerSideId: sales.sideId });
  assert.equal(fin.status, 200, fin.text);
  assert.equal(fin.body.challenge.winnerSideId, sales.sideId);
});

test('proof challenges hold entries until a manager approves them', async () => {
  const asSara = await login('sara@example.com');
  const asRana = await login('rana@example.com');
  const asMgr = await login('manager@example.com');
  const c = await asSara(request(app).post('/api/challenges')).send({
    title: 'Sketch a day', scope: 'person', judging: 'proof', opponents: [org.user['Rana Kamal']], endsAt: inDays(3),
  });
  await asRana(request(app).post(`/api/challenges/${c.body.id}/accept`)).expect(200);
  await asSara(request(app).post(`/api/challenges/${c.body.id}/progress`)).send({ value: 1 }).expect(400);
  const e = await asSara(request(app).post(`/api/challenges/${c.body.id}/progress`)).send({ value: 1, proofUrl: 'https://example.com/a.jpg' });
  assert.equal(e.body.status, 'pending');
  let detail = await asSara(request(app).get(`/api/challenges/${c.body.id}`));
  assert.equal(detail.body.sides[0].score, 0);
  await asMgr(request(app).post(`/api/challenges/${c.body.id}/entries/${e.body.id}/review`)).send({ decision: 'approved' }).expect(200);
  detail = await asSara(request(app).get(`/api/challenges/${c.body.id}`));
  assert.equal(detail.body.sides[0].score, 1);
});

test('leaderboard ranks people and groups and marks my row', async () => {
  const asLina = await login('lina@example.com');
  const people = await asLina(request(app).get('/api/leaderboard?scope=person&period=all'));
  assert.equal(people.body[0].name, 'Lina Farouk');
  assert.ok(people.body[0].me);
  for (const scope of ['team', 'department', 'branch', 'region']) {
    const res = await asLina(request(app).get(`/api/leaderboard?scope=${scope}&period=month`));
    assert.equal(res.status, 200);
    assert.equal(res.body.filter((r) => r.me).length, 1, scope);
  }
});

test('dashboard: overview, participation, export and role limits', async () => {
  const asHr = await login('hr@example.com');
  const asMgr = await login('manager@example.com');
  const asSara = await login('sara@example.com');

  await asSara(request(app).get('/api/admin/overview')).expect(403);
  const ov = await asHr(request(app).get('/api/admin/overview'));
  assert.equal(ov.body.employees, 13);
  assert.equal(ov.body.pendingApprovals, 1);

  const north = await asHr(request(app).get(`/api/admin/overview?regionId=${org.region.North}`));
  assert.ok(north.body.employees < 13);

  const mgr = await asMgr(request(app).get('/api/admin/overview'));
  assert.equal(mgr.body.employees, 4); // Design department only

  const part = await asHr(request(app).get('/api/admin/participation?by=branch&period=all'));
  assert.equal(part.body.length, 4);

  const csv = await asHr(request(app).get('/api/admin/export.csv?period=all'));
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /Lina Farouk/);

  await asMgr(request(app).post('/api/admin/users')).send({}).expect(403);
  const newUser = await asHr(request(app).post('/api/admin/users')).send({
    name: 'New Person', email: 'new@example.com', password: 'longenough', teamId: org.team['Sales@Cairo'],
  });
  assert.equal(newUser.status, 201, newUser.text);
  await asHr(request(app).post('/api/admin/users')).send({
    name: 'Sneaky', email: 'sneaky@example.com', password: 'longenough', role: 'admin', teamId: org.team['Sales@Cairo'],
  }).expect(403);
});

test('settings change the approval rule', async () => {
  const asHr = await login('hr@example.com');
  const asSara = await login('sara@example.com');
  await asSara(request(app).put('/api/admin/settings')).send({ approvalMode: 'none' }).expect(403);
  const s = await asHr(request(app).put('/api/admin/settings')).send({ approvalMode: 'all' });
  assert.equal(s.body.approvalMode, 'all');
  const c = await asSara(request(app).post('/api/challenges')).send({
    title: 'X', scope: 'person', opponents: [org.user['Rana Kamal']], endsAt: inDays(2),
  });
  assert.equal(c.body.status, 'pending_approval');
});

test('finished challenges are settled automatically after their end date', async () => {
  const asSara = await login('sara@example.com');
  const asRana = await login('rana@example.com');
  const c = await asSara(request(app).post('/api/challenges')).send({
    title: 'Quick one', scope: 'person', opponents: [org.user['Rana Kamal']], endsAt: inDays(1),
  });
  await asRana(request(app).post(`/api/challenges/${c.body.id}/accept`));
  await asRana(request(app).post(`/api/challenges/${c.body.id}/progress`)).send({ value: 3 });
  const done = settleDue(db, new Date(Date.now() + 2 * 864e5));
  assert.ok(done.includes(c.body.id));
  const rana = await asRana(request(app).get('/api/me'));
  assert.equal(rana.body.record.won, 1);
});
