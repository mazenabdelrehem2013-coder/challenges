// Scoring engine tests. Numbers follow the Raya spec (section 19); each test names the
// spec item it covers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dec, toNumber, toFixed, validateTemplate, achievement, kpiScore, overachievementBonus, DEFAULT_TEMPLATES,
  DEFAULT_POLICY, validatePolicy, policyForPeriod, publishPolicyVersion, individualScore, teamScore,
  challengeScore, verifiedCredits, isEligible, calculatePeriod, rank, assignmentForPeriod, employeeEligibility,
  Ledger, awardKey, assertWithinBudget, requestRedemption, refundRedemption, peerRecognitionPays,
  finalizePeriod, reproduce, correctPeriod, assertEditable, auditEntry, isCompleteAudit, AUDIT_FIELDS,
  can, assertCanReview, assertCanAssignRole, importKpiResults, setResultStatus, checkSubmission, suspicionFlags,
  periodBounds, periodOf, nextPeriod, previousPeriod, ScoringError,
} from '../shared/scoring/index.js';

const code = (c) => (e) => e instanceof ScoringError && e.code === c;
const n = (x, p = 2) => toNumber(x, p);
const approved = (actual, target) => ({ actual, target, status: 'approved' });

// --- The spec's worked examples -------------------------------------------------

test('spec example: individual 0.80 x 90 + 0.20 x 80 = 88', () => {
  const s = individualScore(DEFAULT_POLICY, 90, 80);
  assert.equal(toFixed(s.final, 2), '88.00');
  assert.equal(n(s.final), 88);
});

test('spec example: team KPI avg(90, 80, 85, 95) = 87.5, team 0.70 x 87.5 + 0.30 x 90 = 88.25', () => {
  const s = teamScore(DEFAULT_POLICY, [90, 80, 85, 95], 90);
  assert.equal(toFixed(s.teamKpi, 2), '87.50');
  assert.equal(toFixed(s.final, 2), '88.25');
  assert.equal(n(s.final), 88.25);
  // Weights that are not exact in binary floating point: 61.3375 + 26.91 = 88.2475, stored at
  // the policy's 2 decimal places (half-up) as 88.25, or 88.2475 at 4 places.
  const odd = { ...DEFAULT_POLICY, teamKpiShare: 70.1, teamChallengeShare: 29.9 };
  assert.equal(toFixed(teamScore(odd, [90, 80, 85, 95], 90).final, 4), '88.2500');
  assert.equal(toFixed(teamScore({ ...odd, precision: 4 }, [90, 80, 85, 95], 90).final, 4), '88.2475');
});

test('decimals are exact and round half-up', () => {
  assert.equal(toFixed(dec('0.1') + dec('0.2'), 2), '0.30');
  assert.equal(toFixed(dec('2.345'), 2), '2.35');
  assert.equal(toFixed(dec('-2.345'), 2), '-2.35');
  assert.equal(toFixed(dec(1e-7), 7), '0.0000001');
});

// --- 1, 2, 11: templates --------------------------------------------------------

test('1: every default department template totals exactly 100% and validates', () => {
  assert.equal(DEFAULT_TEMPLATES.length, 7);
  for (const t of DEFAULT_TEMPLATES) assert.deepEqual(validateTemplate(t), { ok: true, errors: [] }, t.id);
});

const simple = (weights, extra = {}) => ({
  id: 't', version: 1,
  kpis: weights.map((w, i) => ({ kpiId: `k${i}`, name: `K${i}`, weight: w, direction: 'higher', sourceType: 'import', target: 100, ...extra })),
});

test('2: weights under or over 100%, negative weights and missing pieces are rejected', () => {
  assert.match(validateTemplate(simple([30, 30, 30])).errors.join(), /total exactly 100%, they total 90%/);
  assert.match(validateTemplate(simple([50, 60])).errors.join(), /they total 110%/);
  assert.match(validateTemplate(simple([120, -20])).errors.join(), /negative weight/);
  assert.ok(validateTemplate(simple([33.33, 33.33, 33.34])).ok, 'decimal weights that total 100 exactly are fine');
  assert.ok(!validateTemplate(simple([33.33, 33.33, 33.33])).ok);
  assert.match(validateTemplate(simple([100], { direction: undefined })).errors.join(), /scoring direction/);
  assert.match(validateTemplate(simple([100], { sourceType: 'screenshot' })).errors.join(), /approved data source/);
  assert.match(validateTemplate(simple([100], { target: undefined })).errors.join(), /needs a target/);
  assert.match(validateTemplate(simple([100], { target: 0 })).errors.join(), /zero target needs an explicit zeroTarget rule/);
  assert.match(validateTemplate(simple([50, 50]).kpis.length && { kpis: [...simple([50]).kpis, ...simple([50]).kpis] }).errors.join(), /appears twice/);
  assert.throws(() => kpiScore(simple([90]), {}), code('invalid_template'));
});

