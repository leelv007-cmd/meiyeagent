import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Pool } from 'pg';

import { assembleProductionComposerPlanSession } from '../../assembly/composer-plan-runtime-assembly.js';
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
  executionPlanAdmissionWorkflowId,
  type HarnessTaskRequestRegistry,
  type HarnessWorkflowInput,
  type HarnessWorkflowStarter,
} from '../harness/task-admission.js';
import type { RouteSnapshot } from '../model-supply/index.js';
import { AgentMemoryDisabledError } from '../operations/agent-memory-platform.js';
import { ReuseMemoryError } from '../operations/reuse-memory-service.js';
import type { RetrievalExperience } from './context-retrieval.js';
import {
  ComposerPlanSessionCoordinator,
  type ComposerPlanCompilerPort,
  type ComposerPlanMemoryDegradation,
  approvalBasisForSubmission,
  clarificationAnswerTurnMessage,
  compileFinalizeExecutionPlanFreeze,
  compileFinalizeExecutionPlanFreezes,
  compileResultFromArtifact,
  composerRunId,
  ExecutionPlanFreezeError,
  proposalFromSubmission,
  splitClarificationAnswerTurnMessage,
} from './composer-plan-session.js';
import { FixtureAgentKernel } from './agent-kernel.js';
import { AgentSessionHarnessService } from './service.js';
import { MemoryAgentSessionStore } from './memory-agent-session-store.js';
import { MemoryMarketingPlanStore } from './memory-plan-store.js';
import { PostgresAgentSessionStore } from './postgres-agent-session-store.js';
import { PostgresMarketingPlanStore } from './postgres-plan-store.js';
import { ComposerSemanticClarificationInterrupts } from './composer-clarification-interrupt.js';
import {
  createFixturePlanCompilerPorts,
  PlanCompiler,
  type CompilePlanInput,
} from './plan-compiler.js';

const TS = '2026-08-09T08:00:00.000Z';
const connectionString = process.env.TEST_DATABASE_URL;
/** Workspace with no confirmed memory — retrieval still runs (V31-18 P0-2). */
const noConfirmedExperience = async (): Promise<RetrievalExperience[]> => [];
const COMPOSER_SESSION_LIMITS_FOR_TEST = {
  maxLlmSteps: 6,
  maxToolCalls: 12,
  maxRetrievalCalls: 6,
  maxMerchantQuestions: 1,
  maxReplans: 2,
  maxSchemaRepairs: 2,
  maxContextTokens: 32_000,
  maxDelegations: 2,
};

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
      retrieveConfirmedExperience: async () => [],
      compilePlan: (input) => compiler.compile(input),
      adjustPlan: (input) => compiler.adjust(input),
    },
    { now: () => new Date(Date.parse(TS) + tick++ * 1_000).toISOString() }
  );

  const first = record('task-1', '先做一组奶油风美甲图文');
  const firstBinding = await coordinator.prepare({ submission: first });
  const replayedBinding = await coordinator.prepare({ submission: first });

  assert.deepEqual(replayedBinding, firstBinding);
  assert.ok(first.executionPlanFreeze);
  assert.notEqual(firstBinding.threadId, first.executionPlanFreeze.planId);
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
  let compiledPlanId: string | undefined;
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    retrieveConfirmedExperience: async () => [],
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
      compiledPlanId = input.planId;
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

  const submission = record('task-session-first', '为夏日护理做 6 页图文');
  const binding = await coordinator.prepare({ submission });

  assert.deepEqual(calls, ['turn:note', 'compile']);
  assert.equal(binding.makeReady, false);
  const run = await sessions.getRun({
    resourceId: 'workspace-1',
    runId: binding.runId,
  });
  assert.equal(run?.status, 'running');

  // The turn must change the product, not just precede the compile. The
  // merchant asked for 6 pages, so the submission-derived fallback proposal
  // would compile 6; the model proposed 3. Whatever the plan and its execution
  // units say is what Make will produce, so 3 here is the whole point of
  // running the turn at all.
  assert.equal(proposalFromSubmission(submission).recommendedDeliverables[0]?.quantity, 6);
  assert.ok(compiledPlanId, 'the compile seam must receive a plan id');
  const compiled = await plans.getLatest(compiledPlanId!);
  assert.ok(compiled, 'the turn must have produced a durable plan revision');
  assert.deepEqual(
    compiled!.revision.deliverables.map((item) => ({
      kind: item.kind,
      quantity: item.quantity,
    })),
    [{ kind: 'note', quantity: 3 }],
  );
  assert.equal(compiled!.revision.intent.summary, '以门店授权素材制作图文');
  // The compiler expands a repeatable step once per requested deliverable
  // unit (plan-compiler.ts ~:792-801) instead of carrying a scalar quantity
  // on one unit, so 3 requested pages means 3 distinct `pages` unit
  // instances, each still carrying the full deliverable (with its quantity)
  // it was expanded from.
  const pagesUnits = compiled!.executionPlan.units.filter(
    (unit) => (unit.input as { role?: string } | undefined)?.role === 'pages',
  );
  assert.equal(pagesUnits.length, 3);
  for (const unit of pagesUnits) {
    assert.equal(
      (unit.input as { deliverables?: Array<{ quantity?: number }> })
        .deliverables?.[0]?.quantity,
      3,
    );
  }
  // Same freeze the paid confirmation authority will bind.
  assert.equal(submission.executionPlanFreeze?.deliverables[0]?.quantity, 3);
});

