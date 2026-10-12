import jwt from 'jsonwebtoken';
import { GameError } from './game.js';
import { userOrg } from './org.js';

export const ROLES = ['employee', 'manager', 'hr', 'admin'];

export function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production');
    return 'dev-only-secret-change-me';
  }
  return secret;
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, jwtSecret(), { expiresIn: '30d' });
}

export function httpError(status, message) {
  return new GameError(status, message);
}

// Wrap a route so thrown errors (sync or async) reach the error handler.
export const h = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res, next);
    if (out && typeof out.catch === 'function') out.catch(next);
  } catch (err) {
    next(err);
  }
};

export function requireAuth(db) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Please sign in' });
    try {
      const payload = jwt.verify(token, jwtSecret());
      const user = db
        .prepare('SELECT id, name, email, role, title, team_id, active FROM users WHERE id = ?')
        .get(payload.sub);
      if (!user || !user.active) return res.status(401).json({ error: 'Account not active' });
      req.user = { ...user, org: userOrg(db, user.id) };
      next();
    } catch {
      res.status(401).json({ error: 'Session expired, please sign in again' });
    }
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have access to this' });
    next();
  };
}

export const isStaff = (user) => user.role === 'hr' || user.role === 'admin';
export const isManagerOrAbove = (user) => user.role !== 'employee';

// --- small input validators -------------------------------------------------

export function str(value, field, { required = true, max = 500 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw httpError(400, `${field} is required`);
    return null;
  }
  if (typeof value !== 'string') throw httpError(400, `${field} must be text`);
  const v = value.trim();
  if (required && !v) throw httpError(400, `${field} is required`);
  if (v.length > max) throw httpError(400, `${field} is too long`);
  return v;
}

export function int(value, field, { required = true, min = -Infinity, max = Infinity } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw httpError(400, `${field} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw httpError(400, `${field} must be a whole number`);
  return n;
}

export function num(value, field, { min = -Infinity, max = Infinity } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw httpError(400, `${field} must be a number`);
  return n;
}

export function oneOf(value, field, options, fallback) {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw httpError(400, `${field} is required`);
  }
  if (!options.includes(value)) throw httpError(400, `${field} must be one of: ${options.join(', ')}`);
  return value;
}

export function date(value, field, { required = true } = {}) {
  if (!value) {
    if (required) throw httpError(400, `${field} is required`);
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw httpError(400, `${field} must be a date`);
  return d.toISOString();
}

export function periodStart(period, now = new Date()) {
  if (period === 'all' || !period) return '1970-01-01T00:00:00.000Z';
  const d = new Date(now);
  if (period === 'week') d.setUTCDate(d.getUTCDate() - 7);
  else if (period === 'month') d.setUTCDate(d.getUTCDate() - 30);
  else throw httpError(400, 'period must be week, month or all');
  return d.toISOString();
}

// SQLite datetime('now') stores "YYYY-MM-DD HH:MM:SS"; compare in that format.
export function sqlTime(iso) {
  return iso.replace('T', ' ').slice(0, 19);
}
