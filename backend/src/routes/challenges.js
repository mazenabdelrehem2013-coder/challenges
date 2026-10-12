import { Router } from 'express';
import { getSettings } from '../db.js';
import { SCOPES, GROUP_SCOPES, entityOfUser, entityExists, entityName, allEntities, membersOf } from '../org.js';
import { sideScores, settleChallenge, notify, logActivity } from '../game.js';
import { h, httpError, isStaff, isManagerOrAbove, str, int, num, oneOf, date } from '../http.js';

const TYPES = ['fitness', 'learning', 'work', 'custom'];
const JUDGING = ['tracked', 'proof', 'manager'];

export function getChallenge(db, id) {
  const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(id);
  if (!c) throw httpError(404, 'Challenge not found');
  return c;
}

// Managers look after challenges created in their own department, up to department level.
// Branch and region challenges, and everything else, belong to HR and admins.
export function canModerate(db, user, c) {
  if (isStaff(user)) return true;
  if (user.role !== 'manager') return false;
  if (c.scope === 'branch' || c.scope === 'region') return false;
  return entityOfUser(db, c.created_by, 'department') === user.org.department_id;
}

function mySide(db, user, c) {
  const entity = user.org[c.scope === 'person' ? 'person_id' : `${c.scope}_id`];
  return db.prepare('SELECT * FROM challenge_sides WHERE challenge_id = ? AND entity_id = ?').get(c.id, entity) || null;
}

function sideUsers(db, c) {
  const sides = db.prepare('SELECT entity_id FROM challenge_sides WHERE challenge_id = ?').all(c.id);
  return sides.flatMap((s) => membersOf(db, c.scope, s.entity_id));
}

export function challengeSummary(db, user, c) {
  const scores = sideScores(db, c);
  const side = mySide(db, user, c);
  const creator = db.prepare('SELECT id, name FROM users WHERE id = ?').get(c.created_by);
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    type: c.type,
    scope: c.scope,
    unit: c.unit,
    judging: c.judging,
    points: c.points,
    reward: c.reward,
    official: !!c.official,
    status: c.status,
    startsAt: c.starts_at,
    endsAt: c.ends_at,
    createdBy: creator,
    rejectionReason: c.rejection_reason,
    winnerSideId: c.winner_side_id,
    sides: scores,
    mySideId: side?.id ?? null,
    myResponse: side?.response ?? null,
    canModerate: canModerate(db, user, c),
  };
}

