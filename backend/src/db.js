import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS regions (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  region_id INTEGER NOT NULL REFERENCES regions(id)
);
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  branch_id INTEGER NOT NULL REFERENCES branches(id)
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee','manager','hr','admin')),
  title TEXT,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  active INTEGER NOT NULL DEFAULT 1,
  push_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS challenges (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'custom' CHECK (type IN ('fitness','learning','work','custom')),
  scope TEXT NOT NULL CHECK (scope IN ('person','team','department','branch','region')),
  unit TEXT,
  judging TEXT NOT NULL DEFAULT 'tracked' CHECK (judging IN ('tracked','proof','manager')),
  points INTEGER NOT NULL DEFAULT 100,
  reward TEXT,
  official INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending_approval','invited','active','completed','rejected','declined','cancelled')),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  rejection_reason TEXT,
  winner_side_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  settled_at TEXT
);
CREATE TABLE IF NOT EXISTS challenge_sides (
  id INTEGER PRIMARY KEY,
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  entity_id INTEGER NOT NULL,
  response TEXT NOT NULL DEFAULT 'pending' CHECK (response IN ('pending','accepted','declined')),
  UNIQUE (challenge_id, entity_id)
);
CREATE TABLE IF NOT EXISTS progress_entries (
  id INTEGER PRIMARY KEY,
  challenge_id INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  value REAL NOT NULL,
  note TEXT,
  proof_url TEXT,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved','pending','rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS points_ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  challenge_id INTEGER REFERENCES challenges(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_badges (
  user_id INTEGER NOT NULL REFERENCES users(id),
  badge TEXT NOT NULL,
  awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, badge)
);
CREATE TABLE IF NOT EXISTS results (
  challenge_id INTEGER NOT NULL REFERENCES challenges(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('won','lost','draw')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (challenge_id, user_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  challenge_id INTEGER REFERENCES challenges(id),
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  challenge_id INTEGER REFERENCES challenges(id),
  user_id INTEGER REFERENCES users(id),
  department_id INTEGER,
  branch_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE VIEW IF NOT EXISTS user_org AS
  SELECT u.id AS user_id, u.id AS person_id, u.team_id, t.department_id, t.branch_id, b.region_id, u.active
  FROM users u JOIN teams t ON t.id = u.team_id JOIN branches b ON b.id = t.branch_id;
CREATE INDEX IF NOT EXISTS idx_sides_challenge ON challenge_sides(challenge_id);
CREATE INDEX IF NOT EXISTS idx_progress_challenge ON progress_entries(challenge_id);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON points_ledger(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
`;

export const DEFAULT_SETTINGS = {
  // Which peer challenges need a manager/HR approval before they start:
  // 'all', 'groups' (department/branch/region only) or 'none'.
  approvalMode: 'groups',
  // Upper limit for points an employee may put at stake in a peer challenge.
  maxPeerPoints: 500,
  // Points every participant gets just for finishing a challenge.
  participationPoints: 10,
};

export function openDb(file = process.env.DB_FILE || 'challenges.db') {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = JSON.parse(r.value);
  return out;
}

export function saveSettings(db, patch) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [k, v] of Object.entries(patch)) {
    if (k in DEFAULT_SETTINGS) stmt.run(k, JSON.stringify(v));
  }
  return getSettings(db);
}
