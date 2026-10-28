// KPI imports and anti-manipulation checks (spec 12).
// Imports are idempotent: the same source record imported twice changes nothing. A
// different value for an already approved record never overwrites it silently; it is kept
// as a pending correction that someone has to review.
import { ScoringError, RESULT_STATUSES } from './kpi.js';
import { assertPeriod } from './period.js';

export const importKey = (r) => [r.employeeId, r.kpiId, r.period].join('|');
export const sourceKey = (r) => [r.sourceSystem, r.sourceRef].join('|');

/**
 * existing: [kpi result records]; rows: incoming rows
 * { employeeId, kpiId, period, actual, target?, sourceSystem, sourceRef }.
 * Returns { records, inserted, duplicates, corrections, rejected }.
 */
export function importKpiResults(existing, rows, { importedAt, approvedSources = [] } = {}) {
  const records = existing.map((r) => ({ ...r }));
  const bySource = new Map(records.map((r) => [sourceKey(r), r]));
  const byKey = new Map(records.filter((r) => r.status !== 'superseded').map((r) => [importKey(r), r]));
  const out = { records, inserted: [], duplicates: [], corrections: [], rejected: [] };
  for (const row of rows) {
    const problem = rowProblem(row, approvedSources);
    if (problem) {
      out.rejected.push({ row, reason: problem });
      continue;
    }
    if (bySource.has(sourceKey(row))) {
      out.duplicates.push(row);
      continue;
    }
    const current = byKey.get(importKey(row));
    const rec = {
      ...row,
      actual: Number(row.actual),
      target: row.target === undefined ? undefined : Number(row.target),
      status: 'available',
      importedAt: importedAt ?? new Date().toISOString(),
    };
    if (current && ['approved', 'corrected', 'under_review'].includes(current.status)) {
      // Never overwrite reviewed data: keep the new value aside for review.
      rec.status = 'under_review';
      rec.replaces = sourceKey(current);
      out.corrections.push(rec);
    } else if (current) {
      current.status = 'superseded';
      rec.replaces = sourceKey(current);
      out.inserted.push(rec);
    } else {
      out.inserted.push(rec);
    }
    records.push(rec);
    bySource.set(sourceKey(rec), rec);
    if (rec.status === 'available') byKey.set(importKey(rec), rec);
  }
  return out;
}

function rowProblem(row, approvedSources) {
  if (!row.employeeId || !row.kpiId) return 'missing employee or KPI';
  try {
    assertPeriod(row.period);
  } catch {
    return 'bad period';
  }
  if (!row.sourceSystem || !row.sourceRef) return 'missing source system or reference';
  if (approvedSources.length && !approvedSources.includes(row.sourceSystem)) return `${row.sourceSystem} is not an approved source`;
  const a = Number(row.actual);
  if (row.actual === '' || row.actual === null || row.actual === undefined || !Number.isFinite(a)) return 'missing or invalid actual';
  if (row.target !== undefined && !(Number(row.target) >= 0)) return 'invalid target';
  return null;
}

export function setResultStatus(record, status, { actorId, reason }) {
  if (!RESULT_STATUSES.includes(status)) throw new ScoringError('invalid_status', `Unknown status ${status}`);
  if (['approved', 'rejected', 'corrected'].includes(status) && !actorId) {
    throw new ScoringError('needs_approver', 'Approving or rejecting data needs a reviewer');
  }
  if (actorId && actorId === record.employeeId) throw new ScoringError('self_approval', 'Nobody can approve their own KPI data');
  if (status === 'rejected' && !reason) throw new ScoringError('needs_reason', 'A rejection needs a reason');
  return { ...record, status, reviewedBy: actorId ?? null, reviewReason: reason ?? null };
}

/**
 * One challenge submission per assignment that can earn credit: a second approved
 * submission for the same assignment, or the same evidence reused, earns nothing.
 */
export function checkSubmission(existingSubmissions, submission) {
  const sameAssignment = existingSubmissions.find(
    (s) => s.assignmentId === submission.assignmentId && ['submitted', 'approved'].includes(s.status),
  );
  if (sameAssignment) return { ok: false, reason: 'already_submitted', existing: sameAssignment };
  if (submission.evidenceHash) {
    const reused = existingSubmissions.find((s) => s.evidenceHash === submission.evidenceHash && s.status !== 'rejected');
    if (reused) return { ok: false, reason: 'duplicate_evidence', existing: reused };
  }
  return { ok: true };
}

/**
 * Suspicious-activity flags. A flag asks for a review; it is never proof of misconduct.
 * data: { submissions: [{ submittedBy, submittedAt, evidenceHash, reviewedBy }],
 *         scores: [{ employeeId, period, kpiScore, previousKpiScore }],
 *         nominations: [{ nominatorId, period }] }
 */
export function suspicionFlags(data, limits = {}) {
  const L = { dailySubmissions: 5, scoreJump: 30, nominationsPerMonth: 5, approvalsBySameReviewer: 0.9, minReviewsForPattern: 10, ...limits };
  const flags = [];
  const perDay = new Map();
  for (const s of data.submissions ?? []) {
    const key = `${s.submittedBy}|${String(s.submittedAt).slice(0, 10)}`;
    perDay.set(key, (perDay.get(key) || 0) + 1);
  }
  for (const [key, n] of perDay) {
    if (n > L.dailySubmissions) {
      const [employeeId, day] = key.split('|');
      flags.push({ type: 'submission_spike', employeeId, detail: `${n} submissions on ${day}` });
    }
  }
  const hashes = new Map();
  for (const s of data.submissions ?? []) {
    if (!s.evidenceHash) continue;
    if (hashes.has(s.evidenceHash) && hashes.get(s.evidenceHash) !== s.submittedBy) {
      flags.push({ type: 'duplicate_evidence', employeeId: s.submittedBy, detail: `same evidence as ${hashes.get(s.evidenceHash)}` });
    }
    hashes.set(s.evidenceHash, s.submittedBy);
  }
  for (const s of data.scores ?? []) {
    if (s.previousKpiScore !== undefined && s.previousKpiScore !== null && s.kpiScore - s.previousKpiScore > L.scoreJump) {
      flags.push({ type: 'implausible_jump', employeeId: s.employeeId, detail: `KPI score rose ${Math.round(s.kpiScore - s.previousKpiScore)} points in ${s.period}` });
    }
  }
  const noms = new Map();
  for (const n of data.nominations ?? []) noms.set(`${n.nominatorId}|${n.period}`, (noms.get(`${n.nominatorId}|${n.period}`) || 0) + 1);
  for (const [key, n] of noms) {
    if (n > L.nominationsPerMonth) flags.push({ type: 'excessive_nominations', employeeId: key.split('|')[0], detail: `${n} nominations` });
  }
  const bySubmitter = new Map();
  for (const s of (data.submissions ?? []).filter((x) => x.reviewedBy)) {
    const m = bySubmitter.get(s.submittedBy) || new Map();
    m.set(s.reviewedBy, (m.get(s.reviewedBy) || 0) + 1);
    bySubmitter.set(s.submittedBy, m);
  }
  for (const [submitter, reviewers] of bySubmitter) {
    const total = [...reviewers.values()].reduce((a, b) => a + b, 0);
    const [topReviewer, top] = [...reviewers].sort((a, b) => b[1] - a[1])[0];
    if (total >= L.minReviewsForPattern && top / total >= L.approvalsBySameReviewer) {
      flags.push({ type: 'approval_pattern', employeeId: submitter, detail: `${top} of ${total} reviews by ${topReviewer}` });
    }
  }
  return flags;
}