test('11: different templates per department give different KPI scores for the same numbers', () => {
  const sales = DEFAULT_TEMPLATES.find((t) => t.id === 'sales');
  const it = DEFAULT_TEMPLATES.find((t) => t.id === 'it');
  const salesResults = {
    revenue: approved(90, 100), collections: approved(100, 100), dealer_coverage: approved(80, 100),
    sales_returns: approved(4, 2), teamwork: approved(4),
  };
  // 30x90 + 20x100 + 20x80 + 15x50 + 15x85 = 2700 + 2000 + 1600 + 750 + 1275 = 8325 -> 83.25
  assert.equal(n(kpiScore(sales, salesResults).score), 83.25);
  const itResults = {
    uptime: approved(99.9, 99.9), incident_resolution: approved(45, 50), sla: approved(95, 100),
    security: approved(100, 100), documentation: approved(7, 10),
  };
  // 25x100 + 25x90 + 20x95 + 20x100 + 10x70 = 2500 + 2250 + 1900 + 2000 + 700 = 9350 -> 93.5
  assert.equal(n(kpiScore(it, itResults).score), 93.5);
});

// --- 3 to 7: KPI achievement ----------------------------------------------------

const higher = { kpiId: 'h', direction: 'higher', target: 100 };
const lower = { kpiId: 'l', direction: 'lower', target: 2 };

test('3: higher is better: 90M of 100M scores 90, 120% caps at 100', () => {
  assert.equal(n(achievement(higher, { actual: 90_000_000, target: 100_000_000 }).score), 90);
  assert.equal(n(achievement(higher, { actual: 120, target: 100 }).score), 100);
  assert.equal(n(achievement(higher, { actual: 0, target: 100 }).score), 0);
});

test('4: lower is better: 100 x min(target / actual, 1)', () => {
  assert.equal(n(achievement(lower, { actual: 4 }).score), 50);
  assert.equal(n(achievement(lower, { actual: 1 }).score), 100);
  assert.equal(n(achievement(lower, { actual: 3 }).score), 66.67);
});

test('5: zero targets and zero actuals never divide by zero or invent a result', () => {
  assert.equal(n(achievement(lower, { actual: 0 }).score), 100, 'zero errors beats any positive target');
  assert.deepEqual(achievement({ ...higher, target: 0 }, { actual: 5 }), { score: null, reason: 'needs_rule' });
  assert.deepEqual(achievement({ ...lower, target: 0 }, { actual: 1 }), { score: null, reason: 'needs_rule' });
  const binary = { ...lower, target: 0, scoringRule: { zeroTarget: { mode: 'binary' } } };
  assert.equal(n(achievement(binary, { actual: 0 }).score), 100);
  assert.equal(n(achievement(binary, { actual: 1 }).score), 0);
  const decay = { ...lower, target: 0, scoringRule: { zeroTarget: { mode: 'decay', pointsPerUnit: 50 } } };
  assert.equal(n(achievement(decay, { actual: 1 }).score), 50);
  assert.equal(n(achievement(decay, { actual: 3 }).score), 0);
  assert.deepEqual(achievement(higher, { actual: -5 }), { score: null, reason: 'invalid' });
  assert.deepEqual(achievement(higher, { actual: 'abc' }), { score: null, reason: 'invalid' });
  assert.deepEqual(achievement({ ...higher, target: undefined }, { actual: 5 }), { score: null, reason: 'no_target' });
});

test('5: range and threshold KPIs', () => {
  const range = { direction: 'range', scoringRule: { min: 95, max: 105, tolerance: 10 } };
  assert.equal(n(achievement(range, { actual: 100 }).score), 100);
  assert.equal(n(achievement(range, { actual: 110 }).score), 50);
  assert.equal(n(achievement(range, { actual: 80 }).score), 0);
  const hard = { direction: 'range', scoringRule: { min: 95, max: 105 } };
  assert.equal(n(achievement(hard, { actual: 106 }).score), 0);
  const bands = { direction: 'threshold', scoringRule: { better: 'lower', bands: [{ atMost: 1, score: 100 }, { atMost: 3, score: 60 }] } };
  assert.equal(n(achievement(bands, { actual: 0.5 }).score), 100);
  assert.equal(n(achievement(bands, { actual: 2 }).score), 60);
  assert.equal(n(achievement(bands, { actual: 9 }).score), 0);
});

