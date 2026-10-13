// The app's "back end", running inside the phone app and the dashboard and talking
// straight to Cloud Firestore. It answers the same requests the old server did
// (api('/challenges'), api('/me'), ...), so the screens did not have to change much.
// firestore.rules makes sure nobody can bypass these checks.
//
// Both apps pass in their own copy of the Firebase SDK:
//   createBackend({ fs: <the 'firebase/firestore' module>, db, auth })
import {
  SCOPES,
  GROUP_SCOPES,
  TYPES,
  JUDGING,
  OPEN_STATUSES,
  DEFAULT_SETTINGS,
  BADGES,
  levelFor,
  scopeField,
  sideKey,
  playerKeys,
  membersOf,
  mySide,
  liveSides,
  sideScores,
  settlePlan,
  needsApproval,
  canModerate,
  periodStart,
  leaderboard,
} from './game.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new ApiError(status, message);
};

const ORG_KINDS = { regions: 'region', branches: 'branch', departments: 'department', teams: 'team' };
const PLURAL = { region: 'regions', branch: 'branches', department: 'departments', team: 'teams' };

// Every request the apps make. Fixed words win over :params, so /challenges/targets
// is not mistaken for a challenge id.
const ROUTES = [
  'GET /me', 'POST /me/name', 'GET /profiles/:id', 'GET /feed', 'GET /leaderboard',
  'GET /notifications', 'POST /notifications/read',
  'GET /challenges', 'POST /challenges', 'GET /challenges/targets', 'GET /challenges/:id',
  'POST /challenges/:id/accept', 'POST /challenges/:id/decline', 'POST /challenges/:id/progress',
  'POST /challenges/:id/approve', 'POST /challenges/:id/reject', 'POST /challenges/:id/cancel',
  'POST /challenges/:id/finish', 'POST /challenges/:id/entries/:entryId/review',
  'GET /admin/org', 'POST /admin/org/:kind', 'PATCH /admin/org/:kind/:id',
  'GET /admin/settings', 'PUT /admin/settings', 'GET /admin/overview', 'GET /admin/approvals',
  'GET /admin/participation', 'GET /admin/leaderboard', 'GET /admin/export.csv',
  'GET /admin/users', 'PATCH /admin/users/:id',
];
function matchRoute(method, path) {
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  for (const route of ROUTES) {
    const [m, pattern] = route.split(' ');
    const want = pattern.split('/').filter(Boolean);
    if (m !== method || want.length !== parts.length) continue;
    const params = {};
    if (want.every((w, i) => (w.startsWith(':') ? ((params[w.slice(1)] = parts[i]), true) : w === parts[i]))) {
      return { route, params };
    }
  }
  return { route: `${method} ${path}`, params: {} };
}
const ROLES = ['employee', 'manager', 'hr', 'admin'];
const CLOSED = ['completed', 'rejected', 'declined', 'cancelled'];
const CACHE_MS = 20000;

function text(v, name, { required = true, max = 200 } = {}) {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (required) fail(400, `${name} is required`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > max) fail(400, `${name} is too long`);
  return s;
}
function whole(v, name, { min = 0, max = 1e9 } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `${name} must be a whole number from ${min} to ${max}`);
  return n;
}
function pick(v, name, list, fallback) {
  if (v === undefined || v === null || v === '') {
    if (fallback !== undefined) return fallback;
    fail(400, `${name} is required`);
  }
  if (!list.includes(v)) fail(400, `${name} must be one of ${list.join(', ')}`);
  return v;
}
const byName = (a, b) => String(a.name).localeCompare(String(b.name));
const isStaffRole = (p) => ['manager', 'hr', 'admin'].includes(p?.role);
const isHR = (p) => p?.role === 'hr' || p?.role === 'admin';

