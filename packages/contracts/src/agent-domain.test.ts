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
  applyArtifactUpdate,
  artifactDuplicateObjectRate,
  artifactUpdateWireSchema,
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
  buildOutcomeEvidenceIdempotencyKey,
  isForbiddenNoActivityEncoding,
  mapContentPackageResultKindToOutcomeSignal,
  OUTCOME_SELF_REPORT_CHIP_SIGNALS,
  OUTCOME_SELF_REPORT_FREQUENCY_PARAMS,
  outcomeSelfReportFrequencyParamsSchema,
  projectLatestOutcomeEvidence,
  recordOutcomeEvidenceCommandSchema,
  type ArtifactProjectionState,
  type ArtifactUpdateWire,
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
    workspaceId: 'ws-1',
    contentPackageRef: { id: 'pkg-1', revision: 2 },
    signal: 'inquiry',
    source: 'merchant_reported',
    observedAt: TS,
    recordedAt: TS,
    actorId: 'actor-1',
    status: 'active',
  });
  assert.equal(outcome.source, 'merchant_reported');
});

test('outcome evidence accepts no_activity and rejects feedback stand-in', () => {
  const noActivity = outcomeEvidenceSchema.parse({
    schemaVersion: 'outcome-evidence/v1',
    evidenceId: 'out-no-activity',
    workspaceId: 'ws-1',
    contentPackageRef: { id: 'pkg-1', revision: 3 },
    signal: 'no_activity',
    source: 'merchant_reported',
    observedAt: TS,
    recordedAt: TS,
    actorId: 'actor-1',
    status: 'active',
  });
  assert.equal(noActivity.signal, 'no_activity');
  assert.equal(OUTCOME_SELF_REPORT_CHIP_SIGNALS.includes('no_activity'), true);
  assert.equal(isForbiddenNoActivityEncoding('feedback', '没动静'), true);
  assert.equal(isForbiddenNoActivityEncoding('no_activity', '没动静'), false);
  assert.equal(
    mapContentPackageResultKindToOutcomeSignal('no_activity'),
    'no_activity',
  );

  assert.equal(
    recordOutcomeEvidenceCommandSchema.safeParse({
      schemaVersion: 'outcome-evidence/v1',
      workspaceId: 'ws-1',
      contentPackageRef: { id: 'pkg-1', revision: 3 },
      signal: 'feedback',
      note: '没动静',
      actorId: 'actor-1',
    }).success,
    false,
  );
});

test('outcome evidence idempotency key and latest projection', () => {
  const key = buildOutcomeEvidenceIdempotencyKey({
    contentPackageId: 'pkg-1',
    contentPackageRevision: 2,
    signal: 'inquiry',
    observedAt: TS,
    sourceRef: 'shot-1',
  });
  assert.equal(key, `pkg-1|2|inquiry|${TS}|shot-1`);
  assert.equal(
    buildOutcomeEvidenceIdempotencyKey({
      contentPackageId: 'pkg-1',
      contentPackageRevision: 2,
      signal: 'inquiry',
      observedAt: TS,
    }),
    `pkg-1|2|inquiry|${TS}|_`,
  );

  const base = {
    schemaVersion: 'outcome-evidence/v1' as const,
    workspaceId: 'ws-1',
    contentPackageRef: { id: 'pkg-1', revision: 2 },
    source: 'merchant_reported' as const,
    observedAt: TS,
    recordedAt: TS,
    actorId: 'actor-1',
  };
  const first = outcomeEvidenceSchema.parse({
    ...base,
    evidenceId: 'e1',
    signal: 'inquiry',
    status: 'active',
  });
  const correction = outcomeEvidenceSchema.parse({
    ...base,
    evidenceId: 'e2',
    signal: 'booking',
    status: 'active',
    supersedesEvidenceId: 'e1',
    recordedAt: '2026-08-08T13:00:00.000Z',
  });
  const withdraw = outcomeEvidenceSchema.parse({
    ...base,
    evidenceId: 'e3',
    signal: 'booking',
    status: 'withdrawn',
    supersedesEvidenceId: 'e2',
    recordedAt: '2026-08-08T14:00:00.000Z',
  });
  assert.deepEqual(
    projectLatestOutcomeEvidence([first, correction]).map((row) => row.evidenceId),
    ['e2'],
  );
  assert.deepEqual(projectLatestOutcomeEvidence([first, correction, withdraw]), []);
});