test('6: missing KPI data blocks the score instead of counting as 0 or 100', () => {
  const t = simple([60, 40]);
  for (const results of [{}, { k0: approved(80, 100) }, { k0: approved(80, 100), k1: { actual: 50, status: 'pending_data' } }]) {
    const r = kpiScore(t, results);
    assert.equal(r.complete, false);
    assert.equal(r.score, null);
    assert.ok(r.blockers.some((b) => b.kpiId === 'k1'));
  }
  // Available but not yet approved data: fine for a provisional score, not for a final one.
  const avail = { k0: approved(80, 100), k1: { actual: 50, target: 100, status: 'available' } };
  assert.equal(kpiScore(t, avail).complete, false);
  assert.equal(n(kpiScore(t, avail, { mode: 'provisional' }).score), 68);
  // Rejected data blocks both.
  assert.equal(kpiScore(t, { ...avail, k1: { ...avail.k1, status: 'rejected' } }, { mode: 'provisional' }).complete, false);
});

test('6: a documented exception excludes a KPI and rescales the rest; undocumented ones are refused', () => {
  const t = simple([60, 40]);
  const r = kpiScore(t, { k0: approved(80, 100) }, { exceptions: [{ kpiId: 'k1', approvedBy: 'hr1', reason: 'Source system outage' }] });
  assert.equal(r.complete, true);
  assert.equal(n(r.score), 80);
  assert.equal(r.breakdown.find((b) => b.kpiId === 'k0').effectiveWeight, 100);
  assert.equal(r.breakdown.find((b) => b.kpiId === 'k1').excluded, 'exception');
  assert.throws(() => kpiScore(t, {}, { exceptions: [{ kpiId: 'k1' }] }), code('invalid_exception'));
});

test('7: KPI scores are capped at 100; overachievement pays wallet points instead', () => {
  const t = simple([50, 50]);
  const r = kpiScore(t, { k0: approved(200, 100), k1: approved(150, 100) });
  assert.equal(n(r.score), 100);
  const rule = { pointsPerPercent: 5, maxPoints: 100 };
  assert.equal(overachievementBonus(higher, approved(110, 100), rule), 50);
  assert.equal(overachievementBonus(higher, approved(200, 100), rule), 100);
  assert.equal(overachievementBonus(higher, approved(90, 100), rule), 0);
  assert.equal(overachievementBonus(higher, { actual: 200, target: 100, status: 'available' }, rule), 0, 'only approved data pays');
});

// --- 8 to 10: challenge and monthly formulas -----------------------------------

const asg = (challengeId, maxCredits, earnedCredits, status = 'approved', extra = {}) =>
  ({ challengeId, period: '2026-10', maxCredits, earnedCredits, status, ...extra });

test('8: challenge score = earned / available eligible credits, capped at 100', () => {
  assert.equal(n(challengeScore([asg('a', 10, 10), asg('b', 20, 10), asg('c', 10, 0, 'submitted')], '2026-10').score), 50);
  assert.equal(n(challengeScore([asg('a', 10, 50)], '2026-10').score), 100, 'credits above the max are capped');
  assert.equal(n(challengeScore([asg('a', 10, 10), asg('b', 10, 10, 'approved', { eligible: false })], '2026-10').score), 100,
    'challenges that do not apply to the role are not counted against anyone');
  assert.equal(challengeScore([asg('a', 10, 10, 'approved', { period: '2026-09' })], '2026-10').score, null);
  assert.throws(() => verifiedCredits({ maxCredits: 10 }, 11), code('invalid_credits'));
  assert.equal(verifiedCredits({ maxCredits: 10 }, 10), 10);
  assert.ok(isEligible({ eligibility: { departmentIds: ['sales'] } }, { departmentId: 'sales' }));
  assert.ok(!isEligible({ eligibility: { departmentIds: ['sales'] } }, { departmentId: 'it' }));
});

test('9: individual monthly formula, and no penalty when no challenges applied', () => {
  assert.equal(n(individualScore(DEFAULT_POLICY, 100, 0).final), 80);
  assert.equal(n(individualScore(DEFAULT_POLICY, 0, 100).final), 20);
  assert.equal(n(individualScore(DEFAULT_POLICY, 75, null).final), 75);
  assert.equal(n(individualScore({ ...DEFAULT_POLICY, whenNoChallenges: 'zero' }, 75, null).final), 60);
  assert.throws(() => individualScore(DEFAULT_POLICY, 101, 50), code('out_of_range'));
});

