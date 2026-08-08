/**
 * Make Steering service (V3.1 §5.6 / §23.3 / §24 / V31-16).
 *
 * - Classifier four-state application
 * - Dual queue: steer (after current unit) / follow_up (after all units)
 * - Append-only MakeSteeringCommand bound to plan revision + snapshot
 * - Partial delivery settlement (only redo failed pages + clear refund rule)
 * - accepted / acceptance_unknown provider side effects cannot be "modified"
 * - make_steering_v1 feature flag + disable_make_steering kill switch
 */

import { randomUUID } from 'node:crypto';

import {
  STEERING_COMMAND_SCHEMA_VERSION,
  makeSteeringCommandSchema,
  type MakeSteeringCommand,
} from '@meiye/contracts';

import {
  classifySteeringInstruction,
  type SteeringClassifySignals,
  type SteeringQueueMode,
  type SteeringUnitProgress,
} from './steering-classifier.js';

export type { SteeringUnitProgress, SteeringQueueMode } from './steering-classifier.js';
import type {
  SteeringCommandStore,
  StoredSteeringCommand,
} from './steering-command-store.js';
import { SteeringCommandStoreError } from './steering-command-store.js';

// ─── Feature flags / kill switches (spec-D §16) ──────────────────────────────
// Registered in admin-config CONFIG_DEFINITIONS + ADMIN_CONFIG_KEY_CLASSIFICATION.

/** Feature flag — default on when unset (hot-read). */
export const MAKE_STEERING_FLAG = 'make_steering_v1' as const;

/** Kill switch — default off when unset; force-disables independent of flag. */
export const MAKE_STEERING_KILL_SWITCH = 'disable_make_steering' as const;

export type MakeSteeringGate = {
  /** True when the steering path is available. */
  enabled: boolean;
  reason: 'enabled' | 'feature_flag_off' | 'kill_switch';
};

/**
 * Resolve make_steering_v1 + disable_make_steering from admin-config heads.
 * Feature flag off OR kill switch true ⇒ path disabled.
 */
