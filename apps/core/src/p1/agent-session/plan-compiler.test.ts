/**
 * V31-09 Plan Compiler contract tests.
 *
 * Seam: deterministic PlanCompiler + memory store + fixture ports.
 * Covers: model contamination ignore, append-only adjust, readiness projection,
 * retry default-off, cache key workspace+releaseId, A18, unit-type registration
 * boundary, no grammar interpreter.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlanProposal } from './turn-contracts.js';
import {
  assertUnitTypeRegistrationComplete,
  buildExecutionUnitCacheKey,
  createCanonicalExecutionUnitRegistry,
  ExecutionUnitRegistry,
  ExecutionUnitRegistryError,
} from './execution-unit-registry.js';
import { MemoryMarketingPlanStore } from './memory-plan-store.js';
import {
  assertNoConditionalSideEffects,
  createFixturePlanCompilerPorts,
  createProductionPlanCompiler,
  PlanCompiler,
  PlanCompilerError,
} from './plan-compiler.js';
import { projectMarketingPlanReadiness } from './plan-readiness.js';

const TS = '2026-08-08T12:00:00.000Z';

function baseProposal(overrides: Partial<PlanProposal> = {}): PlanProposal {
  return {
    goalNarrative: '小红书护理案例种草',
    whyNow: '暑期新客',
    recommendedDeliverables: [
      {
        carrier: 'note',
        platform: 'xiaohongshu',
        quantity: 1,
        purpose: '案例种草笔记',
      },
    ],
    expressionStrategy: {
      voice: '专业温和',
      promotionIntensity: 'soft',
    },
    factIntentions: ['门店地址'],
    assetIntentions: ['before_after_case'],
    assumptions: [
      { key: 'tone', statement: '少一点硬广', risk: 'low' },
    ],
    ...overrides,
  };
}

function compileInput(
  store: MemoryMarketingPlanStore,
  overrides: Record<string, unknown> = {},
) {
  const ports = createFixturePlanCompilerPorts();
  const compiler = new PlanCompiler({ store, ports });
  return {
    compiler,
    ports,
    input: {
      workspaceId: 'ws-1',
      threadId: 'thread-1',
      goalIds: ['goal-1'],
      proposal: baseProposal(),
      intentRevision: 1,
      contextBundleId: 'bundle-1',
      contextRevision: 'ctx-1',
      harnessReleaseId: 'release-1',
      now: TS,
      planId: 'plan-fixed-1',
      ...overrides,
    },
  };
}

// ─── Deterministic authority overrides model contamination ──────────────────

test('compiler ignores model quote/balance/rights/availability contamination', async () => {
  const store = new MemoryMarketingPlanStore();
  let quoteCalls = 0;
  let rightsCalls = 0;
  let modelCalls = 0;

  const ports = createFixturePlanCompilerPorts({
    quote: {
      async resolveQuote() {
        quoteCalls += 1;
        return {
          quoteRef: { id: 'authority-quote', revision: 9 },
          expiresAt: '2026-08-08T13:00:00.000Z',
          summary: { source: 'authority' },
        };
      },
    },
    rights: {
      async resolveRights() {
        rightsCalls += 1;
        return {
          rightsSummary: { status: 'authority_rights', ok: true },
          rightsRevisionIds: ['rights-auth-1'],
          assetUsages: [{ assetRef: 'a1' }],
          factUsages: [{ factRef: 'f1' }],
        };
      },
    },
    models: {
      async resolveAvailability() {
        modelCalls += 1;
        return {
          capabilitySummary: { models: ['catalog-model-1'] },
          modelRevisionIds: ['model-auth-1'],
          available: true,
        };
      },
    },
  });

  const compiler = new PlanCompiler({ store, ports });
  const result = await compiler.compile({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    proposal: baseProposal(),
    intentRevision: 1,
    contextBundleId: 'bundle-1',
    contextRevision: 'ctx-1',
    harnessReleaseId: 'release-1',
    now: TS,
    planId: 'plan-contam-1',
    modelContamination: {
      quote: { id: 'model-forged-quote', revision: 1, amount: 999 },
      quoteRef: { id: 'model-forged-quote', revision: 1 },
      balance: 0,
      rightsStatus: 'granted_by_model',
      rightsSummary: { status: 'model_lie' },
      modelAvailability: { available: false },
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
  });

  assert.equal(quoteCalls, 1);
  assert.equal(rightsCalls, 1);
  assert.equal(modelCalls, 1);
  assert.equal(result.revision.quoteRef.id, 'authority-quote');
  assert.equal(result.revision.quoteRef.revision, 9);
  assert.equal(result.revision.expiresAt, '2026-08-08T13:00:00.000Z');
  assert.deepEqual(result.revision.rightsSummary, {
    status: 'authority_rights',
    ok: true,
  });
  assert.equal(
    (result.revision.capabilitySummary as { models?: string[] }).models?.[0],
    'catalog-model-1',
  );
  assert.equal(result.revision.boundRevisions.rightsRevisionIds[0], 'rights-auth-1');
  assert.equal(result.revision.boundRevisions.modelRevisionIds[0], 'model-auth-1');
  // Model forgery must not leak into stored revision keys.
  assert.equal(
    JSON.stringify(result.revision).includes('model-forged-quote'),
    false,
  );
  assert.equal(JSON.stringify(result.revision).includes('model_lie'), false);
});

// ─── Append-only NL adjust ──────────────────────────────────────────────────

test('natural-language adjust only appends a new revision; old is intact', async () => {
  const store = new MemoryMarketingPlanStore();
  const { compiler, input } = compileInput(store, { planId: 'plan-adjust-1' });

  const first = await compiler.compile(input);
  assert.equal(first.revision.revision, 1);
  const firstHash = first.revision.contentHash;

  const second = await compiler.adjust({
    ...input,
    existingPlanId: 'plan-adjust-1',
    patch: {
      summary: '只做小红书',
      instructions: '去掉抖音，语气再自然一点',
    },
    proposal: baseProposal({
      goalNarrative: '小红书护理案例种草',
      recommendedDeliverables: [
        {
          carrier: 'note',
          platform: 'xiaohongshu',
          quantity: 1,
          purpose: '案例种草笔记',
        },
      ],
    }),
  });

  assert.equal(second.revision.revision, 2);
  assert.equal(second.revision.planId, first.revision.planId);
  assert.notEqual(second.revision.contentHash, firstHash);
  assert.match(second.revision.goal.summary, /只做小红书/);

  const revisions = await store.listRevisions('plan-adjust-1');
  assert.equal(revisions.length, 2);
  assert.equal(revisions[0]!.revision, 1);
  assert.equal(revisions[0]!.contentHash, firstHash);
  store.assertNotOverwritten('plan-adjust-1', 1, firstHash);

  // No status column on either revision.
  assert.equal('status' in revisions[0]!, false);
  assert.equal('readiness' in revisions[0]!, false);
  assert.equal('status' in revisions[1]!, false);
});

// ─── Readiness is projection only ───────────────────────────────────────────

test('readiness is projection: ready → stale → reprice_required → blocked', async () => {
  const store = new MemoryMarketingPlanStore();
  const { compiler, input } = compileInput(store, { planId: 'plan-ready-1' });
  const compiled = await compiler.compile(input);

  assert.equal(compiled.readiness, 'ready');

  assert.equal(
    projectMarketingPlanReadiness({
      revision: compiled.revision,
      facts: { contextRevision: 'ctx-2' },
      now: TS,
    }),
    'stale',
  );

  assert.equal(
    projectMarketingPlanReadiness({
      revision: compiled.revision,
      facts: { quoteExpired: true },
      now: TS,
    }),
    'reprice_required',
  );

  assert.equal(
    projectMarketingPlanReadiness({
      revision: compiled.revision,
      facts: {},
      now: '2026-08-09T12:00:00.000Z', // past default fixture expiry window if any
    }),
    // fixture ports expire 1h after nowIso at call time — bound expiresAt from compile
    Date.parse(compiled.revision.expiresAt) <=
      Date.parse('2026-08-09T12:00:00.000Z')
      ? 'reprice_required'
      : 'ready',
  );

  assert.equal(
    projectMarketingPlanReadiness({
      revision: compiled.revision,
      facts: { modelUnavailable: true },
      now: TS,
    }),
    'blocked',
  );

  // Projection never mutates revision.
  assert.equal(compiled.revision.revision, 1);
  assert.equal('readiness' in compiled.revision, false);
});

// ─── plan-as-data: retry off, dependency groups, cache key ──────────────────

test('compiled plan is data: retry default off, dependency groups, cache key has releaseId', async () => {
  const store = new MemoryMarketingPlanStore();
  const { compiler, input } = compileInput(store, {
    planId: 'plan-exec-1',
    proposal: baseProposal({
      recommendedDeliverables: [
        { carrier: 'note', platform: 'xiaohongshu', quantity: 2, purpose: '笔记' },
      ],
    }),
  });
  const result = await compiler.compile(input);
  const plan = result.executionPlan;

  assert.equal(plan.schemaVersion, 'compiled-execution-plan/v1');
  assert.ok(plan.units.length >= 4);
  assert.ok(plan.dependencyGroups.length >= 3);

  for (const unit of plan.units) {
    const retry = plan.boundedRetry[unit.unitId];
    assert.ok(retry);
    assert.equal(retry!.retry.enabled, false);
    assert.equal(retry!.maxAttempts, 1);
  }

  // Cacheable units (context.read / compliance.check) expose workspace keys.
  const cacheable = Object.entries(result.unitCacheKeys);
  assert.ok(cacheable.length >= 1);
  for (const [unitId, key] of cacheable) {
    assert.match(key, /^ws:ws-1:/);
    assert.match(key, /:rel:release-1$/);
    assert.ok(plan.units.some((unit) => unit.unitId === unitId));
  }

  // Sensitive/generation units are not cacheable by default.
  const generateUnits = plan.units.filter((unit) =>
    unit.unitType.endsWith('.generate'),
  );
  for (const unit of generateUnits) {
    assert.equal(result.unitCacheKeys[unit.unitId], undefined);
    assert.equal(plan.cachePolicies?.[unit.unitId], undefined);
  }

  // Every cacheable unit carries its own policy, not just context.read. When
  // only the context unit was wired the check unit silently lost its policy.
  const cacheableTypes = plan.units
    .filter((unit) => plan.cachePolicies?.[unit.unitId])
    .map((unit) => unit.unitType)
    .sort();
  assert.deepEqual(cacheableTypes, ['compliance.check', 'context.read']);

  // Direct cache key helper contract.
  const key = buildExecutionUnitCacheKey({
    workspaceId: 'ws-a',
    unitType: 'context.read',
    inputHash: 'abc',
    harnessReleaseId: 'rel-9',
  });
  assert.equal(key, 'ws:ws-a:unit:context.read:in:abc:rel:rel-9');
  assert.throws(
    () =>
      buildExecutionUnitCacheKey({
        workspaceId: '',
        unitType: 'context.read',
        inputHash: 'x',
        harnessReleaseId: 'rel',
      }),
    ExecutionUnitRegistryError,
  );
});

// ─── P0-C: quantity actually compiles ───────────────────────────────────────

async function compileNotePlan(quantity: number) {
  const { compiler, input } = compileInput(new MemoryMarketingPlanStore(), {
    planId: `plan-qty-${quantity}`,
    proposal: baseProposal({
      recommendedDeliverables: [
        { carrier: 'note', platform: 'xiaohongshu', quantity, purpose: '笔记' },
      ],
    }),
  });
  return (await compiler.compile(input)).executionPlan;
}

test('P0-C: requested quantity expands the repeatable step instead of producing the same plan', async () => {
  const one = await compileNotePlan(1);
  const seven = await compileNotePlan(7);

  const pageUnits = (plan: Awaited<ReturnType<typeof compileNotePlan>>) =>
    plan.units.filter((unit) => unit.unitId.startsWith('unit-note-pages'));
  assert.equal(pageUnits(one).length, 1);
  assert.equal(pageUnits(seven).length, 7);

  // Distinct unit ids, and each instance names which deliverable unit it is —
  // the executor keys its durable effects on exactly these fields.
  const ids = pageUnits(seven).map((unit) => unit.unitId);
  assert.equal(new Set(ids).size, 7);
  assert.deepEqual(
    pageUnits(seven).map(
      (unit) => (unit.input as { deliverableIndex?: number }).deliverableIndex,
    ),
    [0, 1, 2, 3, 4, 5, 6],
  );
  for (const unit of pageUnits(seven)) {
    assert.equal(
      (unit.input as { deliverableId?: string }).deliverableId,
      'd1-note',
    );
  }

  // The expanded units are scheduled, not orphaned.
  const scheduled = seven.dependencyGroups.flatMap((group) => group.unitIds);
  assert.equal(scheduled.length, seven.units.length);
  assert.equal(new Set(scheduled).size, scheduled.length);
  for (const id of ids) assert.ok(scheduled.includes(id));

  // The plan a merchant is quoted for differs; it used to be byte-identical.
  assert.notDeepEqual(one.units, seven.units);
  assert.notEqual(JSON.stringify(one), JSON.stringify(seven));
});

test('P0-C: a multi-carrier plan compiles one execution plan per carrier', async () => {
  // Restores the deliverable line that was deleted to keep this fixture
  // single-carrier, which is what hid the per-carrier constant. The Plan is
  // allowed to span carriers; one Make execution is not, so compilation splits
  // rather than rejecting the revision.
  const { compiler, input } = compileInput(new MemoryMarketingPlanStore(), {
    planId: 'plan-multi-carrier-1',
    proposal: baseProposal({
      recommendedDeliverables: [
        { carrier: 'copy', quantity: 1, purpose: '纯文案' },
        { carrier: 'note', platform: 'xiaohongshu', quantity: 2, purpose: '笔记' },
      ],
    }),
  });
  const result = await compiler.compile(input);

  assert.deepEqual(
    result.executionPlans.map((compiled) => compiled.carrier),
    ['copy', 'note'],
  );
  // Both carriers are quoted on one revision.
  assert.deepEqual(
    result.revision.deliverables.map((item) => `${item.kind}:${item.quantity}`),
    ['copy:1', 'note:2'],
  );
  // Each plan carries only its own carrier's units, so neither can execute the
  // other's steps under the wrong effect-key namespace.
  const [copyPlan, notePlan] = result.executionPlans;
  assert.ok(copyPlan && notePlan);
  for (const unit of copyPlan.executionPlan.units) {
    assert.match(unit.unitId, /^unit-copy-/);
  }
  for (const unit of notePlan.executionPlan.units) {
    assert.match(unit.unitId, /^unit-note-/);
  }
  // The note carrier asked for 2, so its repeatable step expanded to 2.
  assert.equal(
    notePlan.executionPlan.units.filter((unit) =>
      unit.unitId.startsWith('unit-note-pages'),
    ).length,
    2,
  );
  // The convenience field is the first carrier's plan, not a merged one.
  assert.deepEqual(result.executionPlan, copyPlan.executionPlan);
});

// ─── A18 + no grammar interpreter ───────────────────────────────────────────

test('A18: conditional side-effect unit types rejected; no grammar nodes', async () => {
  assert.throws(
    () =>
      new ExecutionUnitRegistry([
        {
          unitType: 'evil.conditional_write',
          description: 'illegal',
          sideEffectClass: 'bounded_write',
          mayAppearInConditional: true,
          inputSchema: createCanonicalExecutionUnitRegistry().resolve(
            'context.read',
          ).inputSchema,
          cacheDefault: { cacheable: false, reason: 'x' },
          policyTags: ['x'],
        },
      ]),
    /mayAppearInConditional|A18|sideEffectClass/u,
  );

  const store = new MemoryMarketingPlanStore();
  const { compiler, input } = compileInput(store, { planId: 'plan-a18-1' });
  const result = await compiler.compile(input);
  assert.doesNotThrow(() =>
    assertNoConditionalSideEffects(
      result.executionPlan,
      createCanonicalExecutionUnitRegistry(),
    ),
  );

  const blob = JSON.stringify(result.executionPlan);
  assert.equal(blob.includes('ConditionalNode'), false);
  assert.equal(blob.includes('grammar'), false);
  assert.equal(blob.includes('ifElse'), false);
});

// ─── Unit type registration boundary ────────────────────────────────────────

test('new unit type requires registry + schema + policy + test evidence', () => {
  const candidate = {
    unitType: 'custom.report.generate',
    description: 'Custom report',
    primitive: 'generate' as const,
    sideEffectClass: 'none' as const,
    mayAppearInConditional: false,
    inputSchema: createCanonicalExecutionUnitRegistry().resolve('copy.generate')
      .inputSchema,
    cacheDefault: {
      cacheable: false as const,
      reason: 'generation',
    },
    policyTags: ['billed', 'custom'],
  };

  assert.throws(
    () =>
      assertUnitTypeRegistrationComplete({
        definition: candidate,
        hasSchema: true,
        hasPolicy: true,
        hasTest: false,
      }),
    /missing registration test/u,
  );

  assert.doesNotThrow(() =>
    assertUnitTypeRegistrationComplete({
      definition: candidate,
      hasSchema: true,
      hasPolicy: true,
      hasTest: true,
    }),
  );

  // Canonical set is registered and resolvable.
  const registry = createCanonicalExecutionUnitRegistry();
  for (const unitType of [
    'context.read',
    'copy.generate',
    'note.generate',
    'media.generate',
    'compliance.check',
  ]) {
    assert.equal(registry.has(unitType), true);
    assert.ok(registry.resolve(unitType).policyTags.length > 0);
  }
});

// ─── Skill invocation receipt + production assembly fail-closed ─────────────

test('compiler records skill invocation receipts; production assembly requires ports', async () => {
  const store = new MemoryMarketingPlanStore();
  const { compiler, input } = compileInput(store, { planId: 'plan-skill-1' });
  const result = await compiler.compile(input);
  assert.ok(result.skillInvocationReceipts.length >= 1);
  assert.equal(result.skillInvocationReceipts[0]!.stage, 'plan_compile');
  assert.equal(
    result.skillInvocationReceipts[0]!.harnessReleaseId,
    'release-1',
  );

  assert.throws(
    () =>
      createProductionPlanCompiler({
        store,
        ports: createFixturePlanCompilerPorts({
          quote: undefined as never,
        }),
      }),
    PlanCompilerError,
  );

  const wired = createProductionPlanCompiler({
    store,
    ports: createFixturePlanCompilerPorts(),
  });
  assert.ok(wired.unitRegistry.has('copy.generate'));
});

// ─── A8: domain enums do not enter primitive signatures on units ────────────

test('harness service surface exposes compilePlan/adjustPlan after bindPlanCompiler', async () => {
  const { AgentSessionHarnessService } = await import('./service.js');
  const { FixtureAgentKernel } = await import('./agent-kernel.js');
  const { MemoryAgentSessionStore } = await import(
    './memory-agent-session-store.js'
  );

  const harness = new AgentSessionHarnessService({
    store: new MemoryAgentSessionStore(),
    kernel: new FixtureAgentKernel({
      decision: {
        merchantMessage: 'noop',
        action: { kind: 'finish_turn' as const },
        evidenceRefs: [],
        assumptions: [],
      },
    }),
    resolveRelease: async () => ({
      controlLimits: {
        maxLlmSteps: 4,
        maxToolCalls: 6,
        maxRetrievalCalls: 4,
        maxMerchantQuestions: 1,
        maxReplans: 1,
        maxSchemaRepairs: 1,
        maxContextTokens: 8_000,
        maxDelegations: 1,
      },
    }),
    registerCheckpointWriter: false,
  });

  await assert.rejects(
    () =>
      harness.compilePlan({
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        proposal: baseProposal(),
        intentRevision: 1,
        contextBundleId: 'b',
        contextRevision: '1',
        harnessReleaseId: 'r',
        now: TS,
        planId: 'plan-harness-1',
      }),
    /PlanCompiler is not bound/u,
  );

  const store = new MemoryMarketingPlanStore();
  harness.bindPlanCompiler(
    createProductionPlanCompiler({
      store,
      ports: createFixturePlanCompilerPorts(),
    }),
  );

  const compiled = await harness.compilePlan({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    proposal: baseProposal(),
    intentRevision: 1,
    contextBundleId: 'b',
    contextRevision: '1',
    harnessReleaseId: 'r',
    now: TS,
    planId: 'plan-harness-1',
  });
  assert.equal(compiled.revision.revision, 1);

  const adjusted = await harness.adjustPlan({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    existingPlanId: 'plan-harness-1',
    proposal: baseProposal(),
    patch: { summary: '减到 1 页', instructions: 'quantity 1' },
    intentRevision: 1,
    contextBundleId: 'b',
    contextRevision: '1',
    harnessReleaseId: 'r',
    now: TS,
  });
  assert.equal(adjusted.revision.revision, 2);
  assert.equal(harness.getPlanCompiler()?.unitRegistry.has('note.generate'), true);
});

test('A8: execution units use free unitType + optional six-primitive only', async () => {
  const store = new MemoryMarketingPlanStore();
  const { compiler, input } = compileInput(store, {
    planId: 'plan-a8-1',
    proposal: baseProposal({
      recommendedDeliverables: [
        { carrier: 'media', quantity: 1, purpose: '短视频' },
      ],
    }),
  });
  const result = await compiler.compile(input);
  for (const unit of result.executionPlan.units) {
    // unitType is registry string, not a domain carrier enum field on primitive.
    assert.equal(typeof unit.unitType, 'string');
    if (unit.primitive !== undefined) {
      assert.ok(
        [
          'read_context',
          'generate',
          'revise',
          'record',
          'check',
          'ask_merchant',
        ].includes(unit.primitive),
      );
    }
    // No carrier/kind domain enum smuggled onto the unit root beyond typed input.
    assert.equal('carrier' in unit, false);
    assert.equal('kind' in unit, false);
  }
});