test('10: team monthly formula uses each member\'s normalized score and shows them', () => {
  assert.equal(n(teamScore(DEFAULT_POLICY, [100, 100], 0).final), 70);
  assert.equal(n(teamScore(DEFAULT_POLICY, [70, 80], null).final), 75);
  assert.throws(() => teamScore(DEFAULT_POLICY, [], 50), code('empty_team'));
});

// --- Policies -------------------------------------------------------------------

test('policies are validated, versioned and picked by period; finalized periods keep theirs', () => {
  assert.ok(validatePolicy(DEFAULT_POLICY).ok);
  assert.match(validatePolicy({ ...DEFAULT_POLICY, kpiShare: 70 }).errors.join(), /individual shares must total 100%/);
  assert.match(validatePolicy({ ...DEFAULT_POLICY, teamChallengeShare: -30, teamKpiShare: 130 }).errors.join(), /cannot be negative/);
  const v2 = publishPolicyVersion([DEFAULT_POLICY], { ...DEFAULT_POLICY, kpiShare: 70, challengeShare: 30, effectiveFrom: '2026-12', createdBy: 'hr1' },
    { approvedBy: 'hr2', finalizedPeriods: ['2026-10'] });
  assert.equal(v2.version, 2);
  assert.ok(Object.isFrozen(v2));
  const all = [DEFAULT_POLICY, v2];
  assert.equal(policyForPeriod(all, '2026-11').version, 1);
  assert.equal(policyForPeriod(all, '2026-12').version, 2);
  assert.throws(() => policyForPeriod(all, '2025-12'), code('no_policy'));
  assert.throws(() => publishPolicyVersion(all, { ...DEFAULT_POLICY, effectiveFrom: '2026-10', createdBy: 'hr1' },
    { approvedBy: 'hr2', finalizedPeriods: ['2026-10'] }), code('period_finalized'));
  assert.throws(() => publishPolicyVersion(all, { ...DEFAULT_POLICY, effectiveFrom: '2027-01', createdBy: 'hr1' }, { approvedBy: 'hr1' }),
    code('self_approval'));
});

// --- 12, 13: transfers, new starters, leave ---------------------------------------

const memberships = [
  { employeeId: 'mo', teamId: 'east', validFrom: '2026-01-01', validTo: '2026-10-10' },
  { employeeId: 'mo', teamId: 'west', validFrom: '2026-10-11', validTo: null },
  { employeeId: 'sa', teamId: 'east', validFrom: '2026-01-01', validTo: '2026-10-20' },
  { employeeId: 'sa', teamId: 'west', validFrom: '2026-10-21', validTo: null },
];

test('12: a transfer counts for the team with most days in the period, history kept', () => {
  assert.equal(assignmentForPeriod(memberships, 'mo', '2026-10').teamId, 'west'); // 10 days east, 21 west
  assert.equal(assignmentForPeriod(memberships, 'sa', '2026-10').teamId, 'east'); // 20 east, 11 west
  assert.equal(assignmentForPeriod(memberships, 'mo', '2026-09').teamId, 'east');
  assert.equal(assignmentForPeriod(memberships, 'mo', '2025-12'), null);
});

test('13: new starters and long approved leave are scored but not ranked', () => {
  const rules = DEFAULT_POLICY.eligibility;
  const base = { id: 'mo', status: 'active', startDate: '2025-05-01' };
  assert.equal(employeeEligibility(base, memberships, '2026-10', rules).rankable, true);
  const newbie = employeeEligibility({ ...base, startDate: '2026-10-20' }, memberships, '2026-10', rules);
  assert.equal(newbie.rankable, false);
  assert.deepEqual(newbie.reasons, ['new starter']);
  assert.equal(employeeEligibility({ ...base, startDate: '2026-10-01' }, memberships, '2026-10', rules).rankable, true);
  const leave = employeeEligibility({ ...base, leaves: [{ from: '2026-09-25', to: '2026-10-14', approved: true }] }, memberships, '2026-10', rules);
  assert.equal(leave.leaveDays, 14);
  assert.equal(leave.rankable, false);
  assert.equal(employeeEligibility({ ...base, leaves: [{ from: '2026-10-01', to: '2026-10-30', approved: false }] }, memberships, '2026-10', rules).rankable, true,
    'unapproved leave changes nothing');
  assert.equal(employeeEligibility({ ...base, id: 'ghost' }, memberships, '2026-10', rules).reasons.includes('no team this period'), true);
});

// --- A whole period, ranking, finalizing and corrections ------------------------

