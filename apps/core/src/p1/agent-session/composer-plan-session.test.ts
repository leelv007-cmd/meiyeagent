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

test('Composer production seam runs Session intent before PlanCompiler and paid Make stays waiting', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  const calls: string[] = [];
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    async runComposerTurn(input) {
      calls.push(`turn:${input.authority.progressiveLevel.lens}`);
      assert.equal(input.authority.knownFields.includes('rights'), true);
      return {
        decision: {
          merchantMessage: '已识别为图文计划',
          action: {
            kind: 'propose_plan',
            proposal: {
              goalNarrative: '以门店授权素材制作图文',
              recommendedDeliverables: [
                { carrier: 'note', platform: 'xiaohongshu', quantity: 3 },
              ],
            },
          },
          evidenceRefs: [],
          assumptions: [],
        },
      } as never;
    },
    async compilePlan(input) {
      calls.push('compile');
      assert.deepEqual(input.quoteRefHint, {
        id: 'quote-task-session-first',
        revision: 'quote-r1',
      });
      return compiler.compile(input);
    },
    async adjustPlan(input) {
      calls.push('adjust');
      return compiler.adjust(input);
    },
  });

  const binding = await coordinator.prepare({
    submission: record('task-session-first', '为夏日护理做 6 页图文'),
  });

  assert.deepEqual(calls, ['turn:note', 'compile']);
  assert.equal(binding.makeReady, false);
  const run = await sessions.getRun({
    resourceId: 'workspace-1',
    runId: binding.runId,
  });
  assert.equal(run?.status, 'running');
});

test('production Composer assembly fails closed when Session runTurn is missing', () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });

  assert.throws(
    () =>
      new ComposerPlanSessionCoordinator(
        sessions,
        plans,
        {
          compilePlan: (input) => compiler.compile(input),
          adjustPlan: (input) => compiler.adjust(input),
        },
        { requireSessionTurn: true },
      ),
    /requires Session runTurn/u,
  );
});

test('ask_merchant waits for a clarification answer and never fallback-compiles', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  let turn = 0;
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    async runComposerTurn(input) {
      turn += 1;
      if (turn === 1) {
        return {
          decision: {
            merchantMessage: '需要确认页数',
            action: { kind: 'ask_merchant', question: '需要几页？' },
            evidenceRefs: [],
            assumptions: [],
          },
        } as never;
      }
      assert.equal(input.merchantMessage, '4 页');
      return {
        decision: {
          merchantMessage: '已确认',
          action: {
            kind: 'propose_plan',
            proposal: {
              goalNarrative: '四页图文',
              recommendedDeliverables: [
                { carrier: 'note', platform: 'xiaohongshu', quantity: 4 },
              ],
            },
          },
          evidenceRefs: [],
          assumptions: [],
        },
      } as never;
    },
    compilePlan: (input) => compiler.compile(input),
    adjustPlan: (input) => compiler.adjust(input),
  });
  const submission = record('task-clarification', '做一组图文');
  const waiting = await coordinator.prepare({ submission });

  assert.equal(await plans.getLatest(`plan:workspace-1:${waiting.threadId}`), null);
  assert.equal(Boolean(submission.executionPlanFreeze), false);
  assert.equal(
    (await sessions.getRun({ resourceId: 'workspace-1', runId: waiting.runId }))
      ?.status,
    'waiting',
  );

  await coordinator.answerClarification({ submission, merchantAnswer: '4 页' });
  assert.equal(submission.executionPlanFreeze?.deliverables[0]?.quantity, 4);
});

test('system-only block and empty decision never fallback-compile a plan', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  const results = [
    {
      decision: null,
      systemOnlyBlock: {
        blocked: true,
        gateId: 'system-only',
        reason: 'system-only proposal',
        nextAction: 'ask_merchant',
      },
    },
    { decision: null, systemOnlyBlock: null },
  ];
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    async runComposerTurn() {
      return results.shift() as never;
    },
    compilePlan: (input) => compiler.compile(input),
    adjustPlan: (input) => compiler.adjust(input),
  });

  for (const taskId of ['task-system-block', 'task-empty-decision']) {
    const submission = record(taskId, '做一组图文');
    const binding = await coordinator.prepare({ submission });
    assert.equal(Boolean(submission.executionPlanFreeze), false);
    assert.equal(
      (await sessions.getRun({ resourceId: 'workspace-1', runId: binding.runId }))
        ?.status,
      'waiting',
    );
  }
});

