// Monthly periods ("2026-10") and their exact start and end in the organization's
// timezone (spec 16 and test 24). Uses Intl, so no timezone library is needed.
import { ScoringError } from './kpi.js';

const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function assertPeriod(period) {
  if (typeof period !== 'string' || !PERIOD.test(period)) {
    throw new ScoringError('invalid_period', `A period must look like 2026-10, got "${period}"`);
  }
  return period;
}

export const comparePeriods = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function nextPeriod(period) {
  const [y, m] = assertPeriod(period).split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export function previousPeriod(period) {
  const [y, m] = assertPeriod(period).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// Offset (ms) of a timezone from UTC at a given instant.
function offsetAt(timeZone, instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour, +v.minute, +v.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

// The UTC instant of local midnight on the 1st of a month in a timezone.
function localMonthStart(year, month, timeZone) {
  const guess = Date.UTC(year, month - 1, 1);
  // Two passes settle daylight-saving changes.
  let t = guess - offsetAt(timeZone, new Date(guess));
  t = guess - offsetAt(timeZone, new Date(t));
  return new Date(t);
}

/** { start, end } as Dates: start inclusive, end exclusive. */
export function periodBounds(period, timeZone = 'UTC') {
  const [y, m] = assertPeriod(period).split('-').map(Number);
  const [ny, nm] = nextPeriod(period).split('-').map(Number);
  return { start: localMonthStart(y, m, timeZone), end: localMonthStart(ny, nm, timeZone) };
}

/** The period an instant falls in, in the organization's timezone. */
export function periodOf(instant, timeZone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(new Date(instant));
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}`;
}

// Calendar days ('YYYY-MM-DD', inclusive) helpers for memberships and leave, which are
// recorded as local dates rather than instants.
export function periodDays(period) {
  const [y, m] = assertPeriod(period).split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${period}-01`, last: `${period}-${String(days).padStart(2, '0')}`, days };
}

const dayNumber = (d) => Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000);

/** Days of overlap between [from, to] (to may be null = open) and a period. */
export function overlapDays(from, to, period) {
  const { first, last } = periodDays(period);
  const a = Math.max(dayNumber(from), dayNumber(first));
  const b = Math.min(to ? dayNumber(to) : Infinity, dayNumber(last));
  return b >= a ? b - a + 1 : 0;
}

export function daysBetween(fromDay, toDay) {
  return dayNumber(toDay) - dayNumber(fromDay);
}