const template = { id: 'ops', version: 3, kpis: [
  { kpiId: 'ontime', name: 'On time', weight: 60, direction: 'higher', sourceType: 'import', target: 100 },
  { kpiId: 'errors', name: 'Errors', weight: 40, direction: 'lower', sourceType: 'import', target: 2 },
] };
const emp = (id, name, extra = {}) => ({ id, name, templateId: 'ops', departmentId: 'ops', roleId: 'agent', status: 'active', startDate: '2025-01-01', ...extra });
const mem = (employeeId, teamId) => ({ employeeId, teamId, validFrom: '2025-01-01', validTo: null });
function periodInput() {
  return {
    period: '2026-10',
    policy: DEFAULT_POLICY,
    templates: { ops: template },
    teams: [{ id: 'alpha', name: 'Alpha', departmentId: 'ops' }, { id: 'beta', name: 'Beta', departmentId: 'ops' }],
    employees: [emp('a1', 'Amal'), emp('a2', 'Bassem'), emp('a3', 'Chirine'), emp('a4', 'Dina'), emp('b1', 'Emad'), emp('b2', 'Farah', { startDate: '2026-10-25' })],
    memberships: [mem('a1', 'alpha'), mem('a2', 'alpha'), mem('a3', 'alpha'), mem('a4', 'alpha'), mem('b1', 'beta'), mem('b2', 'beta')],
    // KPI scores: a1 90, a2 80, a3 85, a4 95 (errors at target, so ontime decides).
    kpiResults: Object.fromEntries([['a1', 90], ['a2', 80], ['a3', 85], ['a4', 95], ['b1', 70], ['b2', 100]].map(([id, v]) =>
      [id, { ontime: { actual: v, status: 'approved' }, errors: { actual: v >= 90 ? 1 : 2, status: 'approved' } }])),
    assignments: [
      { employeeId: 'a1', challengeId: 'quiz', period: '2026-10', maxCredits: 10, earnedCredits: 8, status: 'approved' },
    ],
    teamAssignments: [
      { teamId: 'alpha', challengeId: 'ontime_team', period: '2026-10', maxCredits: 20, earnedCredits: 18, status: 'approved', participants: ['a1', 'a2', 'a3'] },
    ],
  };
}

test('a full period: individual and team results from stored data, with the spec numbers', () => {
  const r = calculatePeriod(periodInput());
  const a1 = r.employees.find((e) => e.employeeId === 'a1');
  assert.equal(a1.kpiScore, 94); // 60x90 + 40x100 = 9400
  assert.equal(a1.challengeScore, 80);
  assert.equal(a1.finalScore, 91.2); // 0.8x94 + 0.2x80
  const alpha = r.teams.find((t) => t.teamId === 'alpha');
  // Members' KPI: 94, 88 (60x80+40x100), 91, 97
  assert.deepEqual(alpha.memberScores.map((m) => m.kpiScore), [94, 88, 91, 97]);
  assert.equal(alpha.teamKpiScore, 92.5);
  assert.equal(alpha.teamChallengeScore, 90);
  assert.equal(alpha.finalScore, 91.75); // 0.7x92.5 + 0.3x90
  assert.equal(alpha.rankable, true);
  const beta = r.teams.find((t) => t.teamId === 'beta');
  assert.equal(beta.eligibleMembers, 1, 'the new starter is left out of the team average');
  assert.equal(beta.rankable, false);
  assert.match(beta.reasons.join(), /fewer than 3 eligible members/);
});

test('team challenges with too little participation keep the team off the board', () => {
  const input = periodInput();
  input.teamAssignments[0].participants = ['a1'];
  const alpha = calculatePeriod(input).teams.find((t) => t.teamId === 'alpha');
  assert.equal(alpha.rankable, false);
  assert.match(alpha.reasons.join(), /only 25% took part/);
});

test('leaderboards rank within comparison groups, share ties and show movement', () => {
  const rows = [
    { employeeId: 'x', name: 'X', roleId: 'sales', finalScore: 90 },
    { employeeId: 'y', name: 'Y', roleId: 'sales', finalScore: 90 },
    { employeeId: 'z', name: 'Z', roleId: 'sales', finalScore: 70 },
    { employeeId: 'w', name: 'W', roleId: 'support', finalScore: 50 },
    { employeeId: 'v', name: 'V', roleId: 'support', finalScore: 99, eligibility: { rankable: false } },
  ];
  const ranked = rank(rows, { groupBy: 'roleId', previous: { z: 1 } });
  const by = Object.fromEntries(ranked.map((r) => [r.employeeId, r]));
  assert.deepEqual([by.x.rank, by.y.rank, by.z.rank, by.w.rank], [1, 1, 3, 1]);
  assert.equal(by.z.movement, -2);
  assert.equal(by.v, undefined, 'non-rankable people are not ranked');
});

