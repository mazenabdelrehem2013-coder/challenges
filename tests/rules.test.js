// Database rules, checked against the Firestore emulator (run with `npm test`).
import { test, before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, addDoc, collection, serverTimestamp, Timestamp, increment } from 'firebase/firestore';

let env;
const hour = 3600 * 1000;
const anon = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const email = (uid) => env.authenticatedContext(uid, { email: `${uid}@co.com`, firebase: { sign_in_provider: 'password' } }).firestore();

const player = (role, teamId = 't1', extra = {}) => ({
  name: role, role, active: true, points: 0, teamId,
  departmentId: teamId === 't1' ? 'design' : 'support', branchId: 'cairo', regionId: 'north', ...extra,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-challenges',
    firestore: { rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'regions/north'), { name: 'North' });
    await setDoc(doc(db, 'branches/cairo'), { name: 'Cairo', regionId: 'north' });
    await setDoc(doc(db, 'departments/design'), { name: 'Design' });
    await setDoc(doc(db, 'departments/support'), { name: 'Support' });
    await setDoc(doc(db, 'teams/t1'), { name: 'Design Cairo', departmentId: 'design', branchId: 'cairo' });
    await setDoc(doc(db, 'teams/t2'), { name: 'Support Cairo', departmentId: 'support', branchId: 'cairo' });
    await setDoc(doc(db, 'players/hr'), player('hr', 't2'));
    await setDoc(doc(db, 'players/mgr'), player('manager', 't1'));
    await setDoc(doc(db, 'players/omar'), player('employee', 't2'));
  });
});

const challenge = (extra = {}) => ({
  title: 'Steps', scope: 'person', official: false, status: 'invited', points: 100, judging: 'tracked',
  createdBy: 'sara', creatorDepartmentId: 'design',
  keys: ['person:sara', 'person:omar'],
  sides: [{ key: 'person:sara', entityId: 'sara', name: 'Sara' }, { key: 'person:omar', entityId: 'omar', name: 'Omar' }],
  responses: { 'person:sara': 'accepted', 'person:omar': 'pending' },
  startsAt: Timestamp.fromMillis(Date.now() - hour), endsAt: Timestamp.fromMillis(Date.now() + 24 * hour), ...extra,
});

test('employees join with just a name, but cannot make themselves staff or give themselves points', async () => {
  const sara = anon('sara');
  await assertFails(setDoc(doc(sara, 'players/sara'), player('manager')));
  await assertFails(setDoc(doc(sara, 'players/sara'), { ...player('employee'), points: 500 }));
  await assertFails(setDoc(doc(sara, 'players/sara'), { ...player('employee'), departmentId: 'support' }));
  await assertFails(setDoc(doc(sara, 'players/other'), player('employee')));
  await assertSucceeds(setDoc(doc(sara, 'players/sara'), { ...player('employee'), name: 'Sara' }));
  await assertSucceeds(updateDoc(doc(sara, 'players/sara'), { name: 'Sara A.' }));
  await assertFails(updateDoc(doc(sara, 'players/sara'), { points: 1000 }));
  await assertFails(updateDoc(doc(sara, 'players/sara'), { teamId: 't2', departmentId: 'support' }));
  await assertSucceeds(updateDoc(doc(sara, 'players/sara'), { started: 1 }));
  await assertFails(updateDoc(doc(sara, 'players/sara'), { started: 5 }));
});

test('the first email account can claim the app once and become admin', async () => {
  const anonOwner = anon('x');
  await assertFails(setDoc(doc(anonOwner, 'config/setup'), { ownerUid: 'x' }));
  const owner = email('boss');
  await assertFails(setDoc(doc(owner, 'players/boss'), player('admin')));
  await assertSucceeds(setDoc(doc(owner, 'config/setup'), { ownerUid: 'boss' }));
  await assertSucceeds(setDoc(doc(owner, 'players/boss'), player('admin')));
  await assertFails(setDoc(doc(email('late'), 'config/setup'), { ownerUid: 'late' }));
  // Admins and HR manage the org chart; employees cannot.
  await assertSucceeds(setDoc(doc(owner, 'teams/t9'), { name: 'New', departmentId: 'design', branchId: 'cairo' }));
  await assertFails(setDoc(doc(anon('omar'), 'teams/t8'), { name: 'Mine', departmentId: 'design', branchId: 'cairo' }));
});

