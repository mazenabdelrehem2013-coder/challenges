// Challenge Score (spec 6.6 and 6.7).
//   Challenge Score = 100 x earned eligible credits / available eligible credits, capped at 100.
// Credits come only from verified records of challenges assigned to the employee for the
// period; the client never supplies a score.
import { dec, add, div, mul, min, clamp, ZERO, HUNDRED, toNumber } from './decimal.js';
import { ScoringError } from './kpi.js';

// Assignment statuses whose credits count. 'approved' = evidence approved by a reviewer
// (or verified from a source system); everything else earns 0 but still counts as available.
export const CREDITED_STATUSES = ['approved', 'verified'];

/**
 * assignments: [{ challengeId, period, eligible, maxCredits, earnedCredits, status }]
 * Only assignments for `period` with eligible !== false count. Duplicate assignments of the
 * same challenge count once (the best verified one), so re-submitting earns nothing extra.
 * Returns { score: Dec|null, earned, available, counted: [...] }. score is null when nothing
 * was available (the policy decides what that means).
 */
export function challengeScore(assignments, period) {
  const best = new Map();
  for (const a of assignments) {
    if (a.period !== period || a.eligible === false) continue;
    const maxCredits = dec(a.maxCredits);
    if (maxCredits <= ZERO) throw new ScoringError('invalid_challenge', `Challenge ${a.challengeId} has no credits`);
    const earnedRaw = CREDITED_STATUSES.includes(a.status) ? dec(a.earnedCredits ?? 0) : ZERO;
    if (earnedRaw < ZERO) throw new ScoringError('invalid_credits', `Negative credits on ${a.challengeId}`);
    const earned = min(earnedRaw, maxCredits);
    const prev = best.get(a.challengeId);
    if (!prev || earned > prev.earned) best.set(a.challengeId, { challengeId: a.challengeId, maxCredits, earned });
  }
  const counted = [...best.values()];
  const available = add(...counted.map((c) => c.maxCredits));
  const earned = add(...counted.map((c) => c.earned));
  if (available === ZERO) return { score: null, earned: 0, available: 0, counted: [] };
  const score = clamp(mul(HUNDRED, div(earned, available)), ZERO, HUNDRED);
  return {
    score,
    earned: toNumber(earned, 4),
    available: toNumber(available, 4),
    counted: counted.map((c) => ({ challengeId: c.challengeId, maxCredits: toNumber(c.maxCredits, 4), earned: toNumber(c.earned, 4) })),
  };
}

/**
 * Whether a challenge applies to an employee (frozen eligibility config).
 * eligibility: { departmentIds?, teamIds?, roleIds?, branchIds? } — empty means everyone.
 */
export function isEligible(challenge, employee) {
  const e = challenge.eligibility || {};
  const checks = [
    ['departmentIds', employee.departmentId],
    ['teamIds', employee.teamId],
    ['roleIds', employee.roleId],
    ['branchIds', employee.branchId],
  ];
  return checks.every(([k, v]) => !e[k]?.length || e[k].includes(v));
}

/** Reject a client-supplied credit value above the challenge maximum. */
export function verifiedCredits(challenge, claimed) {
  const n = Number(claimed);
  if (!Number.isFinite(n) || n < 0) throw new ScoringError('invalid_credits', 'Credits must be 0 or more');
  if (n > Number(challenge.maxCredits)) throw new ScoringError('invalid_credits', `At most ${challenge.maxCredits} credits`);
  return n;
}