test('V31-63: a kernel proposal without asset intentions still freezes the snapshot rights baseline', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  let compiledAssetIntentions: readonly string[] | undefined;
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    retrieveConfirmedExperience: async () => [],
    async runComposerTurn() {
      // The e2e session-kernel fixture hardcodes `assetIntentions: []`
      // (core-assembly.ts), and a live LLM proposal is not required to echo
      // asset ids either — the kernel's claim about assets is not faithful.
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
              assetIntentions: [],
            },
          },
          evidenceRefs: [],
          assumptions: [],
        },
      } as never;
    },
    async compilePlan(input) {
      compiledAssetIntentions = input.proposal.assetIntentions;
      return compiler.compile(input);
    },
    async adjustPlan(input) {
      return compiler.adjust(input);
    },
  });

  const submission = record('task-rights-baseline', '用门店案例图做 3 页图文');
  await coordinator.prepare({ submission });

  // The compile-side rights baseline must be the submission snapshot's
  // `sources.assets` ids in snapshot order — the exact list the admission
  // verify side reads as `request.intent.assetReferences`
  // (creation-stage-port.ts) — never the kernel proposal's claim. Anything
  // else fingerprints an empty rights baseline at freeze time and every
  // asset-bearing paid run falsely trips SNAPSHOT_STALE (V31-55 doctrine).
  assert.deepEqual(
    compiledAssetIntentions,
    submission.snapshot.sources.assets.map((asset) => asset.id),
  );
  assert.deepEqual(compiledAssetIntentions, ['asset-case-1']);
  assert.ok(
    submission.executionPlanFreeze,
    'the kernel-proposal compile must still produce the durable freeze',
  );
});

test('production Composer assembly fails closed when Session runTurn is missing', () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const semanticStore = new MemoryAgentSemanticEventStore();

  assert.throws(
    () =>
      assembleProductionComposerPlanSession({
        sessions,
        plans,
        sessionHarness: undefined,
        quoteAuthority: { async resolve() { throw new Error('not used'); } },
        quoteService: { async getQuote() { return null; } },
        releaseResolver: {
          async resolveForRun() {
            return { releaseId: 'release-1' };
          },
        },
        semanticEvents: {
          store: semanticStore,
          projector: new AgentSemanticEventProjector(semanticStore),
        },
        compileFromSubmissionWithoutProposal: false,
      }),
    /requires Session runTurn/u,
  );
});

test('the submission fallback reaches production bound to fixture mode only', async () => {
  const source = await readFile(
    new URL('../../assembly/api-runtime.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /compileFromSubmissionWithoutProposal:\s*modelRuntime\.mode === 'fixture'/u,
  );
});

test('ask_merchant waits for a clarification answer and never fallback-compiles', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts({
      quote: {
        async resolveQuote(input) {
          assert.ok(input.quoteResolutionHint);
          return input.quoteResolutionHint;
        },
      },
    }),
  });
  const eventStore = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(eventStore);
  let turn = 0;
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    retrieveConfirmedExperience: async () => [],
    async runComposerTurn(input) {
      turn += 1;
      if (turn === 1) {
        return {
          decision: {
            merchantMessage: '需要确认页数',
            action: {
              kind: 'ask_merchant',
              question: { itemId: 'page-count', question: '需要几页？' },
            },
            evidenceRefs: [],
            assumptions: [],
          },
        } as never;
      }
      // V31-28: the answer turn replays the original intent with the
      // supplement — the projection has no thread history, so a bare answer
      // would ask the kernel to plan a request it cannot see.
      assert.equal(
        input.merchantMessage,
        clarificationAnswerTurnMessage('做一组图文', '4 页'),
      );
      assert.deepEqual(splitClarificationAnswerTurnMessage(input.merchantMessage), {
        intentText: '做一组图文',
        merchantAnswer: '4 页',
      });
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
  }, {
    clarificationInterrupts: new ComposerSemanticClarificationInterrupts(
      eventStore,
      projector,
    ),
    quoteAuthority: {
      async resolveCurrent() {
        throw new Error('clarification must not reuse the old quote');
      },
      async reprice(input) {
        assert.equal(input.quantity, 4);
        assert.equal(input.merchantInstruction, '4 页');
        return {
          successorQuote: {
            quoteId: 'quote-clarification-r2',
            catalogModelId: 'model-1',
            quotePolicyRevision: 'quote.policy@1',
            billingMode: 'per_request',
            creditCost: 4,
            unitRate: 4,
          },
          resolution: {
            quoteRef: { id: 'quote-clarification-r2', revision: 'quote-r2' },
            expiresAt: '2026-08-09T09:00:00.000Z',
            summary: {
              source: 'product_quote_reprice',
              creditCost: 4,
              outputCount: 4,
            },
          },
        };
      },
    },
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
  let semanticEvents = await eventStore.listByThread({
    resourceId: 'workspace-1',
    threadId: waiting.threadId,
  });
  assert.deepEqual(
    semanticEvents.map((event) => event.eventType),
    ['interrupt.requested'],
  );
  assert.deepEqual(semanticEvents[0]?.payload, {
    interruptId: (semanticEvents[0]?.payload as { interruptId: string }).interruptId,
    interruptType: 'answer_question',
    description: '需要几页？',
    question: { itemId: 'page-count', question: '需要几页？' },
    revision: 1,
  });

  const answered = await coordinator.answerClarification({
    submission,
    merchantAnswer: '4 页',
  });
  assert.equal(submission.executionPlanFreeze?.deliverables[0]?.quantity, 4);
  assert.deepEqual(submission.executionPlanFreeze?.quoteRef, {
    id: 'quote-clarification-r2',
    revision: 'quote-r2',
  });
  assert.deepEqual(answered.repriceCommit, {
    expectedFreeze: null,
    previousQuoteRef: {
      id: 'quote-task-clarification',
      revision: 'quote-r1',
    },
    successorQuote: {
      quoteId: 'quote-clarification-r2',
      catalogModelId: 'model-1',
      quotePolicyRevision: 'quote.policy@1',
      billingMode: 'per_request',
      creditCost: 4,
      unitRate: 4,
    },
    credits: 4,
  });
  assert.ok(answered.clarificationResolution);
  semanticEvents = await eventStore.listByThread({
    resourceId: 'workspace-1',
    threadId: waiting.threadId,
  });
  assert.deepEqual(
    semanticEvents.map((event) => event.eventType),
    ['interrupt.requested'],
  );
  await coordinator.commitClarificationResolution({
    submission,
    resolution: answered.clarificationResolution,
  });
  semanticEvents = await eventStore.listByThread({
    resourceId: 'workspace-1',
    threadId: waiting.threadId,
  });
  assert.deepEqual(
    semanticEvents.map((event) => event.eventType),
    ['interrupt.requested', 'interrupt.resolved'],
  );
  assert.equal(
    (semanticEvents[1]?.payload as { interruptId: string }).interruptId,
    (semanticEvents[0]?.payload as { interruptId: string }).interruptId,
  );
});

