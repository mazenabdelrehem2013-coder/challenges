// Points wallet (spec 9): an append-only ledger, separate from the official monthly score.
// Nothing is edited or deleted. A mistake is undone with a compensating transaction, and
// every award carries an idempotency key so the same achievement can never pay twice.
import { ScoringError } from './kpi.js';

export const EVENT_TYPES = [
  'learning_module', 'certification', 'challenge_completed', 'leaderboard_win', 'team_win',
  'peer_recognition', 'kpi_overachievement', 'badge', 'manual_award', 'redemption', 'redemption_refund',
  'reversal', 'expiry',
];

export const DEFAULT_REWARD_RULES = Object.freeze({
  learning_module: 50,
  certification: 100,
  challenge_completed: { min: 100, max: 250 },
  leaderboard_win: 300,
  team_win: 200, // per eligible member
  peer_recognition: 25,
  peerRecognitionMonthlyCap: 4, // recognitions that pay, per receiver per month
  kpi_overachievement: { pointsPerPercent: 5, maxPoints: 100 },
  // A team win also paying each member's individual leaderboard win is allowed: they are
  // different achievements with different keys. Set to false to pay only the larger one.
  stackTeamAndIndividual: true,
});

/** Idempotency key for an achievement: the same inputs always give the same key. */
export function awardKey(eventType, employeeId, sourceType, sourceId) {
  return [eventType, employeeId, sourceType, sourceId].join(':');
}

export class Ledger {
  constructor(transactions = []) {
    this.txs = [];
    this.keys = new Set();
    for (const t of transactions) this.#push(t);
  }

  #push(t) {
    if (this.keys.has(t.idempotencyKey)) throw new ScoringError('duplicate', `Already recorded: ${t.idempotencyKey}`);
    this.keys.add(t.idempotencyKey);
    this.txs.push(Object.freeze({ ...t }));
  }

  get transactions() {
    return [...this.txs];
  }

  has(key) {
    return this.keys.has(key);
  }

  /**
   * Record a transaction. Returns { tx, duplicate }: a repeated idempotency key is a
   * no-op that returns the original, so retried imports and jobs are safe.
   */
  record({ employeeId, eventType, pointsDelta, sourceType, sourceId, idempotencyKey, createdBy, createdAt, reason }) {
    if (!employeeId) throw new ScoringError('invalid_tx', 'A transaction needs an employee');
    if (!EVENT_TYPES.includes(eventType)) throw new ScoringError('invalid_tx', `Unknown event type ${eventType}`);
    if (!Number.isInteger(pointsDelta) || pointsDelta === 0) throw new ScoringError('invalid_tx', 'Points must be a whole number other than 0');
    if (!idempotencyKey) throw new ScoringError('invalid_tx', 'A transaction needs an idempotency key');
    if (!createdBy) throw new ScoringError('invalid_tx', 'A transaction needs the person or job that created it');
    const existing = this.txs.find((t) => t.idempotencyKey === idempotencyKey);
    if (existing) return { tx: existing, duplicate: true };
    const tx = {
      id: `tx_${this.txs.length + 1}`,
      employeeId, eventType, pointsDelta, sourceType, sourceId, idempotencyKey, createdBy,
      createdAt: createdAt ?? new Date().toISOString(),
      reason: reason ?? null,
    };
    if (pointsDelta < 0 && eventType === 'redemption' && this.balance(employeeId) + pointsDelta < 0) {
      throw new ScoringError('insufficient_points', 'Not enough points');
    }
    this.#push(tx);
    return { tx: this.txs[this.txs.length - 1], duplicate: false };
  }

  /** Undo a transaction with an equal and opposite one. A transaction can be reversed once. */
  reverse(txId, { createdBy, reason, createdAt }) {
    if (!reason) throw new ScoringError('needs_reason', 'A reversal needs a reason');
    const original = this.txs.find((t) => t.id === txId);
    if (!original) throw new ScoringError('not_found', `No transaction ${txId}`);
    if (original.eventType === 'reversal') throw new ScoringError('invalid_tx', 'A reversal cannot be reversed; record a new award instead');
    return this.record({
      employeeId: original.employeeId,
      eventType: 'reversal',
      pointsDelta: -original.pointsDelta,
      sourceType: 'transaction',
      sourceId: original.id,
      idempotencyKey: `reversal:${original.id}`,
      createdBy, createdAt, reason,
    });
  }

  balance(employeeId) {
    return this.txs.filter((t) => t.employeeId === employeeId).reduce((s, t) => s + t.pointsDelta, 0);
  }

  history(employeeId) {
    return this.txs.filter((t) => t.employeeId === employeeId);
  }

  /** Points issued in a period (positive awards minus their reversals), for budgets. */
  issuedBetween(fromIso, toIso) {
    const inRange = (t) => t.createdAt >= fromIso && t.createdAt < toIso;
    const awarded = this.txs.filter((t) => inRange(t) && !['redemption', 'redemption_refund', 'reversal', 'expiry'].includes(t.eventType));
    const reversed = this.txs.filter((t) => inRange(t) && t.eventType === 'reversal' && awarded.some((a) => a.id === t.sourceId));
    return awarded.reduce((s, t) => s + t.pointsDelta, 0) + reversed.reduce((s, t) => s + t.pointsDelta, 0);
  }
}

