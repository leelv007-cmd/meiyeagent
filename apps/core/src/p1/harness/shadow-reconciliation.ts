/**
 * Make shadow reconciliation (V31-13 / V3.1 §23.2).
 *
 * Transition-period dual-path check: new-chain ExecutionPlanSnapshot product vs
 * old-chain deterministic fields only (deliverable count/carrier, fact refs,
 * rights refs, quote, bounds). Zero LLM. Sampled (~10%, configurable) on the
 * existing Make execution-complete path — no daemon/cron.
 *
 * Mismatch is evidence-only (never changes production results). Close leaves
 * an audit trail on the existing ops-console audit surface.
 */

import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type {
  BoundedExecutionSnapshot,
  ExecutionPlanSnapshot,
  PlanDeliverable,
} from '@meiye/contracts';

import type {
  OpsConsoleAuditEntry,
  OpsConsoleAuditStore,
} from '../ops-console/audit.js';
import type { ShadowReconciliationStore } from './shadow-reconciliation-store.js';

// ─── Config keys (admin-config hot-read) ────────────────────────────────────

export const SHADOW_RECONCILIATION_SAMPLE_RATE_KEY =
  'make.shadow_reconciliation.sample_rate' as const;
export const SHADOW_RECONCILIATION_WINDOW_DAYS_KEY =
  'make.shadow_reconciliation.window_days' as const;

export const DEFAULT_SHADOW_SAMPLE_RATE = 0.1;
export const DEFAULT_SHADOW_WINDOW_DAYS = 14;
export const MIN_SHADOW_WINDOW_DAYS = 14;
export const MAX_SHADOW_WINDOW_DAYS = 28;

export type ShadowReconciliationConfig = {
  sampleRate: number;
  windowDays: number;
};

export function resolveShadowReconciliationConfig(input: {
  sampleRate?: unknown;
  windowDays?: unknown;
}): ShadowReconciliationConfig {
  const sampleRate = clampNumber(
    typeof input.sampleRate === 'number' && Number.isFinite(input.sampleRate)
      ? input.sampleRate
      : DEFAULT_SHADOW_SAMPLE_RATE,
    0,
    1,
  );
  const windowDays = Math.round(
    clampNumber(
      typeof input.windowDays === 'number' && Number.isFinite(input.windowDays)
        ? input.windowDays
        : DEFAULT_SHADOW_WINDOW_DAYS,
      MIN_SHADOW_WINDOW_DAYS,
      MAX_SHADOW_WINDOW_DAYS,
    ),
  );
  return { sampleRate, windowDays };
}

/**
 * Hot-read sample rate + window from admin-config (global scope).
 * Unset keys fall back to defaults.
 */
export async function resolveShadowReconciliationConfigFromAdmin(reader: {
  get(
    scope: 'global',
    workspaceId: string,
    key: string,
  ): Promise<{ value: unknown } | null>;
}): Promise<ShadowReconciliationConfig> {
  const [rateRev, windowRev] = await Promise.all([
    reader.get('global', '__global__', SHADOW_RECONCILIATION_SAMPLE_RATE_KEY),
    reader.get('global', '__global__', SHADOW_RECONCILIATION_WINDOW_DAYS_KEY),
  ]);
  return resolveShadowReconciliationConfig({
    sampleRate: rateRev?.value,
    windowDays: windowRev?.value,
  });
}

// ─── Deterministic projection ───────────────────────────────────────────────

export type ShadowDeliverableCarrier = PlanDeliverable['kind'];

export type ShadowDeterministicFields = {
  deliverables: Array<{ kind: ShadowDeliverableCarrier; quantity: number }>;
  factRefs: string[];
  rightsRefs: string[];
  quoteRef: { id: string; revision: number | string };
  bounds: {
    maxIterations: number | 'unset';
    maxCostCents: number | 'unset';
    maxWallClockMs: number | 'unset';
    maxDelegations: number | 'unset';
  };
};

export type ShadowFieldDiff = {
  field: string;
  expected: unknown;
  actual: unknown;
};

export type ShadowCompareResult = {
  match: boolean;
  diffs: ShadowFieldDiff[];
};

