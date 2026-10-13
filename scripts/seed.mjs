// Fills the local emulators with a demo company, for trying the apps locally:
//   npm run emulators   (in one terminal)
//   npm run seed        (in another)
// Staff sign in to the dashboard with these emails and the password demo1234.
// Employees join on the phone app with any name.
import { initializeApp, deleteApp } from 'firebase/app';
import * as fs from 'firebase/firestore';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInAnonymously } from 'firebase/auth';
import { createBackend } from '../shared/client.js';
import { emulatorProject } from '../shared/firebase-config.js';

const apps = [];
let n = 0;
function device() {
  const app = initializeApp({ projectId: emulatorProject, apiKey: 'demo-key', authDomain: 'localhost' }, `seed-${n++}`);
  apps.push(app);
  const db = fs.getFirestore(app);
  fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  return { auth, backend: createBackend({ fs, db, auth }) };
}

await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${emulatorProject}/databases/(default)/documents`, { method: 'DELETE' });
await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${emulatorProject}/accounts`, { method: 'DELETE' });

const owner = device();
await createUserWithEmailAndPassword(owner.auth, 'admin@example.com', 'demo1234');
await owner.backend.claimOwner({ name: 'Admin', company: 'Cairo' });
const a = owner.backend.api;
const post = (path, body) => a(path, { method: 'POST', body });

let o = await a('/admin/org');
const egypt = o.regions[0];
await a(`/admin/org/regions/${egypt.id}`, { method: 'PATCH', body: { name: 'Egypt' } });
const cairo = o.branches[0];
const alex = await post('/admin/org/branches', { name: 'Alexandria', regionId: egypt.id });
const gulf = await post('/admin/org/regions', { name: 'Gulf' });
const dubai = await post('/admin/org/branches', { name: 'Dubai', regionId: gulf.id });
const depts = {};
for (const name of ['Design', 'Support', 'Sales', 'People']) depts[name] = await post('/admin/org/departments', { name });
const teams = {};
for (const [name, dep, br] of [
  ['Design Cairo', 'Design', cairo], ['Support Cairo', 'Support', cairo], ['Design Alexandria', 'Design', alex],
  ['Sales Dubai', 'Sales', dubai], ['People Cairo', 'People', cairo],
]) teams[name] = await post('/admin/org/teams', { name, departmentId: depts[dep].id, branchId: br.id });

async function staff(email, name, role, team, title) {
  const d = device();
  const cred = await createUserWithEmailAndPassword(d.auth, email, 'demo1234');
  await owner.backend.addPlayer(cred.user.uid, { name, email, role, title, teamId: teams[team].id });
  return d;
}
const hr = await staff('hr@example.com', 'Hana', 'hr', 'People Cairo', 'HR lead');
await staff('manager@example.com', 'Mona', 'manager', 'Design Cairo', 'Design manager');

const people = {};
for (const [name, team] of [
  ['Sara', 'Design Cairo'], ['Youssef', 'Design Cairo'], ['Omar', 'Support Cairo'], ['Nour', 'Support Cairo'],
  ['Lina', 'Design Alexandria'], ['Karim', 'Sales Dubai'],
]) {
  const d = device();
  await signInAnonymously(d.auth);
  await d.backend.join({ name, teamId: teams[team].id });
  people[name] = d;
}

const day = 24 * 3600 * 1000;
const soon = (days) => new Date(Date.now() + days * day).toISOString();
const omarId = (await people.Sara.backend.api('/challenges/targets?scope=person&q=omar')).targets[0].id;
const steps = await people.Sara.backend.api('/challenges', {
  method: 'POST', body: { title: 'Most steps this week', type: 'fitness', scope: 'person', unit: 'steps', points: 100, opponents: [omarId], endsAt: soon(5) },
});
await people.Omar.backend.api(`/challenges/${steps.id}/accept`, { method: 'POST' });
await people.Sara.backend.api(`/challenges/${steps.id}/progress`, { method: 'POST', body: { value: 8200 } });
await people.Omar.backend.api(`/challenges/${steps.id}/progress`, { method: 'POST', body: { value: 9100 } });

const tickets = await people.Omar.backend.api('/challenges', {
  method: 'POST', body: { title: 'Most tickets closed', type: 'work', scope: 'team', unit: 'tickets', points: 150, opponents: [teams['Design Cairo'].id], endsAt: soon(3) },
});
await people.Youssef.backend.api(`/challenges/${tickets.id}/accept`, { method: 'POST' });
for (const [who, v] of [['Omar', 12], ['Nour', 9], ['Sara', 7], ['Youssef', 11]]) {
  await people[who].backend.api(`/challenges/${tickets.id}/progress`, { method: 'POST', body: { value: v } });
}

// One that already finished, so the leaderboards have points.
const quiz = await people.Lina.backend.api('/challenges', {
  method: 'POST', body: { title: 'Design quiz', type: 'learning', scope: 'person', unit: 'points', points: 80, opponents: [(await people.Lina.backend.api('/challenges/targets?scope=person&q=karim')).targets[0].id], startsAt: new Date(Date.now() - day).toISOString(), endsAt: new Date(Date.now() + 2000).toISOString() },
});
await people.Karim.backend.api(`/challenges/${quiz.id}/accept`, { method: 'POST' });
await people.Lina.backend.api(`/challenges/${quiz.id}/progress`, { method: 'POST', body: { value: 18 } });
await people.Karim.backend.api(`/challenges/${quiz.id}/progress`, { method: 'POST', body: { value: 15 } });
await new Promise((r) => setTimeout(r, 2500));
await hr.backend.settleDue(await hr.backend.me());

await people.Sara.backend.api('/challenges', {
  method: 'POST', body: { title: 'Design vs Support: customer kudos', type: 'work', scope: 'department', unit: 'kudos', points: 200, opponents: [depts.Support.id], endsAt: soon(14) },
});
await hr.backend.api('/challenges', {
  method: 'POST', body: { title: 'Ramadan step challenge', type: 'fitness', scope: 'branch', unit: 'steps', points: 300, official: true, reward: 'Team lunch', endsAt: soon(20) },
});

await Promise.all(apps.map((x) => deleteApp(x)));
console.log('Seeded: admin@example.com, hr@example.com, manager@example.com (password demo1234) and 6 employees.');
process.exit(0);