export default function challengesRouter(db) {
  const r = Router();

  r.get(
    '/',
    h((req, res) => {
      const { status, view = 'mine' } = req.query;
      const o = req.user.org;
      let rows;
      if (view === 'manage') {
        if (!isManagerOrAbove(req.user)) throw httpError(403, 'You do not have access to this');
        rows = db.prepare('SELECT * FROM challenges ORDER BY created_at DESC LIMIT 500').all();
        rows = rows.filter((c) => canModerate(db, req.user, c));
      } else {
        rows = db
          .prepare(
            `SELECT DISTINCT c.* FROM challenges c
             LEFT JOIN challenge_sides s ON s.challenge_id = c.id
             WHERE c.created_by = ?
                OR (c.scope = 'person' AND s.entity_id = ?)
                OR (c.scope = 'team' AND s.entity_id = ?)
                OR (c.scope = 'department' AND s.entity_id = ?)
                OR (c.scope = 'branch' AND s.entity_id = ?)
                OR (c.scope = 'region' AND s.entity_id = ?)
             ORDER BY c.ends_at DESC LIMIT 200`
          )
          .all(req.user.id, o.person_id, o.team_id, o.department_id, o.branch_id, o.region_id);
      }
      if (status) rows = rows.filter((c) => String(status).split(',').includes(c.status));
      res.json(rows.map((c) => challengeSummary(db, req.user, c)));
    })
  );

  // Who can be challenged at a scope (for the "challenge someone" picker).
  r.get(
    '/targets',
    h((req, res) => {
      const scope = oneOf(req.query.scope, 'scope', SCOPES);
      const q = String(req.query.q || '').toLowerCase();
      const mine = entityOfUser(db, req.user.id, scope);
      const list = allEntities(db, scope)
        .filter((e) => e.id !== mine && (!q || e.name.toLowerCase().includes(q)))
        .slice(0, 50);
      res.json({ mine: { id: mine, name: entityName(db, scope, mine) }, targets: list });
    })
  );

  r.post(
    '/',
    h((req, res) => {
      const b = req.body || {};
      const settings = getSettings(db);
      const official = !!b.official;
      if (official && !isManagerOrAbove(req.user)) throw httpError(403, 'Only managers and HR can create official challenges');

      const scope = oneOf(b.scope, 'scope', SCOPES);
      if (official && req.user.role === 'manager' && (scope === 'branch' || scope === 'region')) {
        throw httpError(403, 'Branch and region challenges are created by HR');
      }
      const startsAt = date(b.startsAt, 'startsAt', { required: false }) || new Date().toISOString();
      const endsAt = date(b.endsAt, 'endsAt');
      if (endsAt <= startsAt) throw httpError(400, 'The end date must be after the start date');
      const points = int(b.points ?? 100, 'points', { min: 0, max: official ? 100000 : settings.maxPeerPoints });

      // Work out the sides.
      let entities;
      if (official) {
        if (Array.isArray(b.sides) && b.sides.length) {
          entities = b.sides.map((id) => int(id, 'sides'));
        } else if (req.user.role === 'manager' && (scope === 'person' || scope === 'team')) {
          entities = allEntities(db, scope)
            .map((e) => e.id)
            .filter((id) =>
              scope === 'person'
                ? entityOfUser(db, id, 'department') === req.user.org.department_id
                : db.prepare('SELECT department_id FROM teams WHERE id = ?').get(id).department_id === req.user.org.department_id
            );
        } else if (req.user.role === 'manager' && scope === 'department') {
          throw httpError(400, 'Pick the departments taking part');
        } else {
          entities = allEntities(db, scope).map((e) => e.id);
        }
      } else {
        const opponents = Array.isArray(b.opponents) ? b.opponents.map((id) => int(id, 'opponents')) : [];
        if (!opponents.length) throw httpError(400, 'Pick who you are challenging');
        const mine = entityOfUser(db, req.user.id, scope);
        if (opponents.includes(mine)) throw httpError(400, 'You cannot challenge yourself');
        entities = [mine, ...opponents];
      }
      entities = [...new Set(entities)];
      if (entities.length < 2 && !(official && scope === 'person')) throw httpError(400, 'A challenge needs at least two sides');
      if (entities.length < 1) throw httpError(400, 'Nobody to challenge');
      for (const id of entities) if (!entityExists(db, scope, id)) throw httpError(400, `Unknown ${scope} ${id}`);

      const needsApproval =
        !official &&
        (settings.approvalMode === 'all' || (settings.approvalMode === 'groups' && GROUP_SCOPES.includes(scope)));
      const status = official ? 'active' : needsApproval ? 'pending_approval' : GROUP_SCOPES.includes(scope) ? 'active' : 'invited';

      const create = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO challenges (title, description, type, scope, unit, judging, points, reward, official, status, starts_at, ends_at, created_by, approved_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            str(b.title, 'title', { max: 120 }),
            str(b.description, 'description', { required: false, max: 2000 }),
            oneOf(b.type, 'type', TYPES, 'custom'),
            scope,
            str(b.unit, 'unit', { required: false, max: 40 }),
            oneOf(b.judging, 'judging', JUDGING, 'tracked'),
            points,
            str(b.reward, 'reward', { required: false, max: 200 }),
            official ? 1 : 0,
            status,
            startsAt,
            endsAt,
            req.user.id,
            official ? req.user.id : null
          );
        const id = Number(info.lastInsertRowid);
        const auto = official || status === 'active';
        const ins = db.prepare('INSERT INTO challenge_sides (challenge_id, entity_id, response) VALUES (?, ?, ?)');
        entities.forEach((e, i) => ins.run(id, e, auto || i === 0 ? 'accepted' : 'pending'));
        return id;
      });
      const id = create();
      const c = getChallenge(db, id);

      if (c.status === 'invited') {
        const invited = entities.slice(1).flatMap((e) => membersOf(db, scope, e));
        notify(db, invited, `${req.user.name} challenged you: ${c.title}`, id);
      } else if (c.status === 'active') {
        notify(db, sideUsers(db, c).filter((u) => u !== req.user.id), `New challenge: ${c.title}`, id);
        logActivity(db, 'challenge', `${official ? 'New official challenge' : 'New challenge'}: ${c.title}`, { challengeId: id, userId: req.user.id });
      }
      res.status(201).json(challengeSummary(db, req.user, c));
    })
  );

  r.get(
    '/:id',
    h((req, res) => {
      const c = getChallenge(db, int(req.params.id, 'id'));
      const summary = challengeSummary(db, req.user, c);
      const involved = summary.mySideId || c.created_by === req.user.id || summary.canModerate;
      if (!involved && !c.official) throw httpError(403, 'You are not part of this challenge');
      const entries = db
        .prepare(
          `SELECT p.id, p.value, p.note, p.proof_url AS proofUrl, p.status, p.created_at AS createdAt, u.id AS userId, u.name AS userName
           FROM progress_entries p JOIN users u ON u.id = p.user_id
           WHERE p.challenge_id = ? ORDER BY p.created_at DESC LIMIT 100`
        )
        .all(c.id);
      res.json({ ...summary, entries });
    })
  );

  function respond(req, res, accept) {
    const c = getChallenge(db, int(req.params.id, 'id'));
    if (c.status !== 'invited') throw httpError(409, 'This challenge is not waiting for an answer');
    const side = mySide(db, req.user, c);
    if (!side || side.response !== 'pending') throw httpError(403, 'There is nothing for you to answer here');

    if (accept) {
      db.prepare("UPDATE challenge_sides SET response = 'accepted' WHERE id = ?").run(side.id);
      const pending = db.prepare("SELECT COUNT(*) AS n FROM challenge_sides WHERE challenge_id = ? AND response = 'pending'").get(c.id).n;
      if (!pending) {
        db.prepare("UPDATE challenges SET status = 'active' WHERE id = ?").run(c.id);
        logActivity(db, 'challenge', `Challenge on: ${c.title}`, { challengeId: c.id });
        notify(db, sideUsers(db, c), `It's on! ${c.title} has started`, c.id);
      }
    } else {
      db.prepare('DELETE FROM challenge_sides WHERE id = ?').run(side.id);
      const left = db.prepare('SELECT COUNT(*) AS n FROM challenge_sides WHERE challenge_id = ?').get(c.id).n;
      if (left < 2) db.prepare("UPDATE challenges SET status = 'declined' WHERE id = ?").run(c.id);
      notify(db, [c.created_by], `${req.user.name} declined ${c.title}`, c.id);
    }
    res.json(challengeSummary(db, req.user, getChallenge(db, c.id)));
  }

  r.post('/:id/accept', h((req, res) => respond(req, res, true)));
  r.post('/:id/decline', h((req, res) => respond(req, res, false)));

  r.post(
    '/:id/progress',
    h((req, res) => {
      const c = getChallenge(db, int(req.params.id, 'id'));
      if (c.status !== 'active') throw httpError(409, 'This challenge is not running');
      const now = new Date().toISOString();
      if (now < c.starts_at) throw httpError(409, 'This challenge has not started yet');
      if (now > c.ends_at) throw httpError(409, 'This challenge has ended');
      if (!mySide(db, req.user, c)) throw httpError(403, 'You are not part of this challenge');
      const b = req.body || {};
      const value = num(b.value, 'value', { min: 0.0001, max: 1e9 });
      const proofUrl = str(b.proofUrl, 'proofUrl', { required: false, max: 1000 });
      if (proofUrl && !/^https:\/\//i.test(proofUrl)) throw httpError(400, 'proofUrl must be an https link');
      if (c.judging === 'proof' && !proofUrl) throw httpError(400, 'This challenge needs a photo or link as proof');
      const status = c.judging === 'proof' ? 'pending' : 'approved';
      const info = db
        .prepare('INSERT INTO progress_entries (challenge_id, user_id, value, note, proof_url, status) VALUES (?, ?, ?, ?, ?, ?)')
        .run(c.id, req.user.id, value, str(b.note, 'note', { required: false, max: 500 }), proofUrl, status);
      res.status(201).json({ id: Number(info.lastInsertRowid), status, challenge: challengeSummary(db, req.user, c) });
    })
  );

  r.post(
    '/:id/entries/:entryId/review',
    h((req, res) => {
      const c = getChallenge(db, int(req.params.id, 'id'));
      if (!canModerate(db, req.user, c)) throw httpError(403, 'You do not have access to this');
      const decision = oneOf(req.body?.decision, 'decision', ['approved', 'rejected']);
      const info = db
        .prepare("UPDATE progress_entries SET status = ? WHERE id = ? AND challenge_id = ? AND status = 'pending'")
        .run(decision, int(req.params.entryId, 'entryId'), c.id);
      if (!info.changes) throw httpError(404, 'No pending entry with that id');
      res.json({ ok: true });
    })
  );

  r.post(
    '/:id/approve',
    h((req, res) => {
      const c = getChallenge(db, int(req.params.id, 'id'));
      if (!canModerate(db, req.user, c)) throw httpError(403, 'You do not have access to this');
      if (c.status !== 'pending_approval') throw httpError(409, 'This challenge is not waiting for approval');
      const next = GROUP_SCOPES.includes(c.scope) ? 'active' : 'invited';
      db.prepare('UPDATE challenges SET status = ?, approved_by = ? WHERE id = ?').run(next, req.user.id, c.id);
      if (next === 'active') {
        db.prepare("UPDATE challenge_sides SET response = 'accepted' WHERE challenge_id = ?").run(c.id);
        logActivity(db, 'challenge', `Challenge on: ${c.title}`, { challengeId: c.id });
        notify(db, sideUsers(db, c), `It's on! ${c.title} has started`, c.id);
      } else {
        const invited = db
          .prepare("SELECT entity_id FROM challenge_sides WHERE challenge_id = ? AND response = 'pending'")
          .all(c.id)
          .flatMap((s) => membersOf(db, c.scope, s.entity_id));
        const creator = db.prepare('SELECT name FROM users WHERE id = ?').get(c.created_by).name;
        notify(db, invited, `${creator} challenged you: ${c.title}`, c.id);
      }
      notify(db, [c.created_by], `Your challenge "${c.title}" was approved`, c.id);
      res.json(challengeSummary(db, req.user, getChallenge(db, c.id)));
    })
  );

  r.post(
    '/:id/reject',
    h((req, res) => {
      const c = getChallenge(db, int(req.params.id, 'id'));
      if (!canModerate(db, req.user, c)) throw httpError(403, 'You do not have access to this');
      if (!['pending_approval', 'invited', 'active'].includes(c.status)) throw httpError(409, 'This challenge can no longer be rejected');
      const reason = str(req.body?.reason, 'reason', { required: false, max: 300 });
      db.prepare("UPDATE challenges SET status = 'rejected', rejection_reason = ?, approved_by = ? WHERE id = ?").run(reason, req.user.id, c.id);
      notify(db, [c.created_by], `Your challenge "${c.title}" was not approved${reason ? `: ${reason}` : ''}`, c.id);
      res.json(challengeSummary(db, req.user, getChallenge(db, c.id)));
    })
  );

  r.post(
    '/:id/cancel',
    h((req, res) => {
      const c = getChallenge(db, int(req.params.id, 'id'));
      const own = c.created_by === req.user.id && ['pending_approval', 'invited'].includes(c.status);
      if (!own && !canModerate(db, req.user, c)) throw httpError(403, 'You cannot cancel this challenge');
      if (['completed', 'rejected', 'declined', 'cancelled'].includes(c.status)) throw httpError(409, 'This challenge is already closed');
      db.prepare("UPDATE challenges SET status = 'cancelled' WHERE id = ?").run(c.id);
      notify(db, sideUsers(db, c).filter((u) => u !== req.user.id), `${c.title} was cancelled`, c.id);
      res.json(challengeSummary(db, req.user, getChallenge(db, c.id)));
    })
  );

  // Close a challenge now. Required for manager-judged challenges; optional otherwise.
  r.post(
    '/:id/finish',
    h((req, res) => {
      const c = getChallenge(db, int(req.params.id, 'id'));
      if (!canModerate(db, req.user, c)) throw httpError(403, 'You do not have access to this');
      const b = req.body || {};
      const winnerSideId = b.winnerSideId === null ? null : b.winnerSideId === undefined ? undefined : int(b.winnerSideId, 'winnerSideId');
      const result = settleChallenge(db, c.id, { winnerSideId });
      res.json({ ...result, challenge: challengeSummary(db, req.user, getChallenge(db, c.id)) });
    })
  );

  return r;
}
