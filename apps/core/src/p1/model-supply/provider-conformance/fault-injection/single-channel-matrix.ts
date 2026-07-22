/**
 * Official single-channel fault-injection matrix (MP-08 / revised D-069).
 *
 * First-round release gate: one official_direct channel per core operation.
 * No auto-fallback. Isolate/unavailable blocks new tasks and marks unavailable.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  planNewTaskAfterIsolate,
  runDualChannelRouter,
} from './dual-channel-router.js';
import type { FaultInjectionChannelControl } from './matrix.js';
import {
  SINGLE_CHANNEL_FAULT_INJECTION_SCENARIOS,
  type FaultInjectionModality,
  type FaultInjectionOperation,
  type SingleChannelFaultInjectionScenarioId,
  type SingleChannelFaultMatrixReport,
  type SingleChannelFaultScenarioResult,
} from './types.js';

export interface SingleChannelFaultInjectionHarness {
  operation: FaultInjectionOperation;
  modality: FaultInjectionModality;
  catalogModelId: string;
  channel: FaultInjectionChannelControl;
  evidenceKind?: 'recorded' | 'live_provider';
  observedAt?: string;
}

export async function runSingleChannelFaultInjectionMatrix(
  harness: SingleChannelFaultInjectionHarness,
): Promise<SingleChannelFaultMatrixReport> {
  const observedAt = harness.observedAt ?? new Date().toISOString();
  const evidenceKind = harness.evidenceKind ?? 'recorded';
  const scenarios: SingleChannelFaultScenarioResult[] = [];

  for (const scenarioId of SINGLE_CHANNEL_FAULT_INJECTION_SCENARIOS) {
    scenarios.push(
      await runSingleChannelScenario(
        scenarioId,
        harness,
        observedAt,
        evidenceKind,
      ),
    );
  }

  const id = createHash('sha256')
    .update(
      [
        'fi-single',
        harness.operation,
        harness.channel.candidate.deploymentId,
        observedAt,
        randomUUID(),
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 20);

  return {
    id,
    operation: harness.operation,
    modality: harness.modality,
    channelMode: 'single_channel',
    channelLabel: 'single-channel/no-fallback',
    dualChannelReady: false,
    fallbackAvailable: false,
    scenarios,
    allPassed: scenarios.every((scenario) => scenario.passed),
    observedAt,
    evidenceKind,
  };
}

async function runSingleChannelScenario(
  scenarioId: SingleChannelFaultInjectionScenarioId,
  harness: SingleChannelFaultInjectionHarness,
  observedAt: string,
  evidenceKind: 'recorded' | 'live_provider',
): Promise<SingleChannelFaultScenarioResult> {
  harness.channel.clearControlPlane();
  harness.channel.forceSuccess();
  const effectKey = `single-${scenarioId}-${randomUUID().slice(0, 8)}`;

  switch (scenarioId) {
    case 'reject_before_accept_fail_closed':
      return runRejectFailClosed(harness, effectKey, observedAt, evidenceKind);
    case 'accepted_no_resubmit':
      return runAcceptedNoResubmit(harness, effectKey, observedAt, evidenceKind);
    case 'acceptance_unknown_reconcile':
      return runAcceptanceUnknown(
        harness,
        effectKey,
        observedAt,
        evidenceKind,
      );
    case 'rate_limit_evidence':
      return runRateLimitEvidence(
        harness,
        effectKey,
        observedAt,
        evidenceKind,
      );
    case 'timeout_evidence':
      return runTimeoutEvidence(harness, effectKey, observedAt, evidenceKind);
    case 'isolate_unavailable_blocks_new_task':
      return runUnavailableBlock(
        harness,
        'isolate',
        observedAt,
        evidenceKind,
      );
    case 'drain_unavailable_blocks_new_task':
      return runUnavailableBlock(harness, 'drain', observedAt, evidenceKind);
    case 'cost_convergence_evidence':
      return runCostConvergence(harness, effectKey, observedAt, evidenceKind);
    case 'route_snapshot_ledger_replay':
      return runRouteSnapshotReplay(
        harness,
        effectKey,
        observedAt,
        evidenceKind,
      );
  }
}

async function runWithSingleChannel(
  harness: SingleChannelFaultInjectionHarness,
  effectKey: string,
  observedAt: string,
) {
  return runDualChannelRouter({
    operation: harness.operation,
    modality: harness.modality,
    catalogModelId: harness.catalogModelId,
    candidates: [{ ...harness.channel.candidate }],
    fallbackConsent: false,
    effectIdempotencyKey: effectKey,
    observedAt,
    execute: async ({ candidate, effectIdempotencyKey, attemptRank }) =>
      harness.channel.execute({
        candidate,
        effectIdempotencyKey,
        attemptRank,
      }),
  });
}

async function runRejectFailClosed(
  harness: SingleChannelFaultInjectionHarness,
  effectKey: string,
  observedAt: string,
  evidenceKind: 'recorded' | 'live_provider',
): Promise<SingleChannelFaultScenarioResult> {
  harness.channel.forceRejectBeforeAccept();
  const before = harness.channel.submitCount();
  const result = await runWithSingleChannel(harness, effectKey, observedAt);
  const passed =
    result.disposition === 'failed_no_fallback' &&
    result.attempts.length === 1 &&
    result.attempts[0]?.acceptance === 'rejected_before_accept' &&
    harness.channel.submitCount() === before + 1;

  return {
    scenarioId: 'reject_before_accept_fail_closed',
    operation: harness.operation,
    modality: harness.modality,
    passed,
    disposition: result.disposition,
    availability: 'available',
    attempts: result.attempts,
    routeSnapshot: result.routeSnapshot,
    bilateralLedger: result.bilateralLedger,
    faultEvidence: {
      errorCode: result.attempts[0]?.errorCode,
      costAmount: result.bilateralLedger.providerCost.amount,
      currency: result.bilateralLedger.providerCost.currency,
      costStatus: result.bilateralLedger.providerCost.status,
    },
    detail: passed
      ? 'Single-channel reject_before_accept failed closed (no fake success)'
      : `Expected failed_no_fallback; got ${result.disposition}`,
    evidenceKind,
    observedAt,
  };
}

async function runAcceptedNoResubmit(
  harness: SingleChannelFaultInjectionHarness,
  effectKey: string,
  observedAt: string,
  evidenceKind: 'recorded' | 'live_provider',
): Promise<SingleChannelFaultScenarioResult> {
  harness.channel.forceSuccess();
  const before = harness.channel.submitCount();
  const result = await runWithSingleChannel(harness, effectKey, observedAt);
  const afterFirst = harness.channel.submitCount();
  // Same effect key must not invent a second channel submit path.
  const passed =
    result.disposition === 'primary_succeeded' &&
    result.attempts.length === 1 &&
    result.attempts[0]?.acceptance === 'accepted' &&
    afterFirst === before + 1 &&
    result.enteredReconcile === false;

  return {
    scenarioId: 'accepted_no_resubmit',
    operation: harness.operation,
    modality: harness.modality,
    passed,
    disposition: result.disposition,
    availability: 'available',
    attempts: result.attempts,
    routeSnapshot: result.routeSnapshot,
    bilateralLedger: result.bilateralLedger,
    detail: passed
      ? 'Accepted single-channel submit; no resubmit path'
      : `Expected primary_succeeded single attempt; got ${result.disposition}`,
    evidenceKind,
    observedAt,
  };
}

async function runAcceptanceUnknown(
  harness: SingleChannelFaultInjectionHarness,
  effectKey: string,
  observedAt: string,
  evidenceKind: 'recorded' | 'live_provider',
): Promise<SingleChannelFaultScenarioResult> {
  harness.channel.forceAcceptanceUnknown();
  const before = harness.channel.submitCount();
  const result = await runWithSingleChannel(harness, effectKey, observedAt);
  const passed =
    result.enteredReconcile &&
    result.disposition === 'reconcile_no_resubmit' &&
    result.attempts.length === 1 &&
    result.attempts[0]?.acceptance === 'acceptance_unknown' &&
    harness.channel.submitCount() === before + 1 &&
    result.bilateralLedger.productUsage.status === 'held_for_reconcile';

  return {
    scenarioId: 'acceptance_unknown_reconcile',
    operation: harness.operation,
    modality: harness.modality,
    passed,
    disposition: result.disposition,
    availability: 'available',
    attempts: result.attempts,
    routeSnapshot: result.routeSnapshot,
    bilateralLedger: result.bilateralLedger,
    detail: passed
      ? 'acceptance_unknown entered reconcile; no single-channel resubmit'
      : `Expected reconcile_no_resubmit; got ${result.disposition}`,
    evidenceKind,
    observedAt,
  };
}

async function runRateLimitEvidence(
  harness: SingleChannelFaultInjectionHarness,
  effectKey: string,
  observedAt: string,
  evidenceKind: 'recorded' | 'live_provider',
): Promise<SingleChannelFaultScenarioResult> {
  harness.channel.forceRateLimit();
  const result = await runWithSingleChannel(harness, effectKey, observedAt);
  const errorCode = result.attempts[0]?.errorCode;
  const passed =
    result.disposition === 'failed_no_fallback' &&
    result.attempts.length === 1 &&
    result.attempts[0]?.acceptance === 'rejected_before_accept' &&
    errorCode === 'rate_limited' &&
    result.bilateralLedger.productUsage.status === 'refunded';

  return {
    scenarioId: 'rate_limit_evidence',
    operation: harness.operation,
    modality: harness.modality,
    passed,
    disposition: result.disposition,
    availability: 'available',
    attempts: result.attempts,
    routeSnapshot: result.routeSnapshot,
    bilateralLedger: result.bilateralLedger,
    faultEvidence: {
      errorCode,
      costAmount: result.bilateralLedger.providerCost.amount,
      currency: result.bilateralLedger.providerCost.currency,
      costStatus: result.bilateralLedger.providerCost.status,
    },
    detail: passed
      ? 'rate_limited left fail-closed evidence (no fake success)'
      : `Expected rate_limited fail-closed; got ${result.disposition}/${errorCode}`,
    evidenceKind,
    observedAt,
  };
}

async function runTimeoutEvidence(
  harness: SingleChannelFaultInjectionHarness,
  effectKey: string,
  observedAt: string,
  evidenceKind: 'recorded' | 'live_provider',
): Promise<SingleChannelFaultScenarioResult> {
  harness.channel.forceTimeout();
  const result = await runWithSingleChannel(harness, effectKey, observedAt);
  const errorCode = result.attempts[0]?.errorCode;
  const passed =
    result.disposition === 'failed_no_fallback' &&
    result.attempts.length === 1 &&
    result.attempts[0]?.acceptance === 'rejected_before_accept' &&
    errorCode === 'logical_timeout';

  return {
    scenarioId: 'timeout_evidence',
    operation: harness.operation,
    modality: harness.modality,
    passed,
    disposition: result.disposition,
    availability: 'available',
    attempts: result.attempts,
    routeSnapshot: result.routeSnapshot,
    bilateralLedger: result.bilateralLedger,
    faultEvidence: {
      errorCode,
      costAmount: result.bilateralLedger.providerCost.amount,
      currency: result.bilateralLedger.providerCost.currency,
      costStatus: result.bilateralLedger.providerCost.status,
    },
    detail: passed
      ? 'logical_timeout left fail-closed evidence'
      : `Expected logical_timeout fail-closed; got ${result.disposition}/${errorCode}`,
    evidenceKind,
    observedAt,
  };
}

async function runUnavailableBlock(
  harness: SingleChannelFaultInjectionHarness,
  mode: 'isolate' | 'drain',
  observedAt: string,
  evidenceKind: 'recorded' | 'live_provider',
): Promise<SingleChannelFaultScenarioResult> {
  if (mode === 'isolate') {
    harness.channel.isolate();
  } else {
    harness.channel.drain();
  }
  const before = harness.channel.submitCount();
  const plan = planNewTaskAfterIsolate({
    candidates: [
      {
        ...harness.channel.candidate,
        isolated: mode === 'isolate' || harness.channel.candidate.isolated,
        draining: mode === 'drain' || harness.channel.candidate.draining,
      },
    ],
    isolatedDeploymentIds:
      mode === 'isolate' ? [harness.channel.candidate.deploymentId] : [],
    drainingDeploymentIds:
      mode === 'drain' ? [harness.channel.candidate.deploymentId] : [],
  });

  const blocked =
    plan.selected === null &&
    plan.requiresRestart === false &&
    plan.skipped.length === 1 &&
    harness.channel.submitCount() === before;

  return {
    scenarioId:
      mode === 'isolate'
        ? 'isolate_unavailable_blocks_new_task'
        : 'drain_unavailable_blocks_new_task',
    operation: harness.operation,
    modality: harness.modality,
    passed: blocked,
    disposition: 'unavailable_blocked',
    availability: blocked ? 'unavailable' : 'available',
    attempts: [],
    detail: blocked
      ? `Single-channel ${mode} blocked new tasks and marked unavailable (no fallback)`
      : `Expected unavailable block on ${mode}; selected=${plan.selected?.deploymentId ?? 'null'}`,
    evidenceKind,
    observedAt,
  };
}

async function runCostConvergence(
  harness: SingleChannelFaultInjectionHarness,
  effectKey: string,
  observedAt: string,
  evidenceKind: 'recorded' | 'live_provider',
): Promise<SingleChannelFaultScenarioResult> {
  harness.channel.forceSuccess();
  const result = await runWithSingleChannel(harness, effectKey, observedAt);
  const cost = result.bilateralLedger.providerCost;
  const usage = result.bilateralLedger.productUsage;
  const passed =
    result.disposition === 'primary_succeeded' &&
    result.attempts[0]?.acceptance === 'accepted' &&
    usage.status === 'settled' &&
    cost.status === 'observed' &&
    Number.isFinite(cost.amount) &&
    cost.amount > 0 &&
    cost.currency === 'CNY' &&
    result.bilateralLedger.supplyFreeze.routeSnapshotRef ===
      result.routeSnapshot.id;

  return {
    scenarioId: 'cost_convergence_evidence',
    operation: harness.operation,
    modality: harness.modality,
    passed,
    disposition: result.disposition,
    availability: 'available',
    attempts: result.attempts,
    routeSnapshot: result.routeSnapshot,
    bilateralLedger: result.bilateralLedger,
    faultEvidence: {
      costAmount: cost.amount,
      currency: cost.currency,
      costStatus: cost.status,
    },
    detail: passed
      ? 'Accepted cost observed and product usage settled (cost convergence)'
      : `Cost/usage did not converge: usage=${usage.status} cost=${cost.status}/${cost.amount}`,
    evidenceKind,
    observedAt,
  };
}

async function runRouteSnapshotReplay(
  harness: SingleChannelFaultInjectionHarness,
  effectKey: string,
  observedAt: string,
  evidenceKind: 'recorded' | 'live_provider',
): Promise<SingleChannelFaultScenarioResult> {
  harness.channel.forceSuccess();
  const result = await runWithSingleChannel(harness, effectKey, observedAt);
  const fallbackChain = result.routeSnapshot.fallbackChain ?? [];
  const passed = Boolean(
    result.snapshotReplayable &&
      result.ledgerReplayable &&
      result.routeSnapshot.id &&
      result.bilateralLedger.supplyFreeze.routeSnapshotRef ===
        result.routeSnapshot.id &&
      // Single channel: no second fallback candidate.
      fallbackChain.length === 1 &&
      fallbackChain[0] === harness.channel.candidate.deploymentId &&
      result.routeSnapshot.fallbackConsent === false,
  );

  return {
    scenarioId: 'route_snapshot_ledger_replay',
    operation: harness.operation,
    modality: harness.modality,
    passed,
    disposition: result.disposition,
    availability: 'available',
    attempts: result.attempts,
    routeSnapshot: result.routeSnapshot,
    bilateralLedger: result.bilateralLedger,
    detail: passed
      ? 'Single-channel RouteSnapshot + bilateral ledger replay ok (no fallback chain)'
      : 'Snapshot or ledger not replayable for single-channel',
    evidenceKind,
    observedAt,
  };
}