/** New-chain product: freeze on ExecutionPlanSnapshot (V31-14 consume path). */
export function extractDeterministicFieldsFromSnapshot(
  snapshot: ExecutionPlanSnapshot,
): ShadowDeterministicFields {
  return projectLegacyDeterministicFields({
    deliverables: snapshot.deliverables.map((d) => ({
      kind: d.kind,
      quantity: d.quantity,
    })),
    factRefs: snapshot.factRevisionRefs,
    rightsRefs: snapshot.rightsRevisionRefs,
    quoteRef: snapshot.quoteRef,
    bounds: boundsFromSnapshot(snapshot.boundedExecution),
  });
}

/**
 * Old-chain product: only deterministic fields the legacy Make path still
 * carries (no intent text / brief wording).
 */
export function projectLegacyDeterministicFields(input: {
  deliverables: Array<{ kind: ShadowDeliverableCarrier; quantity: number }>;
  factRefs: readonly string[];
  rightsRefs: readonly string[];
  quoteRef: { id: string; revision: number | string };
  bounds: ShadowDeterministicFields['bounds'];
}): ShadowDeterministicFields {
  return {
    deliverables: normalizeDeliverables(input.deliverables),
    factRefs: normalizeRefs(input.factRefs),
    rightsRefs: normalizeRefs(input.rightsRefs),
    quoteRef: {
      id: input.quoteRef.id,
      revision: input.quoteRef.revision,
    },
    bounds: { ...input.bounds },
  };
}

export function boundsFromSnapshot(
  bounded: Pick<
    BoundedExecutionSnapshot,
    | 'maxIterations'
    | 'maxCostCents'
    | 'maxWallClockMs'
    | 'maxDelegations'
  >,
): ShadowDeterministicFields['bounds'] {
  return {
    maxIterations: bounded.maxIterations,
    maxCostCents: bounded.maxCostCents,
    maxWallClockMs: bounded.maxWallClockMs,
    maxDelegations: bounded.maxDelegations,
  };
}

/**
 * Compare new-chain vs old-chain deterministic fields.
 * Field-level diffs only — never hashes intent/brief LLM text.
 */
export function compareShadowDeterministicFields(
  newChain: ShadowDeterministicFields,
  oldChain: ShadowDeterministicFields,
): ShadowCompareResult {
  const diffs: ShadowFieldDiff[] = [];

  if (!isDeepStrictEqual(newChain.deliverables, oldChain.deliverables)) {
    diffs.push({
      field: 'deliverables',
      expected: newChain.deliverables,
      actual: oldChain.deliverables,
    });
  }
  if (!isDeepStrictEqual(newChain.factRefs, oldChain.factRefs)) {
    diffs.push({
      field: 'factRefs',
      expected: newChain.factRefs,
      actual: oldChain.factRefs,
    });
  }
  if (!isDeepStrictEqual(newChain.rightsRefs, oldChain.rightsRefs)) {
    diffs.push({
      field: 'rightsRefs',
      expected: newChain.rightsRefs,
      actual: oldChain.rightsRefs,
    });
  }
  if (newChain.quoteRef.id !== oldChain.quoteRef.id) {
    diffs.push({
      field: 'quoteRef.id',
      expected: newChain.quoteRef.id,
      actual: oldChain.quoteRef.id,
    });
  }
  if (newChain.quoteRef.revision !== oldChain.quoteRef.revision) {
    diffs.push({
      field: 'quoteRef.revision',
      expected: newChain.quoteRef.revision,
      actual: oldChain.quoteRef.revision,
    });
  }
  for (const key of [
    'maxIterations',
    'maxCostCents',
    'maxWallClockMs',
    'maxDelegations',
  ] as const) {
    if (newChain.bounds[key] !== oldChain.bounds[key]) {
      diffs.push({
        field: `bounds.${key}`,
        expected: newChain.bounds[key],
        actual: oldChain.bounds[key],
      });
    }
  }

  return { match: diffs.length === 0, diffs };
}

// ─── Sampling ───────────────────────────────────────────────────────────────

/**
 * Deterministic sample gate (hash of sampleKey). Same key → same decision.
 * No Math.random — safe for durable / DBOS re-execution.
 */
export function shouldSampleShadowReconciliation(input: {
  sampleRate: number;
  sampleKey: string;
}): boolean {
  const rate = clampNumber(input.sampleRate, 0, 1);
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  const digest = createHash('sha256')
    .update(`shadow-reconcil-v1:${input.sampleKey}`)
    .digest();
  const unit = digest.readUInt32BE(0) / 0x1_0000_0000;
  return unit < rate;
}

