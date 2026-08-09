/**
 * V31-14 Make snapshot consume — zero intent/brief LLM re-call + validator.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
  EXECUTION_PLAN_SNAPSHOT_SCHEMA_VERSION,
} from '@meiye/contracts';

import {
  buildExecutionPlanSnapshot,
  freezeExecutionPlanContent,
  type ExecutionPlanFrozenContent,
} from './execution-plan-admission.js';
import {
  isMakeSnapshotConsumePath,
  MakeSnapshotConsumeError,
  materializeCopyBriefFromSnapshot,
  materializeIntentFromSnapshot,
  resolveMakeSnapshotConsume,
  snapshotConsumeTracePayload,
  validateContextBundleAgainstSnapshot,
  validateIntentAgainstSnapshot,
} from './make-snapshot-consume.js';
import type { HarnessWorkflowInput } from './task-admission.js';

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

function buildSnapshot(
  overrides: Partial<ExecutionPlanFrozenContent> = {},
) {
  const content = frozenContent(overrides);
  const { snapshotHash } = freezeExecutionPlanContent(content);
  return buildExecutionPlanSnapshot({ content, snapshotHash });
}

function baseRequest(
  snapshot?: ReturnType<typeof buildSnapshot>,
): HarnessWorkflowInput {
  return {
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
    packageId: 'package-1',
    expectedRevision: 1,
    workflowRevision: 1,
    creationMode: 'customized',
    rawInput: '纯文案推广本店团购',
    intent: {
      context: {
        workId: 'work-1',
        intent: '纯文案推广本店团购',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
    ...(snapshot ? { executionPlanSnapshot: snapshot } : {}),
  };
}

test('resolveMakeSnapshotConsume: no snapshot → legacy_llm', () => {
  const decision = resolveMakeSnapshotConsume({ request: baseRequest() });
  assert.equal(decision.mode, 'legacy_llm');
  assert.equal(isMakeSnapshotConsumePath(decision), false);
});

test('resolveMakeSnapshotConsume: force_legacy_five_stage wins even with snapshot', () => {
  const snapshot = buildSnapshot();
  const decision = resolveMakeSnapshotConsume({
    request: baseRequest(snapshot),
    forceLegacyFiveStage: true,
  });
  assert.equal(decision.mode, 'legacy_llm');
  assert.equal(
    decision.mode === 'legacy_llm' && decision.reason,
    'force_legacy_five_stage',
  );
});

test('resolveMakeSnapshotConsume: valid snapshot → snapshot_validator', () => {
  const snapshot = buildSnapshot();
  const decision = resolveMakeSnapshotConsume({
    request: baseRequest(snapshot),
  });
  assert.equal(decision.mode, 'snapshot_validator');
  assert.equal(isMakeSnapshotConsumePath(decision), true);
  if (isMakeSnapshotConsumePath(decision)) {
    assert.equal(decision.snapshot.schemaVersion, EXECUTION_PLAN_SNAPSHOT_SCHEMA_VERSION);
    assert.equal(decision.snapshot.snapshotHash, snapshot.snapshotHash);
  }
});

test('resolveMakeSnapshotConsume: hash mismatch fail closed', () => {
  const snapshot = buildSnapshot();
  const broken = { ...snapshot, snapshotHash: '0'.repeat(64) };
  assert.throws(
    () =>
      resolveMakeSnapshotConsume({
        request: baseRequest(broken as typeof snapshot),
      }),
    (error: unknown) =>
      error instanceof MakeSnapshotConsumeError &&
      error.code === 'SNAPSHOT_HASH_MISMATCH',
  );
});

test('materializeIntentFromSnapshot: llmInvoked=false and customized policy route', () => {
  const snapshot = buildSnapshot();
  const result = materializeIntentFromSnapshot({
    snapshot,
    request: baseRequest(snapshot),
  });
  assert.equal(result.llmInvoked, false);
  assert.equal(result.blockingQuestion, null);
  assert.equal(result.declaration.route, 'customized');
  assert.equal(result.declaration.routingSource, 'policy');
  assert.equal(result.declaration.normalizedIntent, '纯文案推广本店团购');
  assert.equal(result.declaration.deliveryLayer, 'copy');
});

test('materializeCopyBriefFromSnapshot: deterministic brief, zero LLM, freeze fact refs', () => {
  const snapshot = buildSnapshot();
  const intent = materializeIntentFromSnapshot({
    snapshot,
    request: baseRequest(snapshot),
  });
  const result = materializeCopyBriefFromSnapshot({
    snapshot,
    declaration: intent.declaration,
    request: baseRequest(snapshot),
  });
  assert.equal(result.llmInvoked, false);
  assert.equal(result.brief.kind, 'copy');
  assert.deepEqual(result.brief.factRefs, ['fact-1']);
  assert.match(result.brief.instructions, /已确认方案/);
  assert.ok(
    result.brief.constraints.some((c) => c.includes(snapshot.snapshotHash)),
  );
});

test('materializeCopyBriefFromSnapshot consumes structured memory style without leaking its statement', () => {
  const snapshot = buildSnapshot({
    executionPlan: {
      ...COMPILED,
      units: [
        {
          ...COMPILED.units[0],
          input: {
            memoryContext: {
              entries: [{ memoryId: 'preference-1', revision: 3 }],
              receiptRef: {
                taskId: 'task-1',
                runId: 'run-1',
                harnessReleaseId: 'release-1',
              },
              styleConstraints: {
                tones: ['concise', 'restrained'],
                maxTitleChars: 24,
                maxBodyChars: 32,
                maxSentenceChars: 24,
                forbiddenPhrases: ['绝对', '保证', '必然'],
              },
            },
          },
        },
      ],
    } as unknown as ExecutionPlanFrozenContent['executionPlan'],
  });
  const intent = materializeIntentFromSnapshot({
    snapshot,
    request: baseRequest(snapshot),
  });
  const result = materializeCopyBriefFromSnapshot({
    snapshot,
    declaration: intent.declaration,
    request: baseRequest(snapshot),
  });
  assert.match(result.brief.instructions, /正文不超过 32 字/u);
  assert.match(result.brief.instructions, /语气=concise、restrained/u);
  assert.doesNotMatch(result.brief.instructions, /以后每次文案/u);
});

test('validateIntentAgainstSnapshot: hard drift fail closed', () => {
  const snapshot = buildSnapshot();
  assert.throws(
    () =>
      validateIntentAgainstSnapshot({
        snapshot,
        declaration: {
          normalizedIntent: '完全不同的意图内容xyz',
          taskType: 'routine_marketing_materials',
          deliveryLayer: 'copy',
          relevantAssetCategories: ['store'],
          usedAssetCategories: ['store'],
          route: 'customized',
          routingSource: 'model',
          implicitConstraints: [],
        },
      }),
    (error: unknown) =>
      error instanceof MakeSnapshotConsumeError &&
      error.code === 'INTENT_VALIDATOR_MISMATCH',
  );
});

test('validateContextBundleAgainstSnapshot: same id with revision drift fails', () => {
  const snapshot = buildSnapshot();
  assert.throws(
    () =>
      validateContextBundleAgainstSnapshot({
        snapshot,
        bundle: {
          bundleId: 'bundle-1',
          revision: 99,
          hash: 'other-hash',
        },
      }),
    (error: unknown) =>
      error instanceof MakeSnapshotConsumeError &&
      error.code === 'CONTEXT_REF_MISMATCH',
  );
});

test('snapshotConsumeTracePayload asserts llmInvoked=false for both stages', () => {
  const snapshot = buildSnapshot();
  for (const stage of ['intent_naming', 'brief_compilation'] as const) {
    const payload = snapshotConsumeTracePayload({
      snapshotHash: snapshot.snapshotHash,
      approvalBasis: snapshot.approvalBasis,
      stage,
      llmInvoked: false,
    });
    assert.equal(payload.llmInvoked, false);
    assert.equal(payload.makeConsume, 'snapshot_validator');
    assert.equal(payload.stage, stage);
  }
});
