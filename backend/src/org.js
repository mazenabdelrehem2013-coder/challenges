// Helpers that map challenge scopes onto the org structure:
// region > branch > team, and department > team. A user belongs to one team.

export const SCOPES = ['person', 'team', 'department', 'branch', 'region'];
export const GROUP_SCOPES = ['department', 'branch', 'region'];

const SCOPE_COLUMN = {
  person: 'person_id',
  team: 'team_id',
  department: 'department_id',
  branch: 'branch_id',
  region: 'region_id',
};

const SCOPE_TABLE = {
  person: 'users',
  team: 'teams',
  department: 'departments',
  branch: 'branches',
  region: 'regions',
};

export function scopeColumn(scope) {
  const col = SCOPE_COLUMN[scope];
  if (!col) throw new Error(`Unknown scope ${scope}`);
  return col;
}

export function userOrg(db, userId) {
  return db.prepare('SELECT * FROM user_org WHERE user_id = ?').get(userId);
}

// The entity id a user represents at a given scope (their team id, branch id, ...).
export function entityOfUser(db, userId, scope) {
  const org = userOrg(db, userId);
  return org ? org[scopeColumn(scope)] : null;
}

export function entityExists(db, scope, id) {
  const table = SCOPE_TABLE[scope];
  const extra = scope === 'person' ? ' AND active = 1' : '';
  return !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?${extra}`).get(id);
}

export function entityName(db, scope, id) {
  const row = db.prepare(`SELECT name FROM ${SCOPE_TABLE[scope]} WHERE id = ?`).get(id);
  return row ? row.name : `Unknown ${scope}`;
}

export function allEntities(db, scope) {
  const extra = scope === 'person' ? ' WHERE active = 1' : '';
  return db.prepare(`SELECT id, name FROM ${SCOPE_TABLE[scope]}${extra} ORDER BY name`).all();
}

// Active user ids that belong to an entity at the given scope.
export function membersOf(db, scope, entityId) {
  return db
    .prepare(`SELECT user_id FROM user_org WHERE ${scopeColumn(scope)} = ? AND active = 1`)
    .all(entityId)
    .map((r) => r.user_id);
}

export function isMember(db, userId, scope, entityId) {
  return entityOfUser(db, userId, scope) === entityId;
}