test('V31-28: an answered clarification on an exempt copy plan is make-ready and completes the run', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  const eventStore = new MemoryAgentSemanticEventStore();
  const projector = new AgentSemanticEventProjector(eventStore);
  const intent = '随便帮我写点这周能发的内容';
  const answer = '皮肤管理';
  let turn = 0;
  const coordinator = new ComposerPlanSessionCoordinator(
    sessions,
    plans,
    {
      retrieveConfirmedExperience: async () => [],
      async runComposerTurn(input) {
        turn += 1;
        if (turn === 1) {
          return {
            decision: {
              merchantMessage: '这次内容主要属于哪一类美业服务？',
              action: {
                kind: 'ask_merchant',
                question: {
                  itemId: 'industry_category',
                  question: '这次内容主要属于哪一类美业服务？',
                },
              },
              evidenceRefs: [],
              assumptions: [],
            },
          } as never;
        }
        assert.equal(
          input.merchantMessage,
          clarificationAnswerTurnMessage(intent, answer),
        );
        return {
          decision: {
            merchantMessage: '已根据你的补充更新这次的创作方案',
            action: {
              kind: 'propose_plan',
              proposal: {
                goalNarrative: `${intent}（补充：${answer}）`,
                recommendedDeliverables: [
                  { carrier: 'copy', quantity: 1, purpose: '发布文案' },
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
      clarificationInterrupts: new ComposerSemanticClarificationInterrupts(
        eventStore,
        projector,
      ),
    },
  );

  const submission = copyRecord('task-copy-clarify', intent);
  const waiting = await coordinator.prepare({ submission });
  assert.equal(waiting.makeReady, false);
  assert.equal(
    (await sessions.getRun({ resourceId: 'workspace-1', runId: waiting.runId }))
      ?.status,
    'waiting',
  );

  const answered = await coordinator.answerClarification({
    submission,
    merchantAnswer: answer,
  });

  // D-043: an exempt copy plan is confirmation-free — the answered
  // clarification is make-ready exactly like a directly-compiled exempt plan,
  // while merchant_confirmed plans (the note test above) keep makeReady false.
  assert.equal(answered.makeReady, true);
  assert.equal(
    submission.executionPlanFreeze?.approvalBasis,
    'policy_exempt_copy',
  );
  assert.equal(
    (await sessions.getRun({ resourceId: 'workspace-1', runId: waiting.runId }))
      ?.status,
    'completed',
  );
  // The merchant's answer is carried by the durable plan revision.
  const compiled = await plans.getLatest(
    submission.executionPlanFreeze!.planId,
  );
  assert.ok(compiled);
  assert.ok(compiled.revision.intent.summary.includes(answer));
});

test('system-only block becomes an actionable interrupt; empty decision fails closed', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const events = new MemoryAgentSemanticEventStore();
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
    retrieveConfirmedExperience: async () => [],
    async runComposerTurn() {
      return results.shift() as never;
    },
    compilePlan: (input) => compiler.compile(input),
    adjustPlan: (input) => compiler.adjust(input),
  }, {
    clarificationInterrupts: new ComposerSemanticClarificationInterrupts(
      events,
      new AgentSemanticEventProjector(events),
    ),
  });

  const blocked = record('task-system-block', '做一组图文');
  const binding = await coordinator.prepare({ submission: blocked });
  assert.equal(Boolean(blocked.executionPlanFreeze), false);
  assert.equal(
    (await sessions.getRun({ resourceId: 'workspace-1', runId: binding.runId }))
      ?.status,
    'waiting',
  );
  assert.deepEqual(
    (await events.listByThread({ resourceId: 'workspace-1', threadId: binding.threadId }))
      .map((event) => event.eventType),
    ['interrupt.requested'],
  );

  const empty = record('task-empty-decision', '做一组图文');
  await assert.rejects(
    coordinator.prepare({ submission: empty }),
    /no actionable decision or merchant question/u,
  );
  const emptyThreads = await sessions.listRecentThreads({
    resourceId: 'workspace-1',
    limit: 10,
  });
  const emptyRuns = await sessions.listRuns({
    resourceId: 'workspace-1',
    threadId: emptyThreads.find((thread) => String(thread.threadId) !== String(binding.threadId))!.threadId,
  });
  assert.equal(
    emptyRuns[0]?.status,
    'failed',
  );
});

test('a turn that neither proposes nor asks fails the run instead of parking it', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    retrieveConfirmedExperience: async () => [],
    // This is exactly what the fixture AgentKernel returns today: a decision
    // with no proposal and no question. It used to leave the run `waiting` with
    // no interrupt raised, so no merchant action could ever advance it and no
    // plan existed to start — a wait state with no producer for its exit.
    async runComposerTurn() {
      return {
        decision: {
          merchantMessage: 'fixture-session-turn',
          action: { kind: 'finish_turn' },
          evidenceRefs: [],
          assumptions: [],
        },
      } as never;
    },
    compilePlan: (input) => compiler.compile(input),
    adjustPlan: (input) => compiler.adjust(input),
  });

  const submission = record('task-unusable-turn', '做一组图文');
  await assert.rejects(
    coordinator.prepare({ submission }),
    /produced neither a plan proposal nor a merchant question/u,
  );
  assert.equal(Boolean(submission.executionPlanFreeze), false);
  const threads = await sessions.listRecentThreads({
    resourceId: 'workspace-1',
    limit: 10,
  });
  assert.equal(threads.length, 1);
  const runs = await sessions.listRuns({
    resourceId: 'workspace-1',
    threadId: threads[0]!.threadId,
  });
  assert.deepEqual(
    runs.map((run) => run.status),
    ['failed'],
  );
});

