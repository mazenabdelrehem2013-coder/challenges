// Monthly individual and team scores, and leaderboards (spec 6.1 and 8).
//   Individual Monthly Score = kpiShare% x KPI Score + challengeShare% x Challenge Score
//   Team Score = teamKpiShare% x Team KPI Score + teamChallengeShare% x Team Challenge Score
//   Team KPI Score = average of eligible members' normalized (0-100) KPI scores
// Every component is rounded to the policy's precision before it is combined, so a stored
// result can be re-derived exactly from its stored components.
import { dec, add, mul, div, round, toNumber, ZERO, HUNDRED } from './decimal.js';
import { kpiScore, ScoringError } from './kpi.js';
import { challengeScore } from './challenge.js';
import { employeeEligibility } from './eligibility.js';
import { assertValidPolicy } from './policy.js';
import { assertPeriod } from './period.js';

const weighted = (shareA, a, shareB, b) => div(add(mul(dec(shareA), a), mul(dec(shareB), b)), HUNDRED);

/** Individual monthly score from a KPI score and a challenge score (Decs or numbers). */
export function individualScore(policy, kpi, challenge) {
  assertValidPolicy(policy);
  const p = policy.precision;
  const k = round(toDec(kpi), p);
  if (challenge === null || challenge === undefined) {
    if (policy.whenNoChallenges === 'kpi_only') return { final: k, kpi: k, challenge: null, rule: 'kpi_only' };
    return { final: round(weighted(policy.kpiShare, k, policy.challengeShare, ZERO), p), kpi: k, challenge: ZERO, rule: 'zero' };
  }
  const c = round(toDec(challenge), p);
  return { final: round(weighted(policy.kpiShare, k, policy.challengeShare, c), p), kpi: k, challenge: c, rule: 'weighted' };
}

/** Team score from members' KPI scores (0-100 each) and the team challenge score. */
export function teamScore(policy, memberKpiScores, teamChallenge) {
  assertValidPolicy(policy);
  const p = policy.precision;
  if (!memberKpiScores.length) throw new ScoringError('empty_team', 'A team score needs at least one eligible member');
  const members = memberKpiScores.map((s) => round(toDec(s), p));
  const teamKpi = round(div(add(...members), dec(members.length)), p);
  if (teamChallenge === null || teamChallenge === undefined) {
    if (policy.whenNoChallenges === 'kpi_only') return { final: teamKpi, teamKpi, teamChallenge: null, rule: 'kpi_only' };
    return { final: round(weighted(policy.teamKpiShare, teamKpi, policy.teamChallengeShare, ZERO), p), teamKpi, teamChallenge: ZERO, rule: 'zero' };
  }
  const c = round(toDec(teamChallenge), p);
  return { final: round(weighted(policy.teamKpiShare, teamKpi, policy.teamChallengeShare, c), p), teamKpi, teamChallenge: c, rule: 'weighted' };
}

function toDec(x) {
  if (typeof x === 'bigint') return x;
  const d = dec(x);
  if (d < ZERO || d > HUNDRED) throw new ScoringError('out_of_range', `Scores must be 0 to 100, got ${x}`);
  return d;
}

/**
 * Calculate a whole period from stored data. Pure: same inputs, same outputs.
 * input: {
 *   period, policy, templates: { [id]: template },
 *   employees: [{ id, name, templateId, departmentId, branchId, roleId, status, startDate, endDate?, leaves? }],
 *   memberships: [{ employeeId, teamId, validFrom, validTo }],
 *   teams: [{ id, name, departmentId }],
 *   kpiResults: { [employeeId]: { [kpiId]: { actual, target?, status } } },
 *   exceptions: { [employeeId]: [{ kpiId, approvedBy, reason }] },
 *   assignments: [{ employeeId, challengeId, period, eligible, maxCredits, earnedCredits, status }],
 *   teamAssignments: [{ teamId, challengeId, period, maxCredits, earnedCredits, status, participants: [employeeId] }],
 *   mode: 'final' | 'provisional'
 * }
 */
