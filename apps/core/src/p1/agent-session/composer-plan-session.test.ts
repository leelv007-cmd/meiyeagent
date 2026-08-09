import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { AgentSemanticEventProjector } from '../agent-semantic-events/semantic-event-projector.js';
import { MemoryAgentSemanticEventStore } from '../agent-semantic-events/memory-semantic-event-store.js';
import { PostgresAgentSemanticEventStore } from '../agent-semantic-events/postgres-semantic-event-store.js';
import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import { CreationStagePort } from '../execution-spine/creation-stage-port.js';
import type { CreationSubmissionRecord } from '../execution-spine/submission-coordinator.js';
import {
  assembleExecutionPlanSnapshot,
  ExecutionPlanAdmissionService,
} from '../harness/execution-plan-admission.js';
import { HARNESS_LANGFUSE_PROMPT_NAMES } from '../harness/langfuse-prompts.js';
import type { HarnessFrozenPrompts } from '../harness/langfuse-prompts.js';
import { MemoryExecutionPlanSnapshotStore } from '../harness/memory-execution-plan-admission-store.js';
import {
  HarnessTaskAdmissionService,
  type HarnessTaskRequestRegistry,
  type HarnessWorkflowInput,
  type HarnessWorkflowStarter,
} from '../harness/task-admission.js';
import type { RouteSnapshot } from '../model-supply/index.js';
import {
  ComposerPlanSessionCoordinator,
  approvalBasisForSubmission,
  compileFinalizeExecutionPlanFreeze,
  ExecutionPlanFreezeError,
  proposalFromSubmission,
} from './composer-plan-session.js';
import { MemoryAgentSessionStore } from './memory-agent-session-store.js';
import { MemoryMarketingPlanStore } from './memory-plan-store.js';
import { PostgresAgentSessionStore } from './postgres-agent-session-store.js';
import { PostgresMarketingPlanStore } from './postgres-plan-store.js';
import {
  createFixturePlanCompilerPorts,
  PlanCompiler,
} from './plan-compiler.js';

const TS = '2026-08-09T08:00:00.000Z';
const connectionString = process.env.TEST_DATABASE_URL;

test('Composer submission creates/reuses Thread+Run and appends real plan semantic revisions', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const eventStore = new MemoryAgentSemanticEventStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
    semanticEvents: new AgentSemanticEventProjector(eventStore),
  });
  let tick = 0;
  const coordinator = new ComposerPlanSessionCoordinator(
    sessions,
    plans,
    {
      compilePlan: (input) => compiler.compile(input),
      adjustPlan: (input) => compiler.adjust(input),
    },
    { now: () => new Date(Date.parse(TS) + tick++ * 1_000).toISOString() }
  );

  const first = record('task-1', '先做一组奶油风美甲图文');
  const firstBinding = await coordinator.prepare({ submission: first });
  const replayedBinding = await coordinator.prepare({ submission: first });

  assert.deepEqual(replayedBinding, firstBinding);
  assert.equal(
    (
      await sessions.listRuns({
        resourceId: 'workspace-1',
        threadId: firstBinding.threadId,
      })
    ).length,
    1
  );
  let events = await eventStore.listByThread({
    resourceId: 'workspace-1',
    threadId: firstBinding.threadId,
  });
  assert.deepEqual(
    events.map((event) => event.eventType),
    ['plan.created']
  );

  const adjusted = record('task-2', '只做小红书，减到 4 页');
  const adjustedBinding = await coordinator.prepare({
    continuationThreadId: firstBinding.threadId,
    submission: adjusted,
  });

  assert.equal(adjustedBinding.threadId, firstBinding.threadId);
  assert.notEqual(adjustedBinding.runId, firstBinding.runId);
  events = await eventStore.listByThread({
    resourceId: 'workspace-1',
    threadId: firstBinding.threadId,
  });
  assert.deepEqual(
    events.map((event) => event.eventType),
    ['plan.created', 'plan.revised']
  );
  assert.deepEqual(
    events.map((event) => (event.payload as { revision: number }).revision),
    [1, 2]
  );
  assert.equal(
    proposalFromSubmission(adjusted).recommendedDeliverables[0]?.quantity,
    4
  );
});

