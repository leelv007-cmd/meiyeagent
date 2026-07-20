/**
 * Run the MP-08 four-scenario fault-injection matrix for one operation.
 * Unit path uses dual-channel fakes; live path injects real ports via harness.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { ChannelExecutionOutcome, ChannelExecutor } from './dual-channel-router.js';
import {
  planNewTaskAfterIsolate,
  runDualChannelRouter,
} from './dual-channel-router.js';
import {
  FAULT_INJECTION_SCENARIOS,
  type DualChannelRouteCandidate,
  type FaultInjectionMatrixReport,
  type FaultInjectionModality,
  type FaultInjectionOperation,
  type FaultInjectionScenarioId,
  type FaultInjectionScenarioResult,
} from './types.js';

export interface FaultInjectionChannelControl {
  /** Force next execution on this channel to reject_before_accept. */
  forceRejectBeforeAccept(): void;
  /** Force next execution to acceptance_unknown. */
  forceAcceptanceUnknown(): void;
  /** Force next execution to accepted success. */
  forceSuccess(): void;
  /** Isolate channel (new tasks skip without restart). */
  isolate(): void;
  /** Drain channel (reject new submit; in-flight continues). */
  drain(): void;
  /** Clear isolation/drain. */
  clearControlPlane(): void;
  /** Submit/execute count for no-resubmit assertions. */
  submitCount(): number;
  candidate: DualChannelRouteCandidate;
  execute: ChannelExecutor;
}

export interface FaultInjectionHarness {
  operation: FaultInjectionOperation;
  modality: FaultInjectionModality;
  catalogModelId: string;
  primary: FaultInjectionChannelControl;
  fallback: FaultInjectionChannelControl;
  evidenceKind?: 'recorded' | 'live_provider';
  observedAt?: string;
}