test('14 and 20: finalizing freezes the month and it reproduces exactly', () => {
  const input = periodInput();
  assert.throws(() => finalizePeriod({ ...input, kpiResults: { ...input.kpiResults, a1: {} } }, { finalizedBy: 'hr1' }), code('incomplete'));
  const snap = finalizePeriod(input, { finalizedBy: 'hr1', finalizedAt: '2026-11-03T08:00:00Z' });
  assert.ok(Object.isFrozen(snap) && Object.isFrozen(snap.results.employees[0]));
  assert.throws(() => {
    snap.results.employees[0].finalScore = 100;
  }, TypeError);
  assert.equal(reproduce(snap).matches, true);
  // A newer policy does not change an old finalized month.
  input.policy = { ...DEFAULT_POLICY, kpiShare: 50, challengeShare: 50, version: 2 };
  assert.equal(reproduce(snap).matches, true);
  assert.equal(snap.input.policy.version, 1);
  assert.throws(() => assertEditable({ period: '2026-10', status: 'finalized' }), code('period_finalized'));
});

test('21 and 23: an appeal correction makes a new revision with a complete audit entry', () => {
  const snap = finalizePeriod(periodInput(), { finalizedBy: 'hr1', finalizedAt: '2026-11-03T08:00:00Z' });
  const { snapshot: next, audit } = correctPeriod(snap,
    { employeeId: 'a2', kpiResults: { ontime: { actual: 90 } }, reason: 'Appeal upheld: 10 deliveries were misattributed', approvedBy: 'hr2', appealId: 'ap1' },
    { at: '2026-11-10T09:00:00Z' });
  assert.equal(next.revision, 2);
  assert.equal(next.previousFingerprint, snap.fingerprint);
  assert.equal(snap.results.employees.find((e) => e.employeeId === 'a2').kpiScore, 88, 'the original is untouched');
  assert.equal(next.results.employees.find((e) => e.employeeId === 'a2').kpiScore, 94);
  assert.equal(next.input.kpiResults.a2.ontime.status, 'corrected');
  assert.ok(isCompleteAudit(audit));
  assert.deepEqual(Object.keys(audit).filter((k) => AUDIT_FIELDS.includes(k)).sort(), [...AUDIT_FIELDS].sort());
  assert.equal(audit.oldValues.kpiScore, 88);
  assert.equal(audit.newValues.kpiScore, 94);
  assert.equal(reproduce(next).matches, true);
  assert.throws(() => correctPeriod(snap, { employeeId: 'a2', reason: 'x', approvedBy: 'a2' }), code('self_approval'));
  assert.throws(() => correctPeriod(snap, { employeeId: 'a2', approvedBy: 'hr2' }), code('needs_reason'));
  assert.throws(() => auditEntry({ actorId: 'hr1', action: 'x', entityType: 'y', entityId: 'z' }), code('invalid_audit'));
});

// --- 14 to 17, 22: imports, duplicates, ledger, budgets ------------------------

test('14: importing the same KPI records twice changes nothing; reviewed data is never overwritten', () => {
  const rows = [
    { employeeId: 'a1', kpiId: 'ontime', period: '2026-10', actual: 90, sourceSystem: 'tms', sourceRef: 'R1' },
    { employeeId: 'a2', kpiId: 'ontime', period: '2026-10', actual: 80, sourceSystem: 'tms', sourceRef: 'R2' },
  ];
  const first = importKpiResults([], rows, { approvedSources: ['tms'] });
  assert.equal(first.inserted.length, 2);
  const again = importKpiResults(first.records, rows, { approvedSources: ['tms'] });
  assert.equal(again.inserted.length, 0);
  assert.equal(again.duplicates.length, 2);
  assert.equal(again.records.length, 2);
  const reviewed = again.records.map((r) => (r.sourceRef === 'R1' ? setResultStatus(r, 'approved', { actorId: 'mgr' }) : r));
  const changed = importKpiResults(reviewed, [{ ...rows[0], actual: 99, sourceRef: 'R1b' }]);
  assert.equal(changed.corrections.length, 1);
  assert.equal(changed.corrections[0].status, 'under_review');
  assert.equal(changed.records.find((r) => r.sourceRef === 'R1').status, 'approved');
  const bad = importKpiResults([], [{ ...rows[0], actual: '' }, { ...rows[0], sourceSystem: 'excel', sourceRef: 'X' }], { approvedSources: ['tms'] });
  assert.deepEqual(bad.rejected.map((r) => r.reason), ['missing or invalid actual', 'excel is not an approved source']);
  assert.throws(() => setResultStatus(rows[0], 'approved', { actorId: 'a1' }), code('self_approval'));
});

