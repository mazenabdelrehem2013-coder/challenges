// Game rules shared by the phone app and the dashboard: scoring, levels, badges
// and the plan for finishing a challenge. Pure functions only (no Firebase), so
// both apps compute the same results. See ../RULES.md for the plain-language version.

export const SCOPES = ['person', 'team', 'department', 'branch', 'region'];
export const GROUP_SCOPES = ['department', 'branch', 'region'];
export const TYPES = ['fitness', 'learning', 'work', 'custom'];
export const JUDGING = ['tracked', 'proof', 'manager'];
export const STAFF_ROLES = ['manager', 'hr', 'admin'];
export const OPEN_STATUSES = ['pending_approval', 'invited', 'active'];

export const DEFAULT_SETTINGS = {
  // 'all': every peer challenge needs approval; 'groups': department, branch and region ones; 'none'.
  approvalMode: 'groups',
  // Most points an employee can put at stake in a challenge they create.
  maxPeerPoints: 500,
  // Points every participant gets just for finishing a challenge.
  participationPoints: 10,
};

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

export function levelFor(points = 0) {
  const p = Math.max(points, 0);
  const level = Math.floor(p / POINTS_PER_LEVEL) + 1;
  const levelName = LEVEL_TITLES.find(([min]) => level >= min)[1];
  const intoLevel = p % POINTS_PER_LEVEL;
  return { level, levelName, pointsToNext: POINTS_PER_LEVEL - intoLevel, progress: intoLevel / POINTS_PER_LEVEL };
}

// The org field on a player that matches a scope.
export function scopeField(scope) {
  return scope === 'person' ? 'id' : `${scope}Id`;
}

// "team:abc" style keys for every group a player belongs to. Challenges store the
// keys of their sides, so "my challenges" is one array-contains-any query.
export function sideKey(scope, entityId) {
  return `${scope}:${entityId}`;
}
export function playerKeys(player) {
  return SCOPES.map((s) => sideKey(s, player[scopeField(s)])).filter((k) => !k.endsWith(':undefined') && !k.endsWith(':null'));
}

export function membersOf(players, scope, entityId) {
  const f = scopeField(scope);
  return players.filter((p) => p.active !== false && p[f] === entityId);
}

// The side a player is on in a challenge, or null.
export function mySide(challenge, player) {
  if (!player) return null;
  const key = sideKey(challenge.scope, player[scopeField(challenge.scope)]);
  return challenge.sides.find((s) => s.key === key) || null;
}

export function liveSides(challenge) {
  return challenge.sides.filter((s) => (challenge.responses?.[s.key] ?? 'pending') !== 'declined');
}

const round = (n) => Math.round(n * 100) / 100;

