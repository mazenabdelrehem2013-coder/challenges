import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  levelFor, playerKeys, sideScores, settlePlan, needsApproval, canModerate, leaderboard, periodStart, mySide,
} from '../shared/game.js';

const p = (id, name, teamId, departmentId, branchId, regionId, extra = {}) =>
  ({ id, name, teamId, departmentId, branchId, regionId, active: true, role: 'employee', points: 0, ...extra });

const players = [
  p('sara', 'Sara', 't1', 'design', 'cairo', 'north', { points: 50 }),
  p('omar', 'Omar', 't2', 'support', 'cairo', 'north', { points: 300 }),
  p('rana', 'Rana', 't1', 'design', 'cairo', 'north'),
  p('lina', 'Lina', 't3', 'design', 'alex', 'north'),
  p('karim', 'Karim', 't4', 'sales', 'alex', 'north'),
];

test('levels and keys', () => {
  assert.deepEqual(levelFor(0), { level: 1, levelName: 'Rookie', pointsToNext: 200, progress: 0 });
  assert.equal(levelFor(450).level, 3);
  assert.equal(levelFor(450).levelName, 'Contender');
  assert.deepEqual(playerKeys(players[0]), ['person:sara', 'team:t1', 'department:design', 'branch:cairo', 'region:north']);
});

test('groups score the exact total of their members, with each person listed', () => {
  const c = {
    scope: 'branch', status: 'active', judging: 'tracked', points: 200, title: 'Steps',
    sides: [{ key: 'branch:cairo', entityId: 'cairo', name: 'Cairo' }, { key: 'branch:alex', entityId: 'alex', name: 'Alexandria' }],
    responses: { 'branch:cairo': 'accepted', 'branch:alex': 'accepted' },
  };
  const entries = [
    { userId: 'sara', sideKey: 'branch:cairo', value: 7000, status: 'approved' },
    { userId: 'lina', sideKey: 'branch:alex', value: 2000, status: 'approved' },
    { userId: 'karim', sideKey: 'branch:alex', value: 1000, status: 'approved' },
    { userId: 'karim', sideKey: 'branch:alex', value: 9999, status: 'pending' },
  ];
  const [cairo, alex] = sideScores(c, entries, players);
  assert.equal(cairo.score, 7000);
  assert.equal(cairo.members, 3);
  assert.equal(alex.score, 3000);
  assert.deepEqual(alex.people.map((x) => [x.name, x.score]), [['Lina', 2000], ['Karim', 1000]]);

  const plan = settlePlan(c, entries, players, undefined);
  assert.deepEqual(plan.winners, ['branch:cairo']);
  assert.equal(plan.summary, 'Cairo beat Alexandria in "Steps"');
  // Only members who logged something take part: Sara wins 10 + 200, Lina and Karim get 10 each.
  assert.deepEqual(plan.awards.filter((a) => a.userId === 'sara').map((a) => a.amount), [10, 200]);
  assert.equal(plan.playerUpdates.lina.pointsGained, 10);
  assert.equal(plan.playerUpdates.rana, undefined);
  assert.ok(plan.newBadges.some((b) => b.userId === 'sara' && b.code === 'team_player'));
});

test('person challenges: giant slayer, draws and manager judging', () => {
  const c = {
    scope: 'person', status: 'active', judging: 'tracked', points: 100, title: 'Tickets',
    sides: [{ key: 'person:sara', entityId: 'sara', name: 'Sara' }, { key: 'person:omar', entityId: 'omar', name: 'Omar' }],
    responses: { 'person:sara': 'accepted', 'person:omar': 'accepted' },
  };
  const win = settlePlan(c, [{ userId: 'sara', sideKey: 'person:sara', value: 5, status: 'approved' }], players);
  assert.deepEqual(win.winners, ['person:sara']);
  assert.deepEqual(win.newBadges.filter((b) => b.userId === 'sara').map((b) => b.code).sort(), ['first_win', 'giant_slayer']);
  assert.equal(win.playerUpdates.omar.pointsGained, 10);
  assert.deepEqual(win.playerUpdates.omar.record, { won: 0, lost: 1, draw: 0 });
  assert.equal(mySide(c, players[1]).key, 'person:omar');

  const nobody = settlePlan(c, [], players);
  assert.equal(nobody.draw, true);
  assert.equal(nobody.summary, '"Tickets" ended in a draw');
  assert.equal(nobody.awards.reduce((s, a) => s + a.amount, 0), 20);

  const judged = { ...c, judging: 'manager' };
  assert.throws(() => settlePlan(judged, [], players), /must pick the winner/);
  assert.deepEqual(settlePlan(judged, [], players, undefined, { winnerKey: 'person:omar' }).winners, ['person:omar']);
});

test('streak badges build on the stored streak', () => {
  const hot = players.map((x) => (x.id === 'sara' ? { ...x, streak: 2, record: { won: 2, lost: 0, draw: 0 }, badges: { first_win: true } } : x));
  const c = {
    scope: 'person', status: 'active', judging: 'tracked', points: 50, title: 'Read',
    sides: [{ key: 'person:sara', entityId: 'sara', name: 'Sara' }, { key: 'person:rana', entityId: 'rana', name: 'Rana' }],
    responses: {},
  };
  const plan = settlePlan(c, [{ userId: 'sara', sideKey: 'person:sara', value: 1, status: 'approved' }], hot);
  assert.equal(plan.playerUpdates.sara.streak, 3);
  assert.deepEqual(plan.newBadges.filter((b) => b.userId === 'sara').map((b) => b.code), ['hat_trick']);
});

test('approval, moderation, leaderboards and periods', () => {
  assert.equal(needsApproval('branch'), true);
  assert.equal(needsApproval('person'), false);
  assert.equal(needsApproval('person', { approvalMode: 'all' }), true);
  const mgr = { role: 'manager', departmentId: 'design' };
  assert.equal(canModerate(mgr, { scope: 'team', creatorDepartmentId: 'design' }), true);
  assert.equal(canModerate(mgr, { scope: 'branch', creatorDepartmentId: 'design' }), false);
  assert.equal(canModerate({ role: 'hr' }, { scope: 'region' }), true);
  assert.equal(canModerate({ role: 'employee' }, { scope: 'person' }), false);

  const ledger = [{ userId: 'sara', amount: 40 }, { userId: 'lina', amount: 100 }, { userId: 'rana', amount: 70 }];
  const people = leaderboard(players, ledger, 'person', { me: players[0] });
  assert.deepEqual(people.slice(0, 3).map((r) => [r.id, r.score]), [['lina', 100], ['rana', 70], ['sara', 40]]);
  assert.equal(people.find((r) => r.id === 'sara').me, true);
  const branches = leaderboard(players, ledger, 'branch');
  assert.deepEqual(branches.map((r) => [r.id, r.score, r.members]), [['cairo', 110, 3], ['alex', 100, 2]]);

  const wed = new Date(2026, 9, 14, 15, 30);
  assert.equal(periodStart('day', wed).getDate(), 14);
  assert.equal(periodStart('week', wed).getDate(), 12);
  assert.equal(periodStart('month', wed).getDate(), 1);
  assert.equal(periodStart('all', wed).getTime(), 0);
});