export function createBackend({ fs, db, auth }) {
  const {
    collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, query, where, writeBatch,
    runTransaction, serverTimestamp, Timestamp, increment,
  } = fs;

  const toIso = (t) => (t?.toDate ? t.toDate().toISOString() : t || null);
  const uid = () => auth.currentUser?.uid || fail(401, 'Please sign in');

  // --- Cached reads (org chart and people change rarely) -------------------
  let cache = {};
  const forget = () => {
    cache = {};
  };
  async function cached(key, load) {
    const hit = cache[key];
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = await load();
    cache[key] = { at: Date.now(), value };
    return value;
  }
  const all = async (name) => (await getDocs(collection(db, name))).docs.map((d) => ({ id: d.id, ...d.data() }));

  async function org() {
    return cached('org', async () => {
      const [regions, branches, departments, teams] = await Promise.all(
        ['regions', 'branches', 'departments', 'teams'].map(all)
      );
      return {
        regions: regions.sort(byName),
        branches: branches.sort(byName),
        departments: departments.sort(byName),
        teams: teams.sort(byName),
      };
    });
  }
  const players = () => cached('players', () => all('players'));
  async function settings() {
    return cached('settings', async () => {
      const s = await getDoc(doc(db, 'settings/game'));
      return { ...DEFAULT_SETTINGS, ...(s.exists() ? s.data() : {}) };
    });
  }

  async function me() {
    const snap = await getDoc(doc(db, 'players', uid()));
    if (!snap.exists()) fail(401, 'Please join first');
    const p = { id: snap.id, ...snap.data() };
    if (p.active === false) fail(401, 'This account is switched off. Ask HR.');
    return p;
  }

  async function entityList(scope) {
    if (scope === 'person') return (await players()).filter((p) => p.active !== false).map((p) => ({ id: p.id, name: p.name }));
    return (await org())[PLURAL[scope]];
  }
  async function entityName(scope, id) {
    return (await entityList(scope)).find((e) => e.id === id)?.name ?? 'Unknown';
  }

  async function publicUser(p) {
    const o = await org();
    const named = (list, id) => ({ id: id ?? null, name: list.find((x) => x.id === id)?.name ?? '' });
    return {
      id: p.id,
      name: p.name,
      email: p.email || null,
      role: p.role,
      title: p.title || null,
      active: p.active !== false,
      team: named(o.teams, p.teamId),
      department: named(o.departments, p.departmentId),
      branch: named(o.branches, p.branchId),
      region: named(o.regions, p.regionId),
      points: p.points || 0,
      ...levelFor(p.points || 0),
    };
  }

  async function profile(p) {
    return {
      ...(await publicUser(p)),
      record: { won: 0, lost: 0, draw: 0, ...(p.record || {}) },
      streak: p.streak || 0,
      badges: Object.entries(BADGES).map(([code, b]) => ({
        code,
        ...b,
        earned: !!p.badges?.[code],
        awardedAt: toIso(p.badges?.[code]) || null,
      })),
    };
  }

  // --- Challenges ----------------------------------------------------------
  async function loadChallenge(id) {
    const snap = await getDoc(doc(db, 'challenges', id));
    if (!snap.exists()) fail(404, 'Challenge not found');
    return { id: snap.id, ...snap.data() };
  }
  async function entriesOf(id) {
    const snap = await getDocs(collection(db, 'challenges', id, 'entries'));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async function summary(c, viewer, entries) {
    const people = await players();
    const scores = sideScores(c, entries ?? (c.status === 'active' || c.status === 'completed' ? await entriesOf(c.id) : []), people);
    const side = mySide(c, viewer);
    return {
      id: c.id,
      title: c.title,
      description: c.description || null,
      type: c.type,
      scope: c.scope,
      unit: c.unit || null,
      judging: c.judging,
      points: c.points,
      reward: c.reward || null,
      official: !!c.official,
      status: c.status,
      startsAt: toIso(c.startsAt),
      endsAt: toIso(c.endsAt),
      createdBy: { id: c.createdBy, name: c.createdByName || people.find((p) => p.id === c.createdBy)?.name || '' },
      rejectionReason: c.rejectionReason || null,
      winnerSideId: c.winners?.length === 1 ? c.winners[0] : null,
      result: c.summary || null,
      sides: scores.map((s) => ({ ...s, sideId: s.key, total: s.score })),
      mySideId: side?.key ?? null,
      myResponse: side ? c.responses?.[side.key] ?? 'pending' : null,
      canModerate: canModerate(viewer, c),
    };
  }

  // Everyone on the given sides of a challenge.
  async function sidePeople(c, keys = c.keys) {
    const people = await players();
    return c.sides
      .filter((s) => keys.includes(s.key))
      .flatMap((s) => (c.scope === 'person' ? [s.entityId] : membersOf(people, c.scope, s.entityId).map((p) => p.id)));
  }

  function notifyAll(batch, userIds, text, challengeId = null) {
    for (const userId of new Set(userIds)) {
      batch.set(doc(collection(db, 'notifications')), {
        userId, text, challengeId, read: false, createdAt: serverTimestamp(),
      });
    }
  }
  function logActivity(batch, kind, text, { challengeId = null, userId = null } = {}) {
    batch.set(doc(collection(db, 'activity')), { kind, text, challengeId, userId, createdAt: serverTimestamp() });
  }

  async function listChallenges(viewer, { view = 'mine', status } = {}) {
    let rows;
    if (view === 'manage') {
      if (!isStaffRole(viewer)) fail(403, 'You do not have access to this');
      const q = status
        ? query(collection(db, 'challenges'), where('status', 'in', String(status).split(',').slice(0, 10)))
        : collection(db, 'challenges');
      rows = (await getDocs(q)).docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => canModerate(viewer, c));
    } else {
      const [a, b] = await Promise.all([
        getDocs(query(collection(db, 'challenges'), where('keys', 'array-contains-any', playerKeys(viewer)))),
        getDocs(query(collection(db, 'challenges'), where('createdBy', '==', viewer.id))),
      ]);
      const seen = new Map();
      for (const d of [...a.docs, ...b.docs]) seen.set(d.id, { id: d.id, ...d.data() });
      rows = [...seen.values()];
    }
    if (status) rows = rows.filter((c) => String(status).split(',').includes(c.status));
    rows.sort((x, y) => (toIso(y.endsAt) || '').localeCompare(toIso(x.endsAt) || ''));
    return Promise.all(rows.slice(0, 200).map((c) => summary(c, viewer)));
  }

  async function createChallenge(viewer, b = {}) {
    const s = await settings();
    const official = !!b.official;
    if (official && !isStaffRole(viewer)) fail(403, 'Only managers and HR can create official challenges');
    const scope = pick(b.scope, 'scope', SCOPES);
    if (official && viewer.role === 'manager' && (scope === 'branch' || scope === 'region')) {
      fail(403, 'Branch and region challenges are created by HR');
    }
    const startsAt = b.startsAt ? new Date(b.startsAt) : new Date();
    const endsAt = new Date(b.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) fail(400, 'Pick valid dates');
    if (endsAt <= startsAt) fail(400, 'The end date must be after the start date');
    const points = whole(b.points ?? 100, 'points', { min: 0, max: official ? 100000 : s.maxPeerPoints });

    const people = await players();
    const mine = viewer[scopeField(scope)];
    let ids;
    if (official) {
      if (Array.isArray(b.sides) && b.sides.length) ids = b.sides.map(String);
      else if (viewer.role === 'manager' && scope === 'person') {
        ids = people.filter((p) => p.active !== false && p.departmentId === viewer.departmentId).map((p) => p.id);
      } else if (viewer.role === 'manager' && scope === 'team') {
        ids = (await org()).teams.filter((t) => t.departmentId === viewer.departmentId).map((t) => t.id);
      } else if (viewer.role === 'manager' && scope === 'department') fail(400, 'Pick the departments taking part');
      else ids = (await entityList(scope)).map((e) => e.id);
    } else {
      const opponents = Array.isArray(b.opponents) ? b.opponents.map(String) : [];
      if (!opponents.length) fail(400, 'Pick who you are challenging');
      if (opponents.includes(mine)) fail(400, 'You cannot challenge yourself');
      ids = [mine, ...opponents];
    }
    ids = [...new Set(ids)];
    if (ids.length < 2 && !(official && scope === 'person')) fail(400, 'A challenge needs at least two sides');
    if (!ids.length) fail(400, 'Nobody to challenge');
    const known = await entityList(scope);
    const sides = ids.map((id) => {
      const e = known.find((x) => x.id === id) || fail(400, `Unknown ${scope}`);
      return { key: sideKey(scope, id), entityId: id, name: e.name };
    });

    const status = official
      ? 'active'
      : needsApproval(scope, s)
        ? 'pending_approval'
        : GROUP_SCOPES.includes(scope)
          ? 'active'
          : 'invited';
    const auto = official || status === 'active';
    const data = {
      title: text(b.title, 'title', { max: 120 }),
      description: text(b.description, 'description', { required: false, max: 2000 }),
      type: pick(b.type, 'type', TYPES, 'custom'),
      scope,
      unit: text(b.unit, 'unit', { required: false, max: 40 }),
      judging: pick(b.judging, 'judging', JUDGING, 'tracked'),
      points,
      reward: text(b.reward, 'reward', { required: false, max: 200 }),
      official,
      status,
      startsAt: Timestamp.fromDate(startsAt),
      endsAt: Timestamp.fromDate(endsAt),
      createdBy: viewer.id,
      createdByName: viewer.name,
      creatorDepartmentId: viewer.departmentId,
      createdAt: serverTimestamp(),
      sides,
      keys: sides.map((x) => x.key),
      responses: Object.fromEntries(sides.map((x, i) => [x.key, auto || i === 0 ? 'accepted' : 'pending'])),
      winners: [],
    };
    const ref = doc(collection(db, 'challenges'));
    const batch = writeBatch(db);
    batch.set(ref, data);
    batch.update(doc(db, 'players', viewer.id), { started: increment(1) });
    const c = { id: ref.id, ...data };
    if (status === 'invited') {
      notifyAll(batch, (await sidePeople(c, c.keys.slice(1))), `${viewer.name} challenged you: ${data.title}`, ref.id);
    } else if (status === 'active') {
      notifyAll(batch, (await sidePeople(c)).filter((u) => u !== viewer.id), `New challenge: ${data.title}`, ref.id);
      logActivity(batch, 'challenge', `${official ? 'New official challenge' : 'New challenge'}: ${data.title}`, {
        challengeId: ref.id,
        userId: viewer.id,
      });
    }
    await batch.commit();
    forget();
    return summary(await loadChallenge(ref.id), { ...viewer, started: (viewer.started || 0) + 1 }, []);
  }

  async function challengeDetail(viewer, id) {
    const c = await loadChallenge(id);
    const entries = await entriesOf(id);
    const s = await summary(c, viewer, entries);
    const involved = s.mySideId || c.createdBy === viewer.id || s.canModerate;
    if (!involved && !c.official) fail(403, 'You are not part of this challenge');
    const people = await players();
    return {
      ...s,
      entries: entries
        .sort((a, b) => (toIso(b.createdAt) || '').localeCompare(toIso(a.createdAt) || ''))
        .slice(0, 100)
        .map((e) => ({
          id: e.id,
          value: e.value,
          note: e.note || null,
          proofUrl: e.proofUrl || null,
          status: e.status,
          createdAt: toIso(e.createdAt),
          userId: e.userId,
          userName: e.userName || people.find((p) => p.id === e.userId)?.name || '',
        })),
    };
  }

  async function respond(viewer, id, accept) {
    const c = await loadChallenge(id);
    if (c.status !== 'invited') fail(409, 'This challenge is not waiting for an answer');
    const side = mySide(c, viewer);
    if (!side || (c.responses?.[side.key] ?? 'pending') !== 'pending') fail(403, 'There is nothing for you to answer here');
    const responses = { ...c.responses, [side.key]: accept ? 'accepted' : 'declined' };
    const after = { ...c, responses };
    const live = liveSides(after);
    let status = 'invited';
    if (live.length < 2) status = 'declined';
    else if (live.every((s) => responses[s.key] === 'accepted')) status = 'active';
    const batch = writeBatch(db);
    batch.update(doc(db, 'challenges', id), { responses, status });
    if (status === 'active') {
      logActivity(batch, 'challenge', `Challenge on: ${c.title}`, { challengeId: id });
      notifyAll(batch, await sidePeople(after, live.map((s) => s.key)), `It's on! ${c.title} has started`, id);
    }
    if (!accept) notifyAll(batch, [c.createdBy], `${viewer.name} declined ${c.title}`, id);
    await batch.commit();
    return summary({ ...after, status }, viewer);
  }

  async function logProgress(viewer, id, b = {}) {
    const c = await loadChallenge(id);
    if (c.status !== 'active') fail(409, 'This challenge is not running');
    const now = Date.now();
    if (now < c.startsAt.toMillis()) fail(409, 'This challenge has not started yet');
    if (now > c.endsAt.toMillis()) fail(409, 'This challenge has ended');
    const side = mySide(c, viewer);
    if (!side || c.responses?.[side.key] === 'declined') fail(403, 'You are not part of this challenge');
    const value = Number(b.value);
    if (!(value > 0 && value < 1e9)) fail(400, 'Enter a number above 0');
    const proofUrl = text(b.proofUrl, 'proofUrl', { required: false, max: 1000 });
    if (proofUrl && !/^https:\/\//i.test(proofUrl)) fail(400, 'The proof must be an https link');
    if (c.judging === 'proof' && !proofUrl) fail(400, 'This challenge needs a photo or link as proof');
    const status = c.judging === 'proof' ? 'pending' : 'approved';
    const ref = await addDoc(collection(db, 'challenges', id, 'entries'), {
      userId: viewer.id,
      userName: viewer.name,
      sideKey: side.key,
      value,
      note: text(b.note, 'note', { required: false, max: 500 }),
      proofUrl,
      status,
      createdAt: serverTimestamp(),
    });
    return { id: ref.id, status, challenge: await summary(c, viewer) };
  }

  async function moderated(viewer, id) {
    const c = await loadChallenge(id);
    if (!canModerate(viewer, c)) fail(403, 'You do not have access to this');
    return c;
  }

  async function approve(viewer, id) {
    const c = await moderated(viewer, id);
    if (c.status !== 'pending_approval') fail(409, 'This challenge is not waiting for approval');
    const next = GROUP_SCOPES.includes(c.scope) ? 'active' : 'invited';
    const patch = { status: next, approvedBy: viewer.id };
    if (next === 'active') patch.responses = Object.fromEntries(c.keys.map((k) => [k, 'accepted']));
    const batch = writeBatch(db);
    batch.update(doc(db, 'challenges', id), patch);
    if (next === 'active') {
      logActivity(batch, 'challenge', `Challenge on: ${c.title}`, { challengeId: id });
      notifyAll(batch, await sidePeople(c), `It's on! ${c.title} has started`, id);
    } else {
      const pending = c.keys.filter((k) => (c.responses?.[k] ?? 'pending') === 'pending');
      notifyAll(batch, await sidePeople(c, pending), `${c.createdByName || 'Someone'} challenged you: ${c.title}`, id);
    }
    notifyAll(batch, [c.createdBy], `Your challenge "${c.title}" was approved`, id);
    await batch.commit();
    return summary({ ...c, ...patch }, viewer);
  }

  async function reject(viewer, id, b = {}) {
    const c = await moderated(viewer, id);
    if (!OPEN_STATUSES.includes(c.status)) fail(409, 'This challenge can no longer be rejected');
    const reason = text(b.reason, 'reason', { required: false, max: 300 });
    const batch = writeBatch(db);
    batch.update(doc(db, 'challenges', id), { status: 'rejected', rejectionReason: reason, approvedBy: viewer.id });
    notifyAll(batch, [c.createdBy], `Your challenge "${c.title}" was not approved${reason ? `: ${reason}` : ''}`, id);
    await batch.commit();
    return summary({ ...c, status: 'rejected', rejectionReason: reason }, viewer);
  }

  async function cancel(viewer, id) {
    const c = await loadChallenge(id);
    const own = c.createdBy === viewer.id && ['pending_approval', 'invited'].includes(c.status);
    if (!own && !canModerate(viewer, c)) fail(403, 'You cannot cancel this challenge');
    if (CLOSED.includes(c.status)) fail(409, 'This challenge is already closed');
    const batch = writeBatch(db);
    batch.update(doc(db, 'challenges', id), { status: 'cancelled' });
    notifyAll(batch, (await sidePeople(c)).filter((u) => u !== viewer.id), `${c.title} was cancelled`, id);
    await batch.commit();
    return summary({ ...c, status: 'cancelled' }, viewer);
  }

  async function review(viewer, id, entryId, b = {}) {
    await moderated(viewer, id);
    const decision = pick(b.decision, 'decision', ['approved', 'rejected']);
    const ref = doc(db, 'challenges', id, 'entries', entryId);
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().status !== 'pending') fail(404, 'No pending entry with that id');
    await updateDoc(ref, { status: decision });
    return { ok: true };
  }

  // Finish a challenge: pick the winner, hand out points and badges, tell everyone.
  // Runs in a transaction so two dashboards finishing at once can't pay out twice.
  async function settle(viewer, id, { winnerKey } = {}) {
    const first = await moderated(viewer, id);
    if (first.status !== 'active') fail(409, 'Only running challenges can be finished');
    const [entries, s] = await Promise.all([entriesOf(id), settings()]);
    forget();
    const people = await players();
    const result = await runTransaction(db, async (tx) => {
      const cSnap = await tx.get(doc(db, 'challenges', id));
      const c = { id, ...cSnap.data() };
      if (c.status !== 'active') fail(409, 'This challenge was already finished');
      // Who could be paid: re-read them inside the transaction for fresh points and streaks.
      const draft = settlePlan(c, entries, people, s, { winnerKey });
      const fresh = new Map(people.map((p) => [p.id, p]));
      for (const userId of Object.keys(draft.playerUpdates)) {
        const snap = await tx.get(doc(db, 'players', userId));
        if (snap.exists()) fresh.set(userId, { id: userId, ...snap.data() });
      }
      const plan = settlePlan(c, entries, [...fresh.values()], s, { winnerKey });
      const now = Timestamp.now();
      tx.update(doc(db, 'challenges', id), {
        status: 'completed',
        winners: plan.winners,
        summary: plan.summary,
        settledAt: now,
        settledBy: viewer.id,
      });
      for (const [userId, u] of Object.entries(plan.playerUpdates)) {
        const p = fresh.get(userId);
        const badges = { ...(p.badges || {}) };
        for (const nb of plan.newBadges.filter((x) => x.userId === userId)) badges[nb.code] = now;
        tx.update(doc(db, 'players', userId), {
          points: increment(u.pointsGained),
          record: u.record,
          streak: u.streak,
          finished: u.finished,
          badges,
        });
      }
      for (const a of plan.awards) {
        if (!a.amount) continue;
        const p = fresh.get(a.userId) || {};
        tx.set(doc(collection(db, 'points')), {
          userId: a.userId,
          amount: a.amount,
          reason: a.reason,
          challengeId: id,
          teamId: p.teamId ?? null,
          departmentId: p.departmentId ?? null,
          branchId: p.branchId ?? null,
          regionId: p.regionId ?? null,
          createdAt: now,
        });
      }
      const note = (userId, txt) =>
        tx.set(doc(collection(db, 'notifications')), { userId, text: txt, challengeId: id, read: false, createdAt: now });
      for (const userId of new Set(plan.outcomes.map((o) => o.userId))) note(userId, plan.summary);
      for (const nb of plan.newBadges) note(nb.userId, `You earned the ${BADGES[nb.code].name} badge`);
      tx.set(doc(collection(db, 'activity')), { kind: 'result', text: plan.summary, challengeId: id, userId: null, createdAt: serverTimestamp() });
      for (const nb of plan.newBadges) {
        tx.set(doc(collection(db, 'activity')), {
          kind: 'badge',
          text: `${fresh.get(nb.userId)?.name || 'Someone'} earned ${BADGES[nb.code].name}`,
          challengeId: null,
          userId: nb.userId,
          createdAt: serverTimestamp(),
        });
      }
      return { winners: plan.winners, draw: plan.draw, scores: plan.scores };
    });
    forget();
    return { ...result, challenge: await summary(await loadChallenge(id), viewer) };
  }

  // Finish every running challenge this person looks after whose end date has passed
  // (manager-judged ones wait for a manager to pick the winner).
  async function settleDue(viewer, now = new Date()) {
    if (!isStaffRole(viewer)) return [];
    const snap = await getDocs(query(collection(db, 'challenges'), where('status', '==', 'active')));
    const due = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((c) => c.judging !== 'manager' && c.endsAt.toMillis() <= now.getTime() && canModerate(viewer, c));
    const done = [];
    for (const c of due) {
      try {
        await settle(viewer, c.id);
        done.push(c.id);
      } catch (err) {
        if (err.status !== 409) console.error(`could not finish challenge ${c.id}:`, err.message);
      }
    }
    return done;
  }

  // --- Leaderboards and reports -------------------------------------------
  async function pointsSince(period) {
    if (period === 'all') return null;
    const since = Timestamp.fromDate(periodStart(period));
    const snap = await getDocs(query(collection(db, 'points'), where('createdAt', '>=', since)));
    return snap.docs.map((d) => d.data());
  }
  function inFilter(p, f) {
    return (
      p.active !== false &&
      (!f.regionId || p.regionId === f.regionId) &&
      (!f.branchId || p.branchId === f.branchId) &&
      (!f.departmentId || p.departmentId === f.departmentId)
    );
  }
  async function rankings(scope, period, filter = {}, viewer) {
    const people = (await players()).filter((p) => inFilter(p, filter));
    const ledger = (await pointsSince(period)) ?? people.map((p) => ({ userId: p.id, amount: p.points || 0 }));
    const rows = leaderboard(people, ledger, scope, { me: viewer });
    const names = new Map((await entityList(scope)).map((e) => [e.id, e.name]));
    const named = rows.map((r) => ({ ...r, name: names.get(r.id) || 'Unknown' }));
    named.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
    named.forEach((r, i) => (r.rank = i + 1));
    return named;
  }
  function staffFilter(viewer, q) {
    if (!isStaffRole(viewer)) fail(403, 'You do not have access to this');
    const f = { regionId: q.regionId || null, branchId: q.branchId || null, departmentId: q.departmentId || null };
    if (viewer.role === 'manager') f.departmentId = viewer.departmentId;
    return f;
  }
  async function activeEntries() {
    const snap = await getDocs(query(collection(db, 'challenges'), where('status', '==', 'active')));
    const lists = await Promise.all(snap.docs.map(async (d) => (await entriesOf(d.id)).map((e) => ({ ...e, challenge: { id: d.id, ...d.data() } }))));
    return lists.flat();
  }
  async function participation(userIds, period) {
    const ids = new Set(userIds);
    const ledger = (await pointsSince(period)) ?? (await all('points'));
    const since = periodStart(period).getTime();
    const who = new Set(ledger.filter((r) => ids.has(r.userId)).map((r) => r.userId));
    for (const e of await activeEntries()) {
      if (ids.has(e.userId) && (e.createdAt?.toMillis?.() ?? Date.now()) >= since) who.add(e.userId);
    }
    const points = ledger.filter((r) => ids.has(r.userId)).reduce((s, r) => s + r.amount, 0);
    return { participants: who.size, points, who };
  }

  function csvCell(v) {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // keep spreadsheet apps from running formulas
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // --- People (HR) ---------------------------------------------------------
  async function teamOrg(teamId) {
    const o = await org();
    const team = o.teams.find((t) => t.id === teamId) || fail(400, 'Unknown team');
    const branch = o.branches.find((b) => b.id === team.branchId) || fail(400, 'That team has no branch');
    return { teamId: team.id, departmentId: team.departmentId, branchId: team.branchId, regionId: branch.regionId };
  }

  // --- The router ----------------------------------------------------------
  async function api(path, { method = 'GET', body } = {}) {
    const [rawPath, qs = ''] = path.split('?');
    const q = Object.fromEntries(new URLSearchParams(qs));
    const { route, params } = matchRoute(method, rawPath);
    const viewer = await me();
    const id = params.id;

    switch (route) {
      case 'GET /me':
        return profile(viewer);
      case 'GET /profiles/:id': {
        const p = (await players()).find((x) => x.id === id) || fail(404, 'Person not found');
        return profile(p);
      }
      case 'GET /feed': {
        const mine = await listChallenges(viewer, { status: 'invited' });
        const invites = mine.filter((c) => c.myResponse === 'pending' && ['person', 'team'].includes(c.scope));
        const snap = await getDocs(collection(db, 'activity'));
        const activity = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
          .slice(0, 30)
          .map((a) => ({ id: a.id, kind: a.kind, text: a.text, challengeId: a.challengeId, createdAt: toIso(a.createdAt) }));
        return { me: await publicUser(viewer), invites, activity };
      }
      case 'GET /leaderboard': {
        const scope = pick(q.scope, 'scope', SCOPES, 'person');
        const period = pick(q.period, 'period', ['day', 'week', 'month', 'all'], 'week');
        const rows = await rankings(scope, period, {}, viewer);
        return rows.slice(0, 100).concat(rows.slice(100).filter((r) => r.me));
      }
      case 'GET /notifications': {
        const snap = await getDocs(query(collection(db, 'notifications'), where('userId', '==', viewer.id)));
        return snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0))
          .slice(0, 50)
          .map((n) => ({ id: n.id, text: n.text, challengeId: n.challengeId, read: !!n.read, createdAt: toIso(n.createdAt) }));
      }
      case 'POST /notifications/read': {
        const snap = await getDocs(query(collection(db, 'notifications'), where('userId', '==', viewer.id)));
        const unread = snap.docs.filter((d) => !d.data().read);
        for (let i = 0; i < unread.length; i += 400) {
          const batch = writeBatch(db);
          unread.slice(i, i + 400).forEach((d) => batch.update(d.ref, { read: true }));
          await batch.commit();
        }
        return { ok: true };
      }
      case 'POST /me/name': {
        await updateDoc(doc(db, 'players', viewer.id), { name: text(body?.name, 'name', { max: 60 }) });
        forget();
        return profile(await me());
      }

      case 'GET /challenges':
        return listChallenges(viewer, q);
      case 'POST /challenges':
        return createChallenge(viewer, body);
      case 'GET /challenges/targets': {
        const scope = pick(q.scope, 'scope', SCOPES);
        const needle = String(q.q || '').toLowerCase();
        const mine = viewer[scopeField(scope)];
        const targets = (await entityList(scope))
          .filter((e) => e.id !== mine && (!needle || e.name.toLowerCase().includes(needle)))
          .slice(0, 50)
          .map((e) => ({ id: e.id, name: e.name }));
        return { mine: { id: mine, name: await entityName(scope, mine) }, targets };
      }
      case 'GET /challenges/:id':
        return challengeDetail(viewer, id);
      case 'POST /challenges/:id/accept':
        return respond(viewer, id, true);
      case 'POST /challenges/:id/decline':
        return respond(viewer, id, false);
      case 'POST /challenges/:id/progress':
        return logProgress(viewer, id, body);
      case 'POST /challenges/:id/approve':
        return approve(viewer, id);
      case 'POST /challenges/:id/reject':
        return reject(viewer, id, body);
      case 'POST /challenges/:id/cancel':
        return cancel(viewer, id);
      case 'POST /challenges/:id/finish': {
        const w = body?.winnerSideId;
        return settle(viewer, id, { winnerKey: w === undefined ? undefined : w });
      }
      case 'POST /challenges/:id/entries/:entryId/review':
        return review(viewer, id, params.entryId, body);

      case 'GET /admin/org':
        return org();
      case 'GET /admin/settings':
        if (!isStaffRole(viewer)) fail(403, 'You do not have access to this');
        return settings();
      case 'PUT /admin/settings': {
        if (!isHR(viewer)) fail(403, 'Only HR can change settings');
        const b = body || {};
        const patch = {};
        if (b.approvalMode !== undefined) patch.approvalMode = pick(b.approvalMode, 'approvalMode', ['all', 'groups', 'none']);
        if (b.maxPeerPoints !== undefined) patch.maxPeerPoints = whole(b.maxPeerPoints, 'maxPeerPoints', { max: 100000 });
        if (b.participationPoints !== undefined) patch.participationPoints = whole(b.participationPoints, 'participationPoints', { max: 1000 });
        await setDoc(doc(db, 'settings/game'), patch, { merge: true });
        forget();
        return settings();
      }
      case 'GET /admin/overview': {
        const f = staffFilter(viewer, q);
        const people = (await players()).filter((p) => inFilter(p, f));
        const { participants, points } = await participation(people.map((p) => p.id), 'month');
        const open = (await getDocs(query(collection(db, 'challenges'), where('status', 'in', ['active', 'pending_approval'])))).docs.map((d) => ({ id: d.id, ...d.data() }));
        const visible = open.filter((c) => c.status === 'active' && (isHR(viewer) || canModerate(viewer, c) || c.official));
        return {
          employees: people.length,
          participants,
          participationRate: people.length ? Math.round((participants / people.length) * 100) : 0,
          activeChallenges: visible.length,
          activeOfficial: visible.filter((c) => c.official).length,
          pointsThisMonth: points,
          pendingApprovals: open.filter((c) => c.status === 'pending_approval' && canModerate(viewer, c)).length,
        };
      }
      case 'GET /admin/approvals': {
        if (!isStaffRole(viewer)) fail(403, 'You do not have access to this');
        const pending = (await getDocs(query(collection(db, 'challenges'), where('status', '==', 'pending_approval')))).docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((c) => canModerate(viewer, c));
        const entries = (await activeEntries())
          .filter((e) => e.status === 'pending' && canModerate(viewer, e.challenge))
          .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0))
          .map((e) => ({
            id: e.id,
            value: e.value,
            note: e.note || null,
            proofUrl: e.proofUrl || null,
            createdAt: toIso(e.createdAt),
            challengeId: e.challenge.id,
            challengeTitle: e.challenge.title,
            unit: e.challenge.unit || null,
            userName: e.userName,
          }));
        return { challenges: await Promise.all(pending.map((c) => summary(c, viewer, []))), entries };
      }
      case 'GET /admin/participation': {
        const f = staffFilter(viewer, q);
        const by = pick(q.by, 'by', ['team', 'department', 'branch', 'region'], 'department');
        const period = pick(q.period, 'period', ['day', 'week', 'month', 'all'], 'month');
        const people = (await players()).filter((p) => inFilter(p, f));
        const { who } = await participation(people.map((p) => p.id), period);
        const ledger = (await pointsSince(period)) ?? people.map((p) => ({ userId: p.id, amount: p.points || 0 }));
        const names = new Map((await entityList(by)).map((e) => [e.id, e.name]));
        const groups = new Map();
        for (const p of people) groups.set(p[scopeField(by)], [...(groups.get(p[scopeField(by)]) || []), p.id]);
        const rows = [...groups.entries()].map(([gid, ids]) => {
          const set = new Set(ids);
          const participants = ids.filter((x) => who.has(x)).length;
          const points = ledger.filter((r) => set.has(r.userId)).reduce((s, r) => s + r.amount, 0);
          return { id: gid, name: names.get(gid) || 'Unknown', members: ids.length, participants, points, rate: Math.round((participants / ids.length) * 100) };
        });
        rows.sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
        return rows;
      }
      case 'GET /admin/leaderboard': {
        const f = staffFilter(viewer, q);
        const scope = pick(q.scope, 'scope', SCOPES, 'person');
        const period = pick(q.period, 'period', ['day', 'week', 'month', 'all'], 'month');
        return (await rankings(scope, period, f)).slice(0, 200);
      }
      case 'GET /admin/export.csv': {
        const f = staffFilter(viewer, q);
        const period = pick(q.period, 'period', ['day', 'week', 'month', 'all'], 'month');
        const people = (await players()).filter((p) => inFilter(p, f)).sort(byName);
        const ledger = (await pointsSince(period)) ?? people.map((p) => ({ userId: p.id, amount: p.points || 0 }));
        const header = ['Name', 'Email', 'Team', 'Department', 'Branch', 'Region', 'Points', 'Won', 'Lost', 'Draw', 'Level'];
        const lines = [header.join(',')];
        for (const p of people) {
          const u = await publicUser(p);
          const pts = ledger.filter((r) => r.userId === p.id).reduce((s, r) => s + r.amount, 0);
          const rec = { won: 0, lost: 0, draw: 0, ...(p.record || {}) };
          lines.push([u.name, u.email, u.team.name, u.department.name, u.branch.name, u.region.name, pts, rec.won, rec.lost, rec.draw, u.level].map(csvCell).join(','));
        }
        return lines.join('\n');
      }
      case 'GET /admin/users': {
        const f = staffFilter(viewer, q);
        const needle = String(q.q || '').toLowerCase();
        const people = (await players())
          .filter((p) => (!f.regionId || p.regionId === f.regionId) && (!f.branchId || p.branchId === f.branchId) && (!f.departmentId || p.departmentId === f.departmentId))
          .filter((p) => !needle || p.name.toLowerCase().includes(needle) || (p.email || '').toLowerCase().includes(needle))
          .sort(byName);
        return Promise.all(people.slice(0, 500).map(publicUser));
      }
      case 'PATCH /admin/users/:id': {
        if (!isHR(viewer)) fail(403, 'Only HR can change people');
        if (id === viewer.id) fail(400, 'Ask another HR person to change your own account');
        const target = (await players()).find((p) => p.id === id) || fail(404, 'Person not found');
        const b = body || {};
        if (viewer.role !== 'admin' && (target.role === 'admin' || ['admin', 'hr'].includes(b.role))) {
          fail(403, 'Only admins can change HR or admin accounts');
        }
        const patch = {};
        if (b.name !== undefined) patch.name = text(b.name, 'name', { max: 60 });
        if (b.title !== undefined) patch.title = text(b.title, 'title', { required: false, max: 100 });
        if (b.role !== undefined) patch.role = pick(b.role, 'role', ROLES);
        if (b.active !== undefined) patch.active = !!b.active;
        if (b.teamId !== undefined) Object.assign(patch, await teamOrg(String(b.teamId)));
        if (b.password !== undefined) fail(400, 'Use "Send password reset email" to change a password');
        if (!Object.keys(patch).length) fail(400, 'Nothing to change');
        await updateDoc(doc(db, 'players', id), patch);
        forget();
        return publicUser({ ...target, ...patch });
      }
      case 'POST /admin/org/:kind':
      case 'PATCH /admin/org/:kind/:id':
        if (!ORG_KINDS[params.kind]) fail(404, 'Unknown kind');
        if (!isHR(viewer)) fail(403, 'Only HR can change the org chart');
        return saveOrg(params.kind, id || null, body);
      default:
        fail(404, `Unknown request ${method} ${rawPath}`);
    }
  }

  async function saveOrg(kind, existingId, b = {}) {
    const o = await org();
    const name = text(b.name, 'name', { max: 100 });
    const list = o[kind];
    if (list.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.id !== existingId)) fail(409, `${name} already exists`);
    if (existingId) {
      if (!list.some((x) => x.id === existingId)) fail(404, 'Not found');
      await updateDoc(doc(db, kind, existingId), { name });
      forget();
      return { id: existingId, name };
    }
    const data = { name };
    if (kind === 'branches') {
      data.regionId = String(b.regionId || '');
      if (!o.regions.some((r) => r.id === data.regionId)) fail(400, 'Unknown regionId');
    }
    if (kind === 'teams') {
      data.departmentId = String(b.departmentId || '');
      data.branchId = String(b.branchId || '');
      if (!o.departments.some((d) => d.id === data.departmentId)) fail(400, 'Unknown departmentId');
      if (!o.branches.some((x) => x.id === data.branchId)) fail(400, 'Unknown branchId');
    }
    const ref = await addDoc(collection(db, kind), data);
    forget();
    return { id: ref.id, name };
  }

  // --- Joining and setup (used before a player exists) ---------------------
  // Teams to pick from on the join screen (readable once signed in, even anonymously).
  async function joinOptions() {
    const o = await org();
    const dep = new Map(o.departments.map((d) => [d.id, d.name]));
    const br = new Map(o.branches.map((b) => [b.id, b.name]));
    return o.teams.map((t) => ({ id: t.id, name: t.name, department: dep.get(t.departmentId) || '', branch: br.get(t.branchId) || '' }));
  }
  async function hasPlayer() {
    if (!auth.currentUser) return false;
    return (await getDoc(doc(db, 'players', auth.currentUser.uid))).exists();
  }
  // An employee joins with just a name and their team.
  async function join({ name, teamId }) {
    const data = {
      name: text(name, 'name', { max: 60 }),
      role: 'employee',
      title: null,
      active: true,
      points: 0,
      started: 0,
      finished: 0,
      streak: 0,
      record: { won: 0, lost: 0, draw: 0 },
      badges: {},
      email: null,
      ...(await teamOrg(String(teamId))),
    };
    await setDoc(doc(db, 'players', uid()), data);
    forget();
    return profile({ id: uid(), ...data });
  }
  async function setupState() {
    const snap = await getDoc(doc(db, 'config/setup'));
    return { claimed: snap.exists() };
  }
  // The very first email account claims the app, creates a starting org chart and becomes admin.
  async function claimOwner({ name, company = 'Head office' }) {
    const me = uid();
    await setDoc(doc(db, 'config/setup'), { ownerUid: me, claimedAt: serverTimestamp() });
    const region = await addDoc(collection(db, 'regions'), { name: 'Main region' });
    const branch = await addDoc(collection(db, 'branches'), { name: text(company, 'company', { max: 100 }), regionId: region.id });
    const dept = await addDoc(collection(db, 'departments'), { name: 'Management' });
    const team = await addDoc(collection(db, 'teams'), { name: 'Management', departmentId: dept.id, branchId: branch.id });
    forget();
    const data = {
      name: text(name, 'name', { max: 60 }),
      role: 'admin',
      title: null,
      active: true,
      points: 0,
      started: 0,
      finished: 0,
      streak: 0,
      record: { won: 0, lost: 0, draw: 0 },
      badges: {},
      email: auth.currentUser.email || null,
      teamId: team.id,
      departmentId: dept.id,
      branchId: branch.id,
      regionId: region.id,
    };
    await setDoc(doc(db, 'players', me), data);
    return profile({ id: me, ...data });
  }
  // HR adds a staff (or employee) account whose sign-in was already created (see the dashboard).
  async function addPlayer(newUid, b = {}) {
    const viewer = await me();
    if (!isHR(viewer)) fail(403, 'Only HR can add people');
    const role = pick(b.role, 'role', ROLES, 'employee');
    if ((role === 'admin' || role === 'hr') && viewer.role !== 'admin') fail(403, 'Only admins can create HR or admin accounts');
    const data = {
      name: text(b.name, 'name', { max: 60 }),
      role,
      title: text(b.title, 'title', { required: false, max: 100 }),
      active: true,
      points: 0,
      started: 0,
      finished: 0,
      streak: 0,
      record: { won: 0, lost: 0, draw: 0 },
      badges: {},
      email: text(b.email, 'email', { max: 200 }).toLowerCase(),
      ...(await teamOrg(String(b.teamId))),
    };
    await setDoc(doc(db, 'players', newUid), data);
    forget();
    return publicUser({ id: newUid, ...data });
  }

  return { api, me, join, joinOptions, hasPlayer, setupState, claimOwner, addPlayer, settleDue, forget };
}