/** Check an award against the monthly reward budget before recording it. */
export function assertWithinBudget(ledger, { points, budget, fromIso, toIso }) {
  if (budget === undefined || budget === null) return;
  const used = ledger.issuedBetween(fromIso, toIso);
  if (used + points > budget) {
    throw new ScoringError('budget_exceeded', `This award would exceed the monthly budget (${used} of ${budget} used)`);
  }
}

/**
 * Request a reward. Checks stock and balance and holds the points straight away (a
 * redemption transaction); a rejected request is refunded with redemption_refund.
 * One request per requestId.
 */
export function requestRedemption(ledger, reward, { employeeId, requestId, createdAt }) {
  if (!reward.active) throw new ScoringError('unavailable', 'This reward is not available');
  if (reward.inventory !== null && reward.inventory !== undefined && reward.inventory <= 0) {
    throw new ScoringError('out_of_stock', 'This reward is out of stock');
  }
  const { tx, duplicate } = ledger.record({
    employeeId,
    eventType: 'redemption',
    pointsDelta: -reward.pointsCost,
    sourceType: 'reward',
    sourceId: reward.id,
    idempotencyKey: `redemption:${requestId}`,
    createdBy: employeeId,
    createdAt,
  });
  const inventory = duplicate || reward.inventory === null || reward.inventory === undefined ? reward.inventory : reward.inventory - 1;
  return { tx, duplicate, reward: { ...reward, inventory } };
}

export function refundRedemption(ledger, redemptionTx, { createdBy, reason, createdAt }) {
  if (redemptionTx.eventType !== 'redemption') throw new ScoringError('invalid_tx', 'Only a redemption can be refunded');
  return ledger.record({
    employeeId: redemptionTx.employeeId,
    eventType: 'redemption_refund',
    pointsDelta: -redemptionTx.pointsDelta,
    sourceType: 'transaction',
    sourceId: redemptionTx.id,
    idempotencyKey: `refund:${redemptionTx.id}`,
    createdBy, createdAt, reason,
  });
}

/** Peer recognition pays only up to the monthly cap per receiver; the rest is recorded as 0-point thanks by the caller. */
export function peerRecognitionPays(ledger, receiverId, { cap, fromIso, toIso }) {
  const count = ledger.transactions.filter(
    (t) => t.employeeId === receiverId && t.eventType === 'peer_recognition' && t.createdAt >= fromIso && t.createdAt < toIso,
  ).length;
  return count < cap;
}