// ─── Program state / samples ────────────────────────────────────────────────

export type ShadowCloseReason = 'early_achieved' | 'timebox_expired';

export type ShadowProgramState = {
  status: 'open' | 'closed';
  openedAt: string;
  updatedAt: string;
  closeReason: ShadowCloseReason | null;
  closedAt: string | null;
  closedBy: string | null;
  lastMismatchAt: string | null;
  sampleCount: number;
  mismatchCount: number;
};

export type ShadowReconciliationSample = {
  id: string;
  workflowId: string;
  workspaceId: string;
  snapshotHash: string;
  matched: boolean;
  diffs: ShadowFieldDiff[];
  sampledAt: string;
  newChain: ShadowDeterministicFields;
  oldChain: ShadowDeterministicFields;
};

export type ShadowCloseDecision = {
  reason: ShadowCloseReason;
  closedAt: string;
};

// ─── Service ────────────────────────────────────────────────────────────────

export type ShadowReconcileOnCompleteInput = {
  workflowId: string;
  workspaceId: string;
  snapshot: ExecutionPlanSnapshot;
  oldChain: ShadowDeterministicFields;
  now: string;
  operatorId?: string;
  correlationId?: string;
};

export type ShadowReconcileOutcome = {
  sampled: boolean;
  match?: boolean;
  diffs?: ShadowFieldDiff[];
  closed?: ShadowCloseDecision | null;
  error?: boolean;
};

export type ShadowReconciliationServiceDeps = {
  store: ShadowReconciliationStore;
  audit: OpsConsoleAuditStore;
  resolveConfig: () => Promise<ShadowReconciliationConfig>;
};

export class ShadowReconciliationService {
  constructor(private readonly deps: ShadowReconciliationServiceDeps) {}

  async shouldObserveLegacyExecution(sampleKey: string): Promise<boolean> {
    const state = await this.deps.store.getProgramState();
    if (state?.status === 'closed') return false;
    const config = await this.deps.resolveConfig();
    return shouldSampleShadowReconciliation({
      sampleRate: config.sampleRate,
      sampleKey,
    });
  }

  /**
   * Hook for Make execution-complete path. Failures never throw — evidence only.
   */
  async maybeReconcileOnExecutionComplete(
    input: ShadowReconcileOnCompleteInput,
  ): Promise<ShadowReconcileOutcome> {
    try {
      const state = await this.deps.store.getProgramState();
      if (state?.status === 'closed') return { sampled: false };
      const config = await this.deps.resolveConfig();
      if (
        !shouldSampleShadowReconciliation({
          sampleRate: config.sampleRate,
          sampleKey: input.workflowId,
        })
      ) {
        return { sampled: false };
      }

      const newChain = extractDeterministicFieldsFromSnapshot(input.snapshot);
      const comparison = compareShadowDeterministicFields(
        newChain,
        input.oldChain,
      );
      const sample: ShadowReconciliationSample = {
        id: randomUUID(),
        workflowId: input.workflowId,
        workspaceId: input.workspaceId,
        snapshotHash: input.snapshot.snapshotHash,
        matched: comparison.match,
        diffs: comparison.diffs,
        sampledAt: input.now,
        newChain,
        oldChain: input.oldChain,
      };
      const inserted = await this.deps.store.putSampleIfOpen(sample);
      if (!inserted.accepted) return { sampled: false };
      const stored = inserted.sample;

      if (!stored.matched) {
        await this.appendAudit({
          action: 'shadow_reconciliation_mismatch',
          operatorId: input.operatorId ?? 'system',
          reason: 'Shadow deterministic-field mismatch (evidence only)',
          evidence: stored.snapshotHash,
          target: stored.workflowId,
          detail: {
            workspaceId: stored.workspaceId,
            snapshotHash: stored.snapshotHash,
            diffs: stored.diffs,
          },
          correlationId: input.correlationId ?? stored.workflowId,
          createdAt: input.now,
        });
      }

      const closed = await this.tryCloseIfEligible({
        now: input.now,
        operatorId: input.operatorId ?? 'system',
        correlationId: input.correlationId ?? input.workflowId,
        config,
      });

      return {
        sampled: true,
        match: stored.matched,
        diffs: stored.diffs,
        closed,
      };
    } catch (error) {
      console.error('Shadow reconciliation sample failed.', error);
      return { sampled: false, error: true };
    }
  }