test('15: a second submission or reused evidence earns nothing more', () => {
  const existing = [{ assignmentId: 'as1', status: 'approved', evidenceHash: 'h1', submittedBy: 'a1' }];
  assert.equal(checkSubmission(existing, { assignmentId: 'as1', evidenceHash: 'h2' }).reason, 'already_submitted');
  assert.equal(checkSubmission(existing, { assignmentId: 'as2', evidenceHash: 'h1' }).reason, 'duplicate_evidence');
  assert.equal(checkSubmission([{ ...existing[0], status: 'rejected' }], { assignmentId: 'as1', evidenceHash: 'h1' }).ok, true);
  // Duplicate assignment rows for one challenge count once.
  assert.equal(n(challengeScore([asg('a', 10, 10), asg('a', 10, 10), asg('b', 10, 0, 'rejected')], '2026-10').score), 50);
});

test('16 and 17: the same award never pays twice; reversals are compensating transactions', () => {
  const ledger = new Ledger();
  const key = awardKey('certification', 'a1', 'certificate', 'C-77');
  const first = ledger.record({ employeeId: 'a1', eventType: 'certification', pointsDelta: 100, sourceType: 'certificate', sourceId: 'C-77', idempotencyKey: key, createdBy: 'job:lms' });
  const second = ledger.record({ employeeId: 'a1', eventType: 'certification', pointsDelta: 100, sourceType: 'certificate', sourceId: 'C-77', idempotencyKey: key, createdBy: 'job:lms' });
  assert.equal(second.duplicate, true);
  assert.equal(ledger.balance('a1'), 100);
  const rev = ledger.reverse(first.tx.id, { createdBy: 'hr1', reason: 'Certificate was revoked' });
  assert.equal(rev.tx.pointsDelta, -100);
  assert.equal(ledger.balance('a1'), 0);
  assert.equal(ledger.transactions.length, 2, 'nothing is deleted');
  assert.equal(ledger.reverse(first.tx.id, { createdBy: 'hr1', reason: 'again' }).duplicate, true, 'reversing twice is a no-op');
  assert.throws(() => ledger.reverse(rev.tx.id, { createdBy: 'hr1', reason: 'x' }), code('invalid_tx'));
  assert.throws(() => ledger.reverse(first.tx.id, { createdBy: 'hr1' }), code('needs_reason'));
  assert.throws(() => {
    ledger.transactions[0].pointsDelta = 1000;
  }, TypeError);
  assert.throws(() => new Ledger([first.tx, first.tx]), code('duplicate'));
  assert.throws(() => ledger.record({ employeeId: 'a1', eventType: 'certification', pointsDelta: 1.5, idempotencyKey: 'k', createdBy: 'x' }), code('invalid_tx'));
});

test('22: reward budgets, stock and balance limits; refunds on rejection', () => {
  const ledger = new Ledger();
  const award = (id, pts, at) => ledger.record({ employeeId: id, eventType: 'manual_award', pointsDelta: pts, idempotencyKey: `m:${id}:${at}`, createdBy: 'hr1', createdAt: at });
  award('a1', 300, '2026-10-02T00:00:00Z');
  award('a2', 500, '2026-10-03T00:00:00Z');
  const month = { fromIso: '2026-10-01T00:00:00Z', toIso: '2026-11-01T00:00:00Z' };
  assert.throws(() => assertWithinBudget(ledger, { points: 300, budget: 1000, ...month }), code('budget_exceeded'));
  assertWithinBudget(ledger, { points: 200, budget: 1000, ...month });
  let reward = { id: 'voucher', active: true, pointsCost: 250, inventory: 1 };
  const req = requestRedemption(ledger, reward, { employeeId: 'a1', requestId: 'r1' });
  reward = req.reward;
  assert.equal(reward.inventory, 0);
  assert.equal(ledger.balance('a1'), 50);
  assert.equal(requestRedemption(ledger, { ...reward, inventory: 1 }, { employeeId: 'a1', requestId: 'r1' }).duplicate, true, 'one request id redeems once');
  assert.throws(() => requestRedemption(ledger, reward, { employeeId: 'a2', requestId: 'r2' }), code('out_of_stock'));
  assert.throws(() => requestRedemption(ledger, { ...reward, inventory: 5, pointsCost: 900 }, { employeeId: 'a2', requestId: 'r3' }), code('insufficient_points'));
  refundRedemption(ledger, req.tx, { createdBy: 'hr1', reason: 'Out of vouchers' });
  assert.equal(ledger.balance('a1'), 300);
  // Peer recognition cap.
  for (let i = 0; i < 4; i++) ledger.record({ employeeId: 'a3', eventType: 'peer_recognition', pointsDelta: 25, idempotencyKey: `pr${i}`, createdBy: `p${i}`, createdAt: '2026-10-05T00:00:00Z' });
  assert.equal(peerRecognitionPays(ledger, 'a3', { cap: 4, ...month }), false);
  assert.equal(peerRecognitionPays(ledger, 'a3', { cap: 5, ...month }), true);
});

