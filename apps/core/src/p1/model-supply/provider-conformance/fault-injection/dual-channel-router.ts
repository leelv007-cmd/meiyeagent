/**
 * Dual-channel fault-injection router (MP-08).
 *
 * Product Core owns retry/fallback:
 * - reject_before_accept + fallbackConsent → switch to next candidate
 * - accepted / acceptance_unknown → no cross-channel resubmit; reconcile
 * - isolate/drain of a channel → new tasks skip it without process restart
 * - RouteSnapshot + bilateral ledger freezes are replayable
 */
import { createHash, randomUUID } from 'node:crypto';
import type { CanonicalRouteSnapshot, SupplyChannelKind } from '@meiye/contracts';
import {
  replayCanonicalRouteSnapshot,
  serializeCanonicalRouteSnapshot,
} from '../../../route-snapshot-normalize.js';
import type { Acceptance } from '../../supply-contracts.js';
import type {
  BilateralLedgerFreeze,
  DualChannelAttemptRecord,
  DualChannelDisposition,
  DualChannelRouteCandidate,
  FaultInjectionModality,
  FaultInjectionOperation,
} from './types.js';

export interface ChannelExecutionOutcome {
  acceptance: Acceptance;
  providerTaskRef?: string;
  errorCode?: string;
  retryable?: boolean;
  message?: string;
  costAmount?: number;
  currency?: 'CNY' | 'USD';
}

export type ChannelExecutor = (input: {
  candidate: DualChannelRouteCandidate;
  effectIdempotencyKey: string;
  attemptRank: number;
}) => Promise<ChannelExecutionOutcome>;

export interface DualChannelRouterInput {
  operation: FaultInjectionOperation;
  modality: FaultInjectionModality;
  candidates: DualChannelRouteCandidate[];
  /** Max route attempts ("两候选"). */
  attemptLimit?: number;
  fallbackConsent?: boolean;
  workspaceId?: string;
  catalogModelId: string;
  effectIdempotencyKey: string;
  execute: ChannelExecutor;
  observedAt?: string;
}

export interface DualChannelRouterResult {
  disposition: DualChannelDisposition;
  attempts: DualChannelAttemptRecord[];
  winningDeploymentId?: string;
  winningChannelKind?: SupplyChannelKind;
  routeSnapshot: CanonicalRouteSnapshot;
  bilateralLedger: BilateralLedgerFreeze;
  /** True when accepted/unknown blocked further channel submits. */
  enteredReconcile: boolean;
  /** Serialize+parse equality for snapshot. */
  snapshotReplayable: boolean;
  /** Ledger freeze round-trips without loss. */
  ledgerReplayable: boolean;
}

const ATTEMPT_LIMIT = 2;

export function selectEligibleCandidates(
  candidates: readonly DualChannelRouteCandidate[],
): DualChannelRouteCandidate[] {
  return candidates.filter((c) => !c.isolated && !c.draining);
}

export function planDualChannelAttempts(
  candidates: readonly DualChannelRouteCandidate[],
  attemptLimit = ATTEMPT_LIMIT,
): DualChannelRouteCandidate[] {
  return selectEligibleCandidates(candidates).slice(0, attemptLimit);
}