test('a fixture kernel that offers no plan compiles the submission it was given', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  const coordinator = new ComposerPlanSessionCoordinator(
    sessions,
    plans,
    {
      retrieveConfirmedExperience: async () => [],
      async runComposerTurn() {
        return {
          decision: {
            merchantMessage: 'fixture-session-turn',
            action: { kind: 'finish_turn' },
            evidenceRefs: [],
            assumptions: [],
          },
        } as never;
      },
      compilePlan: (input) => compiler.compile(input),
      adjustPlan: (input) => compiler.adjust(input),
    },
    // The fixture kernel is a single assembly-level instance and its turn
    // request carries no submission, so it cannot propose this merchant's plan.
    // Rather than let it invent one, the submission itself becomes the
    // proposal — the same fallback the live path uses. Live mode keeps failing
    // loudly, because there a silent fallback would mean a paid model call with
    // no effect on the plan.
    { compileFromSubmissionWithoutProposal: true },
  );

  const submission = record('task-fixture-fallback', '做一组图文');
  const binding = await coordinator.prepare({ submission });

  assert.equal(binding.makeReady, false);
  const freeze = submission.executionPlanFreeze;
  assert.ok(freeze, 'the fixture turn must still leave a plan to look at');
  const compiled = await plans.getLatest(freeze.planId);
  assert.ok(compiled);
  assert.deepEqual(
    compiled.revision.deliverables.map((item) => item.quantity),
    [6],
    'the plan must carry the submission its merchant actually signed',
  );
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
      retrieveConfirmedExperience: async () => [],
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
            resolution: {
              quoteRef: { id: 'product-quote-4', revision: 'r4' },
              expiresAt: '2026-08-09T11:00:00.000Z',
              summary: { creditCost: 4 },
            },
            successorQuote: {
              quoteId: 'product-quote-4',
              catalogModelId: 'model-1',
              quotePolicyRevision: 'quote.policy@1',
              billingMode: 'per_request',
              creditCost: 4,
              unitRate: 4,
              workspaceId: 'workspace-1',
              expiresAt: '2026-08-09T11:00:00.000Z',
            },
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
  // The compiler expands a repeatable step once per requested deliverable
  // unit (plan-compiler.ts ~:792-801), so revising down to 4 pages produces
  // 4 distinct `unit-note-pages-N` instances, not one unit carrying a
  // scalar quantity — hence "four units" in the test title.
  const pageUnits = freeze.executionPlan.units.filter((unit) =>
    unit.unitId.startsWith('unit-note-pages'),
  );
  assert.equal(pageUnits.length, 4);
  for (const unit of pageUnits) {
    assert.equal(
      (unit.input as { deliverables?: Array<{ quantity?: number }> })
        .deliverables?.[0]?.quantity,
      4,
    );
  }
  assert.deepEqual(
    freeze.executionPlan.units.map((unit) => unit.primitive),
    [
      'read_context',
      'generate',
      'ask_merchant',
      'generate',
      'generate',
      'generate',
      'generate',
      'check',
      'revise',
      'record',
    ],
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
    retrieveConfirmedExperience: async () => [],
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

test('V31-63 explicit start resolves a reprice successor through its inherited session binding', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    retrieveConfirmedExperience: async () => [],
    compilePlan: (input) => compiler.compile(input),
    adjustPlan: (input) => compiler.adjust(input),
  });
  const predecessor = record('task-successor-pred', '为门店做一组图文');
  const binding = await coordinator.prepare({ submission: predecessor });

  // The store admits a reprice successor durably: a NEW task id that never
  // opened its own Composer Run, carrying the predecessor's freeze and the
  // inherited session binding (V31-63 price-drift successor).
  const successor: CreationSubmissionRecord = {
    ...structuredClone(predecessor),
    snapshot: {
      ...structuredClone(predecessor.snapshot),
      task: { id: 'task-successor-next' },
    },
    task: { id: 'task-successor-next' },
    agentBinding: { threadId: binding.threadId, runId: binding.runId },
  };
  assert.equal(
    await sessions.getRun({
      resourceId: successor.snapshot.workspaceId,
      runId: composerRunId(successor),
    }),
    null,
  );

  const unboundSuccessor = structuredClone(successor);
  delete unboundSuccessor.agentBinding;
  await assert.rejects(
    () =>
      coordinator.completeExplicitStart({
        submission: unboundSuccessor,
        planRevision: predecessor.executionPlanFreeze!.planRevision,
      }),
    /Composer Agent Run .* was not found/u,
  );

  const startBinding = await coordinator.completeExplicitStart({
    submission: successor,
    planRevision: predecessor.executionPlanFreeze!.planRevision,
  });
  assert.equal(startBinding.runId, binding.runId);
  assert.equal(startBinding.threadId, binding.threadId);
  assert.equal(startBinding.makeReady, true);
});

