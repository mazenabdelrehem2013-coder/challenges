// Exact fixed-point arithmetic for official scores. JavaScript numbers are binary
// floats (0.7 * 87.5 is 61.24999999999999), so every official calculation runs on
// BigInt values with 9 decimal places and is rounded half-up only when a result is
// stored or shown. A "Dec" is a plain BigInt scaled by SCALE.

export const PLACES = 9;
export const SCALE = 10n ** BigInt(PLACES);

// Parse a number or numeric string exactly (no float round trip).
export function dec(value) {
  if (typeof value === 'bigint') return value * SCALE;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError(`Not a finite number: ${value}`);
    value = numberToPlain(value);
  }
  if (typeof value !== 'string') throw new TypeError(`Not a number: ${value}`);
  const m = /^\s*(-)?(\d*)(?:\.(\d*))?\s*$/.exec(value);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new TypeError(`Not a number: "${value}"`);
  const [, sign, int, frac = ''] = m;
  const kept = frac.slice(0, PLACES).padEnd(PLACES, '0');
  let n = BigInt(int || '0') * SCALE + BigInt(kept);
  // Round half-up on any digits beyond PLACES.
  if (frac.length > PLACES && frac[PLACES] >= '5') n += 1n;
  return sign ? -n : n;
}

// 1e-7 and 1e21 print in exponent form; expand them.
function numberToPlain(n) {
  const s = String(n);
  if (!/e/i.test(s)) return s;
  return n.toFixed(20).replace(/\.?0+$/, '');
}

const divRound = (a, b) => {
  // Round half away from zero.
  if (b === 0n) throw new RangeError('Division by zero');
  const neg = a < 0n !== b < 0n;
  const [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  let q = x / y;
  if ((x % y) * 2n >= y) q += 1n;
  return neg ? -q : q;
};

export const add = (...xs) => xs.reduce((s, x) => s + x, 0n);
export const sub = (a, b) => a - b;
export const mul = (a, b) => divRound(a * b, SCALE);
export const div = (a, b) => divRound(a * SCALE, b);
export const min = (a, b) => (a < b ? a : b);
export const max = (a, b) => (a > b ? a : b);
export const clamp = (x, lo, hi) => max(lo, min(hi, x));
export const ZERO = 0n;
export const HUNDRED = 100n * SCALE;

// Round to `places` decimals (half-up) and return a JS number for display/storage.
export function toNumber(x, places = 2) {
  return Number(toFixed(x, places));
}

export function toFixed(x, places = 2) {
  const step = 10n ** BigInt(PLACES - places);
  const r = divRound(x, step);
  const neg = r < 0n;
  const abs = neg ? -r : r;
  const s = abs.toString().padStart(places + 1, '0');
  const out = places ? `${s.slice(0, -places)}.${s.slice(-places)}` : s;
  return (neg ? '-' : '') + out;
}

// Round a Dec to `places` decimals but keep it a Dec (for chaining with stored values).
export function round(x, places = 2) {
  return dec(toFixed(x, places));
}
