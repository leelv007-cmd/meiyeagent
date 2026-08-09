/**
 * V31-13 shadow reconciliation — deterministic fields, sampling, close audit.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
  EXECUTION_PLAN_SNAPSHOT_SCHEMA_VERSION,
} from '@meiye/contracts';

import { MemoryOpsConsoleAuditStore } from '../ops-console/audit.js';
import {
  buildExecutionPlanSnapshot,
  freezeExecutionPlanContent,
  type ExecutionPlanFrozenContent,
} from './execution-plan-admission.js';
import {
  DEFAULT_SHADOW_SAMPLE_RATE,
  DEFAULT_SHADOW_WINDOW_DAYS,
  SHADOW_RECONCILIATION_SAMPLE_RATE_KEY,
  SHADOW_RECONCILIATION_WINDOW_DAYS_KEY,
  ShadowReconciliationService,
  compareShadowDeterministicFields,
  extractDeterministicFieldsFromSnapshot,
  projectLegacyDeterministicFields,
  projectLegacyFromMakeRequest,
  resolveShadowReconciliationConfig,
  shouldSampleShadowReconciliation,
} from './shadow-reconciliation.js';
import { MemoryShadowReconciliationStore } from './shadow-reconciliation-store.js';

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
  units: [
    {
      unitId: 'unit-1',
      unitType: 'copy.generate',
      primitive: 'generate' as const,
    },
  ],
  dependencyGroups: [{ groupId: 'g1', unitIds: ['unit-1'] }],
  boundedRetry: {
    'unit-1': {
      maxAttempts: 1,
      maxCostCents: 0,
      retry: { enabled: false as const },
    },
  },
};

function frozenContent(
  overrides: Partial<ExecutionPlanFrozenContent> = {},
): ExecutionPlanFrozenContent {
  return {
    planId: 'plan-1',
    planRevision: 1,
    intentDeclaration: { summary: '纯文案推广本店团购' },
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
    factRevisionRefs: ['fact-1', 'fact-2'],
    boundedExecution: {
      ...BOUNDED,
      requiredLimits: ['maxIterations', 'maxCostCents'],
    },
    harnessReleaseId: 'release-1',
    approvalBasis: 'policy_exempt_copy',
    ...overrides,
  } as unknown as ExecutionPlanFrozenContent;
}

function buildSnapshot(overrides: Partial<ExecutionPlanFrozenContent> = {}) {
  const content = frozenContent(overrides);
  const { snapshotHash } = freezeExecutionPlanContent(content);
  return buildExecutionPlanSnapshot({ content, snapshotHash });
}

// ─── Deterministic field comparison (zero LLM) ─────────────────────────────

test('extractDeterministicFieldsFromSnapshot covers only V3.1 §23.2 fields', () => {
  const snapshot = buildSnapshot();
  const fields = extractDeterministicFieldsFromSnapshot(snapshot);

  assert.deepEqual(Object.keys(fields).sort(), [
    'bounds',
    'deliverables',
    'factRefs',
    'quoteRef',
    'rightsRefs',
  ]);
  assert.deepEqual(fields.deliverables, [{ kind: 'copy', quantity: 1 }]);
  assert.deepEqual(fields.factRefs, ['fact-1', 'fact-2']);
  assert.deepEqual(fields.rightsRefs, ['rights-1']);
  assert.deepEqual(fields.quoteRef, { id: 'quote-1', revision: 1 });
  assert.deepEqual(fields.bounds, {
    maxIterations: 10,
    maxCostCents: 100,
    maxWallClockMs: 60_000,
    maxDelegations: 2,
  });
  // Intent text / brief wording intentionally absent (non-deterministic).
  assert.equal(
    'intentDeclaration' in fields || 'summary' in fields,
    false,
  );
  assert.equal(snapshot.schemaVersion, EXECUTION_PLAN_SNAPSHOT_SCHEMA_VERSION);
});

test('compareShadowDeterministicFields: match when equal (order-insensitive refs)', () => {
  const snapshot = buildSnapshot({
    factRevisionRefs: ['fact-b', 'fact-a'],
  });
  const newChain = extractDeterministicFieldsFromSnapshot(snapshot);
  const oldChain = projectLegacyDeterministicFields({
    deliverables: [{ kind: 'copy', quantity: 1 }],
    factRefs: ['fact-a', 'fact-b'],
    rightsRefs: ['rights-1'],
    quoteRef: { id: 'quote-1', revision: 1 },
    bounds: {
      maxIterations: 10,
      maxCostCents: 100,
      maxWallClockMs: 60_000,
      maxDelegations: 2,
    },
  });
  const result = compareShadowDeterministicFields(newChain, oldChain);
  assert.equal(result.match, true);
  assert.deepEqual(result.diffs, []);
});

test('compareShadowDeterministicFields: field-level diffs locate mismatch', () => {
  const newChain = extractDeterministicFieldsFromSnapshot(buildSnapshot());
  const oldChain = projectLegacyDeterministicFields({
    deliverables: [
      { kind: 'copy', quantity: 2 },
      { kind: 'media', quantity: 1 },
    ],
    factRefs: ['fact-1', 'fact-x'],
    rightsRefs: ['rights-2'],
    quoteRef: { id: 'quote-1', revision: 9 },
    bounds: {
      maxIterations: 99,
      maxCostCents: 100,
      maxWallClockMs: 60_000,
      maxDelegations: 2,
    },
  });
  const result = compareShadowDeterministicFields(newChain, oldChain);
  assert.equal(result.match, false);
  const fields = result.diffs.map((d) => d.field).sort();
  assert.ok(fields.includes('deliverables'));
  assert.ok(fields.includes('factRefs'));
  assert.ok(fields.includes('rightsRefs'));
  assert.ok(fields.includes('quoteRef.revision'));
  assert.ok(fields.includes('bounds.maxIterations'));
  const quantityDiff = result.diffs.find((d) => d.field === 'deliverables');
  assert.ok(quantityDiff);
  assert.notDeepEqual(quantityDiff!.expected, quantityDiff!.actual);
});

test('legacy projection refuses snapshot self-fallback and requires independent observations', () => {
  const snapshot = buildSnapshot();
  assert.equal(
    projectLegacyFromMakeRequest({
      snapshot,
      boundedExecution: snapshot.boundedExecution,
      observedDeliverables: [{ kind: 'copy', quantity: 2 }],
    }),
    null,
  );
  const projected = projectLegacyFromMakeRequest({
    snapshot,
    boundedExecution: snapshot.boundedExecution,
    observedDeliverables: [{ kind: 'copy', quantity: 7 }],
    observedFactRefs: ['legacy-fact'],
    observedRightsRefs: ['legacy-rights'],
    observedQuoteRef: { id: 'legacy-quote', revision: 8 },
  });
  assert.equal(projected?.deliverables[0]?.quantity, 7);
  assert.deepEqual(projected?.factRefs, ['legacy-fact']);
  assert.equal(projected?.quoteRef.id, 'legacy-quote');
});

// ─── Sampling gate ──────────────────────────────────────────────────────────

test('shouldSampleShadowReconciliation: rate 0 never, rate 1 always', () => {
  assert.equal(
    shouldSampleShadowReconciliation({ sampleRate: 0, sampleKey: 'wf-1' }),
    false,
  );
  assert.equal(
    shouldSampleShadowReconciliation({ sampleRate: 1, sampleKey: 'wf-1' }),
    true,
  );
});

test('shouldSampleShadowReconciliation: deterministic for same key', () => {
  const a = shouldSampleShadowReconciliation({
    sampleRate: DEFAULT_SHADOW_SAMPLE_RATE,
    sampleKey: 'workflow-stable-key',
  });
  const b = shouldSampleShadowReconciliation({
    sampleRate: DEFAULT_SHADOW_SAMPLE_RATE,
    sampleKey: 'workflow-stable-key',
  });
  assert.equal(a, b);
});

test('shouldSampleShadowReconciliation: ~10% density over many keys', () => {
  let hits = 0;
  const n = 2_000;
  for (let i = 0; i < n; i += 1) {
    if (
      shouldSampleShadowReconciliation({
        sampleRate: 0.1,
        sampleKey: `wf-${i}`,
      })
    ) {
      hits += 1;
    }
  }
  const rate = hits / n;
  assert.ok(rate > 0.05 && rate < 0.15, `observed sample rate ${rate}`);
});

// ─── Config hot-read ────────────────────────────────────────────────────────

test('resolveShadowReconciliationConfig defaults and clamps', () => {
  assert.deepEqual(resolveShadowReconciliationConfig({}), {
    sampleRate: DEFAULT_SHADOW_SAMPLE_RATE,
    windowDays: DEFAULT_SHADOW_WINDOW_DAYS,
  });
  assert.deepEqual(
    resolveShadowReconciliationConfig({
      sampleRate: 0.5,
      windowDays: 21,
    }),
    { sampleRate: 0.5, windowDays: 21 },
  );
  // Clamp out-of-range.
  assert.equal(
    resolveShadowReconciliationConfig({ sampleRate: 2 }).sampleRate,
    1,
  );
  assert.equal(
    resolveShadowReconciliationConfig({ sampleRate: -1 }).sampleRate,
    0,
  );
  assert.equal(
    resolveShadowReconciliationConfig({ windowDays: 7 }).windowDays,
    14,
  );
  assert.equal(
    resolveShadowReconciliationConfig({ windowDays: 40 }).windowDays,
    28,
  );
  assert.equal(
    SHADOW_RECONCILIATION_SAMPLE_RATE_KEY,
    'make.shadow_reconciliation.sample_rate',
  );
  assert.equal(
    SHADOW_RECONCILIATION_WINDOW_DAYS_KEY,
    'make.shadow_reconciliation.window_days',
  );
});

// ─── Service: sample + mismatch evidence + close audit ──────────────────────

test('service skips when sample gate closed', async () => {
  const store = new MemoryShadowReconciliationStore();
  const audit = new MemoryOpsConsoleAuditStore();
  const service = new ShadowReconciliationService({
    store,
    audit,
    resolveConfig: async () => ({ sampleRate: 0, windowDays: 14 }),
  });
  const snapshot = buildSnapshot();
  const outcome = await service.maybeReconcileOnExecutionComplete({
    workflowId: 'wf-skip',
    workspaceId: 'ws-1',
    snapshot,
    oldChain: extractDeterministicFieldsFromSnapshot(snapshot),
    now: '2026-08-01T00:00:00.000Z',
  });
  assert.equal(outcome.sampled, false);
  assert.equal((await store.listSamples()).length, 0);
  assert.equal((await audit.list()).length, 0);
});

test('service records match sample without mismatch audit', async () => {
  const store = new MemoryShadowReconciliationStore();
  const audit = new MemoryOpsConsoleAuditStore();
  const service = new ShadowReconciliationService({
    store,
    audit,
    resolveConfig: async () => ({ sampleRate: 1, windowDays: 14 }),
  });
  const snapshot = buildSnapshot();
  const fields = extractDeterministicFieldsFromSnapshot(snapshot);
  const outcome = await service.maybeReconcileOnExecutionComplete({
    workflowId: 'wf-match',
    workspaceId: 'ws-1',
    snapshot,
    oldChain: fields,
    now: '2026-08-01T00:00:00.000Z',
  });
  assert.equal(outcome.sampled, true);
  assert.equal(outcome.match, true);
  const samples = await store.listSamples();
  assert.equal(samples.length, 1);
  assert.equal(samples[0]?.matched, true);
  assert.equal((await audit.list()).length, 0);
});

test('service records field-level mismatch alert on ops audit surface', async () => {
  const store = new MemoryShadowReconciliationStore();
  const audit = new MemoryOpsConsoleAuditStore();
  const service = new ShadowReconciliationService({
    store,
    audit,
    resolveConfig: async () => ({ sampleRate: 1, windowDays: 14 }),
  });
  const snapshot = buildSnapshot();
  const outcome = await service.maybeReconcileOnExecutionComplete({
    workflowId: 'wf-mismatch',
    workspaceId: 'ws-1',
    snapshot,
    oldChain: projectLegacyDeterministicFields({
      deliverables: [{ kind: 'copy', quantity: 9 }],
      factRefs: ['fact-1', 'fact-2'],
      rightsRefs: ['rights-1'],
      quoteRef: { id: 'quote-1', revision: 1 },
      bounds: {
        maxIterations: 10,
        maxCostCents: 100,
        maxWallClockMs: 60_000,
        maxDelegations: 2,
      },
    }),
    now: '2026-08-01T00:00:00.000Z',
    operatorId: 'system',
    correlationId: 'corr-1',
  });
  assert.equal(outcome.sampled, true);
  assert.equal(outcome.match, false);
  assert.ok(outcome.diffs?.some((d) => d.field === 'deliverables'));
  const entries = await audit.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.action, 'shadow_reconciliation_mismatch');
  assert.ok(
    Array.isArray((entries[0]?.detail as { diffs?: unknown }).diffs),
  );
});

test('close early when continuous window has mismatch=0', async () => {
  const store = new MemoryShadowReconciliationStore();
  const audit = new MemoryOpsConsoleAuditStore();
  const service = new ShadowReconciliationService({
    store,
    audit,
    resolveConfig: async () => ({ sampleRate: 1, windowDays: 14 }),
  });
  const snapshot = buildSnapshot();
  const fields = extractDeterministicFieldsFromSnapshot(snapshot);
  await service.maybeReconcileOnExecutionComplete({
    workflowId: 'wf-early-1',
    workspaceId: 'ws-1',
    snapshot,
    oldChain: fields,
    now: '2026-08-01T00:00:00.000Z',
  });
  // Within window — not yet closable.
  let closed = await service.tryCloseIfEligible({
    now: '2026-08-10T00:00:00.000Z',
    operatorId: 'ops-1',
    correlationId: 'corr-close',
  });
  assert.equal(closed, null);

  // Continuous 14 days mismatch-free → early_achieved.
  closed = await service.tryCloseIfEligible({
    now: '2026-08-15T00:00:00.000Z',
    operatorId: 'ops-1',
    correlationId: 'corr-close',
  });
  assert.ok(closed);
  assert.equal(closed.reason, 'early_achieved');
  const state = await store.getProgramState();
  assert.equal(state?.status, 'closed');
  assert.equal(state?.closeReason, 'early_achieved');
  const closeAudits = (await audit.list()).filter(
    (e) => e.action === 'close_shadow_reconciliation',
  );
  assert.equal(closeAudits.length, 1);
  assert.equal(closeAudits[0]?.operatorId, 'ops-1');
});

test('close timebox_expired when window ends after a mismatch streak reset', async () => {
  const store = new MemoryShadowReconciliationStore();
  const audit = new MemoryOpsConsoleAuditStore();
  const service = new ShadowReconciliationService({
    store,
    audit,
    resolveConfig: async () => ({ sampleRate: 1, windowDays: 14 }),
  });
  const snapshot = buildSnapshot();
  const fields = extractDeterministicFieldsFromSnapshot(snapshot);

  await service.maybeReconcileOnExecutionComplete({
    workflowId: 'wf-tb-1',
    workspaceId: 'ws-1',
    snapshot,
    oldChain: fields,
    now: '2026-08-01T00:00:00.000Z',
  });
  // Mismatch mid-window resets continuous free streak.
  await service.maybeReconcileOnExecutionComplete({
    workflowId: 'wf-tb-2',
    workspaceId: 'ws-1',
    snapshot,
    oldChain: projectLegacyDeterministicFields({
      ...fields,
      deliverables: [{ kind: 'copy', quantity: 3 }],
    }),
    now: '2026-08-05T00:00:00.000Z',
    operatorId: 'system',
    correlationId: 'c',
  });
  // At openedAt+14d continuous free is only ~10d from last mismatch → timebox.
  const closed = await service.tryCloseIfEligible({
    now: '2026-08-15T00:00:00.000Z',
    operatorId: 'ops-2',
    correlationId: 'corr-tb',
  });
  assert.ok(closed);
  assert.equal(closed.reason, 'timebox_expired');
  const state = await store.getProgramState();
  assert.equal(state?.closeReason, 'timebox_expired');
});

test('idempotent sample for same workflowId does not double-count', async () => {
  const store = new MemoryShadowReconciliationStore();
  const audit = new MemoryOpsConsoleAuditStore();
  const service = new ShadowReconciliationService({
    store,
    audit,
    resolveConfig: async () => ({ sampleRate: 1, windowDays: 14 }),
  });
  const snapshot = buildSnapshot();
  const fields = extractDeterministicFieldsFromSnapshot(snapshot);
  const input = {
    workflowId: 'wf-idem',
    workspaceId: 'ws-1',
    snapshot,
    oldChain: fields,
    now: '2026-08-01T00:00:00.000Z' as const,
  };
  await service.maybeReconcileOnExecutionComplete(input);
  await service.maybeReconcileOnExecutionComplete(input);
  assert.equal((await store.listSamples()).length, 1);
});

test('closed shadow program stops sampling completely', async () => {
  const store = new MemoryShadowReconciliationStore();
  await store.putProgramState({
    status: 'closed',
    openedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    closeReason: 'early_achieved',
    closedAt: '2026-08-15T00:00:00.000Z',
    closedBy: 'ops',
    lastMismatchAt: null,
    sampleCount: 1,
    mismatchCount: 0,
  });
  const service = new ShadowReconciliationService({
    store,
    audit: new MemoryOpsConsoleAuditStore(),
    resolveConfig: async () => ({ sampleRate: 1, windowDays: 14 }),
  });
  const snapshot = buildSnapshot();
  const result = await service.maybeReconcileOnExecutionComplete({
    workflowId: 'wf-after-close',
    workspaceId: 'ws-1',
    snapshot,
    oldChain: extractDeterministicFieldsFromSnapshot(snapshot),
    now: '2026-08-16T00:00:00.000Z',
  });
  assert.equal(result.sampled, false);
  assert.equal((await store.listSamples()).length, 0);
});

test('mismatch at window anchor is excluded from the following clean window', async () => {
  const store = new MemoryShadowReconciliationStore();
  const audit = new MemoryOpsConsoleAuditStore();
  const service = new ShadowReconciliationService({
    store,
    audit,
    resolveConfig: async () => ({ sampleRate: 1, windowDays: 14 }),
  });
  const snapshot = buildSnapshot();
  await service.maybeReconcileOnExecutionComplete({
    workflowId: 'wf-anchor-mismatch',
    workspaceId: 'ws-1',
    snapshot,
    oldChain: projectLegacyDeterministicFields({
      ...extractDeterministicFieldsFromSnapshot(snapshot),
      deliverables: [{ kind: 'copy', quantity: 99 }],
    }),
    now: '2026-08-01T00:00:00.000Z',
  });
  const closed = await service.tryCloseIfEligible({
    now: '2026-08-15T00:00:00.000Z',
    operatorId: 'ops',
    correlationId: 'clean-window',
  });
  assert.equal(closed?.reason, 'early_achieved');
});

test('service never throws into production path on store failure', async () => {
  const audit = new MemoryOpsConsoleAuditStore();
  const service = new ShadowReconciliationService({
    store: {
      async getProgramState() {
        throw new Error('store down');
      },
      async putProgramState() {
        throw new Error('store down');
      },
      async putSampleIdempotent() {
        throw new Error('store down');
      },
      async listSamples() {
        throw new Error('store down');
      },
      async countMismatchesSince() {
        throw new Error('store down');
      },
    },
    audit,
    resolveConfig: async () => ({ sampleRate: 1, windowDays: 14 }),
  });
  const snapshot = buildSnapshot();
  const outcome = await service.maybeReconcileOnExecutionComplete({
    workflowId: 'wf-fail',
    workspaceId: 'ws-1',
    snapshot,
    oldChain: extractDeterministicFieldsFromSnapshot(snapshot),
    now: '2026-08-01T00:00:00.000Z',
  });
  assert.equal(outcome.sampled, false);
  assert.equal(outcome.error, true);
});