test('a continuation Thread is resolved inside the submission workspace', async () => {  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    retrieveConfirmedExperience: async () => [],
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
    retrieveConfirmedExperience: async () => [],
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
      const committedFreeze = structuredClone(first.executionPlanFreeze);
      assert.ok(committedFreeze);

      // Simulate a crash after append/event commit but before the submission
      // claim persisted its freeze. The same Run must reconstruct r1.
      first.executionPlanFreeze = undefined;
      const replayed = await coordinator.prepare({
        continuationThreadId: 'ignored-after-binding',
        submission: first,
      });
      assert.deepEqual(
        first.executionPlanFreeze,
        JSON.parse(JSON.stringify(committedFreeze)),
      );
      assert.equal(
        (await plans.listRevisions(committedFreeze.planId)).length,
        1,
      );
      const revised = await coordinator.prepare({
        continuationThreadId: created.threadId,
        submission: record(
          `task-${randomUUID()}`,
          '只做小红书，减到 4 页',
          workspaceId
        ),
      });
	  const firstFreeze = JSON.parse(
		JSON.stringify(first.executionPlanFreeze),
	  ) as NonNullable<CreationSubmissionRecord['executionPlanFreeze']>;
	  assert.ok(firstFreeze);
	  assert.equal(firstFreeze.planRevision, 1);
	  delete first.executionPlanFreeze;
	  delete first.agentBinding;
	  const crashRecovered = await coordinator.prepare({ submission: first });

      assert.deepEqual(replayed, created);
	  assert.deepEqual(crashRecovered, created);
	  assert.deepEqual(first.executionPlanFreeze, firstFreeze);
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
    retrieveConfirmedExperience: async () => [],
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
  // The store only round-trips the primary plan, so the carrier set is rebuilt
  // with the same production helper the crash-recovery path uses (V31-47).
  const result = compileResultFromArtifact(
    { revision: latest.revision, executionPlan: latest.executionPlan },
    submission.snapshot.workspaceId,
  );
  assert.equal(result.executionPlans[0]?.executionPlan, latest.executionPlan);
  assert.deepEqual(
    result.executionPlans.map((plan) => plan.carrier),
    [...new Set(latest.revision.deliverables.map((item) => item.kind))],
  );
  const rebuilt = compileFinalizeExecutionPlanFreeze({
    result,
    contextBundleId: 'context-task-freeze-1',
    contextRevision: '1',
    approvalBasis: approvalBasisForSubmission(submission.snapshot.lens),
  });
  assert.deepEqual(rebuilt, freeze);
});

test('V31-47: multi-carrier freeze fans out one freeze per carrier with matching deliverables', async () => {
  // A Plan revision may span carriers. V31-47 freezes one Make per carrier —
  // each freeze carries only that carrier's deliverables + execution plan so
  // the merchant is never quoted for work the Make will not run.
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

  assert.deepEqual(
    compiled.executionPlans.map((plan) => plan.carrier),
    ['note', 'copy'],
  );
  assert.deepEqual(
    compiled.revision.deliverables.map((item) => item.kind),
    ['note', 'copy'],
  );

  const freezes = compileFinalizeExecutionPlanFreezes({
    result: compiled,
    contextBundleId: 'bundle-multi-carrier',
    contextRevision: '1',
    approvalBasis: 'merchant_confirmed',
  });
  assert.deepEqual(
    freezes.map((freeze) => freeze.carrier),
    ['note', 'copy'],
  );
  assert.deepEqual(
    freezes.map((freeze) => freeze.deliverables.map((item) => item.kind)),
    [['note'], ['copy']],
  );
  assert.deepEqual(
    freezes.map((freeze) => freeze.executionPlan),
    compiled.executionPlans.map((plan) => plan.executionPlan),
  );
  // Package basis: mixed note+copy is merchant_confirmed for every freeze.
  assert.ok(freezes.every((freeze) => freeze.approvalBasis === 'merchant_confirmed'));

  // Singular helper still refuses multi-carrier (must use freezes + fan-out).
  assert.throws(
    () =>
      compileFinalizeExecutionPlanFreeze({
        result: compiled,
        contextBundleId: 'bundle-multi-carrier',
        contextRevision: '1',
        approvalBasis: 'merchant_confirmed',
      }),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionPlanFreezeError);
      assert.equal(error.code, 'MULTI_CARRIER_FREEZE_REQUIRES_FANOUT');
      return true;
    },
  );

  // Single-carrier revisions still freeze through the singular helper.
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
      executionPlans: singleCarrier.executionPlans,
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
    retrieveConfirmedExperience: async () => [],
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

  // Crash seam: the append-only MarketingPlanRevision may commit before the
  // submission claim persists its freeze. Replay reconstructs that exact
  // revision instead of appending r2.
  submission.executionPlanFreeze = undefined;
  const recoveredBinding = await coordinator.prepare({ submission });
  assert.deepEqual(recoveredBinding, first);
  assert.deepEqual(submission.executionPlanFreeze, freeze);
  assert.equal((await plans.listRevisions(freeze.planId)).length, 1);
});

