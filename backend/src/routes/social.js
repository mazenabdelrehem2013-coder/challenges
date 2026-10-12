import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { SCOPES, scopeColumn, allEntities, entityOfUser, userOrg, entityName } from '../org.js';
import { BADGES, levelFor, totalPoints, winStreak } from '../game.js';
import { challengeSummary } from './challenges.js';
import { h, httpError, signToken, requireAuth, str, int, oneOf, periodStart, sqlTime } from '../http.js';

// Simple in-memory brute-force guard for the login endpoint.
const attempts = new Map();
function tooManyAttempts(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  attempts.set(key, list);
  return list.length >= 10;
}

export function authRouter(db) {
  const r = Router();
  r.post(
    '/login',
    h((req, res) => {
      const email = str(req.body?.email, 'email', { max: 200 }).toLowerCase();
      const password = str(req.body?.password, 'password', { max: 200 });
      const key = `${req.ip}|${email}`;
      if (tooManyAttempts(key)) throw httpError(429, 'Too many attempts, try again in 15 minutes');
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash)) {
        attempts.get(key).push(Date.now());
        throw httpError(401, 'Wrong email or password');
      }
      attempts.delete(key);
      res.json({ token: signToken(user), user: publicUser(db, user.id) });
    })
  );
  return r;
}

export function publicUser(db, id) {
  const u = db.prepare('SELECT id, name, email, role, title, team_id FROM users WHERE id = ?').get(id);
  if (!u) return null;
  const o = userOrg(db, id);
  const points = totalPoints(db, id);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    title: u.title,
    team: { id: o.team_id, name: entityName(db, 'team', o.team_id) },
    department: { id: o.department_id, name: entityName(db, 'department', o.department_id) },
    branch: { id: o.branch_id, name: entityName(db, 'branch', o.branch_id) },
    region: { id: o.region_id, name: entityName(db, 'region', o.region_id) },
    points,
    ...levelFor(points),
  };
}

export function profile(db, id) {
  const base = publicUser(db, id);
  if (!base) throw httpError(404, 'Person not found');
  const record = Object.fromEntries(
    db.prepare('SELECT outcome, COUNT(*) AS n FROM results WHERE user_id = ? GROUP BY outcome').all(id).map((r) => [r.outcome, r.n])
  );
  const earned = new Map(db.prepare('SELECT badge, awarded_at FROM user_badges WHERE user_id = ?').all(id).map((b) => [b.badge, b.awarded_at]));
  return {
    ...base,
    record: { won: record.won || 0, lost: record.lost || 0, draw: record.draw || 0 },
    streak: winStreak(db, id),
    badges: Object.entries(BADGES).map(([code, b]) => ({ code, ...b, earned: earned.has(code), awardedAt: earned.get(code) || null })),
  };
}

// Ranking at any scope by points earned in the period. Groups score the exact
// total of their members' points.
export function leaderboard(db, scope, period, filter = {}) {
  const since = sqlTime(periodStart(period));
  const pointsSince = db.prepare('SELECT user_id, SUM(amount) AS p FROM points_ledger WHERE created_at >= ? GROUP BY user_id').all(since);
  const pts = new Map(pointsSince.map((r) => [r.user_id, r.p]));
  const orgs = db.prepare('SELECT * FROM user_org WHERE active = 1').all();
  const inFilter = (o) =>
    (!filter.regionId || o.region_id === filter.regionId) &&
    (!filter.branchId || o.branch_id === filter.branchId) &&
    (!filter.departmentId || o.department_id === filter.departmentId);
  const col = scopeColumn(scope);
  const groups = new Map();
  for (const o of orgs.filter(inFilter)) {
    const g = groups.get(o[col]) || { total: 0, members: 0 };
    g.total += pts.get(o.user_id) || 0;
    g.members += 1;
    groups.set(o[col], g);
  }
  const names = new Map(allEntities(db, scope).map((e) => [e.id, e.name]));
  const rows = [...groups.entries()].map(([id, g]) => ({
    id,
    name: names.get(id) || `#${id}`,
    members: g.members,
    score: g.total,
  }));
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  rows.forEach((row, i) => (row.rank = i + 1));
  return rows;
}

export function socialRouter(db) {
  const r = Router();
  r.use(requireAuth(db));

  r.get('/me', h((req, res) => res.json(profile(db, req.user.id))));

  r.post(
    '/me/push-token',
    h((req, res) => {
      const token = str(req.body?.token, 'token', { required: false, max: 300 });
      db.prepare('UPDATE users SET push_token = ? WHERE id = ?').run(token, req.user.id);
      res.json({ ok: true });
    })
  );

  r.post(
    '/me/password',
    h((req, res) => {
      const current = str(req.body?.currentPassword, 'currentPassword', { max: 200 });
      const next = str(req.body?.newPassword, 'newPassword', { max: 200 });
      if (next.length < 8) throw httpError(400, 'The new password needs at least 8 characters');
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      if (!bcrypt.compareSync(current, row.password_hash)) throw httpError(400, 'Current password is wrong');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 10), req.user.id);
      res.json({ ok: true });
    })
  );

  r.get('/profiles/:id', h((req, res) => res.json(profile(db, int(req.params.id, 'id')))));

  r.get(
    '/feed',
    h((req, res) => {
      const o = req.user.org;
      const invites = db
        .prepare(
          `SELECT c.* FROM challenges c JOIN challenge_sides s ON s.challenge_id = c.id
           WHERE c.status = 'invited' AND s.response = 'pending' AND (
             (c.scope = 'person' AND s.entity_id = ?) OR (c.scope = 'team' AND s.entity_id = ?))
           ORDER BY c.created_at DESC`
        )
        .all(o.person_id, o.team_id)
        .map((c) => challengeSummary(db, req.user, c));
      const activity = db
        .prepare('SELECT id, kind, text, challenge_id AS challengeId, created_at AS createdAt FROM activity ORDER BY id DESC LIMIT 30')
        .all();
      res.json({ me: publicUser(db, req.user.id), invites, activity });
    })
  );

  r.get(
    '/leaderboard',
    h((req, res) => {
      const scope = oneOf(req.query.scope, 'scope', SCOPES, 'person');
      const period = oneOf(req.query.period, 'period', ['week', 'month', 'all'], 'week');
      const rows = leaderboard(db, scope, period);
      const mine = entityOfUser(db, req.user.id, scope);
      res.json(rows.slice(0, 100).concat(rows.slice(100).filter((x) => x.id === mine)).map((x) => ({ ...x, me: x.id === mine })));
    })
  );

  r.get(
    '/notifications',
    h((req, res) => {
      const rows = db
        .prepare('SELECT id, text, challenge_id AS challengeId, read, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50')
        .all(req.user.id);
      res.json(rows.map((n) => ({ ...n, read: !!n.read })));
    })
  );

  r.post(
    '/notifications/read',
    h((req, res) => {
      db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
      res.json({ ok: true });
    })
  );

  r.get(
    '/people',
    h((req, res) => {
      const q = `%${String(req.query.q || '').toLowerCase()}%`;
      const rows = db
        .prepare("SELECT id FROM users WHERE active = 1 AND id != ? AND (lower(name) LIKE ? OR lower(email) LIKE ?) ORDER BY name LIMIT 30")
        .all(req.user.id, q, q);
      res.json(rows.map((r) => publicUser(db, r.id)));
    })
  );

  return r;
}