test('a continuation Thread is resolved inside the submission workspace', async () => {  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    compilePlan: (input) => compiler.compile(input),
    adjustPlan: (input) => compiler.adjust(input),
  });
  const first = await coordinator.prepare({
    submission: record('task-a', 'A'),
  });

  await assert.rejects(
    () =>
      coordinator.prepare({
        continuationThreadId: first.threadId,
        submission: record('task-b', 'B', 'workspace-2'),
      }),
    /already exists for another resource/u
  );
});

test(
  'Postgres submission boundary durably reuses Thread+Run and appends plan revisions',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const workspaceId = `workspace-composer-${randomUUID()}`;
    const sessions = new PostgresAgentSessionStore(pool);
    const plans = new PostgresMarketingPlanStore(pool);
    const events = new PostgresAgentSemanticEventStore(pool);
    let threadId: string | undefined;
    try {
      await sessions.migrate();
      await plans.migrate();
      await events.migrate();
      const compiler = new PlanCompiler({
        store: plans,
        ports: createFixturePlanCompilerPorts(),
        semanticEvents: new AgentSemanticEventProjector(events),
      });
      const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
        compilePlan: (input) => compiler.compile(input),
        adjustPlan: (input) => compiler.adjust(input),
      });
      const first = record(
        `task-${randomUUID()}`,
        '先做 6 页小红书图文',
        workspaceId
      );
      const created = await coordinator.prepare({ submission: first });
      threadId = created.threadId;
      const replayed = await coordinator.prepare({
        continuationThreadId: 'ignored-after-binding',
        submission: first,
      });
      const revised = await coordinator.prepare({
        continuationThreadId: created.threadId,
        submission: record(
          `task-${randomUUID()}`,
          '只做小红书，减到 4 页',
          workspaceId
        ),
      });

      assert.deepEqual(replayed, created);
      assert.equal(revised.threadId, created.threadId);
      assert.equal(
        (await sessions.listRuns({ resourceId: workspaceId, threadId })).length,
        2
      );
      const projected = await events.listByThread({
        resourceId: workspaceId,
        threadId,
      });
      assert.deepEqual(
        projected.map(({ eventType }) => eventType),
        ['plan.created', 'plan.revised']
      );
      assert.equal(
        (projected[1]?.payload as { deliverables: Array<{ quantity: number }> })
          .deliverables[0]?.quantity,
        4
      );
    } finally {
      await pool
        .query('DELETE FROM p1_agent_semantic_events WHERE resource_id = $1', [
          workspaceId,
        ])
        .catch(() => undefined);
      if (threadId) {
        await pool
          .query(
            'DELETE FROM p1_marketing_plan_revisions WHERE thread_id = $1',
            [threadId]
          )
          .catch(() => undefined);
      }
      await pool
        .query('DELETE FROM p1_agent_threads WHERE resource_id = $1', [
          workspaceId,
        ])
        .catch(() => undefined);
      await pool.end();
    }
  }
);

