// Finalized months (spec 6.1, 11 and 23): a finalized period is a frozen snapshot of
// every input, the exact policy and template versions, and the results. Re-running the
// engine on the snapshot must give the same fingerprint, and a correction never edits a
// snapshot: it creates a new revision with an audit entry (old values, new values, who, why).
import { calculatePeriod } from './monthly.js';
import { ScoringError } from './kpi.js';
import { ENGINE_VERSION } from './policy.js';
import { auditEntry } from './audit.js';

// Key-sorted JSON, so equal data always serializes the same way.
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

// FNV-1a 64-bit. Detects accidental or unaudited changes; it is not a security signature.
export function fingerprint(value) {
  let h = 0xcbf29ce484222325n;
  const s = stableStringify(value);
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

const deepFreeze = (o) => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

/**
 * Finalize a period. Every employee must have a complete score (missing data must be
 * resolved or covered by a documented exception first).
 */
export function finalizePeriod(input, { finalizedBy, finalizedAt, revision = 1, previous = null }) {
  if (!finalizedBy) throw new ScoringError('needs_approver', 'Finalizing needs an HR approver');
  const frozenInput = JSON.parse(JSON.stringify({ ...input, mode: 'final' }));
  const results = calculatePeriod(frozenInput);
  const incomplete = results.employees.filter((r) => r.status === 'incomplete');
  if (incomplete.length) {
    throw new ScoringError(
      'incomplete',
      `${incomplete.length} employee(s) still have missing or unapproved KPI data`,
      incomplete.map((r) => ({ employeeId: r.employeeId, blockers: r.blockers })),
    );
  }
  const finalResults = {
    ...results,
    employees: results.employees.map((r) => ({ ...r, status: 'finalized' })),
    teams: results.teams.map((t) => ({ ...t, status: t.status === 'incomplete' ? 'incomplete' : 'finalized' })),
  };
  return deepFreeze({
    period: input.period,
    revision,
    previousFingerprint: previous?.fingerprint ?? null,
    engineVersion: ENGINE_VERSION,
    finalizedBy,
    finalizedAt: finalizedAt ?? new Date().toISOString(),
    input: frozenInput,
    results: finalResults,
    fingerprint: fingerprint(finalResults),
  });
}

/** Recalculate a snapshot from its stored inputs; true when the results match exactly. */
export function reproduce(snapshot) {
  const again = calculatePeriod(JSON.parse(JSON.stringify(snapshot.input)));
  const finalResults = {
    ...again,
    employees: again.employees.map((r) => ({ ...r, status: 'finalized' })),
    teams: again.teams.map((t) => ({ ...t, status: t.status === 'incomplete' ? 'incomplete' : 'finalized' })),
  };
  return { matches: fingerprint(finalResults) === snapshot.fingerprint, fingerprint: fingerprint(finalResults) };
}

/**
 * An authorized correction to a finalized period (e.g. an upheld appeal or a corrected KPI
 * import). Produces a new revision plus an audit entry. The original snapshot is untouched.
 * change: { employeeId, kpiResults?: { [kpiId]: result }, reason, approvedBy, appealId? }
 */
export function correctPeriod(snapshot, change, { at } = {}) {
  if (!change.reason) throw new ScoringError('needs_reason', 'A correction needs a reason');
  if (!change.approvedBy) throw new ScoringError('needs_approver', 'A correction needs an approver');
  if (change.approvedBy === change.employeeId) throw new ScoringError('self_approval', 'Nobody can approve a correction to their own score');
  const input = JSON.parse(JSON.stringify(snapshot.input));
  const before = snapshot.results.employees.find((r) => r.employeeId === change.employeeId);
  if (!before) throw new ScoringError('not_found', 'That employee is not in this period');
  if (change.kpiResults) {
    input.kpiResults[change.employeeId] = { ...input.kpiResults[change.employeeId] };
    for (const [kpiId, r] of Object.entries(change.kpiResults)) {
      input.kpiResults[change.employeeId][kpiId] = { ...r, status: 'corrected', correctedBy: change.approvedBy, correctionReason: change.reason };
    }
  }
  const next = finalizePeriod(input, { finalizedBy: change.approvedBy, finalizedAt: at, revision: snapshot.revision + 1, previous: snapshot });
  const after = next.results.employees.find((r) => r.employeeId === change.employeeId);
  const audit = auditEntry({
    actorId: change.approvedBy,
    action: 'result.corrected',
    entityType: 'monthly_result',
    entityId: `${snapshot.period}:${change.employeeId}`,
    oldValues: { kpiScore: before.kpiScore, challengeScore: before.challengeScore, finalScore: before.finalScore, revision: snapshot.revision },
    newValues: { kpiScore: after.kpiScore, challengeScore: after.challengeScore, finalScore: after.finalScore, revision: next.revision },
    reason: change.reason,
    at,
    meta: change.appealId ? { appealId: change.appealId } : undefined,
  });
  return { snapshot: next, audit };
}

/** Throw if something tries to change a finalized period outside correctPeriod. */
export function assertEditable(periodState) {
  if (periodState?.status === 'finalized') {
    throw new ScoringError('period_finalized', `${periodState.period} is finalized; use the correction process`);
  }
}