test('Composer submit → task-admission assembles and one-shot writes the ExecutionPlanSnapshot (idempotent replay)', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    retrieveConfirmedExperience: async () => [],
    compilePlan: (input) => compiler.compile(input),
    adjustPlan: (input) => compiler.adjust(input),
  });

  const submission = copyRecord('task-chain-1', '为夏日项目写预约文案');
  const binding = await coordinator.prepare({ submission });
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
  const stage = new CreationStagePort({
    preparePendingConfirmation: (input) => admission.preparePendingConfirmation(input),
    dispatchPrepared: (input) => admission.dispatchPrepared(input),
  });

  await stage.start(submission);
  const first = starter.requests[0];
  assert.ok(first?.executionPlanSnapshot);
  assert.equal(first?.agentThreadId, binding.threadId);
  assert.notEqual(first?.agentThreadId, first?.executionPlanSnapshot.planId);
  const admittedWorkflowId = executionPlanAdmissionWorkflowId('task-chain-1', first);
  const admitted = await snapshotStore.getByWorkflowId(admittedWorkflowId);
  assert.ok(admitted);
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
  const admittedAgain = await snapshotStore.getByWorkflowId(admittedWorkflowId);
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
    retrieveConfirmedExperience: async () => [],
    compilePlan: (input) => compiler.compile(input),
    adjustPlan: (input) => compiler.adjust(input),
  });
  const submission = record('task-paid-chain-1', '生成一组付费图文');
  await coordinator.prepare({ submission });
  assert.equal(submission.executionPlanFreeze?.approvalBasis, 'merchant_confirmed');

  const confirmationCalls: Array<{ requestId: string; snapshotHash: string }> = [];
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
      async putCurrent(input) {
        return input;
      },
      async createRequest(input) {
        const requestId = 'confirmation:task-paid-chain-1:plan-r1';
        confirmationCalls.push({
          requestId: input.workflowId,
          snapshotHash: input.pendingAuthority?.snapshotHash ?? '',
        });
        await input.afterPendingPersisted?.({
          transactionClient: null,
          stored: { request: { requestId } } as never,
          reservedCredits: 6,
        });
        return confirmationCreationResult(requestId);
      },
      async getRequest(requestId) {
        if (requestId !== 'confirmation:task-paid-chain-1:plan-r1') return null;
        return {
          request: {
            requestId,
            workspaceId: 'workspace-1',
            status: 'pending',
          },
        } as never;
      },
      async getDecisionForWorkspace() {
        return null;
      },
    },
  );
  const stage = new CreationStagePort({
    preparePendingConfirmation: (input) =>
      admission.preparePendingConfirmation(input),
    dispatchPrepared: (input) => admission.dispatchPrepared(input),
  });

  await stage.preparePendingConfirmation(submission);

  assert.deepEqual(
    confirmationCalls.map(({ requestId }) => ({ requestId })),
    [{ requestId: 'task-paid-chain-1:plan-r1' }],
  );
  assert.ok(confirmationCalls[0]?.snapshotHash);
  assert.equal(starter.requests.length, 0);
  await stage.start(submission);
  assert.equal(starter.requests.length, 1);
  assert.equal(starter.requests[0]?.executionPlanSnapshot, undefined);
  assert.ok(starter.requests[0]?.pendingExecutionPlanSnapshot);
});

test('Campaign second paid Work creates an independent confirmation request', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({ store: plans, ports: createFixturePlanCompilerPorts() });
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    retrieveConfirmedExperience: async () => [],
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
  const confirmationCalls: Array<{ requestId: string; workOrdinal?: number }> = [];
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
    {
      async putCurrent(input) {
        return input;
      },
      async createRequest(input) {
        const requestId = `confirmation:${input.workflowId}`;
        confirmationCalls.push({
          requestId: input.workflowId,
          workOrdinal: input.pendingAuthority?.executionConfirmationContext?.workOrdinal,
        });
        await input.afterPendingPersisted?.({
          transactionClient: null,
          stored: { request: { requestId } } as never,
          reservedCredits: 6,
        });
        return confirmationCreationResult(requestId);
      },
    },
  );
  const stage = new CreationStagePort({
    preparePendingConfirmation: (input) =>
      admission.preparePendingConfirmation(input),
    dispatchPrepared: (input) => admission.dispatchPrepared(input),
  });

  await stage.preparePendingConfirmation(works[0]!);
  await stage.preparePendingConfirmation(works[1]!);

  assert.deepEqual(confirmationCalls.map(({ requestId, workOrdinal }) => ({ requestId, workOrdinal })), [
    { requestId: 'task-campaign-1:plan-r1', workOrdinal: 1 },
    { requestId: 'task-campaign-2:plan-r1', workOrdinal: 2 },
  ]);
});

function confirmationCreationResult(requestId: string) {
  return {
    stored: { request: { requestId } },
    reservedCredits: 6,
    replayed: false,
  } as never;
}

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

  async claimInConfirmationTransaction(
    input: Parameters<NonNullable<HarnessTaskRequestRegistry['claimInConfirmationTransaction']>>[0],
  ) {
    return this.claim(input);
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

test('V31-18 P0-2: the bare Composer fallback shape cannot be assembled', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  // Exactly the object a production deploy without a Session kernel used to
  // receive: compile/adjust only, no server-owned retrieval. It must not build.
  assert.throws(
    () =>
      new ComposerPlanSessionCoordinator(sessions, plans, {
        compilePlan: (input: CompilePlanInput) => compiler.compile(input),
        adjustPlan: (input: CompilePlanInput & { existingPlanId: string }) =>
          compiler.adjust(input),
      } as unknown as ComposerPlanCompilerPort),
    /requires server-owned confirmed experience retrieval/u
  );
  // The same shape with retrieval present builds and retrieves.
  let retrievalCalls = 0;
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    compilePlan: (input) => compiler.compile(input),
    adjustPlan: (input) => compiler.adjust(input),
    retrieveConfirmedExperience: async () => {
      retrievalCalls += 1;
      return [];
    },
  });
  await coordinator.prepare({ submission: copyRecord('task-fallback', '写文案') });
  assert.equal(retrievalCalls, 1);
});

