// Game rules: scoring, settling a finished challenge, points, levels and badges.
// See ../RULES.md for the plain-language version.
import { getSettings } from './db.js';
import { membersOf, entityName } from './org.js';

export const POINTS_PER_LEVEL = 200;

const LEVEL_TITLES = [
  [15, 'Legend'],
  [10, 'Champion'],
  [7, 'Challenger'],
  [5, 'Competitor'],
  [3, 'Contender'],
  [1, 'Rookie'],
];

export const BADGES = {
  first_win: { name: 'First win', description: 'Win your first challenge' },
  hat_trick: { name: 'Hat trick', description: 'Win 3 challenges in a row' },
  streak_master: { name: 'Streak master', description: 'Win 7 challenges in a row' },
  team_player: { name: 'Team player', description: 'Win a team, department, branch or region challenge' },
  giant_slayer: { name: 'Giant slayer', description: 'Beat someone with more points than you' },
  challenger: { name: 'Instigator', description: 'Start 10 challenges' },
  marathoner: { name: 'Marathoner', description: 'Finish 25 challenges' },
};

export function levelFor(points) {
  const level = Math.floor(Math.max(points, 0) / POINTS_PER_LEVEL) + 1;
  const title = LEVEL_TITLES.find(([min]) => level >= min)[1];
  const intoLevel = Math.max(points, 0) % POINTS_PER_LEVEL;
  return { level, levelName: title, pointsToNext: POINTS_PER_LEVEL - intoLevel, progress: intoLevel / POINTS_PER_LEVEL };
}

export function totalPoints(db, userId) {
  return db.prepare('SELECT COALESCE(SUM(amount), 0) AS p FROM points_ledger WHERE user_id = ?').get(userId).p;
}

export function awardPoints(db, userId, amount, reason, challengeId = null) {
  if (!amount) return;
  db.prepare('INSERT INTO points_ledger (user_id, amount, reason, challenge_id) VALUES (?, ?, ?, ?)').run(
    userId,
    amount,
    reason,
    challengeId
  );
}

export function notify(db, userIds, text, challengeId = null) {
  const stmt = db.prepare('INSERT INTO notifications (user_id, text, challenge_id) VALUES (?, ?, ?)');
  const tokens = [];
  for (const id of new Set(userIds)) {
    stmt.run(id, text, challengeId);
    const u = db.prepare('SELECT push_token FROM users WHERE id = ?').get(id);
    if (u?.push_token) tokens.push(u.push_token);
  }
  sendPush(tokens, text, challengeId);
}

function sendPush(tokens, body, challengeId) {
  if (!tokens.length || process.env.NODE_ENV === 'test' || process.env.DISABLE_PUSH) return;
  const messages = tokens.map((to) => ({ to, body, data: { challengeId } }));
  fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  }).catch((err) => console.error('push failed', err.message));
}

export function logActivity(db, kind, text, { challengeId = null, userId = null } = {}) {
  db.prepare('INSERT INTO activity (kind, text, challenge_id, user_id) VALUES (?, ?, ?, ?)').run(
    kind,
    text,
    challengeId,
    userId
  );
}

// Current score of every side: the exact total of everything its people logged.
// Groups also list each member's exact score.
export function sideScores(db, challenge) {
  const sides = db.prepare('SELECT * FROM challenge_sides WHERE challenge_id = ? ORDER BY id').all(challenge.id);
  const perPerson = db.prepare(
    `SELECT u.id, u.name, COALESCE(SUM(p.value), 0) AS score
     FROM users u LEFT JOIN progress_entries p
       ON p.user_id = u.id AND p.challenge_id = ? AND p.status = 'approved'
     WHERE u.id IN (SELECT value FROM json_each(?))
     GROUP BY u.id ORDER BY score DESC, u.name`
  );
  const round = (n) => Math.round(n * 100) / 100;
  return sides.map((side) => {
    const members = membersOf(db, challenge.scope, side.entity_id);
    const people = perPerson.all(challenge.id, JSON.stringify(members)).map((p) => ({ ...p, score: round(p.score) }));
    const total = people.reduce((sum, p) => sum + p.score, 0);
    const active = people.filter((p) => p.score > 0).length;
    return {
      sideId: side.id,
      entityId: side.entity_id,
      name: entityName(db, challenge.scope, side.entity_id),
      response: side.response,
      members: members.length,
      activeMembers: active,
      total: round(total),
      score: round(total),
      people: challenge.scope === 'person' ? [] : people,
    };
  });
}

function participantsOf(db, challenge, side) {
  if (challenge.scope === 'person') return [side.entityId];
  return db
    .prepare(
      `SELECT DISTINCT user_id FROM progress_entries
       WHERE challenge_id = ? AND status = 'approved' AND user_id IN (SELECT value FROM json_each(?))`
    )
    .all(challenge.id, JSON.stringify(membersOf(db, challenge.scope, side.entityId)))
    .map((r) => r.user_id);
}