test('compile-finalize freezes the copy plan; freeze matches the compiled revision (fidelity + U9)', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    compilePlan: (input) => compiler.compile(input),
    adjustPlan: (input) => compiler.adjust(input),
  });

  const submission = copyRecord('task-freeze-1', '为门店写一条夏日团购文案');
  await coordinator.prepare({ submission });

  const freeze = submission.executionPlanFreeze;
  assert.ok(freeze, 'compile-finalize must produce the ExecutionPlanFreeze');
  assert.equal(freeze.approvalBasis, 'policy_exempt_copy');
  assert.equal(freeze.planRevision, 1);
  assert.equal(freeze.contextBundleRef.bundleId, 'context-task-freeze-1');
  assert.equal(freeze.contextBundleRef.revision, 1);
  assert.equal(freeze.harnessReleaseId, 'composer-plan-surface-v1');

  const latest = await plans.getLatest(freeze.planId);
  assert.ok(latest);
  assert.equal(freeze.planId, latest.revision.planId);
  assert.equal(freeze.planRevision, latest.revision.revision);
  assert.deepEqual(freeze.intentDeclaration, latest.revision.intent);
  assert.deepEqual(freeze.deliverables, latest.revision.deliverables);
  assert.deepEqual(freeze.executionPlan, latest.executionPlan);
  assert.deepEqual(freeze.quoteRef, latest.revision.quoteRef);
  assert.deepEqual(
    [...freeze.rightsRevisionRefs],
    latest.revision.boundRevisions.rightsRevisionIds
  );

  // Freeze is deterministic: rebuilding from the same compile artifact yields
  // an identical freeze (idempotent producer, fidelity=100% at compile side).
  const rebuilt = compileFinalizeExecutionPlanFreeze({
    result: { revision: latest.revision, executionPlan: latest.executionPlan },
    contextBundleId: 'context-task-freeze-1',
    contextRevision: '1',
    approvalBasis: approvalBasisForSubmission(submission.snapshot.lens),
  });
  assert.deepEqual(rebuilt, freeze);
});

test('P0-C: freezing a multi-carrier plan revision fails closed instead of half-delivering', async () => {
  // A Plan revision may span carriers (Living Plan, quote and credit cost all
  // project that, and the compiler emits one execution plan per carrier), but a
  // freeze carries ONE executionPlan next to the revision's full deliverable
  // list. Freezing a cross-carrier revision would promise every deliverable and
  // execute only the first carrier's units. The freeze boundary is the single
  // point where a Plan becomes a durable Make, so it is where that fails closed.
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  const compiled = await compiler.compile({
    workspaceId: 'ws-multi-carrier',
    threadId: 'thread-multi-carrier',
    goalIds: ['goal-1'],
    planId: 'plan-multi-carrier-freeze',
    proposal: {
      goalNarrative: '小红书图文加朋友圈短文案',
      whyNow: '明天下午空档',
      recommendedDeliverables: [
        {
          carrier: 'note',
          platform: 'xiaohongshu',
          quantity: 6,
          purpose: '案例图文',
        },
        {
          carrier: 'copy',
          platform: 'wechat_moments',
          quantity: 1,
          purpose: '短文案',
        },
      ],
      expressionStrategy: { voice: '专业温和', promotionIntensity: 'soft' },
      factIntentions: ['门店地址'],
      assetIntentions: ['before_after_case'],
      assumptions: [{ key: 'tone', statement: '少一点硬广', risk: 'low' }],
    },
    intentRevision: 1,
    contextBundleId: 'bundle-multi-carrier',
    contextRevision: '1',
    harnessReleaseId: 'release-1',
    now: '2026-08-09T12:00:00.000Z',
  });

  // Compilation itself succeeds and splits per carrier: the Plan is quotable and
  // displayable across carriers.
  assert.deepEqual(
    compiled.executionPlans.map((plan) => plan.carrier),
    ['note', 'copy'],
  );
  assert.deepEqual(
    compiled.revision.deliverables.map((item) => item.kind),
    ['note', 'copy'],
  );

  // Producing a durable freeze from it does not.
  assert.throws(
    () =>
      compileFinalizeExecutionPlanFreeze({
        result: {
          revision: compiled.revision,
          executionPlan: compiled.executionPlan,
        },
        contextBundleId: 'bundle-multi-carrier',
        contextRevision: '1',
        approvalBasis: 'merchant_confirmed',
      }),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionPlanFreezeError);
      assert.equal(error.code, 'MULTI_CARRIER_FREEZE_UNSUPPORTED');
      assert.match(error.message, /spans note, copy/);
      assert.match(error.message, /execute only note/);
      return true;
    },
  );

  // Single-carrier revisions still freeze, so the gate is not a blanket block.
  const singleCarrier = await compiler.compile({
    workspaceId: 'ws-multi-carrier',
    threadId: 'thread-multi-carrier',
    goalIds: ['goal-1'],
    planId: 'plan-single-carrier-freeze',
    proposal: {
      goalNarrative: '只要小红书图文',
      whyNow: '明天下午空档',
      recommendedDeliverables: [
        {
          carrier: 'note',
          platform: 'xiaohongshu',
          quantity: 6,
          purpose: '案例图文',
        },
      ],
      expressionStrategy: { voice: '专业温和' },
      factIntentions: ['门店地址'],
      assetIntentions: ['before_after_case'],
      assumptions: [{ key: 'tone', statement: '少一点硬广', risk: 'low' }],
    },
    intentRevision: 1,
    contextBundleId: 'bundle-multi-carrier',
    contextRevision: '1',
    harnessReleaseId: 'release-1',
    now: '2026-08-09T12:00:00.000Z',
  });
  const frozen = compileFinalizeExecutionPlanFreeze({
    result: {
      revision: singleCarrier.revision,
      executionPlan: singleCarrier.executionPlan,
    },
    contextBundleId: 'bundle-multi-carrier',
    contextRevision: '1',
    approvalBasis: 'merchant_confirmed',
  });
  assert.deepEqual(
    frozen.deliverables.map((item) => item.kind),
    ['note'],
  );
});