export async function runDualChannelRouter(
  input: DualChannelRouterInput,
): Promise<DualChannelRouterResult> {
  const attemptLimit = input.attemptLimit ?? ATTEMPT_LIMIT;
  const fallbackConsent = input.fallbackConsent ?? true;
  const observedAt = input.observedAt ?? new Date().toISOString();
  const planned = planDualChannelAttempts(input.candidates, attemptLimit);

  const attempts: DualChannelAttemptRecord[] = [];
  let disposition: DualChannelDisposition = 'failed_no_fallback';
  let winningDeploymentId: string | undefined;
  let winningChannelKind: SupplyChannelKind | undefined;
  let enteredReconcile = false;
  let lastOutcome: ChannelExecutionOutcome | undefined;

  for (let i = 0; i < planned.length; i += 1) {
    const candidate = planned[i]!;
    const outcome = await input.execute({
      candidate,
      effectIdempotencyKey: input.effectIdempotencyKey,
      attemptRank: i + 1,
    });
    lastOutcome = outcome;

    const switched = i > 0;
    attempts.push({
      rank: i + 1,
      deploymentId: candidate.deploymentId,
      channelKind: candidate.channelKind,
      acceptance: outcome.acceptance,
      providerTaskRef: outcome.providerTaskRef,
      errorCode: outcome.errorCode,
      switched,
    });

    if (outcome.acceptance === 'accepted') {
      disposition = i === 0 ? 'primary_succeeded' : 'switched_to_fallback';
      winningDeploymentId = candidate.deploymentId;
      winningChannelKind = candidate.channelKind;
      break;
    }

    if (outcome.acceptance === 'acceptance_unknown') {
      // Must NOT cross-channel resubmit — enter reconcile.
      disposition = 'reconcile_no_resubmit';
      enteredReconcile = true;
      winningDeploymentId = candidate.deploymentId;
      winningChannelKind = candidate.channelKind;
      break;
    }

    // rejected_before_accept
    if (
      outcome.acceptance === 'rejected_before_accept' &&
      fallbackConsent &&
      i + 1 < planned.length
    ) {
      // Continue to next candidate.
      continue;
    }

    disposition = 'failed_no_fallback';
    break;
  }

  // If primary was isolated/draining and only fallback ran:
  if (
    attempts.length === 1 &&
    attempts[0] &&
    input.candidates[0] &&
    (input.candidates[0].isolated || input.candidates[0].draining) &&
    attempts[0].deploymentId !== input.candidates[0].deploymentId
  ) {
    disposition =
      attempts[0].acceptance === 'accepted'
        ? 'fallback_only'
        : disposition;
  }
  if (
    attempts.length === 1 &&
    input.candidates.some((c) => c.isolated || c.draining) &&
    attempts[0]?.acceptance === 'accepted' &&
    attempts[0].deploymentId !==
      input.candidates.find((c) => !c.isolated && !c.draining)?.deploymentId
  ) {
    // no-op guard
  }
  // Prefer explicit: if first planned candidate is not the first registered
  // candidate (because primary was filtered), mark fallback_only on success.
  const firstRegistered = input.candidates[0];
  if (
    firstRegistered &&
    (firstRegistered.isolated || firstRegistered.draining) &&
    attempts[0]?.acceptance === 'accepted'
  ) {
    disposition = 'fallback_only';
    winningDeploymentId = attempts[0].deploymentId;
    winningChannelKind = attempts[0].channelKind;
  }

  const routeSnapshot = freezeRouteSnapshot({
    operation: input.operation,
    modality: input.modality,
    catalogModelId: input.catalogModelId,
    candidates: input.candidates,
    planned,
    actualDeploymentId: winningDeploymentId ?? planned[0]?.deploymentId,
    fallbackConsent,
    workspaceId: input.workspaceId ?? 'ws-fault-injection',
    observedAt,
  });

  const bilateralLedger = freezeBilateralLedger({
    modality: input.modality,
    routeSnapshot,
    attempt: attempts[attempts.length - 1],
    outcome: lastOutcome,
    observedAt,
  });

  const snapshotReplayable = assertSnapshotReplayable(routeSnapshot);
  const ledgerReplayable = assertLedgerReplayable(bilateralLedger);

  return {
    disposition,
    attempts,
    winningDeploymentId,
    winningChannelKind,
    routeSnapshot,
    bilateralLedger,
    enteredReconcile,
    snapshotReplayable,
    ledgerReplayable,
  };
}

