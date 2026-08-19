/**
 * V31-12 ExecutionPlanSnapshot freeze + admission + DBOS reverify + stale/legacy.
 *
 * Seams:
 * - fidelity=100% (confirmed plan vs executing snapshot)
 * - pure copy policy_exempt_copy still freezes (U9)
 * - stale confirmation rejected; mismatch fail closed
 * - at-least-once admit replay does not double-write
 * - legacy branch without dual-write; incompatible layout fail closed
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
  EXECUTION_PLAN_SNAPSHOT_HASH_COVERAGE_FIELDS,
  EXECUTION_PLAN_SNAPSHOT_HASH_EXCLUDED_FIELDS,
  EXECUTION_PLAN_SNAPSHOT_SCHEMA_VERSION,
} from '@meiye/contracts';

import {
  assembleExecutionPlanSnapshot,
  assertExecutionPlanFidelity,
  buildExecutionPlanSnapshot,
  computeExecutionPlanSnapshotHash,
  evaluateExecutionPlanStaleness,
  ExecutionPlanAdmissionError,
  ExecutionPlanAdmissionService,
  freezeExecutionPlanContent,
  resolveDurableReplayBranch,
  verifyExecutionPlanSnapshotForDbos,
  type ExecutionPlanCompileFreeze,
  type ExecutionPlanFrozenContent,
} from './execution-plan-admission.js';
import { MemoryExecutionPlanSnapshotStore } from './memory-execution-plan-admission-store.js';

const BOUNDED = {
  schemaVersion: 'bounded-execution-snapshot/v1' as const,
  maxIterations: 10,
  maxCostCents: 100,
  maxWallClockMs: 60_000,
  maxDelegations: 2,
  requiredLimits: ['maxIterations', 'maxCostCents'] as const,
  consumption: {
    iterations: 0,
    costCents: 0,
    wallClockMs: 0,
    delegations: 0,
  },
  stopReason: null,
  triggeredLimit: null,
};

const COMPILED = {
  schemaVersion: COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
  executionCapabilities: {
    scheduling: 'serial' as const,
    retry: 'none' as const,
    cache: 'none' as const,
  },
  units: [
    {
      unitId: 'unit-1',
      unitType: 'copy.generate',
      primitive: 'generate' as const,
    },
  ],
  dependencyGroups: [{ groupId: 'g1', unitIds: ['unit-1'] }],
  boundedRetry: {},
};

function frozenContent(
  overrides: Partial<ExecutionPlanFrozenContent> = {},
): ExecutionPlanFrozenContent {
  return {
    planId: 'plan-1',
    planRevision: 1,
    intentDeclaration: { summary: '纯文案推广' },
    contextBundleRef: {
      bundleId: 'bundle-1',
      revision: 1,
      hash: 'ctx-hash-1',
    },
    executionPlan: COMPILED,
    deliverables: [{ deliverableId: 'd1', kind: 'copy', quantity: 1 }],
    promptRevisionRefs: {
      copyGeneration: { key: 'copyGeneration', version: 'v3' },
    },
    skillManifestRefs: {},
    routeRequirements: [],
    quoteRef: { id: 'quote-1', revision: 1 },
    rightsRevisionRefs: ['rights-1'],
    factRevisionRefs: ['fact-1'],
    boundedExecution: {
      ...BOUNDED,
      requiredLimits: ['maxIterations', 'maxCostCents'],
    },
    harnessReleaseId: 'release-1',
    approvalBasis: 'policy_exempt_copy',
    ...overrides,
  } as unknown as ExecutionPlanFrozenContent;
}

test('snapshotHash covers frozen fields only and excludes confirmationDecisionRef', () => {
  assert.equal(
    (EXECUTION_PLAN_SNAPSHOT_HASH_EXCLUDED_FIELDS as readonly string[]).includes(
      'confirmationDecisionRef',
    ),
    true,
  );
  assert.equal(
    (EXECUTION_PLAN_SNAPSHOT_HASH_COVERAGE_FIELDS as readonly string[]).includes(
      'confirmationDecisionRef',
    ),
    false,
  );

  const content = frozenContent({ approvalBasis: 'merchant_confirmed' });
  const { snapshotHash } = freezeExecutionPlanContent(content);

  const withDecision = buildExecutionPlanSnapshot({
    content,
    confirmationDecisionRef: 'decision-1',
    snapshotHash,
  });
  assert.equal(withDecision.snapshotHash, snapshotHash);
  assert.equal(withDecision.confirmationDecisionRef, 'decision-1');

  // Hash does not change when decision ref is attached post-confirm.
  assert.equal(
    computeExecutionPlanSnapshotHash(content),
    withDecision.snapshotHash,
  );
});

test('policy_exempt_copy freezes exact plan/quote/release without decision (U9)', () => {
  const content = frozenContent({ approvalBasis: 'policy_exempt_copy' });
  const { snapshotHash } = freezeExecutionPlanContent(content);
  const snapshot = buildExecutionPlanSnapshot({ content, snapshotHash });
  assert.equal(snapshot.approvalBasis, 'policy_exempt_copy');
  assert.equal(snapshot.confirmationDecisionRef, undefined);
  assert.equal(snapshot.quoteRef.id, 'quote-1');
  assert.equal(snapshot.harnessReleaseId, 'release-1');
  assert.equal(snapshot.schemaVersion, EXECUTION_PLAN_SNAPSHOT_SCHEMA_VERSION);
});

test('fidelity=100%: confirmed plan matches executing snapshot field-by-field', () => {
  const content = frozenContent();
  const { snapshotHash } = freezeExecutionPlanContent(content);
  const executing = buildExecutionPlanSnapshot({ content, snapshotHash });
  assert.equal(assertExecutionPlanFidelity({ confirmed: content, executing }), true);

  const drifted = frozenContent({
    deliverables: [{ deliverableId: 'd1', kind: 'copy', quantity: 2 }],
  });
  assert.throws(
    () => assertExecutionPlanFidelity({ confirmed: drifted, executing }),
    (error: unknown) =>
      error instanceof ExecutionPlanAdmissionError &&
      error.code === 'SNAPSHOT_FIDELITY_MISMATCH',
  );
});

test('stale confirmation is rejected at admission; mismatch fail closed', async () => {
  const store = new MemoryExecutionPlanSnapshotStore();
  const service = new ExecutionPlanAdmissionService(store);
  const content = frozenContent({
    approvalBasis: 'merchant_confirmed',
    quoteRef: { id: 'quote-1', revision: 1 },
  });
  const { snapshotHash } = freezeExecutionPlanContent(content);

  await assert.rejects(
    () =>
      service.admit({
        workflowId: 'wf-stale',
        workspaceId: 'ws-1',
        content,
        snapshotHash,
        confirmationDecisionRef: 'decision-stale',
        live: { quoteRevision: 2 },
      }),
    (error: unknown) =>
      error instanceof ExecutionPlanAdmissionError &&
      error.code === 'STALE_CONFIRMATION_REJECTED',
  );

  // Hash tampering fails closed before write.
  assert.throws(
    () =>
      buildExecutionPlanSnapshot({
        content,
        snapshotHash: 'deadbeef',
        confirmationDecisionRef: 'decision-1',
      }),
    (error: unknown) =>
      error instanceof ExecutionPlanAdmissionError &&
      error.code === 'SNAPSHOT_HASH_MISMATCH',
  );
});

test('at-least-once admit replay does not double-write Task/snapshot', async () => {
  const store = new MemoryExecutionPlanSnapshotStore();
  const service = new ExecutionPlanAdmissionService(store);
  const content = frozenContent({ approvalBasis: 'policy_exempt_copy' });
  const { snapshotHash } = freezeExecutionPlanContent(content);

  const first = await service.admit({
    workflowId: 'wf-replay',
    workspaceId: 'ws-1',
    content,
    snapshotHash,
    admittedAt: '2026-08-08T12:00:00.000Z',
  });
  assert.equal(first.replayed, false);

  const second = await service.admit({
    workflowId: 'wf-replay',
    workspaceId: 'ws-1',
    content,
    snapshotHash,
    admittedAt: '2026-08-08T12:00:05.000Z',
  });
  assert.equal(second.replayed, true);
  assert.equal(second.admitted.admittedAt, '2026-08-08T12:00:00.000Z');
  assert.equal(second.admitted.snapshot.snapshotHash, snapshotHash);

  await assert.rejects(
    () =>
      service.admit({
        workflowId: 'wf-replay',
        workspaceId: 'ws-1',
        content: frozenContent({
          approvalBasis: 'policy_exempt_copy',
          planRevision: 2,
        }),
        admittedAt: '2026-08-08T12:00:10.000Z',
      }),
    (error: unknown) =>
      error instanceof ExecutionPlanAdmissionError &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('new admission requires the current serial capability declaration while legacy DBOS replay remains valid', async () => {
  const legacyExecutionPlan = structuredClone(COMPILED) as Record<string, unknown>;
  delete legacyExecutionPlan.executionCapabilities;
  legacyExecutionPlan.boundedRetry = {
    'unit-1': {
      maxAttempts: 1,
      maxCostCents: 0,
      retry: { enabled: false },
    },
  };
  const content = frozenContent({
    executionPlan: legacyExecutionPlan as ExecutionPlanFrozenContent['executionPlan'],
  });
  const snapshot = buildExecutionPlanSnapshot({ content });

  // Existing admitted v1 snapshots remain byte-stable and replayable.
  assert.equal(verifyExecutionPlanSnapshotForDbos({ snapshot }).ok, true);

  // The same unmarked layout cannot be published as a new admission.
  await assert.rejects(
    () =>
      new ExecutionPlanAdmissionService(
        new MemoryExecutionPlanSnapshotStore(),
      ).admit({
        workflowId: 'wf-legacy-new-admission',
        workspaceId: 'ws-1',
        content,
        snapshotHash: snapshot.snapshotHash,
      }),
    (error: unknown) =>
      error instanceof ExecutionPlanAdmissionError &&
      error.code === 'PLAN_CAPABILITY_UNSUPPORTED',
  );

  // Store adapters enforce the same publication rule even if a caller tries
  // to bypass the admission service.
  await assert.rejects(
    () =>
      new MemoryExecutionPlanSnapshotStore().putImmutable({
        snapshot,
        workflowId: 'wf-legacy-store-bypass',
        workspaceId: 'ws-1',
        admittedAt: '2026-08-19T12:00:00.000Z',
      }),
    (error: unknown) =>
      error instanceof ExecutionPlanAdmissionError &&
      error.code === 'PLAN_CAPABILITY_UNSUPPORTED',
  );
});

test('new admission fails closed when a serial plan publishes parallel, retry, or cache promises', async () => {
  const content = frozenContent({
    executionPlan: {
      ...structuredClone(COMPILED),
      units: [
        ...COMPILED.units,
        {
          unitId: 'unit-2',
          unitType: 'delivery.record',
          primitive: 'record',
        },
      ],
      dependencyGroups: [
        { groupId: 'g1', unitIds: ['unit-1', 'unit-2'] },
      ],
      boundedRetry: {
        'unit-1': {
          maxAttempts: 2,
          maxCostCents: 100,
          retry: { enabled: true, predicateRef: 'retry-transient/v1' },
        },
      },
      cachePolicies: {
        'unit-1': {
          ttlSeconds: 60,
          scope: 'workspace',
          dependsOn: [],
        },
      },
    } as unknown as ExecutionPlanFrozenContent['executionPlan'],
  });

  await assert.rejects(
    () =>
      new ExecutionPlanAdmissionService(
        new MemoryExecutionPlanSnapshotStore(),
      ).admit({
        workflowId: 'wf-unsupported-promises',
        workspaceId: 'ws-1',
        content,
      }),
    (error: unknown) =>
      error instanceof ExecutionPlanAdmissionError &&
      error.code === 'PLAN_CAPABILITY_UNSUPPORTED',
  );
});

test('DBOS verification recomputes hash and enforces context/rights fence', () => {
  const content = frozenContent({ approvalBasis: 'merchant_confirmed' });
  const snapshot = buildExecutionPlanSnapshot({
    content,
    confirmationDecisionRef: 'decision-ok',
  });

  const ok = verifyExecutionPlanSnapshotForDbos({ snapshot });
  assert.equal(ok.ok, true);
  assert.equal(ok.snapshotHash, snapshot.snapshotHash);

  assert.throws(
    () =>
      verifyExecutionPlanSnapshotForDbos({
        snapshot: { ...snapshot, snapshotHash: '0'.repeat(64) },
      }),
    (error: unknown) =>
      error instanceof ExecutionPlanAdmissionError &&
      error.code === 'SNAPSHOT_HASH_MISMATCH',
  );

  assert.throws(
    () =>
      verifyExecutionPlanSnapshotForDbos({
        snapshot,
        live: { rightsRevoked: true },
      }),
    (error: unknown) =>
      error instanceof ExecutionPlanAdmissionError &&
      error.code === 'RIGHTS_FENCE_MISMATCH',
  );

  assert.throws(
    () =>
      verifyExecutionPlanSnapshotForDbos({
        snapshot,
        live: { contextDrifted: true },
      }),
    (error: unknown) =>
      error instanceof ExecutionPlanAdmissionError &&
      error.code === 'CONTEXT_FENCE_MISMATCH',
  );
});

test('legacy durable task uses independent replay branch; incompatible layout fail closed', () => {
  const legacy = resolveDurableReplayBranch({});
  assert.deepEqual(legacy, { branch: 'legacy', reason: 'no_snapshot' });

  const content = frozenContent();
  const snapshot = buildExecutionPlanSnapshot({ content });
  const snapBranch = resolveDurableReplayBranch({
    executionPlanSnapshot: snapshot,
  });
  assert.equal(snapBranch.branch, 'execution_plan_snapshot');
  if (snapBranch.branch === 'execution_plan_snapshot') {
    assert.equal(snapBranch.snapshot.snapshotHash, snapshot.snapshotHash);
  }

  assert.throws(
    () =>
      resolveDurableReplayBranch({
        executionPlanSnapshotRaw: { schemaVersion: 'broken' },
      }),
    (error: unknown) =>
      error instanceof ExecutionPlanAdmissionError &&
      error.code === 'LAYOUT_INCOMPATIBLE',
  );
});

test('a paid pending freeze is never classified as the legacy LLM replay branch', () => {
  const pendingExecutionPlanSnapshot = freezeExecutionPlanContent(
    frozenContent({ approvalBasis: 'merchant_confirmed' }),
  );

  assert.deepEqual(
    resolveDurableReplayBranch({ pendingExecutionPlanSnapshot }),
    {
      branch: 'pending_confirmation',
      snapshotHash: pendingExecutionPlanSnapshot.snapshotHash,
    },
  );
});

test('evaluateExecutionPlanStaleness projects quote/rights/fact diffs', () => {
  const snapshot = buildExecutionPlanSnapshot({
    content: frozenContent({
      quoteRef: { id: 'quote-1', revision: 1 },
      rightsRevisionRefs: ['r1'],
      factRevisionRefs: ['f1'],
    }),
  });

  assert.equal(
    evaluateExecutionPlanStaleness({ snapshot, live: {} }).status,
    'current',
  );

  const stale = evaluateExecutionPlanStaleness({
    snapshot,
    live: {
      quoteRevision: 3,
      rightsRevisionRefs: ['r2'],
      factRevisionRefs: ['f1', 'f2'],
    },
  });
  assert.equal(stale.status, 'stale');
  if (stale.status === 'stale') {
    assert.deepEqual(stale.diff.quote, { frozen: 1, live: 3 });
    assert.ok(stale.diff.rightsRevisionRefs);
    assert.ok(stale.diff.factRevisionRefs);
  }

  const missingQuote = evaluateExecutionPlanStaleness({
    snapshot,
    live: { quoteMissing: true },
  });
  assert.deepEqual(missingQuote, {
    status: 'stale',
    diff: { quoteMissing: true },
  });
});

test('merchant_confirmed requires decisionRef; policy_exempt forbids it at admit', async () => {
  const service = new ExecutionPlanAdmissionService(
    new MemoryExecutionPlanSnapshotStore(),
  );
  const paid = frozenContent({ approvalBasis: 'merchant_confirmed' });
  await assert.rejects(
    () =>
      service.admit({
        workflowId: 'wf-paid',
        workspaceId: 'ws-1',
        content: paid,
      }),
    (error: unknown) =>
      error instanceof ExecutionPlanAdmissionError &&
      error.code === 'DECISION_REF_REQUIRED',
  );

  const copy = frozenContent({ approvalBasis: 'policy_exempt_copy' });
  await assert.rejects(
    () =>
      service.admit({
        workflowId: 'wf-copy',
        workspaceId: 'ws-1',
        content: copy,
        confirmationDecisionRef: 'decision-nope',
      }),
    (error: unknown) =>
      error instanceof ExecutionPlanAdmissionError &&
      error.code === 'DECISION_REF_FORBIDDEN',
  );
});

// ─── Compile-finalize producer ──────────────────────────────────────────────

function compileFreeze(
  overrides: Partial<ExecutionPlanCompileFreeze> = {},
): ExecutionPlanCompileFreeze {
  const content = frozenContent();
  return {
    planId: content.planId,
    planRevision: content.planRevision,
    intentDeclaration: content.intentDeclaration,
    contextBundleRef: content.contextBundleRef,
    executionPlan: content.executionPlan,
    deliverables: content.deliverables,
    quoteRef: content.quoteRef,
    rightsRevisionRefs: content.rightsRevisionRefs,
    harnessReleaseId: content.harnessReleaseId,
    approvalBasis: content.approvalBasis,
    ...overrides,
  } as unknown as ExecutionPlanCompileFreeze;
}

function assemblyInput(
  overrides: Partial<ExecutionPlanCompileFreeze> = {},
) {
  const freeze = compileFreeze(overrides);
  return {
    freeze,
    promptRevisionRefs: {},
    skillManifestRefs: {},
    routeRequirements: [],
    factRevisionRefs: [],
    boundedExecution: {
      schemaVersion: 'bounded-execution-snapshot/v1' as const,
      maxIterations: 10,
      maxCostCents: 100,
      maxWallClockMs: 60_000,
      maxDelegations: 2,
      requiredLimits: ['maxIterations', 'maxCostCents'] as Array<
        'maxIterations' | 'maxCostCents' | 'maxWallClockMs' | 'maxDelegations'
      >,
      consumption: {
        iterations: 0,
        costCents: 0,
        wallClockMs: 0,
        delegations: 0,
      },
      stopReason: null,
      triggeredLimit: null,
    },
  };
}

test('compile-finalize assembly produces a validated snapshot; hash is stable (idempotent producer)', () => {
  const snapshot = assembleExecutionPlanSnapshot(assemblyInput());
  assert.equal(snapshot.schemaVersion, EXECUTION_PLAN_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(snapshot.approvalBasis, 'policy_exempt_copy');
  assert.equal(snapshot.confirmationDecisionRef, undefined);
  assert.equal(snapshot.planRevision, 1);
  assert.equal(snapshot.quoteRef.id, 'quote-1');
  assert.equal(snapshot.harnessReleaseId, 'release-1');

  // Idempotent: assembling the same freeze twice yields the same hash, and the
  // hash matches the direct freeze of the equivalent full content.
  const again = assembleExecutionPlanSnapshot(assemblyInput());
  assert.equal(again.snapshotHash, snapshot.snapshotHash);
  const equivalentContent = frozenContent({
    promptRevisionRefs: {},
    skillManifestRefs: {},
    routeRequirements: [],
    factRevisionRefs: [],
    boundedExecution: { ...BOUNDED, requiredLimits: ['maxIterations', 'maxCostCents'] },
  });
  assert.equal(
    computeExecutionPlanSnapshotHash(equivalentContent),
    snapshot.snapshotHash,
  );

  // Fidelity exit gate: the assembled snapshot executes exactly the frozen
  // compile fields (confirmed == executing).
  assert.equal(
    assertExecutionPlanFidelity({ confirmed: equivalentContent, executing: snapshot }),
    true,
  );

  // Drift in a compile field changes the hash (stale detection surface).
  const drifted = assembleExecutionPlanSnapshot(
    assemblyInput({ deliverables: [{ deliverableId: 'd1', kind: 'copy', quantity: 2 }] }),
  );
  assert.notEqual(drifted.snapshotHash, snapshot.snapshotHash);
});

test('package allocation authority is frozen into the snapshot hash', () => {
  const packageBilling = {
    contractHash: 'package-contract-r1',
    allocations: [
      {
        carrierUnitId: 'carrier-copy',
        allocationId: 'copy-document',
        carrier: 'copy' as const,
        deliveryUnits: 1,
        creditCost: 17,
        failureRefundsCredits: true,
        operation: 'copy.generate',
        catalogModel: { id: 'copy-model', revision: 'copy-r2' },
        routeSnapshotRef: 'route-copy-r2',
        rightsRevisionRefs: ['rights-copy-r2'],
      },
      {
        carrierUnitId: 'carrier-note',
        allocationId: 'note-pages',
        carrier: 'note' as const,
        deliveryUnits: 6,
        creditCost: 60,
        failureRefundsCredits: true,
        operation: 'note.generate',
        catalogModel: { id: 'note-model', revision: 'note-r4' },
        routeSnapshotRef: 'route-note-r4',
        rightsRevisionRefs: ['rights-note-r4'],
      },
    ],
  };
  const snapshot = assembleExecutionPlanSnapshot(
    assemblyInput({ packageBilling }),
  );
  const drifted = assembleExecutionPlanSnapshot(
    assemblyInput({
      packageBilling: {
        ...packageBilling,
        allocations: packageBilling.allocations.map((allocation) =>
          allocation.allocationId === 'note-pages'
            ? { ...allocation, creditCost: 61 }
            : allocation,
        ),
      },
    }),
  );

  assert.deepEqual(snapshot.packageBilling, packageBilling);
  assert.notEqual(snapshot.snapshotHash, drifted.snapshotHash);
});

test('compile-finalize assembly fails closed for merchant_confirmed without decisionRef', () => {
  assert.throws(
    () =>
      assembleExecutionPlanSnapshot(
        assemblyInput({ approvalBasis: 'merchant_confirmed' }),
      ),
    (error: unknown) =>
      error instanceof Error &&
      /confirmationDecisionRef/u.test(String((error as { message?: string }).message)),
  );
});