test('U2 self-report frequency params are observation-only (not a hard gate)', () => {
  const params = outcomeSelfReportFrequencyParamsSchema.parse(
    OUTCOME_SELF_REPORT_FREQUENCY_PARAMS,
  );
  assert.equal(params.askTiming, 'next_day_once');
  assert.equal(params.maxAsksPerWork, 1);
  assert.equal(params.consecutiveIgnoreThresholdForStoreBackoff, 2);
  assert.equal(params.coverageGateMode, 'observation_only');
  assert.equal(params.coverageObservationTarget, 0.4);
});

test('record outcome evidence command rejects inferred writes and requires supersedes for correct', () => {
  assert.equal(
    recordOutcomeEvidenceCommandSchema.safeParse({
      schemaVersion: 'outcome-evidence/v1',
      workspaceId: 'ws-1',
      contentPackageRef: { id: 'pkg-1', revision: 1 },
      signal: 'inquiry',
      source: 'inferred',
      actorId: 'actor-1',
    }).success,
    false,
  );
  assert.equal(
    recordOutcomeEvidenceCommandSchema.safeParse({
      schemaVersion: 'outcome-evidence/v1',
      action: 'correct',
      workspaceId: 'ws-1',
      contentPackageRef: { id: 'pkg-1', revision: 1 },
      signal: 'inquiry',
      actorId: 'actor-1',
    }).success,
    false,
  );
  const ok = recordOutcomeEvidenceCommandSchema.parse({
    schemaVersion: 'outcome-evidence/v1',
    action: 'correct',
    workspaceId: 'ws-1',
    contentPackageRef: { id: 'pkg-1', revision: 1 },
    signal: 'no_activity',
    actorId: 'actor-1',
    supersedesEvidenceId: 'e1',
  });
  assert.equal(ok.signal, 'no_activity');
});

// ─── V31-15 ArtifactUpdate wire + reconciliation ─────────────────────────────

test('ArtifactUpdate wire: snapshot/delta discriminated union; patch schema by type', () => {
  const noteSnap = artifactUpdateWireSchema.parse({
    schemaVersion: 'artifact-update/v1',
    mode: 'snapshot',
    artifactId: 'art-note-1',
    artifactType: 'note',
    revision: 1,
    status: 'skeleton',
    full: {
      pages: [{ pageIndex: 0, stage: 'skeleton' }],
    },
  });
  assert.equal(noteSnap.mode, 'snapshot');

  const noteDelta = artifactUpdateWireSchema.parse({
    schemaVersion: 'artifact-update/v1',
    mode: 'delta',
    artifactId: 'art-note-1',
    artifactType: 'note',
    revision: 2,
    status: 'partial',
    baseRevision: 1,
    patch: {
      pages: [{ pageIndex: 0, stage: 'copy', body: '周末预约限时' }],
    },
  });
  assert.equal(noteDelta.mode, 'delta');

  const videoSnap = artifactUpdateWireSchema.parse({
    schemaVersion: 'artifact-update/v1',
    mode: 'snapshot',
    artifactId: 'art-vid-1',
    artifactType: 'video',
    revision: 1,
    status: 'partial',
    full: {
      scenes: [
        {
          sceneIndex: 0,
          storyboard: '开场门店外景',
          keyframeStatus: 'pending',
        },
      ],
    },
  });
  assert.equal(videoSnap.artifactType, 'video');

  // type/body mismatch rejected
  assert.equal(
    artifactUpdateWireSchema.safeParse({
      schemaVersion: 'artifact-update/v1',
      mode: 'snapshot',
      artifactId: 'art-x',
      artifactType: 'note',
      revision: 1,
      status: 'skeleton',
      full: { scenes: [{ sceneIndex: 0 }] },
    }).success,
    false,
  );

  // unknown free-form patch rejected (strict)
  assert.equal(
    artifactUpdateWireSchema.safeParse({
      schemaVersion: 'artifact-update/v1',
      mode: 'delta',
      artifactId: 'art-x',
      artifactType: 'note',
      revision: 2,
      status: 'partial',
      baseRevision: 1,
      patch: { arbitraryHtml: '<b>x</b>' },
    }).success,
    false,
  );

  // baseRevision >= revision rejected
  assert.equal(
    artifactUpdateWireSchema.safeParse({
      schemaVersion: 'artifact-update/v1',
      mode: 'delta',
      artifactId: 'art-x',
      artifactType: 'note',
      revision: 1,
      status: 'partial',
      baseRevision: 1,
      patch: { pages: [{ pageIndex: 0, stage: 'copy' }] },
    }).success,
    false,
  );
});

