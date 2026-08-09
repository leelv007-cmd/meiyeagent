/**
 * V31-07 Intent interpreter + ambiguity policy + retrieval tools acceptance.
 *
 * Seam: turn runner + FixtureAgentKernel / mock tool loop — not prompt content.
 * Covers: no re-ask known fields; max 1 question/turn (Intent budget);
 * high-risk rights/facts not LLM-defaulted; tool governance refusal projection;
 * Day-0 free creation not blocked by confirmed_store/project.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentControlLimits, HarnessMiddlewareBinding } from '@meiye/contracts';

import {
  admitMerchantQuestion,
  applyProactiveMode,
  classifyAmbiguity,
  createQuestionBudgetState,
  filterAssumptionsForAuthority,
  resolveAmbiguity,
} from './ambiguity-policy.js';
import {
  createRetrievalToolRegistry,
  createSessionRetrievalPorts,
  RETRIEVAL_TOOL_NAMES,
  runWithMemoryInjectionTurnBinding,
} from './context-retrieval.js';
import {
  FixtureAgentKernel,
  type AgentKernel,
  type AgentKernelTurnRequest,
} from './agent-kernel.js';
import {
  pickSingleQuestionField,
  resolveFreeCreationGrounding,
  seedIntentHypothesis,
} from './intent-interpreter.js';
import {
  applyIntentRetrievalDecisionPatch,
  createDefaultIntentRetrievalBindings,
  createIntentRetrievalPolicies,
} from './intent-retrieval-policies.js';
import {
  AgentToolRegistry,
  evaluateToolCall,
  isToolCallRefusal,
  refuseTool,
} from './tool-registry.js';
import { AgentTurnRunner } from './turn-runner.js';
import { z } from 'zod';

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
    approvedToolNames: [...RETRIEVAL_TOOL_NAMES],
    limits: { ...CONTROL_LIMITS },
    harnessReleaseId: 'release-1',
    ...overrides,
  };
}

// ─── Pure policy units ──────────────────────────────────────────────────────

test('ambiguity axes: rights/facts unknown → L3; reversible strategy → L1', () => {
  assert.equal(
    classifyAmbiguity({
      impact: 'rights',
      reversibility: 'reversible',
      authority: 'unknown',
    }),
    'L3',
  );
  assert.equal(
    classifyAmbiguity({
      impact: 'facts',
      reversibility: 'hard_to_reverse',
      authority: 'model_inferred',
    }),
    'L3',
  );
  assert.equal(
    classifyAmbiguity({
      impact: 'strategy',
      reversibility: 'reversible',
      authority: 'unknown',
    }),
    'L1',
  );
  assert.equal(
    classifyAmbiguity({
      impact: 'facts',
      reversibility: 'reversible',
      authority: 'system_fact',
    }),
    'L0',
  );
});

test('proactive mode never relaxes high-risk; cautious escalates L1→L2', () => {
  const highRisk = {
    impact: 'fees' as const,
    reversibility: 'reversible' as const,
    authority: 'unknown' as const,
  };
  assert.equal(applyProactiveMode('L3', 'proactive', highRisk), 'L3');

  const low = {
    impact: 'strategy' as const,
    reversibility: 'reversible' as const,
    authority: 'unknown' as const,
  };
  assert.equal(applyProactiveMode('L1', 'cautious', low), 'L2');
  assert.equal(applyProactiveMode('L2', 'proactive', low), 'L1');
});

test('resolveAmbiguity: L1 yields visible reversible assumption; L3 blocks LLM default', () => {
  const l1 = resolveAmbiguity({
    axes: {
      impact: 'strategy',
      reversibility: 'reversible',
      authority: 'unknown',
    },
    proactiveMode: 'balanced',
    field: 'platform',
    safeDefaultStatement: '默认小红书（可逆）',
  });
  assert.equal(l1.resolution, 'safe_default');
  assert.equal(l1.assumption?.userVisible, true);
  assert.equal(l1.assumption?.reversible, true);
  assert.equal(l1.assumption?.risk, 'low');

  const l3 = resolveAmbiguity({
    axes: {
      impact: 'rights',
      reversibility: 'irreversible',
      authority: 'unknown',
    },
    proactiveMode: 'proactive',
    field: 'customer_asset',
  });
  assert.equal(l3.resolution, 'block');
});

test('question budget: known field not re-asked; Intent max 1', () => {
  const state = createQuestionBudgetState(['platform']);
  const known = admitMerchantQuestion({
    phase: 'intent',
    field: 'platform',
    state,
  });
  assert.equal(known.allowed, false);
  if (!known.allowed) {
    assert.equal(known.gateId, 'question_already_known');
  }

  const first = admitMerchantQuestion({
    phase: 'intent',
    field: 'tone',
    state,
  });
  assert.equal(first.allowed, true);
  // record manually as policy would
  state.intentAsked = 1;
  state.askedFields.add('tone');

  const second = admitMerchantQuestion({
    phase: 'intent',
    field: 'length',
    state,
    lowRiskFallback: { statement: '默认适中篇幅' },
  });
  assert.equal(second.allowed, false);
  if (!second.allowed) {
    assert.equal(second.gateId, 'question_budget_exhausted');
    assert.ok(second.fallbackAssumption);
  }
});

test('filterAssumptionsForAuthority blocks high-risk LLM defaults', () => {
  const impactByKey = new Map([
    ['price', 'facts' as const],
    ['platform', 'strategy' as const],
  ]);
  const result = filterAssumptionsForAuthority({
    assumptions: [
      { key: 'price', statement: '定价 99', risk: 'high' },
      { key: 'platform', statement: '默认小红书', risk: 'low' },
      { key: 'mystery', statement: '高风险瞎编', risk: 'high' },
    ],
    impactByKey,
  });
  assert.equal(result.assumptions.length, 1);
  assert.equal(result.assumptions[0]?.key, 'platform');
  assert.ok(result.blocked.some((item) => item.key === 'price'));
  assert.ok(result.blocked.some((item) => item.key === 'mystery'));
});

// ─── Day-0 free creation (D-175) ────────────────────────────────────────────

test('Day-0 free creation: not blocked by missing confirmed_store/project', () => {
  const free = resolveFreeCreationGrounding({
    creationMode: 'free',
    hasConfirmedStore: false,
    hasConfirmedProject: false,
  });
  assert.equal(free.blockedByMissingStoreOrProject, false);
  assert.equal(free.mayInventStoreFacts, false);
  assert.equal(free.day0SafeGenericPath, true);
  assert.deepEqual(free.missing, []);

  const customized = resolveFreeCreationGrounding({
    creationMode: 'customized',
    hasConfirmedStore: false,
    hasConfirmedProject: false,
  });
  assert.equal(customized.blockedByMissingStoreOrProject, true);
  assert.ok(customized.missing.includes('confirmed_store'));
});

test('free retrieval tools return empty store facts without inventing', async () => {
  const ports = createSessionRetrievalPorts({
    product: {
      load: async () => null,
    },
    storeFacts: {
      listActive: async () => {
        throw new Error('must not query store facts on free path');
      },
    },
  });
  const registry = createRetrievalToolRegistry({
    ports,
    context: {
      workspaceId: 'ws-day0',
      creationMode: 'free',
    },
  });
  const tools = registry.toKernelTools({ phase: 'intent' });
  const projects = await tools.find_store_projects!.execute({
    response_format: 'concise',
  });
  const facts = await tools.read_confirmed_store_facts!.execute({
    response_format: 'detailed',
  });
  assert.equal(
    (projects as { creationMode?: string }).creationMode,
    'free',
  );
  assert.deepEqual((projects as { items: unknown[] }).items, []);
  assert.deepEqual((facts as { items: unknown[] }).items, []);
  assert.match(
    String((facts as { note?: string }).note),
    /D-175|invent/i,
  );
});

// ─── Tool registry governance ───────────────────────────────────────────────

test('tool registry: phase / maxCalls refusal projects gateId+reason', async () => {
  const registry = new AgentToolRegistry();
  registry.register({
    policy: {
      toolName: 'read_confirmed_store_facts',
      description: 'facts',
      sideEffect: 'none',
      riskClass: 'read',
      approval: 'never',
      allowedPhases: ['intent', 'plan'],
      dataClasses: ['store_fact'],
      maxCallsPerRun: 1,
      timeoutMs: 5_000,
      inputSchema: z.object({ response_format: z.enum(['concise', 'detailed']).optional() }).strict(),
      isRetrieval: true,
    },
    execute: async () => ({ items: [{ ref: 'f1' }] }),
  });

  const phaseRefuse = evaluateToolCall(
    registry.get('read_confirmed_store_facts')!.policy,
    { toolName: 'read_confirmed_store_facts', phase: 'make', priorCallCount: 0 },
  );
  assert.equal(phaseRefuse.allowed, false);
  if (!phaseRefuse.allowed) {
    assert.equal(phaseRefuse.gateId, 'tool_phase_forbidden');
  }

  const tools = registry.toKernelTools({
    phase: 'intent',
    allowNames: ['read_confirmed_store_facts'],
  });
  const first = await tools.read_confirmed_store_facts!.execute({});
  assert.equal(isToolCallRefusal(first), false);
  const second = await tools.read_confirmed_store_facts!.execute({});
  assert.equal(isToolCallRefusal(second), true);
  if (isToolCallRefusal(second)) {
    assert.equal(second.gateId, 'tool_max_calls_exceeded');
    assert.match(second.reason, /maxCallsPerRun/);
  }

  assert.deepEqual(refuseTool('x', 'y'), {
    allowed: false,
    gateId: 'x',
    reason: 'y',
  });
});

test('retrieval tool Zod schemas reject garbage; response_format echoed', async () => {
  const registry = createRetrievalToolRegistry({
    ports: {
      listAuthorizedAssets: async () => [
        {
          ref: 'asset:1',
          category: 'store',
          rightsStatus: 'authorized',
        },
      ],
    },
    context: { workspaceId: 'ws-1', creationMode: 'customized' },
  });
  const tools = registry.toKernelTools({ phase: 'intent' });
  const ok = await tools.find_authorized_assets!.execute({
    response_format: 'concise',
  });
  assert.equal((ok as { response_format: string }).response_format, 'concise');
  assert.equal((ok as { items: unknown[] }).items.length, 1);

  await assert.rejects(async () =>
    tools.find_authorized_assets!.execute({ response_format: 'nope' }),
  );
});

// ─── Intent seed + single question pick ─────────────────────────────────────

test('seedIntentHypothesis: free skips store retrieval storm; pick one question', () => {
  const hypothesis = seedIntentHypothesis({
    merchantMessage: '随便写点美业文案',
    creationMode: 'free',
    proactiveMode: 'balanced',
    knownFields: [],
  });
  assert.equal(hypothesis.creationMode, 'free');
  assert.ok(
    hypothesis.retrievalRequests?.every(
      (item) =>
        item.toolName !== 'find_store_projects' &&
        item.toolName !== 'read_confirmed_store_facts',
    ),
  );

  const field = pickSingleQuestionField({
    ambiguities: hypothesis.ambiguities ?? [],
    knownFields: ['platform'],
    remainingBudget: 1,
  });
  // platform known → no strategy ask; price is retrieve/block not ask_user
  assert.equal(field, null);
});

// ─── Turn-runner seam (mock model / Fixture kernel) ─────────────────────────

test('turn runner: does not re-ask known field; budget exhaust → finish with assumption', async () => {
  const askDecision = {
    merchantMessage: '想确认平台',
    action: {
      kind: 'ask_merchant' as const,
      question: {
        itemId: 'platform',
        question: '你更想发小红书还是抖音？',
      },
    },
    evidenceRefs: [],
    assumptions: [] as Array<{
      key: string;
      statement: string;
      risk: 'low' | 'medium' | 'high';
    }>,
  };

  const bindings = createDefaultIntentRetrievalBindings();
  const policies = createIntentRetrievalPolicies({
    knownFields: ['platform'],
  });

  const kernel = new FixtureAgentKernel({ decision: askDecision });
  const runner = new AgentTurnRunner({
    kernel,
    resolveRelease: async () => ({
      controlLimits: { ...CONTROL_LIMITS },
      middlewareBindings: bindings,
      releaseId: 'release-1',
    }),
    policies,
    readOnly: true,
  });

  const result = await runner.run(baseTurn({ approvedToolNames: [] }));
  // Known field → suppress ask → finish_turn
  assert.equal(result.decision?.action.kind, 'finish_turn');
  assert.equal(result.policyState.suppressAsk, true);
  assert.equal(
    (result.policyState.questionBudgetRefusal as { gateId: string })?.gateId,
    'question_already_known',
  );
});

test('turn runner: high-risk price assumption stripped from decision', async () => {
  const decision = {
    merchantMessage: '方案草稿',
    action: { kind: 'finish_turn' as const },
    evidenceRefs: [],
    assumptions: [
      { key: 'price', statement: '我猜 199', risk: 'high' as const },
      { key: 'platform', statement: '默认小红书', risk: 'low' as const },
    ],
  };
  const impactByKey = new Map([['price', 'facts' as const]]);
  const bindings: HarnessMiddlewareBinding[] = [
    {
      policyId: 'session.high_risk_assumption_gate',
      revision: 'v31-07',
      kind: 'after_model',
      order: 20,
      allowedControlActions: ['continue', 'ask_merchant'],
    },
  ];
  const policies = createIntentRetrievalPolicies({ impactByKey }).filter(
    (policy) => policy.binding.policyId === 'session.high_risk_assumption_gate',
  );

  const kernel = new FixtureAgentKernel({ decision });
  const runner = new AgentTurnRunner({
    kernel,
    resolveRelease: async () => ({
      controlLimits: { ...CONTROL_LIMITS },
      middlewareBindings: bindings,
      releaseId: 'release-1',
    }),
    policies,
    readOnly: true,
  });

  const result = await runner.run(baseTurn({ approvedToolNames: [] }));
  assert.ok(result.decision);
  assert.equal(result.decision!.assumptions.length, 1);
  assert.equal(result.decision!.assumptions[0]?.key, 'platform');
  assert.ok(
    Array.isArray(result.policyState.highRiskBlocked) &&
      (result.policyState.highRiskBlocked as unknown[]).length >= 1,
  );
});

test('turn runner + retrieval tools: tool loop + governance refuse wrong phase', async () => {
  const ports = createSessionRetrievalPorts({
    product: {
      load: async () => ({
        store: {
          id: 'store-1',
          confirmedAt: '2026-01-01T00:00:00.000Z',
          projects: [
            { id: 'p1', name: '水光针', confirmed: true, description: '补水' },
          ],
        },
        assets: [
          {
            id: 'a1',
            category: 'store',
            authorizationStatus: 'authorized',
            consentScope: 'public_marketing',
            rightsEvidence: 'signed',
            containsPerson: false,
            tags: ['门店'],
          },
        ],
      }),
    },
  });
  // Restrict one tool to plan-only to prove phase refusal.
  const registry = createRetrievalToolRegistry({
    ports,
    context: { workspaceId: 'ws-1', creationMode: 'customized', storeId: 'store-1' },
  });
  // Override: re-register is not allowed — evaluate via policy directly for make phase.
  const makeRefuse = evaluateToolCall(
    {
      toolName: 'find_store_projects',
      description: 'x',
      sideEffect: 'none',
      riskClass: 'read',
      approval: 'never',
      allowedPhases: ['intent', 'plan'],
      dataClasses: [],
      maxCallsPerRun: 4,
      timeoutMs: 1000,
      inputSchema: z.object({}).passthrough(),
    },
    { toolName: 'find_store_projects', phase: 'make', priorCallCount: 0 },
  );
  assert.equal(makeRefuse.allowed, false);

  const kernel = new FixtureAgentKernel({
    decision: {
      merchantMessage: '已检索门店项目',
      action: { kind: 'finish_turn' },
      evidenceRefs: ['project:p1'],
      assumptions: [
        { key: 'platform', statement: '默认小红书', risk: 'low' },
      ],
    },
    toolCallPlan: [
      { toolName: 'find_store_projects', args: { response_format: 'concise' } },
      { toolName: 'find_authorized_assets', args: { response_format: 'concise' } },
    ],
  });

  const runner = new AgentTurnRunner({
    kernel,
    toolRegistry: registry,
    resolveRelease: async () => ({
      controlLimits: { ...CONTROL_LIMITS },
      middlewareBindings: [],
      releaseId: 'release-1',
    }),
    readOnly: true,
  });

  const result = await runner.run(
    baseTurn({
      approvedToolNames: ['find_store_projects', 'find_authorized_assets'],
    }),
  );
  assert.equal(result.decision?.action.kind, 'finish_turn');
  assert.equal(result.toolCalls.length, 2);
  assert.equal(result.toolCalls[0]?.toolName, 'find_store_projects');
  // Tool results are on kernel path; assert via re-exec registry for content.
  const tools = registry.toKernelTools({ phase: 'intent' });
  const projects = await tools.find_store_projects!.execute({
    response_format: 'concise',
  });
  assert.equal((projects as { items: { name: string }[] }).items[0]?.name, '水光针');
});

test('applyIntentRetrievalDecisionPatch: suppressAsk converts ask→finish', () => {
  const patched = applyIntentRetrievalDecisionPatch(
    {
      merchantMessage: '问一下',
      action: {
        kind: 'ask_merchant',
        question: { itemId: 'x', question: 'q?' },
      },
      evidenceRefs: [],
      assumptions: [],
    },
    {
      suppressAsk: true,
      forcedAssumption: {
        key: 'x',
        statement: '可逆默认',
        risk: 'low',
      },
    },
  );
  assert.equal(patched.action.kind, 'finish_turn');
  assert.equal(patched.assumptions[0]?.key, 'x');
});

test('first-batch retrieval tool names match V3.1 §20.2', () => {
  assert.deepEqual([...RETRIEVAL_TOOL_NAMES].sort(), [
    'find_authorized_assets',
    'find_store_projects',
    'read_confirmed_experience',
    'read_confirmed_store_facts',
    'read_marketing_identity',
    'read_model_capabilities',
    'read_platform_requirements',
    'read_recent_content',
  ]);
});

test('V31-18 read_confirmed_experience forwards the per-turn injection binding', async () => {
  const seen: Array<{ injectionContext?: object }> = [];
  const ports = createSessionRetrievalPorts({
    experience: {
      retrieveForInjection: async (query) => {
        seen.push({ injectionContext: query.injectionContext });
        return query.injectionContext
          ? [
              {
                memoryId: 'pref-x',
                statement: '语气轻一点',
                kind: 'preference',
                authority: 'confirmed',
              },
            ]
          : [];
      },
    },
  });
  const registry = createRetrievalToolRegistry({
    ports,
    context: { workspaceId: 'ws-1', creationMode: 'customized' },
  });
  const tools = registry.toKernelTools({ phase: 'intent' });

  // No turn binding → read-only retrieval, no injection context forwarded.
  await tools.read_confirmed_experience!.execute({
    response_format: 'concise',
  });
  assert.equal(seen[0]?.injectionContext, undefined);

  // Turn runner binds task/run/release → forwarded to the injection point.
  const binding = {
    taskId: 'task-1',
    runId: 'run-1',
    harnessReleaseId: 'release-1',
  };
  await runWithMemoryInjectionTurnBinding(binding, async () => {
    const result = await tools.read_confirmed_experience!.execute({
      response_format: 'concise',
    });
    assert.equal(
      (result as { confirmed: unknown[] }).confirmed.length,
      1,
    );
    assert.deepEqual(seen[1]?.injectionContext, binding);
  });

  // Bridge restored → next read is read-only again.
  await tools.read_confirmed_experience!.execute({
    response_format: 'concise',
  });
  assert.equal(seen[2]?.injectionContext, undefined);
});

test('V31-18 concurrent workspace turns keep memory injection bindings isolated', async () => {
  const seen = new Map<string, object | undefined>();
  const enteredA = deferred<void>();
  const enteredB = deferred<void>();
  const releaseA = deferred<void>();
  const releaseB = deferred<void>();

  function runnerFor(
    workspaceId: string,
    kernel: AgentKernel,
  ): AgentTurnRunner {
    const ports = createSessionRetrievalPorts({
      experience: {
        retrieveForInjection: async (query) => {
          seen.set(workspaceId, query.injectionContext);
          return [];
        },
      },
    });
    return new AgentTurnRunner({
      kernel,
      toolRegistry: createRetrievalToolRegistry({
        ports,
        context: { workspaceId, creationMode: 'customized' },
      }),
      resolveRelease: async () => ({
        controlLimits: { ...CONTROL_LIMITS },
        middlewareBindings: [],
        releaseId: 'release-1',
      }),
      readOnly: true,
    });
  }

  const runnerA = runnerFor(
    'ws-a',
    coordinatedRetrievalKernel(enteredA, releaseA),
  );
  const runnerB = runnerFor(
    'ws-b',
    coordinatedRetrievalKernel(enteredB, releaseB),
  );

  const turnA = runnerA.run(
    baseTurn({
      activeTaskRef: { taskId: 'task-a', workflowId: 'workflow-a' },
      approvedToolNames: ['read_confirmed_experience'],
      runId: 'run-a',
      threadId: 'thread-a',
      workspaceId: 'ws-a',
    }),
  );
  await enteredA.promise;
  const turnB = runnerB.run(
    baseTurn({
      activeTaskRef: { taskId: 'task-b', workflowId: 'workflow-b' },
      approvedToolNames: ['read_confirmed_experience'],
      runId: 'run-b',
      threadId: 'thread-b',
      workspaceId: 'ws-b',
    }),
  );
  await enteredB.promise;

  // Both kernel turns are now active. Release A while B is the most recently
  // entered turn; a module-global binding leaks B into A here.
  releaseA.resolve();
  await turnA;
  releaseB.resolve();
  await turnB;

  assert.deepEqual(seen.get('ws-a'), {
    taskId: 'task-a',
    runId: 'run-a',
    harnessReleaseId: 'release-1',
  });
  assert.deepEqual(seen.get('ws-b'), {
    taskId: 'task-b',
    runId: 'run-b',
    harnessReleaseId: 'release-1',
  });
});

test('V31-18 receipt attribution uses the resolved canonical release id', async () => {
  let attributedReleaseId: string | undefined;
  const runner = new AgentTurnRunner({
    kernel: coordinatedRetrievalKernel(deferredResolved(), deferredResolved()),
    toolRegistry: createRetrievalToolRegistry({
      ports: createSessionRetrievalPorts({
        experience: {
          retrieveForInjection: async (query) => {
            attributedReleaseId = query.injectionContext?.harnessReleaseId;
            return [];
          },
        },
      }),
      context: { workspaceId: 'ws-a', creationMode: 'customized' },
    }),
    resolveRelease: async () => ({
      controlLimits: { ...CONTROL_LIMITS },
      middlewareBindings: [],
      releaseId: 'release-canonical',
    }),
    readOnly: true,
  });

  await runner.run(baseTurn({
    activeTaskRef: { taskId: 'task-a', workflowId: 'workflow-a' },
    approvedToolNames: ['read_confirmed_experience'],
    harnessReleaseId: 'release-requested-alias',
    runId: 'run-a',
    threadId: 'thread-a',
    workspaceId: 'ws-a',
  }));

  assert.equal(attributedReleaseId, 'release-canonical');
});

function deferredResolved() {
  const gate = deferred<void>();
  gate.resolve();
  return gate;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function coordinatedRetrievalKernel(
  entered: ReturnType<typeof deferred<void>>,
  release: ReturnType<typeof deferred<void>>,
): AgentKernel {
  return {
    async runTurn(request: AgentKernelTurnRequest) {
      entered.resolve();
      await release.promise;
      const args = { response_format: 'concise' };
      const result = await request.tools.read_confirmed_experience!.execute(args);
      return {
        decision: {
          merchantMessage: '检索完成',
          action: { kind: 'finish_turn' },
          evidenceRefs: [],
          assumptions: [],
        },
        toolCalls: [
          { toolName: 'read_confirmed_experience', args, result },
        ],
        steps: 1,
      };
    },
  };
}