export function calculatePeriod(input) {
  const { period, policy, templates, employees, memberships = [], teams = [], mode = 'provisional' } = input;
  assertPeriod(period);
  assertValidPolicy(policy);
  const p = policy.precision;
  const rules = policy.eligibility;

  const people = employees.map((e) => {
    const template = templates[e.templateId];
    const elig = employeeEligibility(e, memberships, period, rules);
    const base = {
      employeeId: e.id,
      name: e.name,
      departmentId: e.departmentId,
      branchId: e.branchId,
      roleId: e.roleId,
      teamId: elig.teamId,
      templateId: e.templateId,
      templateVersion: template?.version ?? null,
      eligibility: elig,
    };
    if (!template) return { ...base, status: 'incomplete', blockers: [{ reason: 'no KPI template' }] };
    const k = kpiScore(template, input.kpiResults?.[e.id] ?? {}, { exceptions: input.exceptions?.[e.id] ?? [], mode });
    const c = challengeScore((input.assignments ?? []).filter((a) => a.employeeId === e.id), period);
    if (!k.complete) {
      return { ...base, status: 'incomplete', blockers: k.blockers, kpiBreakdown: k.breakdown, challenge: summarizeChallenge(c, p) };
    }
    const s = individualScore(policy, k.score, c.score);
    return {
      ...base,
      status: mode === 'final' ? 'calculated' : 'provisional',
      kpiScore: toNumber(s.kpi, p),
      challengeScore: s.challenge === null ? null : toNumber(s.challenge, p),
      finalScore: toNumber(s.final, p),
      rule: s.rule,
      kpiBreakdown: k.breakdown,
      challenge: summarizeChallenge(c, p),
      blockers: [],
    };
  });

  const teamRows = teams.map((t) => {
    const all = people.filter((r) => r.teamId === t.id);
    const excluded = [];
    const eligible = [];
    for (const r of all) {
      const why = [...r.eligibility.reasons];
      if (r.eligibility.daysInTeam < rules.minDaysInTeam) why.push(`only ${r.eligibility.daysInTeam} days in the team`);
      if (r.status === 'incomplete') why.push('incomplete KPI data');
      if (why.length) excluded.push({ employeeId: r.employeeId, reasons: why });
      else eligible.push(r);
    }
    const base = { teamId: t.id, name: t.name, departmentId: t.departmentId, members: all.length, eligibleMembers: eligible.length, excluded };
    if (!eligible.length) return { ...base, status: 'incomplete', rankable: false, reasons: ['no eligible members'] };
    const shared = (input.teamAssignments ?? []).filter((a) => a.teamId === t.id && a.period === period);
    const tc = challengeScore(shared.map((a) => ({ ...a, eligible: true })), period);
    const s = teamScore(policy, eligible.map((r) => dec(r.kpiScore)), tc.score);
    const reasons = [];
    if (eligible.length < rules.minTeamMembers) reasons.push(`fewer than ${rules.minTeamMembers} eligible members`);
    if (shared.length) {
      const ids = new Set(eligible.map((r) => r.employeeId));
      const took = new Set(shared.flatMap((a) => a.participants ?? []).filter((id) => ids.has(id)));
      const pct = (took.size * 100) / eligible.length;
      if (pct < rules.minChallengeParticipation) reasons.push(`only ${Math.round(pct)}% took part in team challenges`);
    }
    return {
      ...base,
      status: mode === 'final' ? 'calculated' : 'provisional',
      rankable: reasons.length === 0,
      reasons,
      memberScores: eligible.map((r) => ({ employeeId: r.employeeId, name: r.name, kpiScore: r.kpiScore })),
      teamKpiScore: toNumber(s.teamKpi, p),
      teamChallengeScore: s.teamChallenge === null ? null : toNumber(s.teamChallenge, p),
      finalScore: toNumber(s.final, p),
      rule: s.rule,
      challenge: summarizeChallenge(tc, p),
    };
  });

  return { period, policyId: policy.id, policyVersion: policy.version, mode, employees: people, teams: teamRows };
}

function summarizeChallenge(c, p) {
  return { score: c.score === null ? null : toNumber(c.score, p), earned: c.earned, available: c.available, counted: c.counted };
}

/**
 * Rank rows within comparison groups (spec 8: never rank incomparable groups together).
 * rows: results with finalScore; groupBy: a field name ('roleId', 'departmentId', ...) or
 * null for one company-wide group. Ties share a rank (1, 1, 3). Only rankable, complete
 * rows are ranked. previous: { [id]: rank } for movement.
 */
export function rank(rows, { groupBy = null, idField = 'employeeId', previous = {} } = {}) {
  const ok = rows.filter((r) => r.finalScore !== undefined && r.finalScore !== null && (r.rankable ?? r.eligibility?.rankable) !== false);
  const groups = new Map();
  for (const r of ok) {
    const g = groupBy ? r[groupBy] ?? 'none' : 'all';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }
  const out = [];
  for (const [group, list] of groups) {
    list.sort((a, b) => b.finalScore - a.finalScore || String(a.name).localeCompare(String(b.name)));
    let lastScore = null;
    let lastRank = 0;
    list.forEach((r, i) => {
      const position = r.finalScore === lastScore ? lastRank : i + 1;
      lastScore = r.finalScore;
      lastRank = position;
      const before = previous[r[idField]];
      out.push({ ...r, group, rank: position, movement: before ? before - position : null });
    });
  }
  return out;
}