test('applyArtifactUpdate: in-place growth, same-revision idempotent, skip → needs_snapshot', () => {
  const snap1 = artifactUpdateWireSchema.parse({
    schemaVersion: 'artifact-update/v1',
    mode: 'snapshot',
    artifactId: 'art-note-1',
    artifactType: 'note',
    revision: 1,
    status: 'skeleton',
    full: { pages: [{ pageIndex: 0, stage: 'skeleton' }, { pageIndex: 1, stage: 'skeleton' }] },
  }) satisfies ArtifactUpdateWire;

  const r1 = applyArtifactUpdate(null, snap1);
  assert.equal(r1.ok, true);
  if (!r1.ok) return;
  assert.equal(r1.state.revision, 1);
  assert.equal(r1.duplicate, false);
  assert.equal('pages' in r1.state.body && r1.state.body.pages.length, 2);

  // same revision re-apply is idempotent
  const again = applyArtifactUpdate(r1.state, snap1);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.duplicate, true);
  assert.equal(again.state.revision, 1);

  // delta grows page 0 copy
  const d2 = artifactUpdateWireSchema.parse({
    schemaVersion: 'artifact-update/v1',
    mode: 'delta',
    artifactId: 'art-note-1',
    artifactType: 'note',
    revision: 2,
    status: 'partial',
    baseRevision: 1,
    patch: {
      pages: [{ pageIndex: 0, stage: 'copy', title: '周末护理', body: '预约从这里' }],
    },
  });
  const r2 = applyArtifactUpdate(r1.state, d2);
  assert.equal(r2.ok, true);
  if (!r2.ok) return;
  assert.equal(r2.state.revision, 2);
  if ('pages' in r2.state.body) {
    assert.equal(r2.state.body.pages[0]?.stage, 'copy');
    assert.equal(r2.state.body.pages[0]?.body, '预约从这里');
    assert.equal(r2.state.body.pages[1]?.stage, 'skeleton');
  }

  // skip revision (base != head) → needs_snapshot
  const skip = artifactUpdateWireSchema.parse({
    schemaVersion: 'artifact-update/v1',
    mode: 'delta',
    artifactId: 'art-note-1',
    artifactType: 'note',
    revision: 5,
    status: 'partial',
    baseRevision: 4,
    patch: { pages: [{ pageIndex: 0, stage: 'image', imageStatus: 'ready' }] },
  });
  const rSkip = applyArtifactUpdate(r2.state, skip);
  assert.equal(rSkip.ok, false);
  if (rSkip.ok) return;
  assert.equal(rSkip.reason, 'needs_snapshot');

  // cold delta without head → needs_snapshot
  const cold = applyArtifactUpdate(null, d2);
  assert.equal(cold.ok, false);
  if (cold.ok) return;
  assert.equal(cold.reason, 'needs_snapshot');
});

