import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AGENT_EPHEMERAL_EVENT_SCHEMA_VERSION,
  AGENT_RUN_SCHEMA_VERSION,
  AGENT_SEMANTIC_EVENT_SCHEMA_VERSION,
  AGENT_THREAD_SCHEMA_VERSION,
  agentEphemeralEventWireSchema,
  agentMemoryEntrySchema,
  agentRunSchema,
  agentSemanticEventFromWire,
  agentSemanticEventSchema,
  agentSemanticEventToWire,
  agentSemanticEventWireSchema,
  agentThreadSchema,
  compareStreamOffsetWire,
  COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
  compiledExecutionPlanSchema,
  EXECUTION_PLAN_SNAPSHOT_HASH_COVERAGE_FIELDS,
  EXECUTION_PLAN_SNAPSHOT_HASH_EXCLUDED_FIELDS,
  EXECUTION_PLAN_SNAPSHOT_SCHEMA_VERSION,
  executionPlanSnapshotSchema,
  HARNESS_RELEASE_ARTIFACT_SCHEMA_VERSION,
  harnessReleaseArtifactSchema,
  harnessReleaseLifecycleSchema,
  harnessReleaseRolloutSchema,
  makeSteeringCommandSchema,
  marketingGoalSchema,
  marketingPlanRevisionSchema,
  memoryInjectionReceiptSchema,
  outcomeEvidenceSchema,
  agentExecutionConfirmationRequestSchema,
  planConfirmationDecisionSchema,
} from './agent-domain.js';

const TS = '2026-08-08T12:00:00.000Z';

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