test('pure copy stays frozen with policy_exempt_copy and no decision ref (U9)', async () => {
  assert.equal(approvalBasisForSubmission('copy'), 'policy_exempt_copy');
  assert.equal(
    approvalBasisForSubmission('image_text_note'),
    'merchant_confirmed'
  );
  assert.equal(approvalBasisForSubmission('image'), 'merchant_confirmed');
  assert.equal(approvalBasisForSubmission('video'), 'merchant_confirmed');

  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    compilePlan: (input) => compiler.compile(input),
    adjustPlan: (input) => compiler.adjust(input),
  });
  const submission = copyRecord('task-freeze-u9', '发布文案');
  const first = await coordinator.prepare({ submission });
  const freeze = submission.executionPlanFreeze;
  assert.ok(freeze);
  assert.equal(freeze.approvalBasis, 'policy_exempt_copy');

  // Idempotent re-entry: same submission does not re-freeze or re-compile.
  await coordinator.prepare({ submission });
  const replayedBinding = await coordinator.prepare({ submission });
  assert.deepEqual(replayedBinding, first);
  assert.deepEqual(submission.executionPlanFreeze, freeze);
});

test('Composer submit → task-admission assembles and one-shot writes the ExecutionPlanSnapshot (idempotent replay)', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    compilePlan: (input) => compiler.compile(input),
    adjustPlan: (input) => compiler.adjust(input),
  });

  const submission = copyRecord('task-chain-1', '为夏日项目写预约文案');
  await coordinator.prepare({ submission });
  assert.ok(submission.executionPlanFreeze);

  const registry = new MemoryHarnessRegistry();
  const starter = new RecordingStarter();
  const snapshotStore = new MemoryExecutionPlanSnapshotStore();
  const admission = new HarnessTaskAdmissionService(
    registry,
    starter,
    new MemoryPromptResolver(),
    undefined,
    undefined,
    { async resolve() { return copyRoute(); } },
    undefined,
    undefined,
    new ExecutionPlanAdmissionService(snapshotStore)
  );
  const stage = new CreationStagePort({ submit: (input) => admission.submit(input) });

  await stage.start(submission);
  const first = starter.requests[0];
  const admitted = await snapshotStore.getByWorkflowId('task-chain-1');
  assert.ok(admitted);
  assert.ok(first?.executionPlanSnapshot);
  assert.equal(
    first.executionPlanSnapshot.snapshotHash,
    admitted.snapshot.snapshotHash
  );
  assert.equal(first.executionPlanSnapshot.approvalBasis, 'policy_exempt_copy');
  assert.equal(first.executionPlanSnapshot.confirmationDecisionRef, undefined);
  assert.equal(first.executionPlanSnapshot.planRevision, 1);
  assert.deepEqual(
    first.executionPlanSnapshot.deliverables,
    submission.executionPlanFreeze!.deliverables
  );

  // Fidelity=100%: the frozen compile fields in the admitted snapshot match
  // the compiled plan revision field by field.
  const latest = await plans.getLatest(submission.executionPlanFreeze!.planId);
  assert.ok(latest);
  assert.equal(first.executionPlanSnapshot.planId, latest.revision.planId);
  assert.equal(first.executionPlanSnapshot.planRevision, latest.revision.revision);
  assert.deepEqual(first.executionPlanSnapshot.intentDeclaration, latest.revision.intent);
  assert.deepEqual(first.executionPlanSnapshot.executionPlan, latest.executionPlan);
  assert.deepEqual(first.executionPlanSnapshot.quoteRef, latest.revision.quoteRef);
  assert.equal(
    first.executionPlanSnapshot.harnessReleaseId,
    latest.revision.boundRevisions.harnessReleaseId
  );

  // At-least-once replay: same submission re-enters the admission path and the
  // snapshot row is not double-written.
  await stage.start(submission);
  const admittedAgain = await snapshotStore.getByWorkflowId('task-chain-1');
  assert.equal(admittedAgain?.admittedAt, admitted.admittedAt);
  assert.equal(admittedAgain?.snapshot.snapshotHash, admitted.snapshot.snapshotHash);
  assert.equal(starter.requests.length, 2);
  assert.equal(starter.requests[1]?.executionPlanSnapshot?.snapshotHash, admitted.snapshot.snapshotHash);
  assert.equal(registry.claims.length, 1);
});