// Current score of every side: the exact total of everything its people logged,
// with each member's exact score for groups.
export function sideScores(challenge, entries, players) {
  const approved = entries.filter((e) => e.status === 'approved');
  return liveSides(challenge).map((side) => {
    const members =
      challenge.scope === 'person'
        ? players.filter((p) => p.id === side.entityId)
        : membersOf(players, challenge.scope, side.entityId);
    const ids = new Set(members.map((m) => m.id));
    const byPerson = new Map(members.map((m) => [m.id, 0]));
    for (const e of approved) {
      if (e.sideKey === side.key && (ids.has(e.userId) || challenge.scope === 'person')) {
        byPerson.set(e.userId, (byPerson.get(e.userId) || 0) + Number(e.value));
      }
    }
    const people = [...byPerson.entries()]
      .map(([id, score]) => ({ id, name: players.find((p) => p.id === id)?.name ?? 'Someone', score: round(score) }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const total = round(people.reduce((s, p) => s + p.score, 0));
    return {
      key: side.key,
      entityId: side.entityId,
      name: side.name,
      response: challenge.responses?.[side.key] ?? 'pending',
      members: members.length,
      activeMembers: people.filter((p) => p.score > 0).length,
      score: total,
      people: challenge.scope === 'person' ? [] : people,
    };
  });
}

// Who takes part on a side: in a person challenge both people always count;
// in a group challenge, the members who logged something.
function participants(challenge, score) {
  if (challenge.scope === 'person') return [score.entityId];
  return score.people.filter((p) => p.score > 0).map((p) => p.id);
}

/**
 * Work out everything that happens when a challenge finishes, without writing anything.
 * winnerKey: for manager judging, the winning side's key, or null for a draw.
 * Returns { winners, draw, summary, awards: [{userId, amount, reason}], outcomes: [{userId, outcome}],
 *           playerUpdates: {userId: {points, record, streak, wins, finished, badges: {code: true}}}, newBadges: [{userId, code}] }.
 */
export function settlePlan(challenge, entries, players, settings = DEFAULT_SETTINGS, { winnerKey } = {}) {
  if (challenge.status !== 'active') throw new Error('Only running challenges can be finished');
  const scores = sideScores(challenge, entries, players);
  let winners;
  if (challenge.judging === 'manager') {
    if (winnerKey === undefined) throw new Error('A manager must pick the winner for this challenge');
    if (winnerKey !== null && !scores.some((s) => s.key === winnerKey)) throw new Error('The winner must be one of the sides');
    winners = winnerKey === null ? [] : [winnerKey];
  } else {
    const best = Math.max(...scores.map((s) => s.score), 0);
    winners = best > 0 ? scores.filter((s) => s.score === best).map((s) => s.key) : [];
  }
  const draw = winners.length !== 1;
  const byId = new Map(players.map((p) => [p.id, p]));
  const everyone = scores.flatMap((side) => participants(challenge, side).map((userId) => ({ userId, side })));

  const awards = [];
  const outcomes = [];
  for (const { userId, side } of everyone) {
    const outcome = draw ? 'draw' : winners.includes(side.key) ? 'won' : 'lost';
    outcomes.push({ userId, outcome });
    awards.push({ userId, amount: settings.participationPoints, reason: 'Finished a challenge' });
    if (outcome === 'won') awards.push({ userId, amount: challenge.points, reason: `Won "${challenge.title}"` });
    if (outcome === 'draw' && winners.includes(side.key)) {
      awards.push({ userId, amount: Math.floor(challenge.points / winners.length), reason: `Shared win in "${challenge.title}"` });
    }
  }

  const playerUpdates = {};
  const newBadges = [];
  for (const { userId, side } of everyone) {
    const p = byId.get(userId) || {};
    const outcome = outcomes.find((o) => o.userId === userId).outcome;
    const record = { won: 0, lost: 0, draw: 0, ...(p.record || {}) };
    record[outcome] += 1;
    const streak = outcome === 'won' ? (p.streak || 0) + 1 : 0;
    const finished = (p.finished || 0) + 1;
    const gained = awards.filter((a) => a.userId === userId).reduce((s, a) => s + a.amount, 0);
    const has = new Set(Object.keys(p.badges || {}));
    const earn = (code) => {
      if (!has.has(code)) {
        has.add(code);
        newBadges.push({ userId, code });
      }
    };
    if (record.won >= 1) earn('first_win');
    if (streak >= 3) earn('hat_trick');
    if (streak >= 7) earn('streak_master');
    if ((p.started || 0) >= 10) earn('challenger');
    if (finished >= 25) earn('marathoner');
    if (outcome === 'won' && challenge.scope !== 'person') earn('team_player');
    if (outcome === 'won' && challenge.scope === 'person') {
      const mine = p.points || 0;
      const beat = everyone.filter((e) => e.side.key !== side.key).some((e) => (byId.get(e.userId)?.points || 0) > mine);
      if (beat) earn('giant_slayer');
    }
    playerUpdates[userId] = { pointsGained: gained, record, streak, finished };
  }

  const winnerName = draw ? null : scores.find((s) => s.key === winners[0]).name;
  const losers = scores.filter((s) => !winners.includes(s.key)).map((s) => s.name);
  const summary = draw ? `"${challenge.title}" ended in a draw` : `${winnerName} beat ${losers.join(', ')} in "${challenge.title}"`;
  return { winners, draw, scores, summary, awards, outcomes, playerUpdates, newBadges };
}

// Whether a new peer challenge has to be approved before it starts.
export function needsApproval(scope, settings = DEFAULT_SETTINGS) {
  return settings.approvalMode === 'all' || (settings.approvalMode === 'groups' && GROUP_SCOPES.includes(scope));
}

// Managers look after challenges created in their own department, up to department level.
// Branch and region challenges belong to HR and admins.
export function canModerate(player, challenge) {
  if (!player) return false;
  if (player.role === 'hr' || player.role === 'admin') return true;
  if (player.role !== 'manager') return false;
  if (challenge.scope === 'branch' || challenge.scope === 'region') return false;
  return challenge.creatorDepartmentId === player.departmentId;
}

export function periodStart(period, now = new Date()) {
  const d = new Date(now);
  if (period === 'day') d.setHours(0, 0, 0, 0);
  else if (period === 'week') {
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  } else if (period === 'month') {
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
  } else return new Date(0);
  return d;
}

// Rank people or groups by points earned since a date. ledger: [{userId, amount, ...org ids}].
export function leaderboard(players, ledger, scope, { me } = {}) {
  const active = players.filter((p) => p.active !== false);
  const pts = new Map();
  for (const row of ledger) pts.set(row.userId, (pts.get(row.userId) || 0) + row.amount);
  const f = scopeField(scope);
  const groups = new Map();
  for (const p of active) {
    const id = p[f];
    if (!id) continue;
    const g = groups.get(id) || { id, total: 0, members: 0 };
    g.total += pts.get(p.id) || 0;
    g.members += 1;
    groups.set(id, g);
  }
  const rows = [...groups.values()].map((g) => ({ ...g, score: g.total }));
  rows.sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.me = me ? me[f] === r.id : false;
  });
  return rows;
}