// --- 18, 19: permissions --------------------------------------------------------

test('18 and 19: employees cannot change scores; nobody approves their own work', () => {
  const employee = { id: 'a1', role: 'employee', departmentId: 'ops' };
  const manager = { id: 'm1', role: 'manager', departmentId: 'ops' };
  const otherManager = { id: 'm2', role: 'manager', departmentId: 'it' };
  const hr = { id: 'h1', role: 'hr' };
  const sysadmin = { id: 's1', role: 'sysadmin' };
  for (const action of ['result.correct', 'period.finalize', 'policy.publish', 'kpi.import']) {
    assert.equal(can(employee, action), false, action);
    assert.equal(can(manager, action), false, action);
    assert.equal(can(sysadmin, action), false, `sysadmin is technical only: ${action}`);
    assert.equal(can(hr, action), true, action);
  }
  assert.equal(can({ ...hr, status: 'inactive' }, 'period.finalize'), false);
  const submission = { submittedBy: 'a1' };
  assertCanReview(manager, submission, { id: 'a1', departmentId: 'ops' });
  assert.throws(() => assertCanReview(manager, { submittedBy: 'm1' }, { id: 'm1', departmentId: 'ops' }), code('self_approval'));
  assert.throws(() => assertCanReview(otherManager, submission, { id: 'a1', departmentId: 'ops', managerId: 'm1' }), code('forbidden'));
  assert.throws(() => assertCanReview(employee, submission, { id: 'a1' }), code('forbidden'));
  assert.throws(() => assertCanAssignRole(hr, hr, 'sysadmin'), code('self_approval'));
  assertCanAssignRole(sysadmin, employee, 'manager');
});

// --- Suspicious activity ---------------------------------------------------------

test('suspicious patterns are flagged for review', () => {
  const subs = Array.from({ length: 7 }, (_, i) => ({ submittedBy: 'a1', submittedAt: `2026-10-05T0${i}:00:00Z`, evidenceHash: `h${i}` }));
  subs.push({ submittedBy: 'a2', submittedAt: '2026-10-06', evidenceHash: 'h1' });
  const flags = suspicionFlags({
    submissions: subs,
    scores: [{ employeeId: 'a3', period: '2026-10', kpiScore: 95, previousKpiScore: 50 }],
    nominations: Array.from({ length: 6 }, () => ({ nominatorId: 'm1', period: '2026-10' })),
  });
  assert.deepEqual(flags.map((f) => f.type).sort(), ['duplicate_evidence', 'excessive_nominations', 'implausible_jump', 'submission_spike']);
});

// --- 24: periods and timezones ---------------------------------------------------

test('24: monthly periods follow the organization timezone', () => {
  const cairo = periodBounds('2026-10', 'Africa/Cairo');
  // Egypt is UTC+3 in October 2026 (summer time ends the last Thursday of October).
  assert.equal(cairo.start.toISOString(), '2026-09-30T21:00:00.000Z');
  assert.equal(cairo.end.toISOString(), '2026-10-31T22:00:00.000Z');
  assert.equal(periodBounds('2026-10').start.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(periodBounds('2026-12', 'Asia/Riyadh').end.toISOString(), '2026-12-31T21:00:00.000Z');
  // 23:30 UTC on 31 Oct is already November in Cairo.
  assert.equal(periodOf('2026-10-31T23:30:00Z', 'Africa/Cairo'), '2026-11');
  assert.equal(periodOf('2026-10-31T23:30:00Z', 'UTC'), '2026-10');
  assert.equal(nextPeriod('2026-12'), '2027-01');
  assert.equal(previousPeriod('2026-01'), '2025-12');
  assert.throws(() => periodBounds('2026-13'), code('invalid_period'));
});