export async function resolveMakeSteeringGate(reader: {
  get(
    scope: 'global',
    workspaceId: string,
    key: string,
  ): Promise<{ value: unknown } | null>;
}): Promise<MakeSteeringGate> {
  const global = '__global__';
  const [flag, kill] = await Promise.all([
    reader.get('global', global, MAKE_STEERING_FLAG),
    reader.get('global', global, MAKE_STEERING_KILL_SWITCH),
  ]);
  if (kill?.value === true) {
    return { enabled: false, reason: 'kill_switch' };
  }
  // Default on when unset (same posture as agent_memory_* flags).
  if (flag?.value === false) {
    return { enabled: false, reason: 'feature_flag_off' };
  }
  return { enabled: true, reason: 'enabled' };
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export type SteeringServiceErrorCode =
  | 'DISABLED'
  | 'INVALID_INPUT'
  | 'PROVIDER_SIDE_EFFECT_IMMUTABLE'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'QUEUE_NOT_READY';

export class SteeringServiceError extends Error {
  readonly status: number;

  constructor(
    readonly code: SteeringServiceErrorCode,
    message: string,
    status = 409,
  ) {
    super(message);
    this.name = 'SteeringServiceError';
    this.status = status;
  }
}

// ─── Provider side-effect immutability (V3.1 §23.3) ─────────────────────────

export type ProviderAttemptAcceptance =
  | 'rejected_before_accept'
  | 'accepted'
  | 'acceptance_unknown';

export type SteeringProviderTouchIntent =
  | 'modify_in_place'
  | 'derived_revision'
  | 'new_attempt'
  | 'cancel_remaining'
  | 'regenerate_failed_only';

/**
 * accepted / acceptance_unknown provider side effects cannot be "modified".
 * Derived revision / new attempt / failed-only regenerate remain allowed.
 */
export function assertProviderSideEffectImmutable(input: {
  acceptance: ProviderAttemptAcceptance;
  intent: SteeringProviderTouchIntent;
}): void {
  if (
    (input.acceptance === 'accepted' ||
      input.acceptance === 'acceptance_unknown') &&
    input.intent === 'modify_in_place'
  ) {
    throw new SteeringServiceError(
      'PROVIDER_SIDE_EFFECT_IMMUTABLE',
      `Provider attempt in ${input.acceptance} cannot be modified in place; use derived_revision or a new attempt.`,
    );
  }
}

// ─── Dual queue insertion (B7 / §24) ─────────────────────────────────────────

export type MakeUnitCursor = {
  /** Unit that just finished (null at start). */
  justCompletedUnitId: string | null;
  /** Units still not finished (pending/running/failed not settled). */
  remainingUnitIds: readonly string[];
  /** True when every unit has reached a terminal success/fail state for the run. */
  allUnitsTerminal: boolean;
};

export type SteeringQueueDrainResult = {
  /** Commands ready to apply at this cursor. */
  ready: StoredSteeringCommand[];
  /** Still waiting for their insertion point. */
  stillQueued: StoredSteeringCommand[];
};

/**
 * Dual-queue drain:
 * - steer → ready as soon as the current unit completes (or immediately if no current)
 * - follow_up → ready only when all units are terminal
 */
export function drainSteeringQueue(input: {
  queued: readonly StoredSteeringCommand[];
  cursor: MakeUnitCursor;
}): SteeringQueueDrainResult {
  const ready: StoredSteeringCommand[] = [];
  const stillQueued: StoredSteeringCommand[] = [];
  for (const row of input.queued) {
    const mode = row.command.queueMode;
    if (mode === 'follow_up') {
      if (input.cursor.allUnitsTerminal) ready.push(row);
      else stillQueued.push(row);
      continue;
    }
    // steer
    if (
      input.cursor.justCompletedUnitId != null ||
      input.cursor.remainingUnitIds.length === 0 ||
      input.cursor.allUnitsTerminal
    ) {
      ready.push(row);
    } else {
      stillQueued.push(row);
    }
  }
  return { ready, stillQueued };
}

// ─── Partial delivery settlement ─────────────────────────────────────────────

export type PartialDeliveryPage = {
  pageIndex: number;
  unitId: string;
  status: 'success' | 'failed' | 'pending';
  /** Credits reserved/charged for this page (0 when free). */
  creditCost: number;
  /**
   * Model-level failure refund switch (credit-billing §). When false, failed
   * pages are not refunded even though they are retriable.
   */
  failureRefundsCredits: boolean;
  /**
   * Provider acceptance for the page attempt, when any side effect was opened.
   */
  providerAcceptance?: ProviderAttemptAcceptance;
};

export type PartialDeliverySettlement = {
  successPages: number[];
  failedPages: number[];
  pendingPages: number[];
  /** Only failed pages — never re-run success. */
  redoUnitIds: string[];
  keepUnitIds: string[];
  /** Credits to refund for failed pages that allow failure refund. */
  refundCredits: number;
  /** Pages that failed but are non-refundable by model switch. */
  nonRefundableFailedPages: number[];
  /**
   * Pages with accepted / acceptance_unknown must not be modified in place
   * when redoing — redo is regenerate_failed_only (new attempt / derived).
   */
  immutableProviderPages: number[];
  refundRule: string;
  merchantMessage: string;
};

/**
 * 6 success / 5 fail style settlement: only redo failed pages; refund rule clear.
 */
export function settlePartialDelivery(input: {
  pages: readonly PartialDeliveryPage[];
}): PartialDeliverySettlement {
  const successPages: number[] = [];
  const failedPages: number[] = [];
  const pendingPages: number[] = [];
  const redoUnitIds: string[] = [];
  const keepUnitIds: string[] = [];
  const nonRefundableFailedPages: number[] = [];
  const immutableProviderPages: number[] = [];
  let refundCredits = 0;

  for (const page of input.pages) {
    if (page.status === 'success') {
      successPages.push(page.pageIndex);
      keepUnitIds.push(page.unitId);
      if (
        page.providerAcceptance === 'accepted' ||
        page.providerAcceptance === 'acceptance_unknown'
      ) {
        immutableProviderPages.push(page.pageIndex);
      }
      continue;
    }
    if (page.status === 'pending') {
      pendingPages.push(page.pageIndex);
      continue;
    }
    // failed
    failedPages.push(page.pageIndex);
    redoUnitIds.push(page.unitId);
    if (
      page.providerAcceptance === 'accepted' ||
      page.providerAcceptance === 'acceptance_unknown'
    ) {
      // Still redo as new attempt — never modify in place.
      immutableProviderPages.push(page.pageIndex);
      assertProviderSideEffectImmutable({
        acceptance: page.providerAcceptance,
        intent: 'regenerate_failed_only',
      });
    }
    if (page.failureRefundsCredits && page.creditCost > 0) {
      refundCredits += page.creditCost;
    } else if (page.creditCost > 0) {
      nonRefundableFailedPages.push(page.pageIndex);
    }
  }

  const successCount = successPages.length;
  const failedCount = failedPages.length;
  const refundRule =
    failedCount === 0
      ? '无失败页，不退费。'
      : refundCredits > 0
        ? `失败页按模型失败退还开关退回 ${refundCredits} 积分；成功页保留且不重做。`
        : nonRefundableFailedPages.length > 0
          ? '失败页可重做，但当前模型关闭失败退还，已扣积分不退；成功页保留。'
          : '失败页可重做；无已扣积分需退还。成功页保留。';

  const merchantMessage =
    failedCount === 0
      ? `全部 ${successCount} 页已完成。`
      : `${successCount} 页已成功，${failedCount} 页失败。将只重做失败页；成功页保持不变。${refundRule}`;

  return {
    successPages,
    failedPages,
    pendingPages,
    redoUnitIds,
    keepUnitIds,
    refundCredits,
    nonRefundableFailedPages,
    immutableProviderPages,
    refundRule,
    merchantMessage,
  };
}

// ─── Submit / apply ──────────────────────────────────────────────────────────

export type SubmitSteeringInput = {
  commandId?: string;
  workspaceId: string;
  threadId: string;
  taskId: string;
  workId?: string;
  actorId: string;
  instruction: string;
  sourcePlanRevision: number;
  sourceContentVersionIds?: string[];
  /** Frozen ExecutionPlanSnapshot hash (V31-14 consume chain). */
  snapshotHash?: string;
  units: readonly SteeringUnitProgress[];
  queueModeHint?: SteeringQueueMode;
  signals?: SteeringClassifySignals;
  createdAt?: string;
  /**
   * When true, apply future_step_patch immediately (unit boundary already free).
   * Default false → queue for steer/follow_up insertion timing.
   */
  applyImmediately?: boolean;
};

export type SubmitSteeringResult = {
  command: MakeSteeringCommand;
  classification: MakeSteeringCommand['classification'];
  queueMode: SteeringQueueMode;
  applicationStatus: StoredSteeringCommand['applicationStatus'];
  impactSummary: string;
  preservedUnitIds: string[];
  affectedUnitIds: string[];
  /**
   * plan_change → consumer must replan+requote via Plan Compiler (V31-09)
   * and confirmation objects (V31-11). This service does not invent money.
   */
  nextAction:
    | 'apply_patch'
    | 'queue_wait'
    | 'create_derived_revision'
    | 'replan_requote_confirm'
    | 'ask_merchant_correct'
    | 'disabled';
  replayed: boolean;
};

export type MakeSteeringGateSource =
  | MakeSteeringGate
  | (() => MakeSteeringGate | Promise<MakeSteeringGate>);

export type SteeringServiceOptions = {
  store: SteeringCommandStore;
  resolveGate?: MakeSteeringGateSource;
  now?: () => string;
  idFactory?: () => string;
};

async function readGate(
  source: MakeSteeringGateSource | undefined,
): Promise<MakeSteeringGate> {
  if (!source) return { enabled: true, reason: 'enabled' };
  if (typeof source === 'function') return source();
  return source;
}

export class SteeringService {
  private readonly store: SteeringCommandStore;
  private readonly resolveGate: MakeSteeringGateSource | undefined;
  private readonly now: () => string;
  private readonly idFactory: () => string;

  constructor(options: SteeringServiceOptions) {
    this.store = options.store;
    this.resolveGate = options.resolveGate;
    this.now = options.now ?? (() => new Date().toISOString());
    this.idFactory = options.idFactory ?? (() => `steer-${randomUUID()}`);
  }

  async submit(input: SubmitSteeringInput): Promise<SubmitSteeringResult> {
    const instruction = input.instruction?.trim();
    if (!instruction) {
      throw new SteeringServiceError(
        'INVALID_INPUT',
        'Steering instruction is required.',
        400,
      );
    }
    if (!Number.isInteger(input.sourcePlanRevision) || input.sourcePlanRevision < 1) {
      throw new SteeringServiceError(
        'INVALID_INPUT',
        'sourcePlanRevision must be a positive integer bound to the frozen plan.',
        400,
      );
    }

    const gate = await readGate(this.resolveGate);
    const commandId = input.commandId ?? this.idFactory();
    const createdAt = input.createdAt ?? this.now();

    if (!gate.enabled) {
      const classified = classifySteeringInstruction({
        instruction,
        units: input.units,
        queueModeHint: input.queueModeHint,
        signals: input.signals,
      });
      const command = makeSteeringCommandSchema.parse({
        schemaVersion: STEERING_COMMAND_SCHEMA_VERSION,
        commandId,
        threadId: input.threadId,
        taskId: input.taskId,
        ...(input.workId ? { workId: input.workId } : {}),
        sourcePlanRevision: input.sourcePlanRevision,
        sourceContentVersionIds: input.sourceContentVersionIds ?? [],
        ...(input.snapshotHash ? { snapshotHash: input.snapshotHash } : {}),
        instruction,
        classification: classified.classification,
        affectedUnitIds: classified.affectedUnitIds,
        queueMode: classified.queueMode,
        createdAt,
        actorId: input.actorId,
      });
      const stored = await this.store.put({
        command,
        workspaceId: input.workspaceId,
        applicationStatus: 'disabled',
        impactSummary: `中途干预已关闭（${gate.reason === 'kill_switch' ? 'kill switch' : 'feature flag'}）。`,
      });
      return {
        command: stored.command,
        classification: stored.command.classification,
        queueMode: stored.command.queueMode,
        applicationStatus: 'disabled',
        impactSummary: stored.impactSummary,
        preservedUnitIds: classified.preservedUnitIds,
        affectedUnitIds: classified.affectedUnitIds,
        nextAction: 'disabled',
        replayed: false,
      };
    }

    // Idempotent replay on same commandId.
    if (input.commandId) {
      const existing = await this.store.getById(input.commandId);
      if (existing) {
        if (
          existing.workspaceId === input.workspaceId &&
          existing.command.instruction === instruction &&
          existing.command.taskId === input.taskId &&
          existing.command.sourcePlanRevision === input.sourcePlanRevision
        ) {
          return {
            command: existing.command,
            classification: existing.command.classification,
            queueMode: existing.command.queueMode,
            applicationStatus: existing.applicationStatus,
            impactSummary: existing.impactSummary,
            preservedUnitIds: [],
            affectedUnitIds: existing.command.affectedUnitIds,
            nextAction: nextActionOf(
              existing.command.classification.kind,
              existing.applicationStatus,
            ),
            replayed: true,
          };
        }
        throw new SteeringServiceError(
          'IDEMPOTENCY_CONFLICT',
          `Steering command ${input.commandId} already exists with a different payload.`,
        );
      }
    }

    const classified = classifySteeringInstruction({
      instruction,
      units: input.units,
      queueModeHint: input.queueModeHint,
      signals: input.signals,
    });

    const command = makeSteeringCommandSchema.parse({
      schemaVersion: STEERING_COMMAND_SCHEMA_VERSION,
      commandId,
      threadId: input.threadId,
      taskId: input.taskId,
      ...(input.workId ? { workId: input.workId } : {}),
      sourcePlanRevision: input.sourcePlanRevision,
      sourceContentVersionIds: input.sourceContentVersionIds ?? [],
      ...(input.snapshotHash ? { snapshotHash: input.snapshotHash } : {}),
      instruction,
      classification: classified.classification,
      affectedUnitIds: classified.affectedUnitIds,
      queueMode: classified.queueMode,
      createdAt,
      actorId: input.actorId,
    });

    const applicationStatus = resolveApplicationStatus({
      classificationKind: classified.classification.kind,
      queueMode: classified.queueMode,
      applyImmediately: input.applyImmediately === true,
    });

    const stored = await this.store.put({
      command,
      workspaceId: input.workspaceId,
      applicationStatus,
      impactSummary: classified.impactSummary,
    });

    return {
      command: stored.command,
      classification: stored.command.classification,
      queueMode: stored.command.queueMode,
      applicationStatus: stored.applicationStatus,
      impactSummary: stored.impactSummary,
      preservedUnitIds: classified.preservedUnitIds,
      affectedUnitIds: classified.affectedUnitIds,
      nextAction: nextActionOf(
        classified.classification.kind,
        stored.applicationStatus,
      ),
      replayed: false,
    };
  }

  /**
   * Make unit-boundary hook (hangs off V31-14 snapshot consume chain).
   * Drains dual queue and marks ready commands accepted.
   */
  async onUnitBoundary(input: {
    workspaceId: string;
    taskId: string;
    cursor: MakeUnitCursor;
  }): Promise<SteeringQueueDrainResult> {
    const queued = await this.store.listQueued({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
    });
    const drained = drainSteeringQueue({ queued, cursor: input.cursor });
    for (const row of drained.ready) {
      // plan_change / unsafe should not have been queued; belt-and-suspenders.
      if (
        row.command.classification.kind === 'plan_change' ||
        row.command.classification.kind === 'unsafe_or_conflicting'
      ) {
        continue;
      }
      await this.store.markApplied({
        commandId: row.command.commandId,
        applicationStatus: 'accepted',
        impactSummary: row.impactSummary,
      });
    }
    return {
      ready: drained.ready.map((row) => ({
        ...row,
        applicationStatus:
          row.command.classification.kind === 'plan_change' ||
          row.command.classification.kind === 'unsafe_or_conflicting'
            ? row.applicationStatus
            : 'accepted',
      })),
      stillQueued: drained.stillQueued,
    };
  }

  async listByTask(input: {
    workspaceId: string;
    taskId: string;
  }): Promise<StoredSteeringCommand[]> {
    return this.store.listByTask(input);
  }

  async getCommand(commandId: string): Promise<StoredSteeringCommand | null> {
    return this.store.getById(commandId);
  }

  /**
   * Runtime overlays for not-yet-executed units (V3.1 §5.6 future_step_patch).
   * Reads append-only accepted commands only — never mutates ExecutionPlanSnapshot.
   * Flag/kill-switch off ⇒ empty list (zero apply).
   */
  async listAcceptedFutureStepPatches(input: {
    workspaceId: string;
    taskId: string;
    unitId?: string;
  }): Promise<
    Array<{
      commandId: string;
      instruction: string;
      affectedUnitIds: string[];
    }>
  > {
    const gate = await readGate(this.resolveGate);
    if (!gate.enabled) return [];
    const rows = await this.store.listByTask({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
    });
    return rows
      .filter(
        (row) =>
          row.applicationStatus === 'accepted' &&
          row.command.classification.kind === 'future_step_patch' &&
          (input.unitId == null ||
            (row.command.affectedUnitIds as string[]).includes(input.unitId)),
      )
      .map((row) => ({
        commandId: row.command.commandId,
        instruction: row.command.instruction,
        affectedUnitIds: row.command.affectedUnitIds as string[],
      }));
  }
}

function resolveApplicationStatus(input: {
  classificationKind: MakeSteeringCommand['classification']['kind'];
  queueMode: SteeringQueueMode;
  applyImmediately: boolean;
}): StoredSteeringCommand['applicationStatus'] {
  if (input.classificationKind === 'unsafe_or_conflicting') {
    return 'rejected_unsafe';
  }
  if (input.classificationKind === 'plan_change') {
    return 'requires_replan_confirm';
  }
  if (input.applyImmediately) {
    return 'accepted';
  }
  return input.queueMode === 'follow_up' ? 'queued_follow_up' : 'queued_steer';
}

function nextActionOf(
  kind: MakeSteeringCommand['classification']['kind'],
  status: StoredSteeringCommand['applicationStatus'],
): SubmitSteeringResult['nextAction'] {
  if (status === 'disabled') return 'disabled';
  if (kind === 'unsafe_or_conflicting') return 'ask_merchant_correct';
  if (kind === 'plan_change') return 'replan_requote_confirm';
  if (kind === 'derived_revision') {
    return status === 'accepted' || status.startsWith('queued')
      ? 'create_derived_revision'
      : 'create_derived_revision';
  }
  if (status === 'queued_steer' || status === 'queued_follow_up') {
    return 'queue_wait';
  }
  return 'apply_patch';
}

export function mapSteeringStoreError(error: unknown): never {
  if (error instanceof SteeringCommandStoreError) {
    if (error.code === 'NOT_FOUND') {
      throw new SteeringServiceError('NOT_FOUND', error.message, 404);
    }
    if (error.code === 'IDEMPOTENCY_CONFLICT') {
      throw new SteeringServiceError('IDEMPOTENCY_CONFLICT', error.message);
    }
    throw new SteeringServiceError('INVALID_INPUT', error.message, 400);
  }
  throw error;
}
