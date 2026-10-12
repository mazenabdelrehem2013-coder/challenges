import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getSettings, saveSettings } from '../db.js';
import { scopeColumn, allEntities } from '../org.js';
import { challengeSummary, canModerate } from './challenges.js';
import { publicUser, leaderboard } from './social.js';
import { h, httpError, requireAuth, requireRole, isStaff, ROLES, str, int, oneOf, periodStart, sqlTime } from '../http.js';

const ORG_KINDS = {
  regions: { table: 'regions', fields: [] },
  branches: { table: 'branches', fields: [['regionId', 'region_id', 'regions']] },
  departments: { table: 'departments', fields: [] },
  teams: { table: 'teams', fields: [['departmentId', 'department_id', 'departments'], ['branchId', 'branch_id', 'branches']] },
};

// Region / branch / department filter from the query; managers are always held to their department.
function orgFilter(req) {
  const f = {
    regionId: int(req.query.regionId, 'regionId', { required: false }),
    branchId: int(req.query.branchId, 'branchId', { required: false }),
    departmentId: int(req.query.departmentId, 'departmentId', { required: false }),
  };
  if (req.user.role === 'manager') f.departmentId = req.user.org.department_id;
  return f;
}

function filteredUsers(db, f) {
  return db
    .prepare('SELECT * FROM user_org WHERE active = 1')
    .all()
    .filter(
      (o) =>
        (!f.regionId || o.region_id === f.regionId) &&
        (!f.branchId || o.branch_id === f.branchId) &&
        (!f.departmentId || o.department_id === f.departmentId)
    );
}

function participationStats(db, userIds, since) {
  const ids = JSON.stringify(userIds);
  const participants = db
    .prepare(
      `SELECT DISTINCT user_id FROM progress_entries WHERE created_at >= ? AND user_id IN (SELECT value FROM json_each(?))
       UNION SELECT DISTINCT user_id FROM results WHERE created_at >= ? AND user_id IN (SELECT value FROM json_each(?))`
    )
    .all(since, ids, since, ids).length;
  const points = db
    .prepare('SELECT COALESCE(SUM(amount), 0) AS p FROM points_ledger WHERE created_at >= ? AND user_id IN (SELECT value FROM json_each(?))')
    .get(since, ids).p;
  return { participants, points };
}