test('peer challenges follow approval and stake rules; invitees accept for their own side only', async () => {
  const sara = anon('sara');
  await setDoc(doc(sara, 'players/sara'), player('employee'));
  await assertFails(setDoc(doc(sara, 'challenges/c0'), challenge({ points: 5000 })));
  await assertFails(setDoc(doc(sara, 'challenges/c0'), challenge({ status: 'active' })));
  await assertFails(setDoc(doc(sara, 'challenges/c0'), challenge({ official: true, status: 'active' })));
  await assertFails(setDoc(doc(sara, 'challenges/c0'), challenge({ keys: ['person:omar', 'person:sara'] })));
  await assertFails(setDoc(doc(sara, 'challenges/c0'),
    challenge({ scope: 'branch', status: 'active', keys: ['branch:cairo', 'branch:alex'] })));
  await assertSucceeds(setDoc(doc(sara, 'challenges/c0'),
    challenge({ scope: 'branch', status: 'pending_approval', keys: ['branch:cairo', 'branch:alex'] })));
  await assertSucceeds(setDoc(doc(sara, 'challenges/c1'), challenge()));

  // Sara can't accept for Omar; Omar can.
  await assertFails(updateDoc(doc(sara, 'challenges/c1'), { 'responses.person:omar': 'accepted', status: 'active' }));
  await assertSucceeds(updateDoc(doc(anon('omar'), 'challenges/c1'), { 'responses.person:omar': 'accepted', status: 'active' }));
  await assertFails(updateDoc(doc(sara, 'challenges/c1'), { status: 'completed' }));
});

test('progress goes on your own side of a running challenge; proof needs a link', async () => {
  const sara = anon('sara');
  await setDoc(doc(sara, 'players/sara'), player('employee'));
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'challenges/run'), challenge({ status: 'active' }));
    await setDoc(doc(ctx.firestore(), 'challenges/proof'), challenge({ status: 'active', judging: 'proof' }));
    await setDoc(doc(ctx.firestore(), 'challenges/ended'), challenge({ status: 'active', endsAt: Timestamp.fromMillis(Date.now() - 1000) }));
  });
  const entry = (extra = {}) => ({ userId: 'sara', sideKey: 'person:sara', value: 5, status: 'approved', createdAt: serverTimestamp(), ...extra });
  await assertSucceeds(addDoc(collection(sara, 'challenges/run/entries'), entry()));
  await assertFails(addDoc(collection(sara, 'challenges/run/entries'), entry({ sideKey: 'person:omar' })));
  await assertFails(addDoc(collection(sara, 'challenges/run/entries'), entry({ userId: 'omar' })));
  await assertFails(addDoc(collection(sara, 'challenges/run/entries'), entry({ value: -3 })));
  await assertFails(addDoc(collection(sara, 'challenges/ended/entries'), entry()));
  await assertFails(addDoc(collection(sara, 'challenges/proof/entries'), entry()));
  await assertFails(addDoc(collection(sara, 'challenges/proof/entries'), entry({ status: 'pending', proofUrl: 'http://x' })));
  await assertSucceeds(addDoc(collection(sara, 'challenges/proof/entries'), entry({ status: 'pending', proofUrl: 'https://photos/x' })));
});

test('managers moderate their own department up to department level; HR everything', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'challenges/team'), challenge({ scope: 'team', status: 'pending_approval' }));
    await setDoc(doc(ctx.firestore(), 'challenges/branch'), challenge({ scope: 'branch', status: 'pending_approval' }));
    await setDoc(doc(ctx.firestore(), 'challenges/other'), challenge({ scope: 'team', status: 'pending_approval', creatorDepartmentId: 'sales' }));
  });
  const mgr = email('mgr');
  await assertSucceeds(updateDoc(doc(mgr, 'challenges/team'), { status: 'invited' }));
  await assertFails(updateDoc(doc(mgr, 'challenges/branch'), { status: 'active' }));
  await assertFails(updateDoc(doc(mgr, 'challenges/other'), { status: 'active' }));
  await assertSucceeds(updateDoc(doc(email('hr'), 'challenges/branch'), { status: 'active' }));

  // Only staff hand out points; managers can't promote people, HR can (but not to admin).
  await assertSucceeds(addDoc(collection(mgr, 'points'), { userId: 'omar', amount: 10 }));
  await assertFails(addDoc(collection(anon('omar'), 'points'), { userId: 'omar', amount: 10 }));
  await assertSucceeds(updateDoc(doc(mgr, 'players/omar'), { points: increment(10) }));
  await assertFails(updateDoc(doc(mgr, 'players/omar'), { role: 'hr' }));
  await assertSucceeds(updateDoc(doc(email('hr'), 'players/omar'), { role: 'manager' }));
  await assertFails(updateDoc(doc(email('hr'), 'players/omar'), { role: 'admin' }));
});

test('notifications are private to their owner', async () => {
  const sara = anon('sara');
  await setDoc(doc(sara, 'players/sara'), player('employee'));
  await assertSucceeds(setDoc(doc(sara, 'notifications/n1'), { userId: 'omar', text: 'hi', read: false }));
  await assertFails(getDoc(doc(sara, 'notifications/n1')));
  await assertSucceeds(getDoc(doc(anon('omar'), 'notifications/n1')));
  await assertSucceeds(updateDoc(doc(anon('omar'), 'notifications/n1'), { read: true }));
  await assertFails(updateDoc(doc(anon('omar'), 'notifications/n1'), { text: 'changed' }));
});