// Finish a challenge: pick the winner, hand out points and badges, notify people.
// For 'manager' judging the winner must be passed in (winnerSideId, or null for a draw).
export function settleChallenge(db, challengeId, { winnerSideId } = {}) {
  const run = db.transaction(() => {
    const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(challengeId);
    if (!c) throw new GameError(404, 'Challenge not found');
    if (c.status !== 'active') throw new GameError(409, 'Only active challenges can be finished');

    const scores = sideScores(db, c);
    let winners;
    if (c.judging === 'manager') {
      if (winnerSideId === undefined) throw new GameError(400, 'A manager must pick the winner for this challenge');
      if (winnerSideId !== null && !scores.some((s) => s.sideId === winnerSideId)) {
        throw new GameError(400, 'Winner must be one of the sides');
      }
      winners = winnerSideId === null ? [] : [winnerSideId];
    } else {
      const best = Math.max(...scores.map((s) => s.score));
      winners = best > 0 ? scores.filter((s) => s.score === best).map((s) => s.sideId) : [];
    }
    const isDraw = winners.length !== 1;
    const settings = getSettings(db);
    const pointsBefore = new Map();
    const everyone = [];

    for (const side of scores) {
      for (const uid of participantsOf(db, c, side)) {
        pointsBefore.set(uid, totalPoints(db, uid));
        everyone.push({ uid, side });
      }
    }

    for (const { uid, side } of everyone) {
      const outcome = isDraw ? 'draw' : winners.includes(side.sideId) ? 'won' : 'lost';
      db.prepare('INSERT OR REPLACE INTO results (challenge_id, user_id, outcome) VALUES (?, ?, ?)').run(c.id, uid, outcome);
      awardPoints(db, uid, settings.participationPoints, 'Finished a challenge', c.id);
      if (outcome === 'won') awardPoints(db, uid, c.points, `Won "${c.title}"`, c.id);
      if (outcome === 'draw' && winners.includes(side.sideId)) {
        awardPoints(db, uid, Math.floor(c.points / winners.length), `Shared win in "${c.title}"`, c.id);
      }
    }

    db.prepare("UPDATE challenges SET status = 'completed', winner_side_id = ?, settled_at = datetime('now') WHERE id = ?").run(
      isDraw ? null : winners[0],
      c.id
    );

    const winnerName = isDraw ? null : scores.find((s) => s.sideId === winners[0]).name;
    const loserNames = scores.filter((s) => !winners.includes(s.sideId)).map((s) => s.name);
    const summary = isDraw
      ? `"${c.title}" ended in a draw`
      : `${winnerName} beat ${loserNames.join(', ')} in "${c.title}"`;
    logActivity(db, 'result', summary, { challengeId: c.id });
    notify(db, everyone.map((e) => e.uid), summary, c.id);

    for (const { uid, side } of everyone) {
      awardBadges(db, uid, {
        challenge: c,
        won: !isDraw && winners.includes(side.sideId),
        opponents: everyone.filter((e) => e.side.sideId !== side.sideId).map((e) => e.uid),
        pointsBefore,
      });
    }
    return { winners, scores, draw: isDraw };
  });
  return run();
}

function recentOutcomes(db, userId, n) {
  return db
    .prepare('SELECT outcome FROM results WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(userId, n)
    .map((r) => r.outcome);
}

export function winStreak(db, userId) {
  let streak = 0;
  for (const o of recentOutcomes(db, userId, 1000)) {
    if (o !== 'won') break;
    streak++;
  }
  return streak;
}

function grant(db, userId, badge) {
  const res = db.prepare('INSERT OR IGNORE INTO user_badges (user_id, badge) VALUES (?, ?)').run(userId, badge);
  if (res.changes) {
    const name = db.prepare('SELECT name FROM users WHERE id = ?').get(userId).name;
    logActivity(db, 'badge', `${name} earned ${BADGES[badge].name}`, { userId });
    notify(db, [userId], `You earned the ${BADGES[badge].name} badge`);
  }
}

export function awardBadges(db, userId, { challenge, won, opponents = [], pointsBefore } = {}) {
  const wins = db.prepare("SELECT COUNT(*) AS n FROM results WHERE user_id = ? AND outcome = 'won'").get(userId).n;
  const finished = db.prepare('SELECT COUNT(*) AS n FROM results WHERE user_id = ?').get(userId).n;
  const created = db.prepare('SELECT COUNT(*) AS n FROM challenges WHERE created_by = ?').get(userId).n;
  const streak = winStreak(db, userId);

  if (wins >= 1) grant(db, userId, 'first_win');
  if (streak >= 3) grant(db, userId, 'hat_trick');
  if (streak >= 7) grant(db, userId, 'streak_master');
  if (created >= 10) grant(db, userId, 'challenger');
  if (finished >= 25) grant(db, userId, 'marathoner');
  if (won && challenge && challenge.scope !== 'person') grant(db, userId, 'team_player');
  if (won && challenge?.scope === 'person' && pointsBefore) {
    const mine = pointsBefore.get(userId) ?? 0;
    if (opponents.some((o) => (pointsBefore.get(o) ?? 0) > mine)) grant(db, userId, 'giant_slayer');
  }
}

// Finish every active challenge whose end date has passed (except manager-judged ones).
export function settleDue(db, now = new Date()) {
  const due = db
    .prepare("SELECT id FROM challenges WHERE status = 'active' AND judging != 'manager' AND ends_at <= ?")
    .all(now.toISOString());
  const done = [];
  for (const { id } of due) {
    try {
      settleChallenge(db, id);
      done.push(id);
    } catch (err) {
      console.error(`could not settle challenge ${id}:`, err.message);
    }
  }
  return done;
}

export class GameError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
