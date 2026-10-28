// Versioned scoring policies (spec 6.1 and 8). A policy is never edited once approved:
// HR publishes a new version with a later effectiveFrom, and every period keeps the
// version it was calculated with.
import { dec, add, HUNDRED, toNumber } from './decimal.js';
import { ScoringError } from './kpi.js';
import { comparePeriods, assertPeriod } from './period.js';

export const ENGINE_VERSION = '1.0.0';

export const DEFAULT_POLICY = Object.freeze({
  id: 'default',
  name: 'Default scoring policy',
  version: 1,
  status: 'approved',
  effectiveFrom: '2026-01',
  // Individual Monthly Score = 80% KPI + 20% Challenge
  kpiShare: 80,
  challengeShare: 20,
  // Team Score = 70% Team KPI + 30% Team Challenge
  teamKpiShare: 70,
  teamChallengeShare: 30,
  // Decimal places for stored and displayed official scores.
  precision: 2,
  // When an employee had no eligible challenges this period, score them on KPIs alone
  // ('kpi_only') rather than penalising them with a 0 challenge score.
  whenNoChallenges: 'kpi_only',
  eligibility: Object.freeze({
    // Employees who started this many days or fewer before the period ends are "new starters":
    // scored, but left out of leaderboards and team averages.
    newStarterMinDays: 15,
    // Approved leave longer than this many days in the period leaves them out of rankings.
    maxLeaveDays: 10,
    // Days someone must be in a team during the period to count in its average.
    minDaysInTeam: 15,
    // Fewer eligible members than this and the team is not ranked.
    minTeamMembers: 3,
    // Share of eligible members (percent) who must take part in team challenges for the
    // team to be ranked.
    minChallengeParticipation: 50,
  }),
});

const SHARE_PAIRS = [
  ['kpiShare', 'challengeShare', 'individual'],
  ['teamKpiShare', 'teamChallengeShare', 'team'],
];

export function validatePolicy(p) {
  const errors = [];
  if (!p?.id) errors.push('A policy needs an id');
  if (!Number.isInteger(p?.version) || p.version < 1) errors.push('A policy needs a whole version number from 1');
  try {
    assertPeriod(p?.effectiveFrom);
  } catch {
    errors.push('effectiveFrom must be a month like 2026-11');
  }
  for (const [a, b, label] of SHARE_PAIRS) {
    let x;
    let y;
    try {
      x = dec(p[a]);
      y = dec(p[b]);
    } catch {
      errors.push(`The ${label} shares must be numbers`);
      continue;
    }
    if (x < 0n || y < 0n) errors.push(`The ${label} shares cannot be negative`);
    if (add(x, y) !== HUNDRED) errors.push(`The ${label} shares must total 100%, they total ${toNumber(add(x, y), 4)}%`);
  }
  if (!Number.isInteger(p?.precision) || p.precision < 0 || p.precision > 6) errors.push('precision must be 0 to 6 decimal places');
  if (!['kpi_only', 'zero'].includes(p?.whenNoChallenges)) errors.push('whenNoChallenges must be kpi_only or zero');
  return { ok: errors.length === 0, errors };
}

export function assertValidPolicy(p) {
  const { ok, errors } = validatePolicy(p);
  if (!ok) throw new ScoringError('invalid_policy', errors.join('; '), errors);
  return p;
}

/** The approved policy that applies to a period: the latest version effective on or before it. */
export function policyForPeriod(policies, period) {
  assertPeriod(period);
  const candidates = policies
    .filter((p) => p.status === 'approved' && comparePeriods(p.effectiveFrom, period) <= 0)
    .sort((a, b) => comparePeriods(b.effectiveFrom, a.effectiveFrom) || b.version - a.version);
  if (!candidates.length) throw new ScoringError('no_policy', `No approved scoring policy covers ${period}`);
  return candidates[0];
}

/**
 * Publish a new policy version. Approved versions are immutable; a change becomes a new
 * version, and it may not take effect in a period that is already finalized.
 */
export function publishPolicyVersion(existing, draft, { approvedBy, finalizedPeriods = [] }) {
  if (!approvedBy) throw new ScoringError('needs_approver', 'A policy needs an approver');
  if (draft.createdBy && draft.createdBy === approvedBy) {
    throw new ScoringError('self_approval', 'The person who drafted a policy cannot approve it');
  }
  const sameId = existing.filter((p) => p.id === draft.id);
  const version = Math.max(0, ...sameId.map((p) => p.version)) + 1;
  const next = { ...draft, version, status: 'approved', approvedBy };
  assertValidPolicy(next);
  const clash = finalizedPeriods.find((fp) => comparePeriods(fp, next.effectiveFrom) >= 0);
  if (clash) {
    throw new ScoringError('period_finalized', `${clash} is already finalized, so a new policy can only take effect after it`);
  }
  return Object.freeze({ ...next, eligibility: Object.freeze({ ...DEFAULT_POLICY.eligibility, ...next.eligibility }) });
}