export async function runFaultInjectionMatrix(
  harness: FaultInjectionHarness,
): Promise<FaultInjectionMatrixReport> {
  const observedAt = harness.observedAt ?? new Date().toISOString();
  const evidenceKind = harness.evidenceKind ?? 'recorded';
  const scenarios: FaultInjectionScenarioResult[] = [];

  for (const scenarioId of FAULT_INJECTION_SCENARIOS) {
    scenarios.push(
      await runScenario(scenarioId, harness, observedAt, evidenceKind),
    );
  }

  const dualChannelReady =
    harness.primary.candidate.channelKind !==
      harness.fallback.candidate.channelKind &&
    scenarios.every((s) => s.passed);

  const id = createHash('sha256')
    .update(
      [
        'fi-matrix',
        harness.operation,
        harness.primary.candidate.deploymentId,
        harness.fallback.candidate.deploymentId,
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
    scenarios,
    allPassed: scenarios.every((s) => s.passed),
    dualChannelReady,
    observedAt,
    evidenceKind,
  };
}

async function runScenario(
  scenarioId: FaultInjectionScenarioId,
  harness: FaultInjectionHarness,
  observedAt: string,
  evidenceKind: 'recorded' | 'live_provider',
): Promise<FaultInjectionScenarioResult> {
  harness.primary.clearControlPlane();
  harness.fallback.clearControlPlane();
  harness.primary.forceSuccess();
  harness.fallback.forceSuccess();

  const effectKey = `${scenarioId}-${randomUUID().slice(0, 8)}`;

  switch (scenarioId) {
    case 'reject_before_accept_switch':
      return runRejectBeforeAcceptSwitch(
        harness,
        effectKey,
        observedAt,
        evidenceKind,
      );
    case 'accepted_no_resubmit':
      return runAcceptedNoResubmit(
        harness,
        effectKey,
        observedAt,
        evidenceKind,
      );
    case 'acceptance_unknown_reconcile':
      return runAcceptanceUnknownReconcile(
        harness,
        effectKey,
        observedAt,
        evidenceKind,
      );
    case 'isolate_drain_new_task':
      return runIsolateDrainNewTask(
        harness,
        effectKey,
        observedAt,
        evidenceKind,
      );
    case 'route_snapshot_ledger_replay':
      return runRouteSnapshotLedgerReplay(
        harness,
        effectKey,
        observedAt,
        evidenceKind,
      );
  }
}

async function runRejectBeforeAcceptSwitch(
  harness: FaultInjectionHarness,
  effectKey: string,
  observedAt: string,
  evidenceKind: 'recorded' | 'live_provider',
): Promise<FaultInjectionScenarioResult> {
  harness.primary.forceRejectBeforeAccept();
  harness.fallback.forceSuccess();

  const beforeFallback = harness.fallback.submitCount();
  const result = await runDualChannelRouter({
    operation: harness.operation,
    modality: harness.modality,
    catalogModelId: harness.catalogModelId,
    candidates: [
      { ...harness.primary.candidate },
      { ...harness.fallback.candidate },
    ],
    fallbackConsent: true,
    effectIdempotencyKey: effectKey,
    observedAt,
    execute: async ({ candidate, effectIdempotencyKey, attemptRank }) => {
      if (candidate.deploymentId === harness.primary.candidate.deploymentId) {
        return harness.primary.execute({
          candidate,
          effectIdempotencyKey,
          attemptRank,
        });
      }
      return harness.fallback.execute({
        candidate,
        effectIdempotencyKey,
        attemptRank,
      });
    },
  });

  const switched =
    result.disposition === 'switched_to_fallback' &&
    result.attempts.length === 2 &&
    result.attempts[0]?.acceptance === 'rejected_before_accept' &&
    result.attempts[1]?.acceptance === 'accepted' &&
    harness.fallback.submitCount() === beforeFallback + 1;

  return {
    scenarioId: 'reject_before_accept_switch',
    operation: harness.operation,
    modality: harness.modality,
    passed: switched && result.snapshotReplayable,
    disposition: result.disposition,
    attempts: result.attempts,
    routeSnapshot: result.routeSnapshot,
    bilateralLedger: result.bilateralLedger,
    detail: switched
      ? 'Primary reject_before_accept auto-switched to fallback'
      : `Expected switch; got disposition=${result.disposition} attempts=${result.attempts.length}`,
    evidenceKind,
    observedAt,
  };
}

async function runAcceptedNoResubmit(
  harness: FaultInjectionHarness,
  effectKey: string,
  observedAt: string,
  evidenceKind: 'recorded' | 'live_provider',
): Promise<FaultInjectionScenarioResult> {
  harness.primary.forceSuccess();
  const beforeFallback = harness.fallback.submitCount();

  const result = await runDualChannelRouter({
    operation: harness.operation,
    modality: harness.modality,
    catalogModelId: harness.catalogModelId,
    candidates: [
      { ...harness.primary.candidate },
      { ...harness.fallback.candidate },
    ],
    fallbackConsent: true,
    effectIdempotencyKey: effectKey,
    observedAt,
    execute: async ({ candidate, effectIdempotencyKey, attemptRank }) => {
      if (candidate.deploymentId === harness.primary.candidate.deploymentId) {
        return harness.primary.execute({
          candidate,
          effectIdempotencyKey,
          attemptRank,
        });
      }
      return harness.fallback.execute({
        candidate,
        effectIdempotencyKey,
        attemptRank,
      });
    },
  });

  const passed =
    result.disposition === 'primary_succeeded' &&
    result.attempts.length === 1 &&
    result.attempts[0]?.acceptance === 'accepted' &&
    harness.fallback.submitCount() === beforeFallback;

  return {
    scenarioId: 'accepted_no_resubmit',
    operation: harness.operation,
    modality: harness.modality,
    passed,
    disposition: result.disposition,
    attempts: result.attempts,
    routeSnapshot: result.routeSnapshot,
    bilateralLedger: result.bilateralLedger,
    detail: passed
      ? 'Accepted primary; fallback never submitted'
      : `Fallback was resubmitted or disposition wrong: ${result.disposition}`,
    evidenceKind,
    observedAt,
  };
}

async function runAcceptanceUnknownReconcile(
  harness: FaultInjectionHarness,
  effectKey: string,
  observedAt: string,
  evidenceKind: 'recorded' | 'live_provider',
): Promise<FaultInjectionScenarioResult> {
  harness.primary.forceAcceptanceUnknown();
  const beforeFallback = harness.fallback.submitCount();

  const result = await runDualChannelRouter({
    operation: harness.operation,
    modality: harness.modality,
    catalogModelId: harness.catalogModelId,
    candidates: [
      { ...harness.primary.candidate },
      { ...harness.fallback.candidate },
    ],
    fallbackConsent: true,
    effectIdempotencyKey: effectKey,
    observedAt,
    execute: async ({ candidate, effectIdempotencyKey, attemptRank }) => {
      if (candidate.deploymentId === harness.primary.candidate.deploymentId) {
        return harness.primary.execute({
          candidate,
          effectIdempotencyKey,
          attemptRank,
        });
      }
      return harness.fallback.execute({
        candidate,
        effectIdempotencyKey,
        attemptRank,
      });
    },
  });

  const passed =
    result.enteredReconcile &&
    result.disposition === 'reconcile_no_resubmit' &&
    result.attempts.length === 1 &&
    result.attempts[0]?.acceptance === 'acceptance_unknown' &&
    harness.fallback.submitCount() === beforeFallback &&
    result.bilateralLedger.productUsage.status === 'held_for_reconcile';

  return {
    scenarioId: 'acceptance_unknown_reconcile',
    operation: harness.operation,
    modality: harness.modality,
    passed,
    disposition: result.disposition,
    attempts: result.attempts,
    routeSnapshot: result.routeSnapshot,
    bilateralLedger: result.bilateralLedger,
    detail: passed
      ? 'acceptance_unknown entered reconcile; no cross-channel resubmit'
      : `Expected reconcile_no_resubmit; got ${result.disposition}`,
    evidenceKind,
    observedAt,
  };
}

async function runIsolateDrainNewTask(
  harness: FaultInjectionHarness,
  effectKey: string,
  observedAt: string,
  evidenceKind: 'recorded' | 'live_provider',
): Promise<FaultInjectionScenarioResult> {
  // Isolate primary + drain semantics: new tasks must take fallback without restart.
  harness.primary.isolate();
  harness.primary.drain();
  harness.fallback.forceSuccess();

  const plan = planNewTaskAfterIsolate({
    candidates: [
      { ...harness.primary.candidate, isolated: true, draining: true },
      { ...harness.fallback.candidate },
    ],
    isolatedDeploymentIds: [harness.primary.candidate.deploymentId],
    drainingDeploymentIds: [harness.primary.candidate.deploymentId],
  });

  if (!plan.selected || plan.requiresRestart !== false) {
    return {
      scenarioId: 'isolate_drain_new_task',
      operation: harness.operation,
      modality: harness.modality,
      passed: false,
      disposition: 'failed_no_fallback',
      attempts: [],
      detail: 'Planner failed to select fallback without restart',
      evidenceKind,
      observedAt,
    };
  }

  const beforePrimary = harness.primary.submitCount();
  const result = await runDualChannelRouter({
    operation: harness.operation,
    modality: harness.modality,
    catalogModelId: harness.catalogModelId,
    candidates: [
      { ...harness.primary.candidate, isolated: true, draining: true },
      { ...harness.fallback.candidate },
    ],
    fallbackConsent: true,
    effectIdempotencyKey: effectKey,
    observedAt,
    execute: async ({ candidate, effectIdempotencyKey, attemptRank }) => {
      if (candidate.deploymentId === harness.primary.candidate.deploymentId) {
        return harness.primary.execute({
          candidate,
          effectIdempotencyKey,
          attemptRank,
        });
      }
      return harness.fallback.execute({
        candidate,
        effectIdempotencyKey,
        attemptRank,
      });
    },
  });

  const passed =
    plan.selected.deploymentId === harness.fallback.candidate.deploymentId &&
    plan.requiresRestart === false &&
    result.disposition === 'fallback_only' &&
    result.winningDeploymentId === harness.fallback.candidate.deploymentId &&
    harness.primary.submitCount() === beforePrimary &&
    result.attempts.every(
      (a) => a.deploymentId === harness.fallback.candidate.deploymentId,
    );

  return {
    scenarioId: 'isolate_drain_new_task',
    operation: harness.operation,
    modality: harness.modality,
    passed,
    disposition: result.disposition,
    attempts: result.attempts,
    routeSnapshot: result.routeSnapshot,
    bilateralLedger: result.bilateralLedger,
    detail: passed
      ? 'Isolated/drained primary; new task took fallback without restart'
      : `Expected fallback_only without primary submit; got ${result.disposition}`,
    evidenceKind,
    observedAt,
  };
}

async function runRouteSnapshotLedgerReplay(
  harness: FaultInjectionHarness,
  effectKey: string,
  observedAt: string,
  evidenceKind: 'recorded' | 'live_provider',
): Promise<FaultInjectionScenarioResult> {
  harness.primary.forceSuccess();

  const result = await runDualChannelRouter({
    operation: harness.operation,
    modality: harness.modality,
    catalogModelId: harness.catalogModelId,
    candidates: [
      { ...harness.primary.candidate },
      { ...harness.fallback.candidate },
    ],
    fallbackConsent: true,
    effectIdempotencyKey: effectKey,
    observedAt,
    execute: async ({ candidate, effectIdempotencyKey, attemptRank }) => {
      if (candidate.deploymentId === harness.primary.candidate.deploymentId) {
        return harness.primary.execute({
          candidate,
          effectIdempotencyKey,
          attemptRank,
        });
      }
      return harness.fallback.execute({
        candidate,
        effectIdempotencyKey,
        attemptRank,
      });
    },
  });

  const passed = Boolean(
    result.snapshotReplayable &&
      result.ledgerReplayable &&
      result.routeSnapshot.id &&
      result.bilateralLedger.supplyFreeze.routeSnapshotRef ===
        result.routeSnapshot.id &&
      (result.routeSnapshot.fallbackChain?.length ?? 0) >= 1,
  );

  return {
    scenarioId: 'route_snapshot_ledger_replay',
    operation: harness.operation,
    modality: harness.modality,
    passed,
    disposition: result.disposition,
    attempts: result.attempts,
    routeSnapshot: result.routeSnapshot,
    bilateralLedger: result.bilateralLedger,
    detail: passed
      ? 'RouteSnapshot + bilateral ledger round-trip replay ok'
      : 'Snapshot or ledger not replayable',
    evidenceKind,
    observedAt,
  };
}

/** Helper for live harnesses that only need a scripted outcome sequence. */
export function scriptedExecutor(
  outcomes: ChannelExecutionOutcome[],
): {
  execute: ChannelExecutor;
  submitCount: () => number;
  forceRejectBeforeAccept: () => void;
  forceAcceptanceUnknown: () => void;
  forceSuccess: () => void;
  clear: () => void;
} {
  let submitCalls = 0;
  let forced: ChannelExecutionOutcome | null = null;
  return {
    submitCount: () => submitCalls,
    forceRejectBeforeAccept: () => {
      forced = {
        acceptance: 'rejected_before_accept',
        errorCode: 'forced_reject',
        retryable: true,
        message: 'forced reject_before_accept',
        costAmount: 0,
        currency: 'CNY',
      };
    },
    forceAcceptanceUnknown: () => {
      forced = {
        acceptance: 'acceptance_unknown',
        errorCode: 'forced_unknown',
        retryable: true,
        message: 'forced acceptance_unknown',
        providerTaskRef: `unknown-${randomUUID().slice(0, 8)}`,
        costAmount: 0,
        currency: 'CNY',
      };
    },
    forceSuccess: () => {
      forced = {
        acceptance: 'accepted',
        providerTaskRef: `ok-${randomUUID().slice(0, 8)}`,
        costAmount: 0.01,
        currency: 'CNY',
      };
    },
    clear: () => {
      forced = null;
    },
    execute: async () => {
      submitCalls += 1;
      if (forced) {
        const next = forced;
        forced = null;
        return next;
      }
      const scripted = outcomes.shift();
      if (scripted) return scripted;
      return {
        acceptance: 'accepted',
        providerTaskRef: `default-${submitCalls}`,
        costAmount: 0.01,
        currency: 'CNY',
      };
    },
  };
}