const COMPILED_PLAN = {
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

const CONTROL_LIMITS = {
  maxLlmSteps: 6,
  maxToolCalls: 8,
  maxRetrievalCalls: 4,
  maxMerchantQuestions: 1,
  maxReplans: 3,
  maxSchemaRepairs: 1,
  maxContextTokens: 32_000,
  maxDelegations: 2,
};

test('agent thread contract parses and rejects unknown fields', () => {
  const thread = {
    schemaVersion: AGENT_THREAD_SCHEMA_VERSION,
    threadId: 'thread-1',
    resourceId: 'resource-1',
    title: '8 月新客引流',
    status: 'active' as const,
    activeGoalIds: ['goal-1'],
    summaryRevision: 2,
    sessionRevision: 5,
    createdAt: TS,
    updatedAt: TS,
  };
  assert.equal(agentThreadSchema.parse(thread).sessionRevision, 5);
  assert.equal(
    agentThreadSchema.safeParse({ ...thread, contentPackageBody: 'x' }).success,
    false,
  );
  assert.equal(
    agentThreadSchema.safeParse({ ...thread, sessionRevision: -1 }).success,
    false,
  );
});

test('agent run requires executionLink only for sync durability', () => {
  const exitRun = {
    schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    runId: 'run-exit',
    threadId: 'thread-1',
    trigger: 'merchant_turn' as const,
    status: 'completed' as const,
    durability: 'exit' as const,
    harnessReleaseId: 'release-1',
    startedAt: TS,
    finishedAt: TS,
  };
  assert.equal(agentRunSchema.parse(exitRun).durability, 'exit');
  assert.equal(
    agentRunSchema.safeParse({
      ...exitRun,
      executionLink: { workflowId: 'wf-1', snapshotHash: 'abc' },
    }).success,
    false,
  );

  const syncBase = {
    schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    runId: 'run-sync',
    threadId: 'thread-1',
    parentRunId: 'run-exit',
    trigger: 'system_resume' as const,
    status: 'running' as const,
    durability: 'sync' as const,
    harnessReleaseId: 'release-1',
    startedAt: TS,
  };
  assert.equal(agentRunSchema.safeParse(syncBase).success, false);
  assert.deepEqual(
    agentRunSchema.parse({
      ...syncBase,
      executionLink: {
        workflowId: 'workflow-1',
        snapshotHash: 'deadbeef',
      },
    }).executionLink,
    { workflowId: 'workflow-1', snapshotHash: 'deadbeef' },
  );
});

test('marketing goal and plan revision contracts parse V3.1 shapes', () => {
  const goal = marketingGoalSchema.parse({
    schemaVersion: 'marketing-goal/v1',
    goalId: 'goal-1',
    resourceId: 'resource-1',
    objective: 'inquiry',
    statement: '本月多接新客咨询',
    priority: 'normal',
    status: 'active',
    evidenceRefs: [{ kind: 'merchant_said', ref: 'msg-1' }],
    revision: 1,
    createdAt: TS,
    updatedAt: TS,
  });
  assert.equal(goal.objective, 'inquiry');

  const plan = marketingPlanRevisionSchema.parse({
    schemaVersion: 'marketing-plan-revision/v1',
    planId: 'plan-1',
    revision: 1,
    threadId: 'thread-1',
    goalIds: ['goal-1'],
    scope: 'single_work',
    intent: { summary: '小红书护理案例' },
    goal: {
      summary: '新客引流',
      whyNow: null,
      desiredAction: '发笔记',
    },
    deliverables: [
      { deliverableId: 'd1', kind: 'note', quantity: 1 },
    ],
    expression: { voice: '专业温和' },
    factUsages: [],
    assetUsages: [],
    rightsSummary: {},
    complianceSummary: {},
    capabilitySummary: {},
    quoteRef: { id: 'quote-1', revision: 3 },
    boundRevisions: {
      intentRevision: 1,
      contextBundleId: 'bundle-1',
      contextRevision: '1',
      recipeRevisionIds: [],
      catalogRevisionId: 'catalog-1',
      modelRevisionIds: [],
      sourceRevisionIds: [],
      rightsRevisionIds: [],
      harnessReleaseId: 'release-1',
    },
    contentHash: 'hash-plan',
    expiresAt: TS,
    createdAt: TS,
  });
  assert.equal(plan.revision, 1);
  assert.equal(
    marketingPlanRevisionSchema.safeParse({
      ...plan,
      status: 'confirmed',
    }).success,
    false,
  );
});

test('memory entry and injection receipt contracts parse', () => {
  const entry = agentMemoryEntrySchema.parse({
    schemaVersion: 'agent-memory-entry/v1',
    memoryId: 'mem-1',
    resourceId: 'resource-1',
    kind: 'preference',
    scope: { storeId: 'store-1', platform: 'xiaohongshu' },
    authority: 'confirmed',
    state: 'active',
    statement: '小红书少一点强促销感',
    evidenceRefs: [],
    confidence: 0.9,
    effectiveFrom: TS,
    revision: 1,
  });
  assert.equal(entry.kind, 'preference');

  const receipt = memoryInjectionReceiptSchema.parse({
    schemaVersion: 'memory-injection-receipt/v1',
    taskId: 'task-1',
    runId: 'run-1',
    harnessReleaseId: 'release-1',
    entries: [
      { memoryId: 'mem-1', statement: entry.statement, revision: 1 },
    ],
    injectedAt: TS,
  });
  assert.equal(receipt.entries.length, 1);
});

test('semantic event domain/wire round-trip and numeric offset order', () => {
  const domain = agentSemanticEventSchema.parse({
    schemaVersion: AGENT_SEMANTIC_EVENT_SCHEMA_VERSION,
    eventId: 'evt-1',
    threadId: 'thread-1',
    streamOffset: 10n,
    contextRole: 'included',
    sourceDomain: 'agent_run',
    sourceEntityId: 'run-1',
    sourceRevision: '1',
    correlationId: 'corr-1',
    eventType: 'run.started',
    payload: { ok: true },
    occurredAt: TS,
  });
  const wire = agentSemanticEventToWire(domain);
  assert.equal(wire.streamOffset, '10');
  assert.equal(agentSemanticEventWireSchema.parse(wire).streamOffset, '10');
  assert.equal(agentSemanticEventFromWire(wire).streamOffset, 10n);
  assert.equal(compareStreamOffsetWire('9', '10'), -1);
  assert.equal(compareStreamOffsetWire('10', '10'), 0);
  assert.equal(compareStreamOffsetWire('100', '20'), 1);
  assert.equal(
    agentSemanticEventWireSchema.safeParse({
      ...wire,
      streamOffset: '01',
    }).success,
    false,
  );

  const ephemeral = agentEphemeralEventWireSchema.parse({
    schemaVersion: AGENT_EPHEMERAL_EVENT_SCHEMA_VERSION,
    eventId: 'tok-1',
    threadId: 'thread-1',
    eventType: 'token.delta',
    payload: { text: '你' },
    occurredAt: TS,
    transient: true,
  });
  assert.equal(ephemeral.transient, true);
  assert.equal(
    agentEphemeralEventWireSchema.safeParse({
      ...ephemeral,
      transient: false,
    }).success,
    false,
  );
});

test('compiled execution plan and snapshot hash coverage exclude confirmationDecisionRef', () => {
  assert.ok(
    (
      EXECUTION_PLAN_SNAPSHOT_HASH_COVERAGE_FIELDS as readonly string[]
    ).includes('executionPlan'),
  );
  assert.ok(
    (
      EXECUTION_PLAN_SNAPSHOT_HASH_EXCLUDED_FIELDS as readonly string[]
    ).includes('confirmationDecisionRef'),
  );
  assert.equal(
    (
      EXECUTION_PLAN_SNAPSHOT_HASH_COVERAGE_FIELDS as readonly string[]
    ).includes('confirmationDecisionRef'),
    false,
  );

  assert.equal(
    compiledExecutionPlanSchema.parse(COMPILED_PLAN).schemaVersion,
    COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
  );

  const baseSnapshot = {
    schemaVersion: EXECUTION_PLAN_SNAPSHOT_SCHEMA_VERSION,
    planId: 'plan-1',
    planRevision: 1,
    intentDeclaration: { summary: '纯文案' },
    contextBundleRef: {
      bundleId: 'bundle-1',
      revision: 1,
      hash: 'ctx-hash',
    },
    executionPlan: COMPILED_PLAN,
    deliverables: [{ deliverableId: 'd1', kind: 'copy' as const, quantity: 1 }],
    promptRevisionRefs: {
      copyGeneration: { key: 'copyGeneration', version: 'v3' },
    },
    skillManifestRefs: {},
    routeRequirements: [],
    quoteRef: { id: 'quote-1', revision: 1 },
    rightsRevisionRefs: [],
    factRevisionRefs: [],
    boundedExecution: BOUNDED,
    harnessReleaseId: 'release-1',
    approvalBasis: 'policy_exempt_copy' as const,
    snapshotHash: 'snap-hash-1',
  };

  assert.equal(
    executionPlanSnapshotSchema.parse(baseSnapshot).approvalBasis,
    'policy_exempt_copy',
  );
  assert.equal(
    executionPlanSnapshotSchema.safeParse({
      ...baseSnapshot,
      confirmationDecisionRef: 'decision-1',
    }).success,
    false,
  );

  assert.equal(
    executionPlanSnapshotSchema.safeParse({
      ...baseSnapshot,
      approvalBasis: 'merchant_confirmed',
    }).success,
    false,
  );
  assert.equal(
    executionPlanSnapshotSchema.parse({
      ...baseSnapshot,
      approvalBasis: 'merchant_confirmed',
      confirmationDecisionRef: 'decision-1',
    }).confirmationDecisionRef,
    'decision-1',
  );

  // Only two approval basis enums.
  assert.equal(
    executionPlanSnapshotSchema.safeParse({
      ...baseSnapshot,
      approvalBasis: 'auto',
    }).success,
    false,
  );
});

test('agent execution confirmation request and immutable decision parse', () => {
  const request = agentExecutionConfirmationRequestSchema.parse({
    schemaVersion: 'agent-execution-confirmation-request/v1',
    requestId: 'req-1',
    workspaceId: 'ws-1',
    planId: 'plan-1',
    planRevision: 1,
    snapshotHash: 'snap-hash-1',
    quoteRef: { id: 'quote-1', revision: 1 },
    reservationIdempotencyKey: 'reserve-1',
    createdAt: TS,
    holdExpiresAt: '2026-08-08T13:00:00.000Z',
    status: 'pending',
  });
  assert.equal(request.status, 'pending');

  const decision = planConfirmationDecisionSchema.parse({
    schemaVersion: 'plan-confirmation-decision/v1',
    decisionId: 'decision-1',
    requestId: 'req-1',
    actorId: 'actor-1',
    decision: 'confirmed',
    decidedAt: TS,
  });
  assert.equal(decision.decision, 'confirmed');
});

test('harness release artifact requires middlewareBindings and controlLimits', () => {
  const artifact = {
    schemaVersion: HARNESS_RELEASE_ARTIFACT_SCHEMA_VERSION,
    releaseId: 'release-1',
    version: 1,
    manifestHash: 'manifest-hash',
    agentSessionHarnessVersion: 'session/1',
    makeHarnessVersion: 'make/1',
    middlewareBindings: [
      {
        policyId: 'tenant-gate',
        revision: '1',
        kind: 'wrap_tool_call' as const,
        order: 0,
        allowedControlActions: ['continue' as const, 'end_turn' as const],
      },
    ],
    controlLimits: CONTROL_LIMITS,
    supervisorPolicyRef: { id: 'sup', revision: '1' },
    memoryPolicyRef: { id: 'mem', revision: '1' },
    contextCompilerRef: { id: 'ctx', revision: '1' },
    planSchemaRevision: 'plan-schema/v1',
    promptBindings: {},
    promptPackBindings: { copy: ['copyGeneration'] },
    schemaBindings: {},
    skillBindings: {},
    toolPolicyRevision: 'tool/1',
    modelPolicyRevision: 'model/1',
    factPolicyRevision: 'fact/1',
    rightsPolicyRevision: 'rights/1',
    budgetPolicyRevision: 'budget/1',
    evalSuiteRevision: 'eval/1',
    createdAt: TS,
  };

  const parsed = harnessReleaseArtifactSchema.parse(artifact);
  assert.equal(parsed.middlewareBindings.length, 1);
  assert.equal(parsed.controlLimits.maxLlmSteps, 6);
  assert.equal(
    harnessReleaseArtifactSchema.safeParse({
      ...artifact,
      middlewareBindings: undefined,
    }).success,
    false,
  );
  assert.equal(
    harnessReleaseArtifactSchema.safeParse({
      ...artifact,
      controlLimits: undefined,
    }).success,
    false,
  );

  harnessReleaseLifecycleSchema.parse({
    schemaVersion: 'harness-release-lifecycle/v1',
    releaseId: 'release-1',
    status: 'canary',
    approvedBy: 'ops-1',
    approvedAt: TS,
    updatedAt: TS,
  });
  harnessReleaseRolloutSchema.parse({
    schemaVersion: 'harness-release-rollout/v1',
    releaseId: 'release-1',
    workspaceAllowlist: ['ws-1'],
    updatedAt: TS,
  });
});

test('steering command and outcome evidence contracts parse', () => {
  const command = makeSteeringCommandSchema.parse({
    schemaVersion: 'steering-command/v1',
    commandId: 'steer-1',
    threadId: 'thread-1',
    taskId: 'task-1',
    sourcePlanRevision: 1,
    sourceContentVersionIds: ['v1'],
    instruction: '封面换更柔和的色调',
    classification: {
      kind: 'future_step_patch',
      affectedUnits: ['unit-2'],
      requiresRequote: false,
    },
    affectedUnitIds: ['unit-2'],
    queueMode: 'steer',
    createdAt: TS,
    actorId: 'actor-1',
  });
  assert.equal(command.queueMode, 'steer');

  const outcome = outcomeEvidenceSchema.parse({
    schemaVersion: 'outcome-evidence/v1',
    evidenceId: 'out-1',
    contentPackageRef: { id: 'pkg-1', revision: 2 },
    signal: 'inquiry',
    source: 'merchant_reported',
    observedAt: TS,
  });
  assert.equal(outcome.source, 'merchant_reported');
});
