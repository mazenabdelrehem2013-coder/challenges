// KPI templates and KPI scores (spec sections 6.2 to 6.5).
//
// A KPI template is a list of KPIs with weights that must total exactly 100 (percent).
//   KPI Score = sum(weight x achievement score) / 100, between 0 and 100.
// Each KPI result has a status; only approved or corrected results can be finalized,
// and a missing required KPI blocks the score instead of counting as 0 or as 100.
import { dec, add, mul, div, min, clamp, sub, ZERO, HUNDRED, toNumber } from './decimal.js';

export const DIRECTIONS = ['higher', 'lower', 'range', 'threshold'];
export const SOURCE_TYPES = ['import', 'lms', 'survey', 'manager_assessment', 'quiz', 'manual_verified'];
export const RESULT_STATUSES = ['pending_data', 'available', 'under_review', 'approved', 'rejected', 'corrected'];
// Statuses that may go into a final (official) score.
export const FINAL_STATUSES = ['approved', 'corrected'];
// Statuses that may go into a provisional score shown during the month.
export const PROVISIONAL_STATUSES = ['available', 'under_review', 'approved', 'corrected'];

export class ScoringError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/**
 * Check a template before it can be published.
 * template: { id, name, version, kpis: [{ kpiId, name, weight, direction, sourceType, target?, scoringRule?, required? }] }
 * Returns { ok, errors: [string] }. Weights are percentages (30 = 30%).
 */
export function validateTemplate(template) {
  const errors = [];
  const kpis = template?.kpis ?? [];
  if (!kpis.length) errors.push('A template needs at least one KPI');
  const seen = new Set();
  let total = ZERO;
  for (const k of kpis) {
    const label = k.name || k.kpiId || 'A KPI';
    if (!k.kpiId) errors.push(`${label} has no KPI id`);
    if (seen.has(k.kpiId)) errors.push(`${label} appears twice`);
    seen.add(k.kpiId);
    let w;
    try {
      w = dec(k.weight);
    } catch {
      errors.push(`${label} has no valid weight`);
      continue;
    }
    if (w < ZERO) errors.push(`${label} has a negative weight`);
    total += w;
    if (!DIRECTIONS.includes(k.direction)) errors.push(`${label} needs a scoring direction (${DIRECTIONS.join(', ')})`);
    if (!SOURCE_TYPES.includes(k.sourceType)) errors.push(`${label} needs an approved data source (${SOURCE_TYPES.join(', ')})`);
    errors.push(...ruleErrors(k).map((e) => `${label}: ${e}`));
  }
  if (kpis.length && total !== HUNDRED) {
    errors.push(`KPI weights must total exactly 100%, they total ${toNumber(total, 4)}%`);
  }
  return { ok: errors.length === 0, errors };
}

export function assertValidTemplate(template) {
  const { ok, errors } = validateTemplate(template);
  if (!ok) throw new ScoringError('invalid_template', errors.join('; '), errors);
  return template;
}

// Every KPI needs a target or an explicit scoring rule that fits its direction.
function ruleErrors(k) {
  const r = k.scoringRule || {};
  const out = [];
  if (k.direction === 'higher' || k.direction === 'lower') {
    if (k.target === undefined || k.target === null) {
      if (!k.targetFromResult) out.push('needs a target, or targetFromResult when each result carries its own target');
    } else if (Number(k.target) < 0) out.push('target cannot be negative');
    else if (Number(k.target) === 0 && !r.zeroTarget) out.push('a zero target needs an explicit zeroTarget rule');
    if (r.zeroTarget) out.push(...zeroTargetErrors(r.zeroTarget));
  }
  if (k.direction === 'range') {
    if (r.min === undefined || r.max === undefined) out.push('a range KPI needs scoringRule.min and scoringRule.max');
    else if (Number(r.min) > Number(r.max)) out.push('range min is above max');
    if (r.tolerance !== undefined && !(Number(r.tolerance) > 0)) out.push('range tolerance must be above 0');
  }
  if (k.direction === 'threshold') {
    const bands = r.bands;
    if (!Array.isArray(bands) || !bands.length) out.push('a threshold KPI needs scoringRule.bands');
    else if (bands.some((b) => !(Number(b.score) >= 0 && Number(b.score) <= 100))) out.push('band scores must be 0 to 100');
    if (!['higher', 'lower'].includes(r.better)) out.push('threshold rule needs better: higher or lower');
  }
  return out;
}