function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // keep spreadsheet apps from running formulas
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function adminRouter(db) {
  const r = Router();
  r.use(requireAuth(db));

  // The org structure is readable by everyone (needed for pickers in the app).
  r.get(
    '/org',
    h((req, res) => {
      res.json({
        regions: db.prepare('SELECT id, name FROM regions ORDER BY name').all(),
        branches: db.prepare('SELECT id, name, region_id AS regionId FROM branches ORDER BY name').all(),
        departments: db.prepare('SELECT id, name FROM departments ORDER BY name').all(),
        teams: db.prepare('SELECT id, name, department_id AS departmentId, branch_id AS branchId FROM teams ORDER BY name').all(),
      });
    })
  );

  const staff = requireRole('hr', 'admin');
  const managers = requireRole('manager', 'hr', 'admin');

  for (const [kind, def] of Object.entries(ORG_KINDS)) {
    r.post(
      `/org/${kind}`,
      staff,
      h((req, res) => {
        const name = str(req.body?.name, 'name', { max: 100 });
        const values = [name];
        for (const [field, , table] of def.fields) {
          const id = int(req.body?.[field], field);
          if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) throw httpError(400, `Unknown ${field}`);
          values.push(id);
        }
        const cols = ['name', ...def.fields.map((f) => f[1])];
        try {
          const info = db
            .prepare(`INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
            .run(...values);
          res.status(201).json({ id: Number(info.lastInsertRowid), name });
        } catch (err) {
          if (String(err.message).includes('UNIQUE')) throw httpError(409, `${name} already exists`);
          throw err;
        }
      })
    );
    r.patch(
      `/org/${kind}/:id`,
      staff,
      h((req, res) => {
        const id = int(req.params.id, 'id');
        const name = str(req.body?.name, 'name', { max: 100 });
        const info = db.prepare(`UPDATE ${def.table} SET name = ? WHERE id = ?`).run(name, id);
        if (!info.changes) throw httpError(404, 'Not found');
        res.json({ id, name });
      })
    );
  }

  r.get(
    '/users',
    managers,
    h((req, res) => {
      const f = orgFilter(req);
      const q = String(req.query.q || '').toLowerCase();
      const ids = new Set(filteredUsers(db, f).map((o) => o.user_id));
      const rows = db
        .prepare('SELECT id, name, email, active FROM users ORDER BY name')
        .all()
        .filter((u) => ids.has(u.id) && (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)));
      res.json(rows.slice(0, 500).map((u) => publicUser(db, u.id)));
    })
  );

  r.post(
    '/users',
    staff,
    h((req, res) => {
      const b = req.body || {};
      const role = oneOf(b.role, 'role', ROLES, 'employee');
      if ((role === 'admin' || role === 'hr') && req.user.role !== 'admin') throw httpError(403, 'Only admins can create HR or admin accounts');
      const password = str(b.password, 'password', { max: 200 });
      if (password.length < 8) throw httpError(400, 'Password needs at least 8 characters');
      const teamId = int(b.teamId, 'teamId');
      if (!db.prepare('SELECT 1 FROM teams WHERE id = ?').get(teamId)) throw httpError(400, 'Unknown team');
      try {
        const info = db
          .prepare('INSERT INTO users (name, email, password_hash, role, title, team_id) VALUES (?, ?, ?, ?, ?, ?)')
          .run(
            str(b.name, 'name', { max: 100 }),
            str(b.email, 'email', { max: 200 }).toLowerCase(),
            bcrypt.hashSync(password, 10),
            role,
            str(b.title, 'title', { required: false, max: 100 }),
            teamId
          );
        res.status(201).json(publicUser(db, Number(info.lastInsertRowid)));
      } catch (err) {
        if (String(err.message).includes('UNIQUE')) throw httpError(409, 'That email is already registered');
        throw err;
      }
    })
  );

  r.patch(
    '/users/:id',
    staff,
    h((req, res) => {
      const id = int(req.params.id, 'id');
      const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (!target) throw httpError(404, 'Person not found');
      const b = req.body || {};
      if (req.user.role !== 'admin' && (target.role === 'admin' || ['admin', 'hr'].includes(b.role))) {
        throw httpError(403, 'Only admins can change HR or admin accounts');
      }
      const sets = [];
      const vals = [];
      if (b.name !== undefined) sets.push('name = ?') && vals.push(str(b.name, 'name', { max: 100 }));
      if (b.title !== undefined) sets.push('title = ?') && vals.push(str(b.title, 'title', { required: false, max: 100 }));
      if (b.role !== undefined) sets.push('role = ?') && vals.push(oneOf(b.role, 'role', ROLES));
      if (b.active !== undefined) sets.push('active = ?') && vals.push(b.active ? 1 : 0);
      if (b.teamId !== undefined) {
        const teamId = int(b.teamId, 'teamId');
        if (!db.prepare('SELECT 1 FROM teams WHERE id = ?').get(teamId)) throw httpError(400, 'Unknown team');
        sets.push('team_id = ?') && vals.push(teamId);
      }
      if (b.password !== undefined) {
        const pw = str(b.password, 'password', { max: 200 });
        if (pw.length < 8) throw httpError(400, 'Password needs at least 8 characters');
        sets.push('password_hash = ?') && vals.push(bcrypt.hashSync(pw, 10));
      }
      if (!sets.length) throw httpError(400, 'Nothing to change');
      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
      res.json(publicUser(db, id));
    })
  );

  r.get(
    '/overview',
    managers,
    h((req, res) => {
      const f = orgFilter(req);
      const users = filteredUsers(db, f);
      const since = sqlTime(periodStart('month'));
      const { participants, points } = participationStats(db, users.map((u) => u.user_id), since);
      const active = db.prepare("SELECT * FROM challenges WHERE status = 'active'").all();
      const visible = active.filter((c) => isStaff(req.user) || canModerate(db, req.user, c) || c.official);
      const pending = db.prepare("SELECT * FROM challenges WHERE status = 'pending_approval'").all().filter((c) => canModerate(db, req.user, c));
      res.json({
        employees: users.length,
        participants,
        participationRate: users.length ? Math.round((participants / users.length) * 100) : 0,
        activeChallenges: visible.length,
        activeOfficial: visible.filter((c) => c.official).length,
        pointsThisMonth: points,
        pendingApprovals: pending.length,
      });
    })
  );

  r.get(
    '/approvals',
    managers,
    h((req, res) => {
      const challenges = db
        .prepare("SELECT * FROM challenges WHERE status = 'pending_approval' ORDER BY created_at")
        .all()
        .filter((c) => canModerate(db, req.user, c))
        .map((c) => challengeSummary(db, req.user, c));
      const entries = db
        .prepare(
          `SELECT p.id, p.value, p.note, p.proof_url AS proofUrl, p.created_at AS createdAt, p.challenge_id AS challengeId,
                  c.title AS challengeTitle, c.unit, u.name AS userName
           FROM progress_entries p JOIN challenges c ON c.id = p.challenge_id JOIN users u ON u.id = p.user_id
           WHERE p.status = 'pending' ORDER BY p.created_at`
        )
        .all()
        .filter((e) => canModerate(db, req.user, db.prepare('SELECT * FROM challenges WHERE id = ?').get(e.challengeId)));
      res.json({ challenges, entries });
    })
  );

  r.get(
    '/participation',
    managers,
    h((req, res) => {
      const by = oneOf(req.query.by, 'by', ['team', 'department', 'branch', 'region'], 'department');
      const period = oneOf(req.query.period, 'period', ['week', 'month', 'all'], 'month');
      const since = sqlTime(periodStart(period));
      const users = filteredUsers(db, orgFilter(req));
      const col = scopeColumn(by);
      const names = new Map(allEntities(db, by).map((e) => [e.id, e.name]));
      const groups = new Map();
      for (const u of users) groups.set(u[col], [...(groups.get(u[col]) || []), u.user_id]);
      const rows = [...groups.entries()].map(([id, ids]) => {
        const s = participationStats(db, ids, since);
        return { id, name: names.get(id), members: ids.length, ...s, rate: Math.round((s.participants / ids.length) * 100) };
      });
      rows.sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
      res.json(rows);
    })
  );

  r.get(
    '/leaderboard',
    managers,
    h((req, res) => {
      const scope = oneOf(req.query.scope, 'scope', ['person', 'team', 'department', 'branch', 'region'], 'person');
      const period = oneOf(req.query.period, 'period', ['week', 'month', 'all'], 'month');
      res.json(leaderboard(db, scope, period, orgFilter(req)).slice(0, 200));
    })
  );

  r.get(
    '/export.csv',
    managers,
    h((req, res) => {
      const period = oneOf(req.query.period, 'period', ['week', 'month', 'all'], 'month');
      const since = sqlTime(periodStart(period));
      const users = filteredUsers(db, orgFilter(req));
      const header = ['Name', 'Email', 'Team', 'Department', 'Branch', 'Region', 'Points', 'Won', 'Lost', 'Draw', 'Progress entries'];
      const lines = [header.join(',')];
      for (const o of users) {
        const p = publicUser(db, o.user_id);
        const pts = db.prepare('SELECT COALESCE(SUM(amount),0) AS p FROM points_ledger WHERE user_id = ? AND created_at >= ?').get(o.user_id, since).p;
        const rec = Object.fromEntries(
          db.prepare('SELECT outcome, COUNT(*) AS n FROM results WHERE user_id = ? AND created_at >= ? GROUP BY outcome').all(o.user_id, since).map((x) => [x.outcome, x.n])
        );
        const entries = db.prepare('SELECT COUNT(*) AS n FROM progress_entries WHERE user_id = ? AND created_at >= ?').get(o.user_id, since).n;
        lines.push(
          [p.name, p.email, p.team.name, p.department.name, p.branch.name, p.region.name, pts, rec.won || 0, rec.lost || 0, rec.draw || 0, entries]
            .map(csvCell)
            .join(',')
        );
      }
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="challenges-report-${period}.csv"`);
      res.send(lines.join('\n'));
    })
  );

  r.get('/settings', managers, h((req, res) => res.json(getSettings(db))));

  r.put(
    '/settings',
    staff,
    h((req, res) => {
      const b = req.body || {};
      const patch = {};
      if (b.approvalMode !== undefined) patch.approvalMode = oneOf(b.approvalMode, 'approvalMode', ['all', 'groups', 'none']);
      if (b.maxPeerPoints !== undefined) patch.maxPeerPoints = int(b.maxPeerPoints, 'maxPeerPoints', { min: 0, max: 100000 });
      if (b.participationPoints !== undefined) patch.participationPoints = int(b.participationPoints, 'participationPoints', { min: 0, max: 1000 });
      res.json(saveSettings(db, patch));
    })
  );

  return r;
}