function freezeRouteSnapshot(input: {
  operation: FaultInjectionOperation;
  modality: FaultInjectionModality;
  catalogModelId: string;
  candidates: DualChannelRouteCandidate[];
  planned: DualChannelRouteCandidate[];
  actualDeploymentId?: string;
  fallbackConsent: boolean;
  workspaceId: string;
  observedAt: string;
}): CanonicalRouteSnapshot {
  const actual =
    input.planned.find((c) => c.deploymentId === input.actualDeploymentId) ??
    input.planned[0] ??
    input.candidates[0];
  if (!actual) {
    throw new Error('Cannot freeze RouteSnapshot without candidates');
  }

  const allowedCandidates = input.candidates.map((c, index) => ({
    catalogModelId: c.catalogModelId,
    deploymentId: c.deploymentId,
    rank: index + 1,
    exclusionReasons: [
      ...(c.isolated ? ['isolated'] : []),
      ...(c.draining ? ['draining'] : []),
    ],
    region: c.region,
    credentialMode: 'platform' as const,
    credentialVersion: c.credentialVersion ?? 'cred-v1',
    providerProfileId: c.providerProfileId,
    executionChannelId: c.executionChannelId,
    endpointRevision: c.endpointRevision,
    priceRevision: c.priceRevision,
    sourceKind: c.channelKind,
  }));

  const fallbackChain = input.fallbackConsent
    ? input.planned.map((c) => c.deploymentId)
    : [actual.deploymentId];

  const id = createHash('sha256')
    .update(
      [
        'fi-route',
        input.operation,
        input.catalogModelId,
        actual.deploymentId,
        input.observedAt,
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 24);

  return {
    id: `rs-${id}`,
    catalogModelId: input.catalogModelId,
    requestedCatalogModelId: input.catalogModelId,
    providerProfileId: actual.providerProfileId,
    executionChannelId: actual.executionChannelId,
    deploymentId: actual.deploymentId,
    credentialAccountVersion: actual.credentialVersion ?? 'cred-v1',
    credentialMode: 'platform',
    policyRevisionId: `policy-${input.operation}`,
    priceRevisionId: actual.priceRevision ?? 'price-v1',
    endpointRevisionId: actual.endpointRevision ?? 'endpoint-v1',
    allowedCandidates,
    actualDeploymentId: actual.deploymentId,
    runtimeExclusionReasons: input.candidates
      .filter((c) => c.isolated || c.draining)
      .map((c) =>
        c.isolated
          ? `isolated:${c.deploymentId}`
          : `draining:${c.deploymentId}`,
      ),
    fallbackChain,
    fallbackConsent: input.fallbackConsent,
    sourceKind: actual.channelKind,
    selectionMode: 'auto',
    primaryDataClass: 'public',
    dataClasses: ['public'],
    workspaceId: input.workspaceId,
    createdAt: input.observedAt,
  };
}

function freezeBilateralLedger(input: {
  modality: FaultInjectionModality;
  routeSnapshot: CanonicalRouteSnapshot;
  attempt?: DualChannelAttemptRecord;
  outcome?: ChannelExecutionOutcome;
  observedAt: string;
}): BilateralLedgerFreeze {
  const resource =
    input.modality === 'llm'
      ? ('copy' as const)
      : input.modality === 'image'
        ? ('image' as const)
        : ('video' as const);
  const attemptId = input.attempt
    ? `attempt-${input.attempt.deploymentId}-${input.attempt.rank}`
    : `attempt-${randomUUID().slice(0, 8)}`;
  const supplierTaskId =
    input.attempt?.providerTaskRef ??
    input.outcome?.providerTaskRef ??
    `pending-${attemptId}`;

  const usageStatus =
    input.attempt?.acceptance === 'acceptance_unknown'
      ? ('held_for_reconcile' as const)
      : input.attempt?.acceptance === 'rejected_before_accept'
        ? ('refunded' as const)
        : input.attempt?.acceptance === 'accepted'
          ? ('settled' as const)
          : ('reserved' as const);

  const costStatus =
    input.attempt?.acceptance === 'acceptance_unknown'
      ? ('unknown' as const)
      : input.outcome?.costAmount !== undefined
        ? ('observed' as const)
        : ('estimated' as const);

  return {
    productUsage: {
      id: `pu-${attemptId}`,
      status: usageStatus,
      quantity: 1,
      resource,
    },
    providerCost: {
      id: `pc-${attemptId}`,
      amount: input.outcome?.costAmount ?? 0,
      currency: input.outcome?.currency ?? 'CNY',
      status: costStatus,
      attemptId,
    },
    supplyFreeze: {
      id: `sf-${attemptId}`,
      routeSnapshotRef: input.routeSnapshot.id,
      credentialAccountVersion:
        input.routeSnapshot.credentialAccountVersion ?? 'cred-v1',
      supplierRequestTaskId: supplierTaskId,
      supplyPoolId: 'pool-shared-default',
      frozenAt: input.observedAt,
    },
  };
}

function assertSnapshotReplayable(snapshot: CanonicalRouteSnapshot): boolean {
  const replayed = replayCanonicalRouteSnapshot(snapshot);
  return serializeCanonicalRouteSnapshot(replayed) ===
    serializeCanonicalRouteSnapshot(snapshot);
}

function assertLedgerReplayable(ledger: BilateralLedgerFreeze): boolean {
  const serialized = JSON.stringify(ledger);
  const replayed = JSON.parse(serialized) as BilateralLedgerFreeze;
  return JSON.stringify(replayed) === serialized;
}

/** Pure planner used by isolate/drain scenario without executing providers. */
export function planNewTaskAfterIsolate(input: {
  candidates: DualChannelRouteCandidate[];
  isolatedDeploymentIds: readonly string[];
  drainingDeploymentIds?: readonly string[];
}): {
  selected: DualChannelRouteCandidate | null;
  skipped: DualChannelRouteCandidate[];
  requiresRestart: false;
} {
  const isolated = new Set(input.isolatedDeploymentIds);
  const draining = new Set(input.drainingDeploymentIds ?? []);
  const skipped: DualChannelRouteCandidate[] = [];
  const eligible: DualChannelRouteCandidate[] = [];
  for (const candidate of input.candidates) {
    if (isolated.has(candidate.deploymentId) || candidate.isolated) {
      skipped.push({ ...candidate, isolated: true });
      continue;
    }
    if (draining.has(candidate.deploymentId) || candidate.draining) {
      skipped.push({ ...candidate, draining: true });
      continue;
    }
    eligible.push(candidate);
  }
  return {
    selected: eligible[0] ?? null,
    skipped,
    requiresRestart: false,
  };
}