function zeroTargetErrors(z) {
  if (z.mode === 'binary') return [];
  if (z.mode === 'decay') return Number(z.pointsPerUnit) > 0 ? [] : ['zeroTarget decay needs pointsPerUnit above 0'];
  return ['zeroTarget.mode must be binary or decay'];
}

/**
 * Achievement score (0 to 100) for one KPI result. Never invents a value:
 * returns { score: Dec } or { score: null, reason } when it cannot be scored.
 * kpi: a template KPI. result: { actual, target?, status }.
 */
export function achievement(kpi, result) {
  if (!result || result.actual === undefined || result.actual === null || result.actual === '') {
    return { score: null, reason: 'missing' };
  }
  let actual;
  try {
    actual = dec(result.actual);
  } catch {
    return { score: null, reason: 'invalid' };
  }
  const r = kpi.scoringRule || {};
  if (actual < ZERO && !r.allowNegative) return { score: null, reason: 'invalid' };

  if (kpi.direction === 'range') return { score: rangeScore(actual, r) };
  if (kpi.direction === 'threshold') return { score: thresholdScore(actual, r) };

  const rawTarget = result.target ?? kpi.target;
  if (rawTarget === undefined || rawTarget === null) return { score: null, reason: 'no_target' };
  const target = dec(rawTarget);
  if (target < ZERO) return { score: null, reason: 'invalid' };
  if (target === ZERO) {
    if (!r.zeroTarget) return { score: null, reason: 'needs_rule' };
    return { score: zeroTargetScore(actual, kpi.direction, r.zeroTarget) };
  }
  if (kpi.direction === 'higher') {
    // 100 x min(actual / target, 1)
    return { score: mul(HUNDRED, min(div(actual, target), dec(1))) };
  }
  // lower is better: 100 x min(target / actual, 1); an actual of 0 beats any positive target.
  if (actual === ZERO) return { score: HUNDRED };
  return { score: mul(HUNDRED, min(div(target, actual), dec(1))) };
}

// A zero target: e.g. "zero safety incidents". HR picks how it scores.
//  binary: 100 when the actual meets the target (<= 0 for lower, >= 0 for higher), else 0.
//  decay:  lower-is-better only: 100 minus pointsPerUnit for each unit above 0, floored at 0.
function zeroTargetScore(actual, direction, z) {
  if (z.mode === 'binary') {
    const met = direction === 'lower' ? actual <= ZERO : actual >= ZERO;
    return met ? HUNDRED : ZERO;
  }
  return clamp(sub(HUNDRED, mul(actual, dec(z.pointsPerUnit))), ZERO, HUNDRED);
}

// Acceptable range: 100 inside [min, max]; outside, falls linearly to 0 over `tolerance`
// units (or straight to 0 when there is no tolerance).
function rangeScore(actual, r) {
  const lo = dec(r.min);
  const hi = dec(r.max);
  if (actual >= lo && actual <= hi) return HUNDRED;
  if (r.tolerance === undefined) return ZERO;
  const distance = actual < lo ? sub(lo, actual) : sub(actual, hi);
  return clamp(sub(HUNDRED, mul(HUNDRED, div(distance, dec(r.tolerance)))), ZERO, HUNDRED);
}

// Bands: better 'higher' -> first band with actual >= atLeast; 'lower' -> actual <= atMost.
function thresholdScore(actual, r) {
  if (r.better === 'higher') {
    const bands = [...r.bands].sort((a, b) => Number(b.atLeast) - Number(a.atLeast));
    const hit = bands.find((b) => actual >= dec(b.atLeast));
    return hit ? dec(hit.score) : ZERO;
  }
  const bands = [...r.bands].sort((a, b) => Number(a.atMost) - Number(b.atMost));
  const hit = bands.find((b) => actual <= dec(b.atMost));
  return hit ? dec(hit.score) : ZERO;
}