function copyRecord(
  taskId: string,
  intent: string,
  workspaceId = 'workspace-1'
): CreationSubmissionRecord {
  const snapshot = createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId,
      idempotencyKey: `submission-${taskId}`,
      taskId,
      workId: `work-${taskId}`,
      contentPackageId: `package-${taskId}`,
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent,
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: { id: 'recipe-1', revision: 'recipe-r1' },
      lens: 'copy',
      platform: { id: 'douyin' },
      deliverables: [
        { id: 'copy-primary', kind: 'copy', quantity: 1, order: 0 },
      ],
      sources: { assets: [] },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-1', revision: 'identity-r1' },
      modelPolicy: {
        id: 'policy-1',
        revision: 'policy-r1',
        mode: 'fixed',
      },
      catalogModel: { id: 'model-1', revision: 'model-r1' },
      quote: { id: `quote-${taskId}`, revision: 'quote-r1' },
      route: { id: 'route-1', revision: 'route-r1' },
      briefContext: { id: `context-${taskId}`, revision: 1 },
      contentModules: ['social_cover'],
    },
    TS
  );
  return {
    snapshot,
    task: { id: taskId },
    work: { id: `work-${taskId}` },
    contentPackage: { id: `package-${taskId}`, expectedRevision: 0 },
    usageReservation: { id: `usage-${taskId}`, credits: 0, units: [] },
  };
}

function copyRoute(): RouteSnapshot {
  return {
    id: 'route-1',
    catalogRevisionId: 'route-r1',
    capabilityRevisionId: 'capability-copy-r1',
    requestedSelection: {
      mode: 'fixed',
      catalogModelId: 'model-1',
    },
    candidateCatalogModelIds: ['model-1'],
    actualCatalogModelId: 'model-1',
    deploymentId: 'deployment-copy-1',
    policyRevision: 'policy-r1',
    priceRevision: 'price-r1',
    credentialMode: 'platform',
    credentialVersion: 'credential-r1',
    fallbackConsent: false,
    reason: 'fixed_selection',
    dataClass: [],
    createdAt: TS,
  } satisfies RouteSnapshot;
}