test('applyArtifactUpdate: ready never silent-overwritten; derived version history 回看', () => {
  let state: ArtifactProjectionState | null = null;
  const toReady = artifactUpdateWireSchema.parse({
    schemaVersion: 'artifact-update/v1',
    mode: 'snapshot',
    artifactId: 'art-note-1',
    artifactType: 'note',
    revision: 3,
    status: 'ready',
    full: {
      pages: [
        {
          pageIndex: 0,
          stage: 'image',
          title: '封面',
          body: '最后两个名额',
          imageStatus: 'ready',
        },
      ],
    },
  });
  const ready = applyArtifactUpdate(state, toReady);
  assert.equal(ready.ok, true);
  if (!ready.ok) return;
  state = ready.state;
  assert.equal(state.status, 'ready');

  // silent overwrite without parentRevision → reject
  const silent = artifactUpdateWireSchema.parse({
    schemaVersion: 'artifact-update/v1',
    mode: 'snapshot',
    artifactId: 'art-note-1',
    artifactType: 'note',
    revision: 4,
    status: 'ready',
    full: {
      pages: [
        {
          pageIndex: 0,
          stage: 'image',
          title: '封面',
          body: '温馨预约',
          imageStatus: 'ready',
        },
      ],
    },
  });
  const blocked = applyArtifactUpdate(state, silent);
  assert.equal(blocked.ok, false);
  if (blocked.ok) return;
  assert.equal(blocked.reason, 'silent_overwrite');

  // derived revision with parentRevision archives ready head
  const derived = artifactUpdateWireSchema.parse({
    schemaVersion: 'artifact-update/v1',
    mode: 'snapshot',
    artifactId: 'art-note-1',
    artifactType: 'note',
    revision: 4,
    status: 'ready',
    parentRevision: 3,
    full: {
      pages: [
        {
          pageIndex: 0,
          stage: 'image',
          title: '封面',
          body: '温馨预约',
          imageStatus: 'ready',
        },
      ],
    },
  });
  const next = applyArtifactUpdate(state, derived);
  assert.equal(next.ok, true);
  if (!next.ok) return;
  assert.equal(next.state.revision, 4);
  assert.equal(next.state.parentRevision, 3);
  assert.equal(next.state.versionHistory.length, 1);
  assert.equal(next.state.versionHistory[0]?.revision, 3);
  if ('pages' in next.state.versionHistory[0]!.body) {
    assert.equal(next.state.versionHistory[0]!.body.pages[0]?.body, '最后两个名额');
  }
  if ('pages' in next.state.body) {
    assert.equal(next.state.body.pages[0]?.body, '温馨预约');
  }
});

test('artifact stable id: duplicate object rate is 0 for map keyed by artifactId', () => {
  const map: Record<string, ArtifactProjectionState> = {};
  const a = applyArtifactUpdate(null, artifactUpdateWireSchema.parse({
    schemaVersion: 'artifact-update/v1',
    mode: 'snapshot',
    artifactId: 'a1',
    artifactType: 'copy',
    revision: 1,
    status: 'partial',
    full: { blocks: [{ blockId: 'b1', role: 'title', text: '标题' }] },
  }));
  const b = applyArtifactUpdate(null, artifactUpdateWireSchema.parse({
    schemaVersion: 'artifact-update/v1',
    mode: 'snapshot',
    artifactId: 'a2',
    artifactType: 'video',
    revision: 1,
    status: 'skeleton',
    full: { scenes: [{ sceneIndex: 0, storyboard: '开场' }] },
  }));
  assert.equal(a.ok && b.ok, true);
  if (!a.ok || !b.ok) return;
  map[a.state.artifactId] = a.state;
  map[b.state.artifactId] = b.state;
  // second update same id replaces (in-place), still rate 0
  const a2 = applyArtifactUpdate(a.state, artifactUpdateWireSchema.parse({
    schemaVersion: 'artifact-update/v1',
    mode: 'delta',
    artifactId: 'a1',
    artifactType: 'copy',
    revision: 2,
    status: 'ready',
    baseRevision: 1,
    patch: { blocks: [{ blockId: 'b1', role: 'title', text: '新标题', status: 'ready' }] },
  }));
  assert.equal(a2.ok, true);
  if (!a2.ok) return;
  map[a2.state.artifactId] = a2.state;
  assert.equal(Object.keys(map).length, 2);
  assert.equal(artifactDuplicateObjectRate(map), 0);
});