test('revise recompiles six pages into four units and binds a fresh ProductQuote', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const ports = createFixturePlanCompilerPorts();
  ports.quote = {
    async resolveQuote(input) {
      assert.ok(input.quoteResolutionHint);
      return input.quoteResolutionHint;
    },
  };
  const compiler = new PlanCompiler({ store: plans, ports });
  const coordinator = new ComposerPlanSessionCoordinator(
    sessions,
    plans,
    {
      async runComposerTurn() {
        return {
          decision: {
            merchantMessage: '六页方案',
            action: {
              kind: 'propose_plan',
              proposal: {
                goalNarrative: '六页图文',
                recommendedDeliverables: [
                  { carrier: 'note', platform: 'xiaohongshu', quantity: 6 },
                ],
              },
            },
            evidenceRefs: [],
            assumptions: [],
          },
        } as never;
      },
      compilePlan: (input) => compiler.compile(input),
      adjustPlan: (input) => compiler.adjust(input),
    },
    {
      requireSessionTurn: true,
      requireQuoteAuthority: true,
      quoteAuthority: {
        async resolveCurrent() {
          return {
            quoteRef: { id: 'product-quote-6', revision: 'r6' },
            expiresAt: '2026-08-09T10:00:00.000Z',
          };
        },
        async reprice(input) {
          assert.equal(input.quantity, 4);
          return {
            quoteRef: { id: 'product-quote-4', revision: 'r4' },
            expiresAt: '2026-08-09T11:00:00.000Z',
            summary: { creditCost: 4 },
          };
        },
      },
    },
  );
  const submission = record('task-real-four-pages', '先做 6 页图文');
  const binding = await coordinator.prepare({ submission });
  await coordinator.revisePrepared({
    submission,
    planRevision: 1,
    merchantInstruction: '只做小红书，减到 4 页',
  });

  const freeze = submission.executionPlanFreeze!;
  assert.equal(freeze.planRevision, 2);
  assert.equal(freeze.deliverables[0]?.quantity, 4);
  assert.equal(
    freeze.executionPlan.units.filter((unit) => unit.unitType === 'note.generate')
      .length,
    4,
  );
  assert.deepEqual(freeze.quoteRef, { id: 'product-quote-4', revision: 'r4' });
  assert.equal(submission.snapshot.quote.id, 'product-quote-4');
  assert.equal(submission.usageReservation.credits, 4);
  assert.equal(binding.makeReady, false);
});

test('explicit start fails closed when the latest plan has unauthorized assets', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const ports = createFixturePlanCompilerPorts();
  ports.rights = {
    async resolveRights() {
      return {
        rightsSummary: { unauthorizedAssetIds: ['asset-case-1'] },
        rightsRevisionIds: ['rights-denied-r1'],
        assetUsages: [],
        factUsages: [],
        blocked: true,
      };
    },
  };
  const compiler = new PlanCompiler({ store: plans, ports });
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    compilePlan: (input) => compiler.compile(input),
    adjustPlan: (input) => compiler.adjust(input),
  });
  const submission = record('task-rights-denied', '使用门店素材制作图文');
  const binding = await coordinator.prepare({ submission });

  await assert.rejects(
    () =>
      coordinator.completeExplicitStart({
        submission,
        planRevision: submission.executionPlanFreeze!.planRevision,
      }),
    /latest plan is blocked/u,
  );
  assert.equal(
    (await sessions.getRun({
      resourceId: submission.snapshot.workspaceId,
      runId: binding.runId,
    }))?.status,
    'completed',
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

test('paid admission creates one pending request before Make and carries the durable freeze', async () => {
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
  const submission = record('task-paid-chain-1', '生成一组付费图文');
  await coordinator.prepare({ submission });
  assert.equal(submission.executionPlanFreeze?.approvalBasis, 'merchant_confirmed');

  const calls: Array<{ requestId: string; snapshotHash: string }> = [];
  const starter = new RecordingStarter();
  const admission = new HarnessTaskAdmissionService(
    new MemoryHarnessRegistry(),
    starter,
    new MemoryPromptResolver(),
    undefined,
    undefined,
    { async resolve() { return copyRoute(); } },
    undefined,
    undefined,
    new ExecutionPlanAdmissionService(new MemoryExecutionPlanSnapshotStore()),
    {
      async createRequest(input) {
        calls.push({ requestId: input.requestId, snapshotHash: input.snapshotHash });
      },
    },
  );
  const stage = new CreationStagePort({ submit: (input) => admission.submit(input) });

  await stage.start(submission);

  assert.deepEqual(calls, [
    {
      requestId: 'confirmation:task-paid-chain-1',
      snapshotHash: starter.requests[0]!.pendingExecutionPlanSnapshot!.snapshotHash,
    },
  ]);
  assert.equal(starter.requests[0]?.executionPlanSnapshot, undefined);
  assert.ok(starter.requests[0]?.pendingExecutionPlanSnapshot);
});

test('Campaign second paid Work creates an independent confirmation request', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({ store: plans, ports: createFixturePlanCompilerPorts() });
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    compilePlan: (input) => compiler.compile(input),
    adjustPlan: (input) => compiler.adjust(input),
  });
  const works = [record('task-campaign-1', '第一周'), record('task-campaign-2', '第二周')];
  for (const [index, submission] of works.entries()) {
    submission.executionConfirmationContext = {
      campaignPlanRef: { id: 'campaign-plan-1', revision: 2 },
      workOrdinal: index + 1,
      approvalScope: 'single_work',
    };
    await coordinator.prepare({ submission });
  }
  const calls: Array<{ requestId: string; workOrdinal?: number }> = [];
  const admission = new HarnessTaskAdmissionService(
    new MemoryHarnessRegistry(),
    new RecordingStarter(),
    new MemoryPromptResolver(),
    undefined,
    undefined,
    { async resolve() { return copyRoute(); } },
    undefined,
    undefined,
    new ExecutionPlanAdmissionService(new MemoryExecutionPlanSnapshotStore()),
    { async createRequest(input) { calls.push(input); } },
  );
  const stage = new CreationStagePort({ submit: (input) => admission.submit(input) });

  await stage.start(works[0]!);
  await stage.start(works[1]!);

  assert.deepEqual(calls.map(({ requestId, workOrdinal }) => ({ requestId, workOrdinal })), [
    { requestId: 'confirmation:task-campaign-1', workOrdinal: 1 },
    { requestId: 'confirmation:task-campaign-2', workOrdinal: 2 },
  ]);
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
