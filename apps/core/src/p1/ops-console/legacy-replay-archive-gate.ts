/**
 * U14 legacy durable replay archive condition gate (V31-26a / V3.1 §35 batch 6).
 *
 * Archive is fail-closed: every condition must pass before archiveAllowed=true.
 * Conditions (U14):
 *  1. zero active/pending legacy instances (no ExecutionPlanSnapshot on request)
 *  2. max hold window (30d) has elapsed after last legacy cleared
 *  3. audit export available
 *  4. rollback proof present (at least one passed drill)
 *  5. ops policy safety buffer after hold window
 *
 * This module is read-only evaluation + inventory port. It does not perform archive.
 */

export const LEGACY_REPLAY_MAX_HOLD_WINDOW_DAYS = 30 as const;
export const LEGACY_REPLAY_DEFAULT_OPS_BUFFER_DAYS = 7 as const;

/** Admin-config / ops policy key for fixed buffer days after hold window. */
export const LEGACY_REPLAY_OPS_BUFFER_DAYS_KEY =
  'legacy.replay.archive_ops_buffer_days' as const;

export type LegacyReplayInventorySnapshot = {
  /** In-flight tasks without ExecutionPlanSnapshot (legacy replay branch). */
  activePendingCount: number;
  oldestActiveCreatedAt: string | null;
  sampleTaskIds: string[];
  /**
   * When the most recent legacy instance became terminal (delivered/failed/
   * hold-expired). Null when no historical legacy task is known.
   */
  lastLegacyTerminalAt: string | null;
  /** Explicit ops audit proving this installation has never had legacy rows. */
  noHistoryProofAuditId?: string | null;
};

export interface LegacyReplayInventoryPort {
  snapshot(): Promise<LegacyReplayInventorySnapshot>;
}

export type LegacyReplayArchiveGateFacts = {
  inventory: LegacyReplayInventorySnapshot;
  now: string;
  maxHoldWindowDays?: number;
  opsPolicyBufferDays?: number;
  rollbackDrillPassed: boolean;
  auditExportAvailable: boolean;
};

export type LegacyReplayConditionStatus = {
  ok: boolean;
  detail: string;
};

export type LegacyReplayArchiveGateResult = {
  /** Fail closed: true only when every condition is ok. */
  archiveAllowed: boolean;
  evaluatedAt: string;
  conditions: {
    zeroActivePendingLegacy: LegacyReplayConditionStatus & { count: number };
    holdWindowComplete: LegacyReplayConditionStatus;
    auditExportAvailable: LegacyReplayConditionStatus;
    rollbackProofPresent: LegacyReplayConditionStatus;
    opsPolicyBufferComplete: LegacyReplayConditionStatus;
  };
  blockingReasons: string[];
};

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.NaN;
  return (to - from) / (24 * 60 * 60 * 1000);
}

/**
 * Pure U14 gate evaluation. Fail closed on any incomplete condition or bad clock.
 */