/**
 * KPI Score for one employee and period.
 * results: { [kpiId]: { actual, target?, status } }
 * exceptions: [{ kpiId, approvedBy, reason }] documented, authorized exclusions.
 * mode: 'final' (only approved/corrected data) or 'provisional'.
 *
 * Returns { complete, score: Dec|null, breakdown: [...], blockers: [...] }.
 * Excluded KPIs (an approved exception, or an optional KPI with no data) are removed and
 * the remaining weights are rescaled to 100, which is recorded in the breakdown.
 * A required KPI without usable data makes the score incomplete (score null).
 */
export function kpiScore(template, results = {}, { exceptions = [], mode = 'final' } = {}) {
  assertValidTemplate(template);
  const usable = mode === 'final' ? FINAL_STATUSES : PROVISIONAL_STATUSES;
  const excused = new Map();
  for (const e of exceptions) {
    if (!e.approvedBy || !e.reason) throw new ScoringError('invalid_exception', 'An exception needs an approver and a reason');
    excused.set(e.kpiId, e);
  }
  const breakdown = [];
  const blockers = [];
  for (const k of template.kpis) {
    const required = k.required !== false;
    const res = results[k.kpiId];
    const row = { kpiId: k.kpiId, name: k.name, weight: Number(k.weight), status: res?.status ?? 'pending_data' };
    if (excused.has(k.kpiId)) {
      breakdown.push({ ...row, excluded: 'exception', exception: excused.get(k.kpiId) });
      continue;
    }
    if (!res || !usable.includes(res.status)) {
      if (required) {
        blockers.push({ kpiId: k.kpiId, reason: res ? `status ${res.status}` : 'pending_data' });
        breakdown.push({ ...row, excluded: null, achievement: null });
      } else breakdown.push({ ...row, excluded: 'optional_no_data' });
      continue;
    }
    const a = achievement(k, res);
    if (a.score === null) {
      if (required) blockers.push({ kpiId: k.kpiId, reason: a.reason });
      breakdown.push({ ...row, excluded: required ? null : 'optional_no_data', achievement: null, problem: a.reason });
      continue;
    }
    breakdown.push({ ...row, excluded: null, achievementDec: a.score, achievement: toNumber(a.score, 4) });
  }
  if (blockers.length) return { complete: false, score: null, breakdown: strip(breakdown), blockers };

  const counted = breakdown.filter((b) => !b.excluded);
  if (!counted.length) {
    return { complete: false, score: null, breakdown: strip(breakdown), blockers: [{ reason: 'every KPI was excluded' }] };
  }
  const weightSum = add(...counted.map((b) => dec(b.weight)));
  let score = ZERO;
  for (const b of counted) {
    const effective = div(mul(dec(b.weight), HUNDRED), weightSum); // rescaled to 100 if anything was excluded
    b.effectiveWeight = toNumber(effective, 4);
    score += mul(effective, b.achievementDec);
  }
  score = div(score, HUNDRED);
  return { complete: true, score: clamp(score, ZERO, HUNDRED), breakdown: strip(breakdown), blockers: [] };
}

const strip = (rows) => rows.map(({ achievementDec, ...rest }) => rest);

/**
 * Overachievement bonus POINTS for the wallet (spec 6.3). Never changes the KPI score.
 * rule: { pointsPerPercent, maxPoints } e.g. 5 points per % above target, at most 100.
 */
export function overachievementBonus(kpi, result, rule) {
  if (!rule || !(kpi.direction === 'higher' || kpi.direction === 'lower')) return 0;
  if (!result || !FINAL_STATUSES.includes(result.status)) return 0;
  const target = Number(result.target ?? kpi.target);
  const actual = Number(result.actual);
  if (!(target > 0) || !(actual >= 0)) return 0;
  const ratio = kpi.direction === 'higher' ? actual / target : actual === 0 ? Infinity : target / actual;
  const over = Math.floor((ratio - 1) * 100 + 1e-9);
  if (over <= 0) return 0;
  return Math.min(over * rule.pointsPerPercent, rule.maxPoints ?? 100);
}