test('V31-18 P0-1: disable_memory_read degrades the plan, never the paid submission', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  const degradations: ComposerPlanMemoryDegradation[] = [];
  const coordinator = new ComposerPlanSessionCoordinator(
    sessions,
    plans,
    {
      compilePlan: (input) => compiler.compile(input),
      adjustPlan: (input) => compiler.adjust(input),
      // Production shape: AgentMemoryPlatform.retrieveForInjection fails closed
      // on `disable_memory_read` / `agent_memory_read_v1` off.
      retrieveConfirmedExperience: async () => {
        throw new AgentMemoryDisabledError('read');
      },
    },
    { onMemoryDegraded: (event) => degradations.push(event) }
  );

  const submission = copyRecord('task-killswitch', '写一条周末护理文案');
  const binding = await coordinator.prepare({ submission });

  assert.ok(submission.executionPlanFreeze, 'the paid submission still plans');
  const latest = await plans.getLatest(submission.executionPlanFreeze.planId);
  assert.equal(latest?.revision.memoryContext ?? null, null);
  assert.deepEqual(degradations, [
    {
      workspaceId: 'workspace-1',
      taskId: 'task-killswitch',
      runId: binding.runId,
      reason: 'kill_switch',
      detail: 'Memory read is disabled by kill switch.',
    },
  ]);
  const run = await sessions.getRun({
    resourceId: 'workspace-1',
    runId: binding.runId,
  });
  assert.equal(run?.status, 'completed');
});

test('V31-18 P0-1: a receipt conflict degrades to no injection (no receipt ⇒ no injection)', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  const degradations: ComposerPlanMemoryDegradation[] = [];
  const coordinator = new ComposerPlanSessionCoordinator(
    sessions,
    plans,
    {
      compilePlan: (input) => compiler.compile(input),
      adjustPlan: (input) => compiler.adjust(input),
      retrieveConfirmedExperience: async () => {
        throw new ReuseMemoryError(
          'CONFLICT',
          'Injection receipt for task task-receipt-conflict already exists with another payload.'
        );
      },
    },
    { onMemoryDegraded: (event) => degradations.push(event) }
  );

  const submission = copyRecord('task-receipt-conflict', '写一条到店提醒');
  await coordinator.prepare({ submission });

  assert.ok(submission.executionPlanFreeze);
  const latest = await plans.getLatest(submission.executionPlanFreeze.planId);
  assert.equal(latest?.revision.memoryContext ?? null, null);
  assert.equal(degradations.length, 1);
  assert.equal(degradations[0]?.reason, 'unavailable');
});

test('V31-18 P0-1: a failed planning attempt leaves the Run resumable', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  let compileCalls = 0;
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    // A non-memory planning failure (compile authority) must still be
    // retryable: the credits are already consumed by `store.claim()`.
    compilePlan: (input) => {
      compileCalls += 1;
      if (compileCalls === 1) {
        throw new Error('plan compiler transport failed');
      }
      return compiler.compile(input);
    },
    adjustPlan: (input) => compiler.adjust(input),
    retrieveConfirmedExperience: noConfirmedExperience,
  });

  const submission = copyRecord('task-retryable', '写一条周末护理文案');
  const threadId = 'thread-retryable';
  await assert.rejects(
    () => coordinator.prepare({ continuationThreadId: threadId, submission }),
    /plan compiler transport failed/u
  );
  const runsAfterFailure = await sessions.listRuns({
    resourceId: 'workspace-1',
    threadId,
  });
  assert.equal(runsAfterFailure.length, 1);
  const runId = runsAfterFailure[0]!.runId;
  assert.notEqual(runsAfterFailure[0]!.status, 'failed');

  // The retry (same idempotencyKey ⇒ same deterministic runId) recovers.
  const binding = await coordinator.prepare({ submission });
  assert.equal(binding.runId, runId);
  assert.equal(compileCalls, 2);
  assert.ok(submission.executionPlanFreeze);
  assert.equal(
    (await sessions.getRun({ resourceId: 'workspace-1', runId }))?.status,
    'completed'
  );
});

test('V31-18 P0-1: a crash-recovered submission rehydrates the compile freeze', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  let compileCalls = 0;
  const coordinator = new ComposerPlanSessionCoordinator(sessions, plans, {
    compilePlan: (input) => {
      compileCalls += 1;
      return compiler.compile(input);
    },
    adjustPlan: (input) => compiler.adjust(input),
    retrieveConfirmedExperience: noConfirmedExperience,
  });

  // Attempt 1 compiles and freezes normally.
  const first = copyRecord('task-refreeze', '写一条周末护理文案');
  await coordinator.prepare({ submission: first });
  const compiledFreeze = first.executionPlanFreeze;
  assert.ok(compiledFreeze);

  // Attempt 2 is what production actually replays: `submit()`'s existing-receipt
  // branch and `recoverPendingStarts()` both rebuild the record from
  // `execution_spine.creation_submissions`, and `storedSubmission` has no
  // `executionPlanFreeze` key — the freeze only ever lived in memory. A retry
  // must therefore be a FRESH record, not the object attempt 1 mutated.
  const replayed = copyRecord('task-refreeze', '写一条周末护理文案');
  assert.equal(replayed.executionPlanFreeze, undefined);
  await coordinator.prepare({ submission: replayed });

  // Compile is correctly skipped (the plan is durable and immutable)...
  assert.equal(compileCalls, 1);
  // ...but skipping it must not drop the freeze: without it, task-admission
  // takes the legacy five-stage branch (`task-admission.ts:427` requires
  // `input.executionPlanFreeze`) and the recovered paid submission silently
  // loses its ExecutionPlanSnapshot.
  assert.deepEqual(replayed.executionPlanFreeze, compiledFreeze);
});

