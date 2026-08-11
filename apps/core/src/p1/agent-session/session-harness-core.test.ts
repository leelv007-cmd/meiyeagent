/**
 * V31-06 Session Harness core acceptance tests.
 *
 * Seam: turn contracts, state machine, after-model policy order, system-only intercept,
 * controlLimits U11, compaction writer + U4 degradation, partial activity
 * stable ID, read-only didNotCall('record').
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentControlLimits, HarnessMiddlewareBinding } from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import { WORKING_MEMORY_CHECKPOINT_WRITE_HOOK } from '../operations/agent-memory-platform.js';
import {
  AGENT_KERNEL_FORBIDDEN_METHODS,
  FixtureAgentKernel,
  assertNoDurableCheckpointSurface,
} from './agent-kernel.js';
import {
  ThreadCheckpointWriter,
  assertSoleCheckpointWriter,
  getRegisteredCheckpointWriter,
  registerSoleCheckpointWriter,
  resetCheckpointWriterRegistryForTests,
  serializeCompactionSummary,
} from './compaction.js';
import {
  CONTEXT_BUDGETS,
  buildModelContextProjection,
} from './context-projection.js';
import { MemoryAgentSessionStore } from './memory-agent-session-store.js';
import { PartialActivityBuffer } from './partial-activity.js';
import {
  runAfterModelPolicies,
  type AfterModelPolicy,
} from './policy-middleware.js';
import {
  SESSION_HARNESS_STATES,
  canTransition,
  level1ShortcutPath,
  transition,
} from './state-machine.js';
import {
  SYSTEM_ONLY_GATE_ID,
  interceptSystemOnlyProposal,
} from './system-only-intercept.js';
import {
  agentTurnDecisionSchema,
  parseAgentTurnDecision,
  parseAgentTurnInput,
} from './turn-contracts.js';
import { didNotCall, toolOrder } from './quick-checks.js';
import { AgentTurnRunner } from './turn-runner.js';

const TS = '2026-08-08T12:00:00.000Z';

const CONTROL_LIMITS: AgentControlLimits = {
  maxLlmSteps: 4,
  maxToolCalls: 6,
  maxRetrievalCalls: 6,
  maxMerchantQuestions: 1,
  maxReplans: 0,
  maxSchemaRepairs: 1,
  maxContextTokens: 16_000,
  maxDelegations: 1,
};

const FINISH_DECISION = {
  merchantMessage: '已理解你的目标，先给出方案草稿。',
  action: { kind: 'finish_turn' as const },
  evidenceRefs: ['fact:1'],
  assumptions: [
    { key: 'platform', statement: '默认小红书', risk: 'low' as const },
  ],
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
    approvedToolNames: ['read_context'],
    limits: { ...CONTROL_LIMITS },
    harnessReleaseId: 'release-1',
    ...overrides,
  };
}

function resolveReleaseOk(bindings: HarnessMiddlewareBinding[] = []) {
  return async () => ({
    controlLimits: { ...CONTROL_LIMITS },
    middlewareBindings: bindings,
    releaseId: 'release-1',
  });
}

test('AgentTurnDecision Zod strict parse accepts terminal actions and rejects retrieve', () => {
  const parsed = parseAgentTurnDecision(FINISH_DECISION);
  assert.equal(parsed.action.kind, 'finish_turn');

  assert.throws(
    () =>
      agentTurnDecisionSchema.parse({
        ...FINISH_DECISION,
        action: { kind: 'retrieve', query: 'facts' },
      }),
  );

  assert.throws(
    () =>
      agentTurnDecisionSchema.parse({
        merchantMessage: 'x',
        // missing action
        evidenceRefs: [],
        assumptions: [],
      }),
  );
});

test('AgentTurnInput requires calibrated limits bag shape', () => {
  const input = parseAgentTurnInput(baseTurn());
  assert.equal(input.limits.maxLlmSteps, 4);
  assert.throws(() =>
    parseAgentTurnInput(baseTurn({ limits: { maxLlmSteps: 4 } })),
  );
});

test('state machine idle→…→handing_off legal path and level-1 shortcut', () => {
  assert.equal(SESSION_HARNESS_STATES[0], 'idle');
  let state = transition('idle', 'interpreting');
  state = transition(state, 'retrieving');
  state = transition(state, 'hypothesis_ready');
  state = transition(state, 'plan_compiling');
  state = transition(state, 'plan_ready');
  state = transition(state, 'handing_off');
  assert.equal(state, 'handing_off');

  assert.ok(canTransition('interpreting', 'handing_off'));
  assert.deepEqual(level1ShortcutPath(), [
    'idle',
    'interpreting',
    'handing_off',
    'completed',
  ]);
  assert.throws(() => transition('idle', 'completed'));
});

test('context projection strips forbidden keys and applies budgets by rank', () => {
  const facts = Array.from({ length: 30 }, (_, index) => ({
    ref: `f-${index}`,
    kind: 'price',
    value: index,
    relevance: index,
    authorityRank: index === 29 ? 100 : 1,
  }));
  const projection = buildModelContextProjection(
    { phase: 'intent', proactiveMode: 'balanced', merchantMessage: 'hi' },
    {
      merchantRequest: { text: 'hi' },
      confirmedFacts: facts,
      assets: Array.from({ length: 20 }, (_, index) => ({
        ref: `a-${index}`,
        relevance: index,
      })),
      identity: {
        storeName: '丽客',
        providerSecret: 'SECRET',
        apiKey: 'k',
      },
      extras: { chainOfThought: 'hidden', ok: true },
      experience: [
        ...Array.from({ length: 10 }, (_, index) => ({
          ref: `e-c-${index}`,
          instruction: `c${index}`,
          status: 'confirmed' as const,
          relevance: index,
        })),
        ...Array.from({ length: 5 }, (_, index) => ({
          ref: `e-p-${index}`,
          instruction: `p${index}`,
          status: 'pending' as const,
          relevance: index,
        })),
      ],
    },
  );

  assert.equal(projection.confirmedFacts.length, CONTEXT_BUDGETS.confirmedFacts);
  assert.equal(projection.confirmedFacts[0]?.ref, 'f-29');
  assert.equal(projection.assets.length, CONTEXT_BUDGETS.assets);
  assert.equal(
    projection.experience.filter((item) => item.status === 'confirmed').length,
    CONTEXT_BUDGETS.confirmedExperience,
  );
  assert.equal(
    projection.experience.filter((item) => item.status === 'pending').length,
    CONTEXT_BUDGETS.pendingExperience,
  );
  assert.equal(projection.identity?.storeName, '丽客');
  assert.equal(projection.identity?.providerSecret, undefined);
  assert.ok(projection.strippedKeys.some((key) => key.includes('providerSecret')));
  assert.ok(projection.strippedKeys.some((key) => key.includes('chainOfThought')));
});

test('System-only proposal intercept returns {blocked,gateId,reason,nextAction}', () => {
  const blocked = interceptSystemOnlyProposal({
    merchantMessage: 'x',
    action: { kind: 'reserve_usage' },
  });
  assert.equal(blocked.blocked, true);
  if (blocked.blocked) {
    assert.equal(blocked.gateId, SYSTEM_ONLY_GATE_ID);
    assert.match(blocked.reason, /System-only/);
    assert.equal(blocked.nextAction, 'ask_merchant');
  }

  for (const kind of [
    'settle',
    'commit_fact',
    'grant_rights',
    'publish',
    'final_commit',
  ]) {
    const result = interceptSystemOnlyProposal({ intent: kind });
    assert.equal(result.blocked, true);
  }

  assert.equal(
    interceptSystemOnlyProposal(FINISH_DECISION).blocked,
    false,
  );
});

test('after_model policies run in reverse pinned order and merge patches', async () => {
  const bindings: HarnessMiddlewareBinding[] = [
    {
      policyId: 'c',
      revision: '1',
      kind: 'after_model',
      order: 1,
      allowedControlActions: ['continue', 'end_turn', 'ask_merchant'],
    },
    {
      policyId: 'd',
      revision: '1',
      kind: 'after_model',
      order: 5,
      allowedControlActions: ['continue', 'end_turn', 'ask_merchant'],
    },
  ];

  const seen: string[] = [];
  const policies: AfterModelPolicy[] = [
    {
      binding: bindings[0]!,
      afterModel: () => {
        seen.push('after:c');
        return { control: 'continue', patch: { c: true } };
      },
    },
    {
      binding: bindings[1]!,
      afterModel: () => {
        seen.push('after:d');
        return { control: 'continue', patch: { d: true } };
      },
    },
  ];
  const ctx = {
    phase: 'intent',
    runId: 'r',
    workspaceId: 'w',
    state: {} as Record<string, unknown>,
  };
  assert.deepEqual(
    await runAfterModelPolicies(bindings, policies, ctx),
    { control: 'continue' },
  );
  assert.deepEqual(seen, ['after:d', 'after:c']);
  assert.deepEqual(ctx.state, { d: true, c: true });
});

test('unregistered after_model binding fails closed', async () => {
  const ghostBinding: HarnessMiddlewareBinding = {
    policyId: 'ghost.gate',
    revision: '1',
    kind: 'after_model',
    order: 0,
    allowedControlActions: ['continue'],
  };
  const registeredBinding: HarnessMiddlewareBinding = {
    policyId: 'real.gate',
    revision: '1',
    kind: 'after_model',
    order: 10,
    allowedControlActions: ['continue'],
  };

  await assert.rejects(
    runAfterModelPolicies(
      [registeredBinding, ghostBinding],
      [
        {
          binding: registeredBinding,
          afterModel: () => ({ control: 'continue' }),
        },
      ],
      { phase: 'intent', runId: 'r', workspaceId: 'w', state: {} },
    ),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'INVALID_STATE' &&
      /ghost\.gate/.test(error.message) &&
      !/real\.gate/.test(error.message),
  );
});

test('a registered after_model policy the release never pins fails closed', async () => {
  const pinned: HarnessMiddlewareBinding = {
    policyId: 'real.gate',
    revision: '1',
    kind: 'after_model',
    order: 0,
    allowedControlActions: ['continue'],
  };
  const unpinned: HarnessMiddlewareBinding = {
    policyId: 'question.budget',
    revision: 'v31-07',
    kind: 'after_model',
    order: 10,
    allowedControlActions: ['continue'],
  };

  // The mirror of an unregistered binding: the gate is built and handed to the
  // runner, the release forgot to pin it, and every turn then runs without it.
  await assert.rejects(
    runAfterModelPolicies(
      [pinned],
      [
        { binding: pinned, afterModel: () => ({ control: 'continue' }) },
        { binding: unpinned, afterModel: () => ({ control: 'continue' }) },
      ],
      { phase: 'intent', runId: 'r', workspaceId: 'w', state: {} },
    ),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'INVALID_STATE' &&
      /question\.budget@v31-07:after_model/.test(error.message) &&
      !/real\.gate/.test(error.message),
  );
});

test('after_model implementation must match release policyId and revision exactly', async () => {
  const releaseBinding: HarnessMiddlewareBinding = {
    policyId: 'rights.gate',
    revision: 'r2',
    kind: 'after_model',
    order: 0,
    allowedControlActions: ['continue'],
  };
  for (const mismatched of [{ ...releaseBinding, revision: 'r1' }]) {
    await assert.rejects(
      runAfterModelPolicies(
        [releaseBinding],
        [{ binding: mismatched, afterModel: () => ({ control: 'continue' }) }],
        { phase: 'intent', runId: 'r', workspaceId: 'w', state: {} },
      ),
      /rights\.gate@r2:after_model/u,
    );
  }
});

test('AgentKernel has no durable checkpoint surface', () => {
  const kernel = new FixtureAgentKernel({ decision: FINISH_DECISION });
  assertNoDurableCheckpointSurface(kernel);
  for (const method of AGENT_KERNEL_FORBIDDEN_METHODS) {
    assert.equal(method in kernel, false);
  }
});

test('partial output updates temp Activity; repair replaces same stable ID', () => {
  const buffer = new PartialActivityBuffer();
  const stableId = 'turn-activity:run-x';
  buffer.upsertPartial({
    stableId,
    payload: { draft: 1 },
    status: 'forming',
    now: TS,
  });
  buffer.upsertPartial({
    stableId,
    payload: { draft: 2 },
    status: 'draft',
    now: TS,
  });
  assert.equal(buffer.countFor(stableId), 1);
  assert.equal((buffer.get(stableId)?.payload as { draft: number }).draft, 2);

  buffer.replaceWithFinal({
    stableId,
    payload: FINISH_DECISION,
    now: TS,
  });
  assert.equal(buffer.countFor(stableId), 1);
  assert.equal(buffer.list().length, 1);
  assert.equal(buffer.get(stableId)?.status, 'draft');
  assert.equal(buffer.get(stableId)?.authoritative, false);
});

test('compaction sole writer: second registration rejected; hook matches V31-18 seam', () => {
  resetCheckpointWriterRegistryForTests();
  const store = new MemoryAgentSessionStore();
  const writer = new ThreadCheckpointWriter(store);
  assert.equal(writer.hookId, WORKING_MEMORY_CHECKPOINT_WRITE_HOOK);
  assertSoleCheckpointWriter(writer);
  registerSoleCheckpointWriter(writer);
  assert.equal(getRegisteredCheckpointWriter(), writer);

  const second = new ThreadCheckpointWriter(store);
  assert.throws(
    () => registerSoleCheckpointWriter(second),
    /sole writer already registered/,
  );
  resetCheckpointWriterRegistryForTests();
});

test('compaction failure retains last summary and does not block (U4)', async () => {
  resetCheckpointWriterRegistryForTests();
  const store = new MemoryAgentSessionStore();
  // Fail write by pointing at missing thread.
  const writer = new ThreadCheckpointWriter(store);
  const result = await writer.write({
    resourceId: 'ws-1',
    threadId: 'missing',
    sections: {
      goal: 'g',
      progress: 'p',
      keyDecisions: 'k',
      nextSteps: 'n',
      criticalContext: 'c',
      referencedObjects: [],
    },
    retainedTail: [{ role: 'user', text: 'hi' }],
    now: TS,
    previousSummary: 'LAST_GOOD_SUMMARY',
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.blocked, false);
    assert.equal(result.retainedSummary, 'LAST_GOOD_SUMMARY');
  }

  // Happy path writes via recordThreadSummary (summaryRevision only).
  await store.createThread({
    resourceId: 'ws-1',
    threadId: 'thread-ok',
    title: 't',
    now: TS,
  });
  const ok = await writer.write({
    resourceId: 'ws-1',
    threadId: 'thread-ok',
    sections: {
      goal: '做种草',
      progress: 'interpreting',
      keyDecisions: '默认小红书',
      nextSteps: 'propose_plan',
      criticalContext: 'day0',
      referencedObjects: ['plan:1'],
    },
    retainedTail: [{ role: 'user', text: '帮我做种草' }],
    now: TS,
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.checkpoint.costBearer, 'platform');
    assert.equal(ok.checkpoint.writerHook, WORKING_MEMORY_CHECKPOINT_WRITE_HOOK);
    assert.match(serializeCompactionSummary(ok.checkpoint), /Key Decisions/);
    assert.equal(ok.summaryRevision, 1);
  }
  resetCheckpointWriterRegistryForTests();
});

test('read-only turn: didNotCall(record) and zero paid side effects', async () => {
  resetCheckpointWriterRegistryForTests();
  const kernel = new FixtureAgentKernel({
    decision: FINISH_DECISION,
    toolCallPlan: [{ toolName: 'read_context', args: {} }],
  });
  const runner = new AgentTurnRunner({
    kernel,
    resolveRelease: resolveReleaseOk(),
    readOnly: true,
    tools: {
      read_context: {
        description: 'read',
        sideEffect: 'none',
        execute: async () => ({ facts: [] }),
      },
      record: {
        description: 'paid-ish',
        sideEffect: 'paid',
        execute: async () => {
          throw new Error('record must not run');
        },
      },
    },
  });

  const result = await runner.run(
    baseTurn({ approvedToolNames: ['read_context'] }),
  );
  assert.ok(didNotCall(result.toolCalls, 'record'));
  assert.ok(toolOrder(result.toolCalls, ['read_context']));
  assert.equal(result.decision?.action.kind, 'finish_turn');
  assert.equal(result.controlLimits.maxLlmSteps, CONTROL_LIMITS.maxLlmSteps);
});

test('U11: unset AgentControlLimits rejects production path', async () => {
  const kernel = new FixtureAgentKernel({ decision: FINISH_DECISION });
  const runner = new AgentTurnRunner({
    kernel,
    resolveRelease: async () => ({
      controlLimits: {
        maxLlmSteps: 4,
        maxToolCalls: null,
      },
      releaseId: 'release-bad',
    }),
  });

  await assert.rejects(
    () => runner.run(baseTurn()),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'INVALID_STATE' &&
      /U11/.test(error.message),
  );
});

test('turn runner: system-only block + partial activity same stable id', async () => {
  const activity = new PartialActivityBuffer();
  // Custom kernel returns a forbidden proposal before decision schema parse.
  const customKernel = {
    async runTurn(request: {
      onPartial?: (partial: unknown) => Promise<void> | void;
    }) {
      if (request.onPartial) {
        await request.onPartial({ forming: true });
        await request.onPartial({ forming: true, text: '...' });
      }
      return {
        decision: {
          merchantMessage: '尝试预扣',
          action: { kind: 'reserve_usage' },
          evidenceRefs: [],
          assumptions: [],
        },
        toolCalls: [],
        steps: 1,
      };
    },
  };

  const runner = new AgentTurnRunner({
    kernel: customKernel as never,
    resolveRelease: resolveReleaseOk(),
    activity,
    readOnly: true,
  });

  const result = await runner.run(baseTurn());
  assert.equal(result.decision, null);
  assert.ok(result.systemOnlyBlock?.blocked);
  if (result.systemOnlyBlock?.blocked) {
    assert.equal(result.systemOnlyBlock.gateId, SYSTEM_ONLY_GATE_ID);
    assert.equal(result.systemOnlyBlock.nextAction, 'ask_merchant');
  }
  assert.equal(activity.countFor(result.activityStableId), 1);
  assert.equal(activity.get(result.activityStableId)?.stableId, result.activityStableId);
});

test('turn runner advances state and uses release controlLimits over client bag', async () => {
  resetCheckpointWriterRegistryForTests();
  const store = new MemoryAgentSessionStore();
  await store.createThread({
    resourceId: 'ws-1',
    threadId: 'thread-1',
    title: 't',
    now: TS,
  });
  const writer = new ThreadCheckpointWriter(store);
  registerSoleCheckpointWriter(writer);

  const releaseLimits: AgentControlLimits = {
    ...CONTROL_LIMITS,
    maxLlmSteps: 9,
  };
  const kernel = new FixtureAgentKernel({ decision: FINISH_DECISION });
  const runner = new AgentTurnRunner({
    kernel,
    resolveRelease: async () => ({
      controlLimits: releaseLimits,
      middlewareBindings: [],
      releaseId: 'release-1',
    }),
    checkpointWriter: writer,
    resourceId: 'ws-1',
    readOnly: true,
  });

  const result = await runner.run(
    baseTurn({
      limits: { ...CONTROL_LIMITS, maxLlmSteps: 1 },
    }),
  );
  assert.equal(result.controlLimits.maxLlmSteps, 9);
  assert.equal(result.state, 'handing_off');
  assert.ok(result.compaction?.ok);
  resetCheckpointWriterRegistryForTests();
});