class MemoryPromptResolver {
  async resolve(): Promise<HarnessFrozenPrompts> {
    return Object.fromEntries(
      Object.entries(HARNESS_LANGFUSE_PROMPT_NAMES).map(([key, name]) => [
        key,
        {
          name,
          version: 'v1',
          contentHash: 'c'.repeat(64),
          label: 'production',
          source: 'langfuse',
          isFallback: false,
        },
      ]),
    ) as HarnessFrozenPrompts;
  }
}

class MemoryHarnessRegistry implements HarnessTaskRequestRegistry {
  readonly claims: Array<{ taskId: string }> = [];
  private readonly fingerprints = new Map<string, string>();
  private readonly requests = new Map<string, HarnessWorkflowInput>();

  async lookup(
    input: Parameters<NonNullable<HarnessTaskRequestRegistry['lookup']>>[0],
  ) {
    const existing = this.fingerprints.get(input.taskId);
    if (existing === undefined) return null;
    if (existing !== input.fingerprint) return { kind: 'conflict' as const };
    return {
      kind: 'existing' as const,
      workflowId: input.taskId,
      request: structuredClone(this.requests.get(input.taskId)!),
    };
  }

  async claim(
    input: Parameters<NonNullable<HarnessTaskRequestRegistry['claim']>>[0],
  ) {
    this.claims.push({ taskId: input.taskId });
    const existing = this.fingerprints.get(input.taskId);
    if (existing === undefined) {
      this.fingerprints.set(input.taskId, input.fingerprint);
      this.requests.set(input.taskId, structuredClone(input.request));
      return { kind: 'created' as const };
    }
    if (existing === input.fingerprint) {
      return {
        kind: 'existing' as const,
        workflowId: input.taskId,
        request: structuredClone(this.requests.get(input.taskId)!),
      };
    }
    return { kind: 'conflict' as const };
  }
}

class RecordingStarter implements HarnessWorkflowStarter {
  readonly requests: HarnessWorkflowInput[] = [];

  async start(input: Parameters<HarnessWorkflowStarter['start']>[0]) {
    this.requests.push(structuredClone(input.request));
    return { workflowId: input.workflowId };
  }
}

function record(
  taskId: string,
  intent: string,
  workspaceId = 'workspace-1'
): CreationSubmissionRecord {
  const snapshot = createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId,
      idempotencyKey: `submission-${taskId}`,
      taskId,
      workId: `work-${taskId}`,
      contentPackageId: `package-${taskId}`,
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent,
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: { id: 'recipe-1', revision: 'recipe-r1' },
      lens: 'image_text_note',
      platform: { id: 'xiaohongshu' },
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'manual_copy',
      deliverable: {
        kind: 'image_set',
        quantity: 6,
        aspectRatio: '3:4',
        notePageBound: 6,
      },
      deliverables: [
        {
          id: 'note-main',
          kind: 'image_text_note',
          order: 0,
          quantity: 6,
          aspectRatio: '3:4',
          notePageBound: 6,
        },
      ],
      sources: {
        assets: [{ id: 'asset-case-1', revision: 'asset-r1', role: 'source' }],
      },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-1', revision: 'identity-r1' },
      modelPolicy: {
        id: 'policy-1',
        revision: 'policy-r1',
        mode: 'fixed',
      },
      catalogModel: { id: 'model-1', revision: 'model-r1' },
      quote: { id: `quote-${taskId}`, revision: 'quote-r1' },
      route: { id: 'route-1', revision: 'route-r1' },
      briefContext: { id: `context-${taskId}`, revision: 1 },
      contentModules: ['social_cover'],
    },
    TS
  );
  return {
    snapshot,
    task: { id: taskId },
    work: { id: `work-${taskId}` },
    contentPackage: { id: `package-${taskId}`, expectedRevision: 0 },
    usageReservation: { id: `usage-${taskId}`, credits: 8, units: [] },
  };
}