  /**
   * Close when continuous windowDays has mismatch=0 (early_achieved) or
   * openedAt+windowDays elapsed (timebox_expired). Idempotent once closed.
   */
  async tryCloseIfEligible(input: {
    now: string;
    operatorId: string;
    correlationId: string;
    config?: ShadowReconciliationConfig;
  }): Promise<ShadowCloseDecision | null> {
    try {
      const config = input.config ?? (await this.deps.resolveConfig());
      const state = await this.deps.store.getProgramState();
      if (!state || state.status === 'closed') return null;

      const windowMs = config.windowDays * 24 * 60 * 60 * 1000;
      const nowMs = Date.parse(input.now);
      const openedMs = Date.parse(state.openedAt);
      if (!Number.isFinite(nowMs) || !Number.isFinite(openedMs)) return null;

      const freeAnchorIso = state.lastMismatchAt ?? state.openedAt;
      const freeAnchorMs = Date.parse(freeAnchorIso);
      const continuousFreeMs = nowMs - freeAnchorMs;
      const elapsedMs = nowMs - openedMs;
      // The mismatch at the anchor starts the next clean interval; it is not
      // part of that interval. Stores therefore implement this as sampledAt > anchor.
      const mismatchesSinceAnchor =
        await this.deps.store.countMismatchesSince(freeAnchorIso);

      let reason: ShadowCloseReason | null = null;
      if (
        continuousFreeMs >= windowMs &&
        mismatchesSinceAnchor === 0 &&
        state.sampleCount > 0
      ) {
        reason = 'early_achieved';
      } else if (elapsedMs >= windowMs) {
        reason = 'timebox_expired';
      }
      if (!reason) return null;

      const closedAt = input.now;
      const closedState: ShadowProgramState = {
        ...state,
        status: 'closed',
        updatedAt: closedAt,
        closeReason: reason,
        closedAt,
        closedBy: input.operatorId,
      };
      const wonClose = await this.deps.store.closeProgramStateCas(
        state,
        closedState,
      );
      if (!wonClose) return null;
      await this.appendAudit({
        action: 'close_shadow_reconciliation',
        operatorId: input.operatorId,
        reason:
          reason === 'early_achieved'
            ? `Continuous ${config.windowDays}d mismatch=0 — early close`
            : `Shadow timebox ${config.windowDays}d expired`,
        evidence: reason,
        target: 'make.shadow_reconciliation',
        detail: {
          reason,
          windowDays: config.windowDays,
          openedAt: state.openedAt,
          sampleCount: state.sampleCount,
          mismatchCount: state.mismatchCount,
          lastMismatchAt: state.lastMismatchAt,
        },
        correlationId: input.correlationId,
        createdAt: closedAt,
      });
      return { reason, closedAt };
    } catch (error) {
      console.error('Shadow reconciliation close check failed.', error);
      return null;
    }
  }

  private async appendAudit(input: {
    action: OpsConsoleAuditEntry['action'];
    operatorId: string;
    reason: string;
    evidence: string | null;
    target: string;
    detail: Record<string, unknown>;
    correlationId: string;
    createdAt: string;
  }): Promise<void> {
    await this.deps.audit.append({
      id: randomUUID(),
      action: input.action,
      operatorId: input.operatorId,
      reason: input.reason,
      evidence: input.evidence,
      target: input.target,
      detail: input.detail,
      createdAt: input.createdAt,
      correlationId: input.correlationId,
    });
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function clampNumber(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeRefs(refs: readonly string[]): string[] {
  return [...new Set(refs.map((r) => r.trim()).filter(Boolean))].sort();
}

function normalizeDeliverables(
  items: Array<{ kind: ShadowDeliverableCarrier; quantity: number }>,
): Array<{ kind: ShadowDeliverableCarrier; quantity: number }> {
  const byKind = new Map<ShadowDeliverableCarrier, number>();
  for (const item of items) {
    byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + item.quantity);
  }
  return [...byKind.entries()]
    .map(([kind, quantity]) => ({ kind, quantity }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}