export function evaluateLegacyReplayArchiveGate(
  facts: LegacyReplayArchiveGateFacts,
): LegacyReplayArchiveGateResult {
  const maxHold =
    facts.maxHoldWindowDays ?? LEGACY_REPLAY_MAX_HOLD_WINDOW_DAYS;
  const bufferDays =
    facts.opsPolicyBufferDays ?? LEGACY_REPLAY_DEFAULT_OPS_BUFFER_DAYS;
  const { inventory } = facts;
  const blockingReasons: string[] = [];

  const zeroOk = inventory.activePendingCount === 0;
  const zero: LegacyReplayArchiveGateResult['conditions']['zeroActivePendingLegacy'] =
    {
      ok: zeroOk,
      count: inventory.activePendingCount,
      detail: zeroOk
        ? 'No active/pending legacy durable instances.'
        : `${inventory.activePendingCount} active/pending legacy instance(s); sample=${inventory.sampleTaskIds.slice(0, 5).join(',')}`,
    };
  if (!zeroOk) blockingReasons.push(zero.detail);

  let holdOk = false;
  let holdDetail: string;
  if (!zeroOk) {
    holdOk = false;
    holdDetail =
      'Hold window cannot complete while active/pending legacy instances remain.';
  } else if (inventory.lastLegacyTerminalAt === null) {
    holdOk = Boolean(inventory.noHistoryProofAuditId?.trim());
    holdDetail = holdOk
      ? `Audited no-history proof ${inventory.noHistoryProofAuditId}; hold window complete.`
      : 'Legacy terminal history is unknown and no audited no-history proof exists; fail closed.';
  } else {
    const elapsed = daysBetween(inventory.lastLegacyTerminalAt, facts.now);
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      holdOk = false;
      holdDetail =
        'Invalid clock or lastLegacyTerminalAt; fail closed on hold window.';
    } else if (elapsed >= maxHold) {
      holdOk = true;
      holdDetail = `Hold window complete: ${elapsed.toFixed(2)}d ≥ ${maxHold}d since last legacy terminal.`;
    } else {
      holdOk = false;
      holdDetail = `Hold window incomplete: ${elapsed.toFixed(2)}d < ${maxHold}d since last legacy terminal.`;
    }
  }
  if (!holdOk) blockingReasons.push(holdDetail);

  const auditOk = facts.auditExportAvailable === true;
  const auditDetail = auditOk
    ? 'Audit export endpoint is available.'
    : 'Audit export is unavailable; fail closed.';
  if (!auditOk) blockingReasons.push(auditDetail);

  const rollbackOk = facts.rollbackDrillPassed === true;
  const rollbackDetail = rollbackOk
    ? 'At least one passed rollback drill is on record.'
    : 'No passed rollback drill; fail closed.';
  if (!rollbackOk) blockingReasons.push(rollbackDetail);

  let bufferOk = false;
  let bufferDetail: string;
  if (!zeroOk || !holdOk) {
    bufferOk = false;
    bufferDetail =
      'Ops policy buffer requires zero active legacy and completed hold window.';
  } else if (inventory.lastLegacyTerminalAt === null) {
    bufferOk = Boolean(inventory.noHistoryProofAuditId?.trim());
    bufferDetail = bufferOk
      ? `Audited no-history proof ${inventory.noHistoryProofAuditId}; ops buffer complete.`
      : 'Legacy terminal history is unknown and no audited no-history proof exists; fail closed.';
  } else {
    const required = maxHold + bufferDays;
    const elapsed = daysBetween(inventory.lastLegacyTerminalAt, facts.now);
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      bufferOk = false;
      bufferDetail =
        'Invalid clock or lastLegacyTerminalAt; fail closed on ops buffer.';
    } else if (elapsed >= required) {
      bufferOk = true;
      bufferDetail = `Ops buffer complete: ${elapsed.toFixed(2)}d ≥ ${required}d (hold ${maxHold}d + buffer ${bufferDays}d).`;
    } else {
      bufferOk = false;
      bufferDetail = `Ops buffer incomplete: ${elapsed.toFixed(2)}d < ${required}d (hold ${maxHold}d + buffer ${bufferDays}d).`;
    }
  }
  if (!bufferOk) blockingReasons.push(bufferDetail);

  const archiveAllowed =
    zeroOk && holdOk && auditOk && rollbackOk && bufferOk;

  return {
    archiveAllowed,
    evaluatedAt: facts.now,
    conditions: {
      zeroActivePendingLegacy: zero,
      holdWindowComplete: { ok: holdOk, detail: holdDetail },
      auditExportAvailable: { ok: auditOk, detail: auditDetail },
      rollbackProofPresent: { ok: rollbackOk, detail: rollbackDetail },
      opsPolicyBufferComplete: { ok: bufferOk, detail: bufferDetail },
    },
    blockingReasons: archiveAllowed ? [] : blockingReasons,
  };
}

/** In-memory inventory for unit tests. */
export class MemoryLegacyReplayInventory implements LegacyReplayInventoryPort {
  constructor(private state: LegacyReplayInventorySnapshot) {}

  set(state: LegacyReplayInventorySnapshot) {
    this.state = state;
  }

  async snapshot(): Promise<LegacyReplayInventorySnapshot> {
    return structuredClone(this.state);
  }
}
