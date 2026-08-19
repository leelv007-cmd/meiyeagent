/**
 * ARCH-SESSION-01: AgentTurnPhase is a single-turn observation.
 * Every live phase has a producer, a consumer, and a transition test.
 * Archived phases (publish / delivered) stay rejected — no auto-publish.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { agentRunSchema, AGENT_RUN_SCHEMA_VERSION } from '@meiye/contracts';
import { z } from 'zod';

import {
  admitMerchantQuestion,
  createQuestionBudgetState,
  recordMerchantQuestion,
} from './ambiguity-policy.js';
import { FixtureAgentKernel } from './agent-kernel.js';
import { AgentSessionHarnessService } from './service.js';
import {
  SESSION_HARNESS_STATES,
  canTransition,
  level1ShortcutPath,
  transition,
} from './state-machine.js';
import {
  AgentToolRegistry,
  evaluateToolCall,
  toToolPhase,
} from './tool-registry.js';
import {
  AGENT_TURN_PHASES,
  ARCHIVED_AGENT_TURN_PHASES,
  observeAgentTurnPhase,
  parseAgentTurnInput,
  produceComposerTurnPhase,
} from './turn-contracts.js';
import { AgentTurnRunner } from './turn-runner.js';

const CONTROL_LIMITS = {
  maxLlmSteps: 4,
  maxToolCalls: 6,
  maxRetrievalCalls: 6,
  maxMerchantQuestions: 1,
  maxReplans: 0,
  maxSchemaRepairs: 1,
  maxContextTokens: 16_000,
  maxDelegations: 1,
};

function baseTurn(overrides: Record<string, unknown> = {}) {
  return {
    threadId: 'thread-1',
    runId: 'run-1',
    workspaceId: 'ws-1',
    actorId: 'actor-1',
    phase: 'intent' as const,
    merchantMessage: '帮我做一组种草图文',
    proactiveMode: 'balanced' as const,
    sessionRevision: 0,
    approvedToolNames: [],
    limits: { ...CONTROL_LIMITS },
    harnessReleaseId: 'release-1',
    ...overrides,
  };
}

const FINISH_DECISION = {
  merchantMessage: '先记下目标。',
  action: { kind: 'finish_turn' as const },
  evidenceRefs: [],
  assumptions: [],
};

test('live AgentTurnPhase set is intent/plan/make; archived phases have no producer', () => {
  assert.deepEqual([...AGENT_TURN_PHASES], ['intent', 'plan', 'make']);
  assert.deepEqual([...ARCHIVED_AGENT_TURN_PHASES], ['delivered', 'publish']);
  for (const phase of ARCHIVED_AGENT_TURN_PHASES) {
    assert.equal(AGENT_TURN_PHASES.includes(phase as never), false);
    assert.throws(() => observeAgentTurnPhase(phase));
    assert.throws(() => parseAgentTurnInput(baseTurn({ phase })));
  }
});

test('every live phase has a producer and a consumer', () => {
  assert.equal(produceComposerTurnPhase(), 'intent');
  assert.equal(observeAgentTurnPhase('intent'), 'intent');
  assert.equal(observeAgentTurnPhase('plan'), 'plan');
  assert.equal(observeAgentTurnPhase('make'), 'make');

  const intent = parseAgentTurnInput(baseTurn({ phase: 'intent' }));
  const plan = parseAgentTurnInput(baseTurn({ phase: 'plan' }));
  const make = parseAgentTurnInput(baseTurn({ phase: 'make' }));
  assert.equal(intent.phase, 'intent');
  assert.equal(plan.phase, 'plan');
  assert.equal(make.phase, 'make');

  const intentBudget = admitMerchantQuestion({
    phase: intent.phase,
    field: 'tone',
    state: createQuestionBudgetState(),
  });
  const planBudget = admitMerchantQuestion({
    phase: plan.phase,
    field: 'tone',
    state: createQuestionBudgetState(),
  });
  const makeBudget = admitMerchantQuestion({
    phase: make.phase,
    field: 'tone',
    state: createQuestionBudgetState(),
  });
  assert.equal(intentBudget.allowed, true);
  assert.equal(planBudget.allowed, true);
  assert.equal(makeBudget.allowed, false);
  if (!makeBudget.allowed) {
    assert.equal(makeBudget.gateId, 'question_budget_exhausted');
  }

  assert.equal(toToolPhase(intent.phase), 'intent');
  assert.equal(toToolPhase(plan.phase), 'plan');
  assert.equal(toToolPhase(make.phase), 'make');
});

test('Composer production path produces intent, never publish', () => {
  const harness = new AgentSessionHarnessService({
    store: {} as never,
    kernel: new FixtureAgentKernel({ decision: FINISH_DECISION }),
    resolveRelease: async () => ({
      controlLimits: { ...CONTROL_LIMITS },
      releaseId: 'release-1',
    }),
  });
  const runner = harness.createTurnRunner({ resourceId: 'ws-1' });
  assert.equal(runner.currentState, 'idle');

  // The production Composer seam is the only live writer of phase.
  assert.equal(produceComposerTurnPhase(), 'intent');
  const composed = parseAgentTurnInput(
    baseTurn({ phase: produceComposerTurnPhase() }),
  );
  assert.equal(composed.phase, 'intent');
});

test('intent and plan question budgets transition independently; make stays closed', () => {
  const state = createQuestionBudgetState();
  assert.equal(
    admitMerchantQuestion({ phase: 'intent', field: 'tone', state }).allowed,
    true,
  );
  recordMerchantQuestion(state, 'intent', 'tone');
  assert.equal(
    admitMerchantQuestion({ phase: 'intent', field: 'length', state }).allowed,
    false,
  );
  assert.equal(
    admitMerchantQuestion({ phase: 'plan', field: 'length', state }).allowed,
    true,
  );
  recordMerchantQuestion(state, 'plan', 'length');
  assert.equal(
    admitMerchantQuestion({ phase: 'plan', field: 'cta', state }).allowed,
    false,
  );
  assert.equal(
    admitMerchantQuestion({ phase: 'make', field: 'cta', state }).allowed,
    false,
  );
});

test('archived publish/delivered observations do not unlock delivery tools', () => {
  const registry = new AgentToolRegistry();
  registry.register({
    policy: {
      toolName: 'handoff_only',
      description: 'delivery-only',
      sideEffect: 'none',
      riskClass: 'read',
      approval: 'never',
      allowedPhases: ['delivery'],
      dataClasses: [],
      maxCallsPerRun: 1,
      timeoutMs: 1_000,
      inputSchema: z.object({}).strict(),
    },
    execute: () => ({ ok: true }),
  });

  for (const phase of ['publish', 'delivered', 'unknown'] as const) {
    assert.equal(toToolPhase(phase), null);
    const admission = evaluateToolCall(registry.get('handoff_only')!.policy, {
      toolName: 'handoff_only',
      phase,
      priorCallCount: 0,
    });
    assert.equal(admission.allowed, false);
    if (!admission.allowed) {
      assert.equal(admission.gateId, 'tool_phase_forbidden');
    }
    assert.deepEqual(registry.namesForPhase(phase), []);
    assert.deepEqual(Object.keys(registry.toKernelTools({ phase })), []);
  }

  const makeRefuse = evaluateToolCall(registry.get('handoff_only')!.policy, {
    toolName: 'handoff_only',
    phase: 'make',
    priorCallCount: 0,
  });
  assert.equal(makeRefuse.allowed, false);
});

test('in-turn observations are not a durable session machine and have producers', async () => {
  assert.deepEqual([...SESSION_HARNESS_STATES], [
    'idle',
    'interpreting',
    'retrieving',
    'hypothesis_ready',
    'awaiting_clarification',
    'plan_compiling',
    'handing_off',
  ]);
  assert.deepEqual(level1ShortcutPath(), [
    'idle',
    'interpreting',
    'handing_off',
  ]);

  let state = transition('idle', 'interpreting');
  state = transition(state, 'retrieving');
  state = transition(state, 'hypothesis_ready');
  state = transition(state, 'plan_compiling');
  assert.equal(state, 'plan_compiling');
  assert.equal(canTransition('plan_compiling', 'handing_off'), false);
  assert.equal(canTransition('handing_off', 'completed' as never), false);
  assert.throws(() => transition('idle', 'handing_off'));

  const kernel = new FixtureAgentKernel({ decision: FINISH_DECISION });
  const first = new AgentTurnRunner({
    kernel,
    resolveRelease: async () => ({
      controlLimits: { ...CONTROL_LIMITS },
      releaseId: 'release-1',
    }),
    readOnly: true,
  });
  const second = new AgentTurnRunner({
    kernel,
    resolveRelease: async () => ({
      controlLimits: { ...CONTROL_LIMITS },
      releaseId: 'release-1',
    }),
    readOnly: true,
  });
  assert.equal(first.currentState, 'idle');
  assert.equal(second.currentState, 'idle');
  const finished = await first.run(baseTurn());
  assert.equal(finished.state, 'handing_off');
  assert.equal(second.currentState, 'idle');

  const asked = await new AgentTurnRunner({
    kernel: new FixtureAgentKernel({
      decision: {
        merchantMessage: '先确认平台。',
        action: {
          kind: 'ask_merchant',
          question: { itemId: 'platform', question: '发哪个平台？', options: [{ label: '小红书' }] },
        },
        evidenceRefs: [],
        assumptions: [],
      },
    }),
    resolveRelease: async () => ({
      controlLimits: { ...CONTROL_LIMITS },
      releaseId: 'release-1',
    }),
    readOnly: true,
  }).run(baseTurn());
  assert.equal(asked.state, 'awaiting_clarification');

  const retrieving = await new AgentTurnRunner({
    kernel: {
      async runTurn() {
        return {
          decision: {
            merchantMessage: '尝试预扣',
            action: { kind: 'reserve_usage' },
            evidenceRefs: [],
            assumptions: [],
          },
          toolCalls: [{ toolName: 'read_context', args: {} }],
          steps: 1,
        };
      },
    },
    resolveRelease: async () => ({
      controlLimits: { ...CONTROL_LIMITS },
      releaseId: 'release-1',
    }),
    tools: {
      read_context: {
        description: 'read',
        sideEffect: 'none',
        execute: async () => ({ facts: [] }),
      },
    },
    readOnly: true,
  }).run(baseTurn({ approvedToolNames: ['read_context'] }));
  assert.equal(retrieving.systemOnlyBlock?.blocked, true);
  assert.equal(retrieving.state, 'retrieving');
});

test('AgentRun persistence has no phase field — observation is not CAS-stored', () => {
  const run = agentRunSchema.parse({
    schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    runId: 'run_turnphase_1',
    threadId: 'thr_turnphase_1',
    trigger: 'merchant_turn',
    status: 'running',
    durability: 'exit',
    harnessReleaseId: 'rel_turnphase_1',
    startedAt: '2026-08-20T00:00:00.000Z',
  });
  assert.equal('phase' in run, false);
  assert.equal(
    agentRunSchema.safeParse({ ...run, phase: 'intent' }).success,
    false,
  );
});
