// Audit entries and the permission checks the scoring workflows rely on (spec 4 and 12).
import { ScoringError } from './kpi.js';

// Fields every audit entry must carry (test 23: audit completeness).
export const AUDIT_FIELDS = ['actorId', 'action', 'entityType', 'entityId', 'oldValues', 'newValues', 'reason', 'createdAt'];

export function auditEntry({ actorId, action, entityType, entityId, oldValues = null, newValues = null, reason, at, meta }) {
  if (!actorId) throw new ScoringError('invalid_audit', 'An audit entry needs an actor');
  if (!action || !entityType || !entityId) throw new ScoringError('invalid_audit', 'An audit entry needs an action and an entity');
  if (!reason) throw new ScoringError('invalid_audit', 'An audit entry needs a reason');
  return Object.freeze({
    actorId, action, entityType, entityId, oldValues, newValues, reason,
    createdAt: at ?? new Date().toISOString(),
    ...(meta ? { meta } : {}),
  });
}

export function isCompleteAudit(entry) {
  return AUDIT_FIELDS.every((f) => entry[f] !== undefined) && Boolean(entry.reason) && Boolean(entry.actorId);
}

// Roles (spec 4). sysadmin is technical only: it cannot approve results or change policies.
// 'admin' is the existing app's owner role, which already does HR's job, so it keeps HR's
// rights plus role assignment.
export const ROLES = ['employee', 'manager', 'hr', 'admin', 'sysadmin'];

const HR = ['hr', 'admin'];
const CAN = {
  'kpi.import': HR,
  'kpi.approve': [...HR, 'manager'],
  'policy.publish': HR,
  'template.publish': HR,
  'challenge.publish': HR,
  'period.calculate': HR,
  'period.finalize': HR,
  'result.correct': HR,
  'appeal.review': HR,
  'evidence.review': ['manager', ...HR],
  'role.assign': ['sysadmin', ...HR],
  'reward.approve': HR,
  nominate: ['manager', ...HR],
};

export function can(actor, action) {
  return Boolean(actor && actor.status !== 'inactive' && CAN[action]?.includes(actor.role));
}

export function assertCan(actor, action) {
  if (!can(actor, action)) throw new ScoringError('forbidden', `Your role cannot do ${action}`);
}

/**
 * Evidence review: reviewer must be a manager of the submitter's team/department (or HR),
 * and never the submitter (no self-approval).
 */
export function assertCanReview(actor, submission, submitter) {
  assertCan(actor, 'evidence.review');
  if (actor.id === submission.submittedBy) throw new ScoringError('self_approval', 'You cannot review your own submission');
  if (actor.role === 'manager' && submitter.managerId !== actor.id && submitter.departmentId !== actor.departmentId) {
    throw new ScoringError('forbidden', 'You can only review submissions from your own team or department');
  }
}

/** Assigning roles: sysadmin or HR, never to themselves. */
export function assertCanAssignRole(actor, target, role) {
  assertCan(actor, 'role.assign');
  if (!ROLES.includes(role)) throw new ScoringError('invalid_role', `Unknown role ${role}`);
  if (actor.id === target.id) throw new ScoringError('self_approval', 'You cannot change your own role');
}
