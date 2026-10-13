// The whole game, played through shared/client.js against the Firebase emulators
// (Auth + Firestore with the real security rules). Run with `npm test`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initializeApp, deleteApp } from 'firebase/app';
import * as fs from 'firebase/firestore';
import {
  getAuth, connectAuthEmulator, signInAnonymously, createUserWithEmailAndPassword,
} from 'firebase/auth';
import { createBackend } from '../shared/client.js';

const PROJECT = 'demo-challenges';
let n = 0;
const apps = [];

// Each person gets their own Firebase app, like their own phone.
function device() {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'demo-key', authDomain: 'localhost' }, `device-${n++}`);
  apps.push(app);
  const db = fs.getFirestore(app);
  fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  return { app, db, auth, backend: createBackend({ fs, db, auth }) };
}

async function clear() {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

const hour = 3600 * 1000;
after(() => Promise.all(apps.map((a) => deleteApp(a))));
let owner, hr, sara, omar, lina;
let org;

before(async () => {
  await clear();
  owner = device();
  await createUserWithEmailAndPassword(owner.auth, 'owner@co.com', 'secret123');
  assert.equal((await owner.backend.setupState()).claimed, false);
  await owner.backend.claimOwner({ name: 'Mazen', company: 'Cairo HQ' });

  const a = owner.backend.api;
  const north = await a('/admin/org/regions', { method: 'POST', body: { name: 'North' } });
  const alex = await a('/admin/org/branches', { method: 'POST', body: { name: 'Alexandria', regionId: north.id } });
  const o = await a('/admin/org');
  const cairo = o.branches.find((b) => b.name === 'Cairo HQ');
  const design = await a('/admin/org/departments', { method: 'POST', body: { name: 'Design' } });
  const support = await a('/admin/org/departments', { method: 'POST', body: { name: 'Support' } });
  const t1 = await a('/admin/org/teams', { method: 'POST', body: { name: 'Design Cairo', departmentId: design.id, branchId: cairo.id } });
  const t2 = await a('/admin/org/teams', { method: 'POST', body: { name: 'Support Cairo', departmentId: support.id, branchId: cairo.id } });
  const t3 = await a('/admin/org/teams', { method: 'POST', body: { name: 'Design Alex', departmentId: design.id, branchId: alex.id } });
  org = { t1, t2, t3, design, support };

  // HR gets an email login made by the owner (the dashboard does this with a second Firebase app).
  hr = device();
  const cred = await createUserWithEmailAndPassword(hr.auth, 'hr@co.com', 'secret123');
  await owner.backend.addPlayer(cred.user.uid, { name: 'Hana', email: 'hr@co.com', role: 'hr', teamId: t2.id });

  // Employees join with only a name.
  sara = device();
  await signInAnonymously(sara.auth);
  assert.equal(await sara.backend.hasPlayer(), false);
  assert.ok((await sara.backend.joinOptions()).some((t) => t.name === 'Design Cairo'));
  await sara.backend.join({ name: 'Sara', teamId: t1.id });
  omar = device();
  await signInAnonymously(omar.auth);
  await omar.backend.join({ name: 'Omar', teamId: t2.id });
  lina = device();
  await signInAnonymously(lina.auth);
  await lina.backend.join({ name: 'Lina', teamId: t1.id });
});

test('setup can only be claimed once, and the owner is an admin', async () => {
  assert.equal((await owner.backend.setupState()).claimed, true);
  const me = await owner.backend.api('/me');
  assert.equal(me.role, 'admin');
  const intruder = device();
  await createUserWithEmailAndPassword(intruder.auth, 'x@co.com', 'secret123');
  await assert.rejects(intruder.backend.claimOwner({ name: 'X' }));
});

test('a person challenge: invite, accept, log progress, finish, points on the daily leaderboard', async () => {
  const targets = await sara.backend.api('/challenges/targets?scope=person&q=om');
  const omarId = targets.targets.find((t) => t.name === 'Omar').id;
  const c = await sara.backend.api('/challenges', {
    method: 'POST',
    body: { title: 'Most steps', scope: 'person', unit: 'steps', points: 100, opponents: [omarId], endsAt: new Date(Date.now() + 24 * hour).toISOString() },
  });
  assert.equal(c.status, 'invited');

  const feed = await omar.backend.api('/feed');
  assert.equal(feed.invites.length, 1);
  assert.equal((await omar.backend.api('/notifications'))[0].text, 'Sara challenged you: Most steps');

  const accepted = await omar.backend.api(`/challenges/${c.id}/accept`, { method: 'POST' });
  assert.equal(accepted.status, 'active');

  await sara.backend.api(`/challenges/${c.id}/progress`, { method: 'POST', body: { value: 8000 } });
  await omar.backend.api(`/challenges/${c.id}/progress`, { method: 'POST', body: { value: 5000 } });
  await sara.backend.api(`/challenges/${c.id}/progress`, { method: 'POST', body: { value: 1500 } });
  await assert.rejects(lina.backend.api(`/challenges/${c.id}/progress`, { method: 'POST', body: { value: 99999 } }), /not part/);

  const detail = await sara.backend.api(`/challenges/${c.id}`);
  assert.deepEqual(detail.sides.map((s) => [s.name, s.score]), [['Sara', 9500], ['Omar', 5000]]);

  // Employees can't finish it; HR can.
  await assert.rejects(sara.backend.api(`/challenges/${c.id}/finish`, { method: 'POST', body: {} }));
  const done = await hr.backend.api(`/challenges/${c.id}/finish`, { method: 'POST', body: {} });
  assert.equal(done.draw, false);
  assert.equal(done.challenge.status, 'completed');
  await assert.rejects(hr.backend.api(`/challenges/${c.id}/finish`, { method: 'POST', body: {} }), /running|finished/);

  const me = await sara.backend.api('/me');
  assert.equal(me.points, 110); // 100 for winning + 10 for taking part
  assert.deepEqual(me.record, { won: 1, lost: 0, draw: 0 });
  assert.ok(me.badges.find((b) => b.code === 'first_win').earned);
  assert.equal((await omar.backend.api('/me')).points, 10);

  const today = await omar.backend.api('/leaderboard?scope=person&period=day');
  assert.deepEqual(today.slice(0, 2).map((r) => [r.name, r.score]), [['Sara', 110], ['Omar', 10]]);
  assert.ok(today.find((r) => r.name === 'Omar').me);
  const teams = await omar.backend.api('/leaderboard?scope=team&period=day');
  assert.equal(teams[0].name, 'Design Cairo');
  assert.equal(teams[0].score, 110);
});

test('team challenges score the exact total of the team, with each member listed', async () => {
  const c = await sara.backend.api('/challenges', {
    method: 'POST',
    body: { title: 'Team tickets', scope: 'team', points: 50, opponents: [org.t2.id], endsAt: new Date(Date.now() + hour).toISOString() },
  });
  await omar.backend.api(`/challenges/${c.id}/accept`, { method: 'POST' });
  await sara.backend.api(`/challenges/${c.id}/progress`, { method: 'POST', body: { value: 3 } });
  await lina.backend.api(`/challenges/${c.id}/progress`, { method: 'POST', body: { value: 4.5 } });
  await omar.backend.api(`/challenges/${c.id}/progress`, { method: 'POST', body: { value: 6 } });
  const d = await lina.backend.api(`/challenges/${c.id}`);
  const design = d.sides.find((s) => s.name === 'Design Cairo');
  assert.equal(design.score, 7.5);
  assert.deepEqual(design.people.map((p) => [p.name, p.score]), [['Lina', 4.5], ['Sara', 3]]);
  assert.equal(d.sides.find((s) => s.name === 'Support Cairo').score, 6);
});

test('department challenges wait for approval; managers and HR see them in Approvals', async () => {
  const c = await sara.backend.api('/challenges', {
    method: 'POST',
    body: { title: 'Kudos', scope: 'department', points: 20, opponents: [org.support.id], endsAt: new Date(Date.now() + hour).toISOString() },
  });
  assert.equal(c.status, 'pending_approval');
  const ap = await hr.backend.api('/admin/approvals');
  assert.ok(ap.challenges.some((x) => x.id === c.id));
  const ok = await hr.backend.api(`/challenges/${c.id}/approve`, { method: 'POST' });
  assert.equal(ok.status, 'active');
  const overview = await hr.backend.api('/admin/overview');
  assert.ok(overview.activeChallenges >= 2);
  assert.ok(overview.employees >= 5);
});

test('ended challenges are finished automatically when staff open the dashboard', async () => {
  const c = await sara.backend.api('/challenges', {
    method: 'POST',
    body: { title: 'Quick one', scope: 'team', points: 30, opponents: [org.t2.id], startsAt: new Date(Date.now() - hour).toISOString(), endsAt: new Date(Date.now() + 1500).toISOString() },
  });
  await omar.backend.api(`/challenges/${c.id}/accept`, { method: 'POST' });
  await omar.backend.api(`/challenges/${c.id}/progress`, { method: 'POST', body: { value: 2 } });
  await new Promise((r) => setTimeout(r, 2000));
  const hrMe = await hr.backend.me();
  const done = await hr.backend.settleDue(hrMe);
  assert.ok(done.includes(c.id));
  const after = await omar.backend.api(`/challenges/${c.id}`);
  assert.equal(after.status, 'completed');
  assert.equal(after.result, 'Support Cairo beat Design Cairo in "Quick one"');
});

test('HR manages people and settings; employees cannot', async () => {
  const people = await hr.backend.api('/admin/users');
  const lina2 = people.find((p) => p.name === 'Lina');
  const moved = await hr.backend.api(`/admin/users/${lina2.id}`, { method: 'PATCH', body: { teamId: org.t3.id } });
  assert.equal(moved.branch.name, 'Alexandria');
  await assert.rejects(sara.backend.api('/admin/users'));
  await assert.rejects(sara.backend.api('/admin/settings', { method: 'PUT', body: { maxPeerPoints: 9999 } }));
  const s = await hr.backend.api('/admin/settings', { method: 'PUT', body: { maxPeerPoints: 300 } });
  assert.equal(s.maxPeerPoints, 300);
  const csv = await hr.backend.api('/admin/export.csv?period=all');
  assert.match(csv.split('\n')[0], /^Name,Email,Team/);
});

test('players can delete their own account; the profile is wiped and switched off', async () => {
  const gone = device();
  await signInAnonymously(gone.auth);
  await gone.backend.join({ name: 'Temp', teamId: org.t1.id });
  const id = gone.auth.currentUser.uid;
  sara.backend.forget();
  await sara.backend.api('/challenges', {
    method: 'POST',
    body: { title: 'Bye', scope: 'person', points: 10, opponents: [id], endsAt: new Date(Date.now() + hour).toISOString() },
  });
  assert.equal((await gone.backend.api('/notifications')).length, 1);

  // Nobody else can wipe someone's profile.
  await assert.rejects(fs.updateDoc(fs.doc(sara.db, 'players', id), { name: 'Deleted user', title: null, email: null, active: false, deleted: true }));

  await gone.backend.deleteAccount();
  const snap = await fs.getDoc(fs.doc(hr.db, 'players', id));
  assert.equal(snap.data().name, 'Deleted user');
  assert.equal(snap.data().active, false);
  const left = await fs.getDocs(fs.query(fs.collection(gone.db, 'notifications'), fs.where('userId', '==', id)));
  assert.equal(left.size, 0);
  await assert.rejects(gone.backend.api('/me'), /switched off/);
});
