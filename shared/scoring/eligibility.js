// Who counts in a period (spec 5 and 8): dated team memberships, transfers, new starters
// and approved leave. Rules come from the policy's `eligibility` block and are published
// before the period starts.
import { periodDays, overlapDays, daysBetween } from './period.js';

/**
 * The team an employee is assigned to for a period: the membership covering the most days
 * of it (a later membership wins a tie, so a mid-month transfer lands in the new team).
 * memberships: [{ employeeId, teamId, validFrom: 'YYYY-MM-DD', validTo: 'YYYY-MM-DD'|null }]
 */
export function assignmentForPeriod(memberships, employeeId, period) {
  let best = null;
  for (const m of memberships) {
    if (m.employeeId !== employeeId) continue;
    const days = overlapDays(m.validFrom, m.validTo, period);
    if (days === 0) continue;
    if (!best || days > best.days || (days === best.days && m.validFrom > best.validFrom)) {
      best = { teamId: m.teamId, days, validFrom: m.validFrom };
    }
  }
  return best;
}

/**
 * Eligibility of one employee for leaderboards and team averages.
 * employee: { id, status: 'active'|'inactive', startDate, leaves: [{ from, to, approved }] }
 * Returns { rankable, reasons: [string], teamId, daysInTeam }.
 * A non-rankable employee is still scored (they can see their own result); they are just
 * left out of rankings and team averages, so nobody gains or loses from partial months.
 */
export function employeeEligibility(employee, memberships, period, rules) {
  const reasons = [];
  const { last } = periodDays(period);
  if (employee.status === 'inactive' && !employee.endDate) reasons.push('inactive');
  if (employee.endDate && employee.endDate < last) reasons.push('left during the period');
  if (employee.startDate && employee.startDate > last) reasons.push('not started yet');
  else if (employee.startDate && daysBetween(employee.startDate, last) + 1 <= rules.newStarterMinDays) {
    reasons.push('new starter');
  }
  const leaveDays = (employee.leaves || [])
    .filter((l) => l.approved)
    .reduce((s, l) => s + overlapDays(l.from, l.to, period), 0);
  if (leaveDays > rules.maxLeaveDays) reasons.push(`approved leave of ${leaveDays} days`);
  const assignment = assignmentForPeriod(memberships, employee.id, period);
  if (!assignment) reasons.push('no team this period');
  return {
    rankable: reasons.length === 0,
    reasons,
    teamId: assignment?.teamId ?? null,
    daysInTeam: assignment?.days ?? 0,
    leaveDays,
  };
}