test('server pre-plan retrieval runs with a kernel that makes zero tool calls', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  let retrievalCalls = 0;
  const harness = new AgentSessionHarnessService({
    store: sessions,
    kernel: new FixtureAgentKernel({
      decision: {
        merchantMessage: '文案方案',
        action: {
          kind: 'propose_plan',
          proposal: {
            goalNarrative: '周末护理文案',
            recommendedDeliverables: [
              { carrier: 'copy', platform: 'xiaohongshu', quantity: 1 },
            ],
          },
        },
        evidenceRefs: [],
        assumptions: [],
      },
      toolCallPlan: [],
    }),
    resolveRelease: async () => ({
      controlLimits: COMPOSER_SESSION_LIMITS_FOR_TEST,
      releaseId: 'resolved-live-release',
    }),
    retrieveConfirmedExperience: async () => {
      retrievalCalls += 1;
      return [
        {
          instruction: '文案保持简洁克制',
          ref: 'experience:preference-live',
          revision: 5,
          status: 'confirmed',
        },
      ];
    },
  });
  harness.bindPlanCompiler(compiler);
  const coordinator = new ComposerPlanSessionCoordinator(
    sessions,
    plans,
    harness
  );
  const submission = copyRecord('task-live-lookup', '写一条周末护理文案');
  const binding = await coordinator.prepare({ submission });
  const freeze = submission.executionPlanFreeze;
  assert.ok(freeze);
  assert.equal(retrievalCalls, 1);
  // Unit input carries the full compiler contract now (stage/role/plan
  // identity/the whole deliverables array), not the older flat
  // deliverableId/index/kind shape — deliverable + plan identity come from
  // the freeze the compiler just produced, everything else is a fixed
  // literal.
  assert.deepEqual(
    freeze.executionPlan.units.find(
      (unit) => unit.unitType === 'copy.generate'
    )?.input,
    {
      stage: 'brief_compilation',
      role: 'brief',
      planId: freeze.planId,
      planRevision: freeze.planRevision,
      deliverables: [
        {
          deliverableId: 'd1-copy',
          kind: 'copy',
          platform: 'xiaohongshu',
          quantity: 1,
        },
      ],
      quoteRef: freeze.quoteRef,
      memoryContext: {
        entries: [{ memoryId: 'preference-live', revision: 5 }],
        receiptRef: {
          // The live kernel release (`resolved-live-release`) belongs to the
          // pre-plan turn; the injection is bound to the Run the plan froze.
          harnessReleaseId: 'composer-plan-surface-v1',
          runId: binding.runId,
          taskId: submission.task.id,
        },
        styleConstraints: {
          forbiddenPhrases: ['绝对', '保证', '必然'],
          maxBodyChars: 32,
          maxSentenceChars: 24,
          maxTitleChars: 24,
          tones: ['concise', 'restrained'],
        },
      },
    }
  );
});

test('real Composer recovery deterministically rebuilds a missing freeze from its durable compiled plan', async () => {
  const sessions = new MemoryAgentSessionStore();
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  let compiles = 0;
  let tick = 0;
  const coordinator = new ComposerPlanSessionCoordinator(
    sessions,
    plans,
    {
      retrieveConfirmedExperience: async () => [],
      async compilePlan(input) {
        compiles += 1;
        return compiler.compile(input);
      },
      async adjustPlan(input) {
        compiles += 1;
        return compiler.adjust(input);
      },
    },
    // The two Runs' exitRuns ordering falls back to `runId.localeCompare`
    // whenever `startedAt` ties, and real wall-clock time can tie two
    // sequential `prepare()` calls within the same millisecond — a
    // deterministic advancing clock (matching the pattern above) keeps the
    // ordering this test depends on from flaking.
    { now: () => new Date(Date.parse(TS) + tick++ * 1_000).toISOString() },
  );
  const submitted = record('task-crash-after-plan', '生成三页护理图文');
  const binding = await coordinator.prepare({ submission: submitted });
  const expectedFreeze = structuredClone(submitted.executionPlanFreeze);
  assert.ok(expectedFreeze);
	const later = record('task-after-crash', '把这次内容改成五页');
	await coordinator.prepare({
	  continuationThreadId: binding.threadId,
	  submission: later,
	});
	assert.equal(later.executionPlanFreeze?.planRevision, 2);

  const recovered = structuredClone(submitted);
  delete recovered.executionPlanFreeze;
  delete recovered.agentBinding;
  const recoveredBinding = await coordinator.prepare({ submission: recovered });

  assert.deepEqual(recoveredBinding, binding);
  assert.deepEqual(recovered.executionPlanFreeze, expectedFreeze);
	assert.equal(compiles, 2, 'recovery must not append another plan revision');
	assert.equal((await plans.listRevisions(expectedFreeze.planId)).length, 2);
});
