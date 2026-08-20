/**
 * V31-25 runner convergence tests:
 * - equivalence baseline (deliverable / settlement / recovery)
 * - kill/restart side-effect = 0
 * - carrier constructive gate (no runner fork)
 * - five-stage taxonomy demotion (D-036)
 * - D-038 five-rule constructive evidence
 * - note/media snapshot zero structured LLM
 */

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';

import {
  COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
  HARNESS_STAGES,
  type CompiledExecutionPlan,
} from '@meiye/contracts';

import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import {
  assertCarrierRegistrationComplete,
  createCanonicalCarrierUnitRecipeRegistry,
  lensToContentCarrier,
} from './carrier-unit-recipes.js';
import {
  buildExecutionPlanSnapshot,
  freezeExecutionPlanContent,
} from './execution-plan-admission.js';
import {
  assertNoGrammarInterpreter,
  createMemoryPrimitiveEffectStore,
  executeCompiledCarrierPlan,
  immediatePrimitiveEffectStore,
  resolveCompiledCarrierExecution,
} from './compiled-carrier-executor.js';
import {
  attachStageTaxonomy,
  FIVE_STAGE_TRACE_ROLE,
  STAGE_TO_PRIMITIVES,
  stageTaxonomyPayload,
} from './five-stage-trace-taxonomy.js';
import {
  POST_CONVERGENCE_PRIMITIVE_EFFECT_KEYS,
  PRE_CONVERGENCE_BASELINES,
} from './fixtures/pre-convergence-equivalence-baselines.js';
import {
  materializeMediaBriefFromSnapshot,
  materializeNoteBriefFromSnapshot,
} from './make-snapshot-consume.js';
import {
  assertZeroDuplicateSideEffects,
  buildRunnerEquivalenceSnapshot,
  diffRunnerEquivalence,
  type RunnerEquivalenceSnapshot,
} from './runner-equivalence.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import {
  type HarnessMediaStagePorts,
  type HarnessNoteStagePorts,
  type HarnessStagePorts,
  type HarnessWorkflowRuntime,
  runHarnessWorkflow,
} from './workflow-core.js';

// ─── Taxonomy / six primitives ──────────────────────────────────────────────

test('V31-25: five stages map to six-primitive mounts (D-036 demotion)', () => {
  assert.deepEqual(STAGE_TO_PRIMITIVES.intent_naming, [
    'read_context',
    'ask_merchant',
  ]);
  assert.deepEqual(STAGE_TO_PRIMITIVES.brief_compilation, ['generate']);
  assert.deepEqual(STAGE_TO_PRIMITIVES.execution_selection, [
    'generate',
    'check',
    'revise',
  ]);
  for (const stage of HARNESS_STAGES) {
    const payload = stageTaxonomyPayload(stage);
    assert.equal(payload.stageRole, FIVE_STAGE_TRACE_ROLE);
    assert.equal(payload.metricsDimension, stage);
    assert.ok(payload.adminExplanation.length > 0);
    assert.ok(payload.primitives.length > 0);
  }
});

test('V31-25: attachStageTaxonomy does not clobber existing payload keys', () => {
  const merged = attachStageTaxonomy('brief_compilation', {
    kind: 'copy',
    llmInvoked: false,
  });
  assert.equal(merged.kind, 'copy');
  assert.equal(merged.llmInvoked, false);
  assert.equal(merged.stageRole, FIVE_STAGE_TRACE_ROLE);
  assert.deepEqual(merged.primitives, ['generate']);
});

// ─── Carrier recipes + constructive gate ────────────────────────────────────

test('V31-25: canonical recipes cover copy/note/media with registered unit types', () => {
  const registry = createCanonicalCarrierUnitRecipeRegistry();
  assert.deepEqual(
    registry.list().map((r) => r.carrier).sort(),
    ['copy', 'media', 'note'],
  );
  for (const recipe of registry.list()) {
    assert.equal(recipe.plan.schemaVersion, COMPILED_EXECUTION_PLAN_SCHEMA_VERSION);
    assert.deepEqual(recipe.plan.executionCapabilities, {
      scheduling: 'serial',
      retry: 'none',
      cache: 'none',
    });
    assert.ok(recipe.plan.units.length >= 3);
    assertNoGrammarInterpreter(recipe.plan);
    assert.ok(
      recipe.plan.dependencyGroups.every((group) => group.unitIds.length === 1),
    );
    assert.deepEqual(recipe.plan.boundedRetry, {});
    assert.equal(recipe.plan.cachePolicies, undefined);
  }
  assert.equal(lensToContentCarrier('copy'), 'copy');
  assert.equal(lensToContentCarrier('image'), 'media');
  assert.equal(lensToContentCarrier('video'), 'media');
  assert.equal(lensToContentCarrier('image_text_note'), 'note');
});

test('V31-25: new carrier constructive check rejects runner-fork shape', () => {
  assert.throws(
    () =>
      assertCarrierRegistrationComplete({
        carrier: 'audio',
        hasRecipe: false,
        hasUnitTypes: true,
        hasPrimitiveHandlers: true,
        hasTest: true,
      }),
    /missing CompiledExecutionPlan recipe/,
  );
  assert.throws(
    () =>
      assertCarrierRegistrationComplete({
        carrier: 'audio',
        hasRecipe: true,
        hasUnitTypes: true,
        hasPrimitiveHandlers: false,
        hasTest: true,
      }),
    /missing primitive handlers/,
  );
  assertCarrierRegistrationComplete({
    carrier: 'copy',
    hasRecipe: true,
    hasUnitTypes: true,
    hasPrimitiveHandlers: true,
    hasTest: true,
  });
});

test('V31-25: single executor fails closed without terminal record', async () => {
  const plan = structuredClone(
    createCanonicalCarrierUnitRecipeRegistry().resolve('media').plan,
  );
  plan.units.at(-1)!.primitive = 'check';
  await assert.rejects(
    () =>
      executeCompiledCarrierPlan({
        context: { lens: 'image', frozenExecutionPlan: plan },
        programInput: { carrier: 'media' },
        primitiveHandlers: primitiveHandlersReturningNull(),
        effectStore: immediatePrimitiveEffectStore,
        executionId: 'missing-record',
      }),
    /must end with a record unit/,
  );
});

test('V31-25: resolveCompiledCarrierExecution prefers frozen plan when present', () => {
  const frozen = createCanonicalCarrierUnitRecipeRegistry().resolve('copy').plan;
  const resolution = resolveCompiledCarrierExecution({
    lens: 'copy',
    frozenExecutionPlan: frozen,
  });
  assert.equal(resolution.usedCanonicalRecipe, false);
  assert.equal(resolution.executorPath, 'compiled_plan_executor');
  assert.equal(resolution.executionPlan.units.length, frozen.units.length);
});

test('current serial executor fails closed before effects when a plan advertises unsupported promises', async () => {
  const recipe = createCanonicalCarrierUnitRecipeRegistry().resolve('copy');
  const plan = structuredClone(recipe.plan);
  plan.dependencyGroups = [
    {
      groupId: 'parallel-looking',
      unitIds: plan.units.map((unit) => unit.unitId),
    },
  ];
  plan.boundedRetry[plan.units[0]!.unitId] = {
    maxAttempts: 2,
    maxCostCents: 100,
    retry: { enabled: true, predicateRef: 'transient/v1' },
  };
  plan.cachePolicies = {
    [plan.units[0]!.unitId]: {
      ttlSeconds: 60,
      scope: 'workspace',
      dependsOn: [],
    },
  };
  const calls: string[] = [];
  const handlers = Object.fromEntries(
    [
      'read_context',
      'generate',
      'check',
      'revise',
      'record',
      'ask_merchant',
    ].map((primitive) => [
      primitive,
      async () => {
        calls.push(primitive);
        return null;
      },
    ]),
  );

  await assert.rejects(
    () =>
      executeCompiledCarrierPlan({
        context: { lens: 'copy', frozenExecutionPlan: plan },
        programInput: {},
        primitiveHandlers: handlers as never,
        effectStore: immediatePrimitiveEffectStore,
        executionId: 'unsupported-promises',
      }),
    /serial.*no retry or cache policies/i,
  );
  assert.deepEqual(calls, []);
});

test('V31-25: a plan naming a step the carrier does not implement fails closed', async () => {
  const recipe = createCanonicalCarrierUnitRecipeRegistry().resolve('copy');
  const calls: string[] = [];
  const handlers = Object.fromEntries(
    ['read_context', 'generate', 'check', 'revise', 'record', 'ask_merchant'].map(
      (primitive) => [
        primitive,
        async ({
          unit,
          priorOutputs,
        }: {
          unit: { unitId: string };
          priorOutputs: ReadonlyMap<string, unknown>;
        }) => {
          calls.push(`${primitive}:${unit.unitId}`);
          return primitive === 'record'
            ? {
                deliveredBy: unit.unitId,
                checkedBy: priorOutputs.get('unit-copy-check'),
              }
            : primitive;
        },
      ],
    ),
  );

  const first = await executeCompiledCarrierPlan({
    context: { lens: 'copy', frozenExecutionPlan: recipe.plan },
    programInput: { ignored: true },
    primitiveHandlers: handlers as never,
    effectStore: immediatePrimitiveEffectStore,
    executionId: 'mutate-first',
  });
  assert.deepEqual(first.result, {
    deliveredBy: 'unit-copy-assemble',
    checkedBy: 'check',
  });
  assert.deepEqual(calls, [
    'read_context:unit-copy-context',
    'generate:unit-copy-brief',
    'generate:unit-copy-select',
    'check:unit-copy-check',
    'record:unit-copy-assemble',
  ]);

  // Repointing a unit at a primitive the carrier never bound for that role is
  // not a "different plan", it is an unexecutable one: fail closed, run nothing.
  const mutated = structuredClone(recipe.plan);
  const check = mutated.units.find((unit) => unit.unitId === 'unit-copy-check');
  assert.ok(check);
  check.primitive = 'revise';
  calls.length = 0;
  await assert.rejects(
    () =>
      executeCompiledCarrierPlan({
        context: { lens: 'copy', frozenExecutionPlan: mutated },
        programInput: { ignored: true },
        primitiveHandlers: handlers as never,
        effectStore: immediatePrimitiveEffectStore,
        executionId: 'mutate-second',
      }),
    /names step revise:gate, which the copy carrier does not implement/,
  );
  assert.deepEqual(calls, []);
});

test('legacy v1 plan replay remains serial and does not repeat durable effects', async () => {
  const legacy = structuredClone(
    createCanonicalCarrierUnitRecipeRegistry().resolve('copy').plan,
  ) as CompiledExecutionPlan;
  delete legacy.executionCapabilities;
  legacy.boundedRetry = Object.fromEntries(
    legacy.units.map((unit) => [
      unit.unitId,
      {
        maxAttempts: 1,
        maxCostCents: 0,
        retry: { enabled: false as const },
      },
    ]),
  );
  legacy.cachePolicies = {
    [legacy.units[0]!.unitId]: {
      ttlSeconds: 60,
      scope: 'workspace',
      dependsOn: [],
    },
  };
  const calls: string[] = [];
  const handlers = Object.fromEntries(
    [
      'read_context',
      'generate',
      'check',
      'revise',
      'record',
      'ask_merchant',
    ].map((primitive) => [
      primitive,
      async ({ unit }: { unit: { unitId: string } }) => {
        calls.push(`${primitive}:${unit.unitId}`);
        return primitive === 'record' ? { delivered: true } : primitive;
      },
    ]),
  );
  const effectStore = createMemoryPrimitiveEffectStore();
  const run = () =>
    executeCompiledCarrierPlan({
      context: { lens: 'copy', frozenExecutionPlan: legacy },
      programInput: {},
      primitiveHandlers: handlers as never,
      effectStore,
      executionId: 'legacy-replay',
    });

  assert.deepEqual((await run()).result, { delivered: true });
  assert.deepEqual((await run()).result, { delivered: true });
  assert.deepEqual(calls, [
    'read_context:unit-copy-context',
    'generate:unit-copy-brief',
    'generate:unit-copy-select',
    'check:unit-copy-check',
    'record:unit-copy-assemble',
  ]);
});

test('V31-25: a plan that drops a required step or repeats a single-shot step fails closed', async () => {
  const recipe = createCanonicalCarrierUnitRecipeRegistry().resolve('note');
  const run = (plan: CompiledExecutionPlan, executionId: string) =>
    executeCompiledCarrierPlan({
      context: { lens: 'image_text_note' as const, frozenExecutionPlan: plan },
      programInput: { ignored: true },
      primitiveHandlers: {
        ...primitiveHandlersReturningNull(),
        record: async () => ({ delivered: true }),
      },
      effectStore: immediatePrimitiveEffectStore,
      executionId,
    });

  const missingCheck = structuredClone(recipe.plan) as CompiledExecutionPlan;
  missingCheck.units = missingCheck.units.filter(
    (unit) => unit.unitId !== 'unit-note-check',
  );
  missingCheck.dependencyGroups = missingCheck.dependencyGroups.filter(
    (group) => !group.unitIds.some((unitId) => unitId === 'unit-note-check'),
  );
  await assert.rejects(
    () => run(missingCheck, 'note-missing-check'),
    /omits required step check:consistency for carrier note/,
  );

  const repeatedCheck = structuredClone(recipe.plan) as CompiledExecutionPlan;
  const noteCheck = repeatedCheck.units.find(
    (unit) => unit.unitId === 'unit-note-check',
  );
  assert.ok(noteCheck);
  const duplicate = structuredClone(noteCheck);
  duplicate.unitId = 'unit-note-check-2' as typeof duplicate.unitId;
  // Insert in place: appending would move record off the tail and trip the
  // terminal-record rule instead of the repeat rule under test.
  const checkAt = repeatedCheck.units.indexOf(noteCheck) + 1;
  repeatedCheck.units = [
    ...repeatedCheck.units.slice(0, checkAt),
    duplicate,
    ...repeatedCheck.units.slice(checkAt),
  ];
  const checkGroupAt = repeatedCheck.dependencyGroups.findIndex((group) =>
    group.unitIds.includes(noteCheck.unitId),
  );
  repeatedCheck.dependencyGroups.splice(checkGroupAt + 1, 0, {
    groupId: 'g-note-check-2',
    unitIds: [duplicate.unitId],
  });
  await assert.rejects(
    () => run(repeatedCheck, 'note-repeated-check'),
    /repeats non-repeatable step check:consistency for carrier note/,
  );
});

test('V31-25 P1-H: a frozen plan from another carrier is refused for this request', async () => {
  // copy and media have identical primitive sequences AND identical step
  // catalogs, so sequence equality accepted the media plan for a copy request
  // and ran it under copy's effect-key namespacing. Plan identity is bound to
  // the executing carrier through the unit types the carrier owns.
  const registry = createCanonicalCarrierUnitRecipeRegistry();
  const copyRecipe = registry.resolve('copy');
  const mediaRecipe = registry.resolve('media');
  assert.deepEqual(copyRecipe.primitiveSequence, mediaRecipe.primitiveSequence);
  assert.deepEqual(
    copyRecipe.stepCatalog.map((step) => `${step.primitive}:${step.role}`),
    mediaRecipe.stepCatalog.map((step) => `${step.primitive}:${step.role}`),
  );

  const calls: string[] = [];
  const track = <T>(primitive: string, output: T) => async () => {
    calls.push(primitive);
    return output;
  };
  const handlers = {
    read_context: track('read_context', null),
    ask_merchant: track('ask_merchant', null),
    generate: track('generate', null),
    check: track('check', null),
    revise: track('revise', null),
    record: track('record', { delivered: true }),
  };

  await assert.rejects(
    () =>
      executeCompiledCarrierPlan({
        context: { lens: 'copy', frozenExecutionPlan: mediaRecipe.plan },
        programInput: { ignored: true },
        primitiveHandlers: handlers,
        effectStore: immediatePrimitiveEffectStore,
        executionId: 'p1h-copy-request-media-plan',
      }),
    /uses unitType media\.generate, which does not belong to the copy carrier/,
  );
  assert.deepEqual(calls, []);

  // The reverse direction is refused too, and the matching carrier still runs.
  await assert.rejects(
    () =>
      executeCompiledCarrierPlan({
        context: { lens: 'image', frozenExecutionPlan: copyRecipe.plan },
        programInput: { ignored: true },
        primitiveHandlers: handlers,
        effectStore: immediatePrimitiveEffectStore,
        executionId: 'p1h-media-request-copy-plan',
      }),
    /uses unitType copy\.generate, which does not belong to the media carrier/,
  );
  const matched = await executeCompiledCarrierPlan({
    context: { lens: 'copy', frozenExecutionPlan: copyRecipe.plan },
    programInput: { ignored: true },
    primitiveHandlers: handlers,
    effectStore: immediatePrimitiveEffectStore,
    executionId: 'p1h-copy-request-copy-plan',
  });
  assert.deepEqual(matched.result, { delivered: true });
});

// ─── P0-A: the plan directs execution (mutation evidence) ────────────────────

/**
 * Note ports whose produced version is missing one planned page. The two note
 * rubrics then disagree about the same run: `note_page_consistency` finds the
 * dropped page, `note_selected_style` finds nothing because the style that came
 * back is the style that was asked for. Nothing about the request differs
 * between the mutation runs below — only one field of one plan unit.
 */
function fixtureNoteStagesDroppingPage(pageId: string): HarnessNoteStagePorts {
  const stages = fixtureNoteStages();
  const execute = stages.executeNoteAndSelect;
  return {
    ...stages,
    async executeNoteAndSelect(input) {
      const selected = await execute(input);
      return {
        ...selected,
        version: {
          ...selected.version,
          plan: {
            ...selected.version.plan,
            pages: selected.version.plan.pages.filter(
              (page) => page.id !== pageId,
            ),
          },
        },
      };
    },
  };
}

async function runNotePlanMutation(input: {
  workflowId: string;
  mutate: (plan: CompiledExecutionPlan) => void;
  stages?: HarnessNoteStagePorts;
  effectKeys?: string[];
}) {
  const snapshot = buildTestPlanSnapshot('note', input.mutate);
  return runHarnessWorkflow(
    input.workflowId,
    {
      ...mediaTaskInput('image_text_note'),
      executionPlanSnapshot: snapshot,
    },
    input.stages ?? fixtureNoteStagesDroppingPage('page-2'),
    {
      ...recordingRuntime(input.effectKeys ?? []),
      async awaitDecision(question) {
        return noteStyleOrPaidDecision(question);
      },
    },
  );
}

function noteCheckUnit(plan: CompiledExecutionPlan) {
  const unit = plan.units.find((entry) => entry.unitId === 'unit-note-check');
  assert.ok(unit, 'note plan must carry a check unit');
  assert.ok(unit.input, 'check unit must carry declared parameters');
  return unit.input as Record<string, unknown>;
}

test('V31-25 P0-A: repointing the note check unit at another rubric changes the merchant-visible delivery', async () => {
  // Same request, same ports, same code path. The ONLY difference between the
  // two runs is units[unit-note-check].input.rubric.
  const consistency = await runNotePlanMutation({
    workflowId: 'p0a-note-rubric-consistency',
    mutate: (plan) => {
      noteCheckUnit(plan).rubric = 'note_page_consistency';
    },
  });
  const styleOnly = await runNotePlanMutation({
    workflowId: 'p0a-note-rubric-style',
    mutate: (plan) => {
      noteCheckUnit(plan).rubric = 'note_selected_style';
    },
  });

  // page-2 was planned but never produced. Under the page-consistency rubric
  // that is a partial delivery the merchant is told about; under the
  // selected-style rubric the same run is a clean delivery.
  assert.equal(consistency.merchantReport?.kind, 'partial');
  assert.match(consistency.merchantReport?.message ?? '', /没完全对上/);
  assert.equal(styleOnly.merchantReport, undefined);
  assert.notDeepEqual(consistency.merchantReport, styleOnly.merchantReport);
  // Both runs still delivered: the rubric changed the verdict, not the plumbing.
  assert.equal(consistency.delivery.packageId, 'package-1');
  assert.equal(styleOnly.delivery.packageId, 'package-1');
});

test('V31-25 P0-A: an unknown rubric on the check unit fails closed instead of defaulting', async () => {
  await assert.rejects(
    () =>
      runNotePlanMutation({
        workflowId: 'p0a-note-rubric-unknown',
        mutate: (plan) => {
          noteCheckUnit(plan).rubric = 'whatever_passes';
        },
      }),
    /declares unknown rubric whatever_passes/,
  );
});

test('V31-25 P0-A: dropping the revise unit stops the page-regeneration step from running', async () => {
  const observed: string[] = [];
  const regeneratingStages = (): HarnessNoteStagePorts => {
    const base = fixtureNoteStagesDroppingPage('page-2');
    const execute = base.executeNoteAndSelect;
    return {
      ...base,
      async executeNoteAndSelect(input) {
        const selected = await execute(input);
        return {
          ...selected,
          auditSignals: [
            {
              eventType: 'note_page_regenerated' as const,
              payload: { auditRef: 'audit-regen-1', imagePoints: 1 },
            },
          ],
        };
      },
      async recordObservabilityEvent(input) {
        observed.push(input.event.eventType);
      },
    } as HarnessNoteStagePorts;
  };

  const withRevise = await runNotePlanMutation({
    workflowId: 'p0a-note-revise-present',
    mutate: () => {},
    stages: regeneratingStages(),
  });
  assert.equal(withRevise.delivery.packageId, 'package-1');
  assert.deepEqual(observed, ['note_page_regenerated']);

  observed.length = 0;
  const withoutRevise = await runNotePlanMutation({
    workflowId: 'p0a-note-revise-absent',
    mutate: (plan) => {
      plan.units = plan.units.filter(
        (unit) => unit.unitId !== 'unit-note-revise',
      );
      plan.dependencyGroups = plan.dependencyGroups.filter(
        (group) => !group.unitIds.some((unitId) => unitId === 'unit-note-revise'),
      );
    },
    stages: regeneratingStages(),
  });
  // revise is declared optional, so removing it must not break delivery — but
  // its business effect must genuinely stop happening.
  assert.equal(withoutRevise.delivery.packageId, 'package-1');
  assert.deepEqual(observed, []);
});

test('V31-25 P0-C: a plan the real compiler produced for quantity 3 executes three page units', async () => {
  // Closes the loop the P0-A tests open by hand: the plan under test is whatever
  // PlanCompiler actually emits, so a compiler that ignores quantity fails here.
  const { PlanCompiler, createFixturePlanCompilerPorts } = await import(
    '../agent-session/plan-compiler.js'
  );
  const { MemoryMarketingPlanStore } = await import(
    '../agent-session/memory-plan-store.js'
  );
  const compiler = new PlanCompiler({
    store: new MemoryMarketingPlanStore(),
    ports: createFixturePlanCompilerPorts(),
  });
  const compiled = await compiler.compile({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    goalIds: ['goal-1'],
    proposal: {
      goalNarrative: '小红书护理案例种草',
      whyNow: '暑期新客',
      recommendedDeliverables: [
        {
          carrier: 'note',
          platform: 'xiaohongshu',
          quantity: 3,
          purpose: '案例种草笔记',
        },
      ],
      expressionStrategy: { voice: '专业温和', promotionIntensity: 'soft' },
      factIntentions: ['门店地址'],
      assetIntentions: ['before_after_case'],
      assumptions: [{ key: 'tone', statement: '少一点硬广', risk: 'low' }],
    },
    intentRevision: 1,
    contextBundleId: 'bundle-1',
    contextRevision: 'ctx-1',
    harnessReleaseId: 'release-1',
    now: '2026-08-09T12:00:00.000Z',
    planId: 'plan-p0c-exec-1',
  });

  const selectionCalls: string[] = [];
  const base = fixtureNoteStages();
  const execute = base.executeNoteAndSelect;
  const keys: string[] = [];
  // Freeze the compiler's own plan, so the snapshot hash covers it.
  const snapshot = buildTestPlanSnapshot('note', (plan) => {
    plan.units = compiled.executionPlan.units;
    plan.dependencyGroups = compiled.executionPlan.dependencyGroups;
    plan.boundedRetry = compiled.executionPlan.boundedRetry;
    if (compiled.executionPlan.cachePolicies) {
      plan.cachePolicies = compiled.executionPlan.cachePolicies;
    }
  });
  const result = await runHarnessWorkflow(
    'p0c-compiled-note-quantity-3',
    {
      ...mediaTaskInput('image_text_note'),
      executionPlanSnapshot: snapshot,
    },
    {
      ...base,
      async executeNoteAndSelect(input) {
        selectionCalls.push(input.selectedStyleId);
        return execute(input);
      },
    },
    {
      ...recordingRuntime(keys),
      async awaitDecision(question) {
        return noteStyleOrPaidDecision(question);
      },
    },
  );

  assert.equal(result.delivery.packageId, 'package-1');
  assert.equal(selectionCalls.length, 3);
  const selectionKeys = keys.filter(
    (key) => key.includes(':s4:') && key.endsWith(':selection'),
  );
  assert.equal(new Set(selectionKeys).size, 3);
});

test('V31-25 P0-A: repeating the note pages unit runs the selection port once per unit under distinct durable keys', async () => {
  const selectionCalls: string[] = [];
  const countingStages = (): HarnessNoteStagePorts => {
    const base = fixtureNoteStagesDroppingPage('page-2');
    const execute = base.executeNoteAndSelect;
    return {
      ...base,
      async executeNoteAndSelect(input) {
        selectionCalls.push(input.selectedStyleId);
        return execute(input);
      },
    };
  };
  // Stage 4 selection keys only; the stage 3 brief key also carries the kind.
  const selectionEffectKeys = (keys: string[]) =>
    [
      ...new Set(
        keys.filter(
          (key) => key.includes(':s4:') && key.endsWith(':selection'),
        ),
      ),
    ].sort();

  const singleKeys: string[] = [];
  await runNotePlanMutation({
    workflowId: 'p0a-note-pages-single',
    mutate: () => {},
    stages: countingStages(),
    effectKeys: singleKeys,
  });
  assert.equal(selectionCalls.length, 1);

  selectionCalls.length = 0;
  const expandedKeys: string[] = [];
  await runNotePlanMutation({
    workflowId: 'p0a-note-pages-expanded',
    mutate: (plan) => {
      const pages = plan.units.find(
        (unit) => unit.unitId === 'unit-note-pages',
      );
      assert.ok(pages);
      const pagesInput = pages.input as Record<string, unknown>;
      pagesInput.deliverableId = 'd1';
      pagesInput.deliverableIndex = 0;
      const second = structuredClone(pages);
      second.unitId = 'unit-note-pages-2' as typeof second.unitId;
      (second.input as Record<string, unknown>).deliverableIndex = 1;
      const unitAt = plan.units.indexOf(pages) + 1;
      plan.units = [
        ...plan.units.slice(0, unitAt),
        second,
        ...plan.units.slice(unitAt),
      ];
      const groupAt = plan.dependencyGroups.findIndex((group) =>
        group.unitIds.includes(pages.unitId),
      );
      plan.dependencyGroups.splice(groupAt + 1, 0, {
        groupId: 'g-note-pages-2',
        unitIds: [second.unitId],
      });
    },
    stages: countingStages(),
    effectKeys: expandedKeys,
  });
  // The plan asked for the step twice, so the production port ran twice under
  // two distinct durable effect keys instead of replaying one cached result.
  assert.equal(selectionCalls.length, 2);
  assert.equal(selectionEffectKeys(singleKeys).length, 1);
  assert.equal(selectionEffectKeys(expandedKeys).length, 2);
  assert.notDeepEqual(
    selectionEffectKeys(expandedKeys),
    selectionEffectKeys(singleKeys),
  );
});

function primitiveHandlersReturningNull() {
  const value = async () => null;
  return {
    read_context: value,
    ask_merchant: value,
    generate: value,
    check: value,
    revise: value,
    record: value,
  };
}

test('V31-25: production workflow has no inert handler or carrier-program fallback', () => {
  const executor = readFileSync(
    new URL('./compiled-carrier-executor.ts', import.meta.url),
    'utf8',
  );
  const workflow = readFileSync(new URL('./workflow-core.ts', import.meta.url), 'utf8');
  const dbos = readFileSync(new URL('./dbos-workflow.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(executor, /inertPrimitiveHandlers|programs\?:|programs\.resolve/);
  assert.doesNotMatch(workflow, /createCarrierProgramRegistry/);
  assert.doesNotMatch(
    workflow,
    /execute(?:Copy|Note|Media)HarnessStages\(/,
  );
  // Anti-regression for the units-as-checksum design this replaced: the old
  // executor advanced a generator and only checked that its next yield agreed
  // with the plan, so the plan could agree or abort but never direct anything.
  assert.doesNotMatch(
    workflow,
    /primitiveProgramPosition|synchronizeCarrierPrimitiveProgram|advanceCarrierPrimitive|CarrierPrimitiveProgram/,
  );
  assert.doesNotMatch(workflow, /async function\* create\w+CarrierBusinessProgram/);
  assert.match(workflow, /createCarrierStepMachine/);
  assert.match(workflow, /primitiveHandlers:/);
  assert.match(dbos, /legacyShadowObservationReader\.read\(/);
  assert.doesNotMatch(dbos, /projectLegacyFromMakeRequest|observedRightsRefs/);
  assert.doesNotMatch(dbos, /observeLegacyHarnessDeterministicFields/);
  const shadowBlock = dbos.slice(
    dbos.indexOf('V31-13: sample shadow reconcile'),
    dbos.indexOf('V31-23 L0.5: production quick-check'),
  );
  assert.doesNotMatch(
    shadowBlock,
    /runHarnessWorkflow|resolveExecutionPlanLiveFacts|executionConfirmation|billing|ports\b|runtime\b/,
  );
});

test('V31-13 P1-G: compiled path embeds shadow evidence in the five-stage trace', async () => {
  const traces: Array<{ stage: string; payload: Record<string, unknown> }> = [];
  const baseRequest = mediaTaskInput('image_text_note');
  const executionSnapshot = baseRequest.executionSnapshot!;
  const result = await runHarnessWorkflow(
    'p1g-compiled-shadow-sample',
    {
      ...baseRequest,
      executionPlanSnapshot: buildTestPlanSnapshot('note'),
      executionSnapshot: {
        ...executionSnapshot,
        deliverable: { ...executionSnapshot.deliverable!, quantity: 7 },
        deliverables: executionSnapshot.deliverables.map((deliverable) => ({
          ...deliverable,
          quantity: 7,
        })),
      },
    },
    fixtureNoteStages(),
    {
      ...recordingRuntime([]),
      async recordTrace(input) {
        traces.push({
          stage: input.stage,
          payload: input.payload as Record<string, unknown>,
        });
      },
      async awaitDecision(question) {
        return noteStyleOrPaidDecision(question);
      },
    },
    // No forceLegacyFiveStage: this is the normal production path.
  );

  assert.equal(result.delivery.packageId, 'package-1');
  // The projection comes from the merchant's creation snapshot, not from the
  // frozen plan the new chain is compared against.
  assert.deepEqual(
    traces.map(({ stage }) => stage),
    [
      'intent_naming',
      'context_injection',
      'brief_compilation',
      'execution_selection',
      'assembly_delivery',
    ],
  );
  const observation = traces.find(
    ({ stage }) => stage === 'context_injection',
  )?.payload.legacyShadowObservation as
    | { deliverables: unknown; quoteRef: unknown }
    | undefined;
  assert.ok(observation);
  assert.deepEqual(observation.deliverables, [
    { kind: 'note', quantity: 7 },
  ]);
  assert.deepEqual(observation.quoteRef, {
    id: 'quote-1',
    revision: 'quote-r1',
  });
});

test('V31-25: corrupting the compiled plan fails closed instead of executing', async () => {
  const snapshot = buildTestPlanSnapshot('copy');
  const corruptedRequest: HarnessWorkflowInput = {
    ...taskInput(),
    executionPlanSnapshot: {
      ...snapshot,
      executionPlan: {
        ...snapshot.executionPlan,
        units: snapshot.executionPlan.units.map((unit, index) =>
          index === 0 ? { ...unit, primitive: 'revise' as const } : unit,
        ),
      },
    },
  };
  await assert.rejects(
    () =>
      runHarnessWorkflow(
        'compiled-program-corrupted',
        corruptedRequest,
        fixtureCopyStages(),
        recordingRuntime([]),
      ),
    /names step revise:context, which the copy carrier does not implement/,
  );
});

test('V31-13: legacy shadow reads exact multi-page durable projection without executing a runner', async () => {
  const { parseLegacyShadowObservation } = await import(
    './legacy-shadow-observation-reader.js'
  );
  const observed = parseLegacyShadowObservation({
    deliverables: [{ kind: 'note', quantity: 7 }],
    factRefs: ['fact-1'],
    rightsRefs: ['asset-1:allowed'],
    quoteRef: { id: 'quote-1', revision: 'legacy-r1' },
    bounds: {
      maxIterations: 8,
      maxCostCents: 500,
      maxWallClockMs: 60_000,
      maxDelegations: 2,
    },
  });
  assert.equal(observed?.deliverables[0]?.quantity, 7);
});

test('V31-25: durable topology baseline includes compiled primitive effects', () => {
  const recovery = buildRunnerEquivalenceSnapshot({
    result: { delivery: { packageId: 'p', versionId: 'v', revision: 1 } },
    effectKeys: ['compiled-primitive:run:unit-context', 'business-write'],
  }).recovery;
  assert.deepEqual(recovery.effectKeys, [
    'business-write',
    'compiled-primitive:run:unit-context',
  ]);
});

test('V31-25: durable primitive effects survive executor restart without duplicate writes', async () => {
  const store = createMemoryPrimitiveEffectStore();
  let contextReads = 0;
  let businessWrites = 0;
  let killOnce = true;
  const handlers = {
    read_context: async () => ({ readNumber: ++contextReads }),
    generate: async () => {
      if (killOnce) {
        killOnce = false;
        throw new Error('simulated worker kill');
      }
      return null;
    },
    check: async () => null,
    revise: async () => null,
    ask_merchant: async () => null,
    record: async () => ({ writeNumber: ++businessWrites }),
  };
  const run = () =>
    executeCompiledCarrierPlan({
      context: { lens: 'copy' as const },
      programInput: { ignored: true },
      primitiveHandlers: handlers,
      effectStore: store,
      executionId: 'durable-run-1',
    });

  await assert.rejects(run, /simulated worker kill/);
  const afterRestart = await run();
  const replay = await run();
  assert.deepEqual(replay.result, afterRestart.result);
  assert.equal(contextReads, 1);
  assert.equal(businessWrites, 1);
});

test('V31-25: production workflow self-durable record survives kill after business commit exactly once', async () => {
  const completed = new Map<string, unknown>();
  let killAfterCommit = true;
  let deliveryWrites = 0;
  const stages = fixtureCopyStages();
  const deliver = stages.assembleAndDeliver;
  stages.assembleAndDeliver = async (input) => {
    deliveryWrites += 1;
    return deliver(input);
  };
  const runtime: HarnessWorkflowRuntime = {
    ...recordingRuntime([]),
    async runStep(key, operation) {
      if (completed.has(key)) return completed.get(key) as never;
      const output = await operation();
      completed.set(key, output);
      if (key.includes(':s5:package:') && killAfterCommit) {
        killAfterCommit = false;
        throw new Error('worker killed after durable delivery commit');
      }
      return output;
    },
  };
  const run = () =>
    runHarnessWorkflow(
      'self-durable-record',
      taskInput(),
      stages,
      runtime,
    );

  await assert.rejects(run, /worker killed after durable delivery commit/);
  const restarted = await run();
  const replayed = await run();
  assert.deepEqual(replayed, restarted);
  assert.equal(deliveryWrites, 1);
});

test('V31-25: production primitive topology never nests a durable step', async () => {
  let depth = 0;
  let maximumDepth = 0;
  const runtime: HarnessWorkflowRuntime = {
    ...recordingRuntime([]),
    async runStep(_key, operation) {
      depth += 1;
      maximumDepth = Math.max(maximumDepth, depth);
      assert.equal(depth, 1, 'nested durable step');
      try {
        return await operation();
      } finally {
        depth -= 1;
      }
    },
  };
  await runHarnessWorkflow(
    'no-nested-primitive-step',
    taskInput(),
    fixtureCopyStages(),
    runtime,
  );
  assert.equal(maximumDepth, 1);
});

// ─── Equivalence baseline + kill/restart ─────────────────────────────────────

/**
 * REAL before/after comparison (V31-25, P1-b).
 *
 * PRE_CONVERGENCE_BASELINES are frozen snapshots captured by running the
 * exact fixture task set through the PRE-CONVERGENCE runHarnessWorkflow entry
 * at git commit 64bdaded8^ (prelude + descriptor.execute direct dispatch —
 * the old five-stage runner entry). The post-convergence suite below runs the
 * SAME fixture tasks through the CURRENT single-executor entry and asserts
 * deliverable / settlement / recovery semantics are field-for-field equal.
 *
 * What this proves: the convergence did not change business behavior for any
 * fixture while adding the durable six-primitive topology. The comparison
 * keeps the fixed pre-convergence business effects and explicitly adds every
 * compiled primitive effect key produced by the current executor.
 */
type FixtureTaskId = keyof typeof PRE_CONVERGENCE_BASELINES;

type FixtureAwaitDecision = (
  question: Parameters<HarnessWorkflowRuntime['awaitDecision']>[0],
  stage: Parameters<HarnessWorkflowRuntime['awaitDecision']>[1],
) => Awaited<ReturnType<NonNullable<HarnessWorkflowRuntime['awaitDecision']>>>;

const FIXTURE_TASKS: Record<
  FixtureTaskId,
  {
    workflowId: string;
    buildRequest: () => HarnessWorkflowInput;
    buildStages: () =>
      | HarnessStagePorts
      | HarnessNoteStagePorts
      | HarnessMediaStagePorts;
    awaitDecision?: FixtureAwaitDecision;
  }
> = {
  'copy-legacy': {
    workflowId: 'v31-25-copy-legacy',
    buildRequest: () => taskInput(),
    buildStages: () => fixtureCopyStages(),
  },
  'note-legacy': {
    workflowId: 'v31-25-note-legacy',
    buildRequest: () => mediaTaskInput('image_text_note'),
    buildStages: () => fixtureNoteStages(),
    awaitDecision: noteStyleOrPaidDecision,
  },
  'media-legacy': {
    workflowId: 'v31-25-media-legacy',
    buildRequest: () => mediaTaskInput('image'),
    buildStages: () => fixtureMediaStages(),
    awaitDecision: approvePaid,
  },
  'copy-snapshot': {
    workflowId: 'v31-25-copy-snapshot',
    buildRequest: () => ({
      ...taskInput(),
      rawInput: '把门店活动做成能发的文案',
      intent: {
        context: {
          workId: 'work-1',
          intent: '把门店活动做成能发的文案',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
      executionPlanSnapshot: buildTestPlanSnapshot('copy'),
    }),
    buildStages: () => fixtureCopyStages(),
  },
  'note-snapshot': {
    workflowId: 'v31-25-note-snapshot',
    buildRequest: () => ({
      ...mediaTaskInput('image_text_note'),
      executionPlanSnapshot: buildTestPlanSnapshot('note'),
    }),
    buildStages: () => fixtureNoteStages(),
    awaitDecision: noteStyleOrPaidDecision,
  },
  'media-snapshot': {
    workflowId: 'v31-25-media-snapshot',
    buildRequest: () => ({
      ...mediaTaskInput('image'),
      executionPlanSnapshot: buildTestPlanSnapshot('media'),
    }),
    buildStages: () => fixtureMediaStages(),
    awaitDecision: approvePaid,
  },
};

/**
 * Run one fixture task through the CURRENT (post-convergence) entry and
 * return its deliverable / settlement / recovery equivalence snapshot.
 */
async function runFixtureSnapshot(fixtureId: FixtureTaskId) {
  const fixture = FIXTURE_TASKS[fixtureId];
  const keys: string[] = [];
  const progress: Array<{ stage: string; state: string }> = [];
  const traces: Array<{ stage: string }> = [];
  const result = await runHarnessWorkflow(
    fixture.workflowId,
    fixture.buildRequest(),
    fixture.buildStages(),
    {
      ...recordingRuntime(keys),
      ...(fixture.awaitDecision
        ? {
            awaitDecision: async (
              question: Parameters<HarnessWorkflowRuntime['awaitDecision']>[0],
              stage: Parameters<HarnessWorkflowRuntime['awaitDecision']>[1],
            ) => fixture.awaitDecision!(question, stage),
          }
        : {}),
      async progress(event) {
        progress.push({ stage: event.stage, state: event.state });
      },
      async recordTrace(input) {
        traces.push({ stage: input.stage });
      },
    },
  );
  return buildRunnerEquivalenceSnapshot({
    result,
    effectKeys: keys,
    progress,
    traces,
  });
}

async function collectFixtureEffectKeys(fixtureId: FixtureTaskId) {
  const fixture = FIXTURE_TASKS[fixtureId];
  const keys: string[] = [];
  await runHarnessWorkflow(
    fixture.workflowId,
    fixture.buildRequest(),
    fixture.buildStages(),
    {
      ...recordingRuntime(keys),
      ...(fixture.awaitDecision
        ? {
            awaitDecision: async (
              question: Parameters<HarnessWorkflowRuntime['awaitDecision']>[0],
              stage: Parameters<HarnessWorkflowRuntime['awaitDecision']>[1],
            ) => fixture.awaitDecision!(question, stage),
          }
        : {}),
    },
  );
  return keys;
}

/**
 * Set only when this suite runs against the PRE-convergence commit to capture
 * baselines. At that commit there are no compiled-primitive markers, so the
 * expectation is the raw baseline. Separate from the output path on purpose: the
 * one env var used to mean both "where to write" and "which expectation", so a
 * normal CI run silently took the derived expectation.
 */
const capturingPreConvergenceBaseline =
  process.env.V31_PRE_CONVERGENCE_BASELINE_CAPTURE === '1';

function assertMatchesPreConvergenceBaseline(
  fixtureId: FixtureTaskId,
  actual: RunnerEquivalenceSnapshot,
) {
  const expected = capturingPreConvergenceBaseline
    ? PRE_CONVERGENCE_BASELINES[fixtureId]
    : expectedCurrentTopology(fixtureId);
  const mismatches = diffRunnerEquivalence(expected, actual);
  assert.deepEqual(
    mismatches,
    [],
    `${fixtureId} diverged from pre-convergence baseline (64bdaded8^): ${JSON.stringify(mismatches)}`,
  );
}

/**
 * Pre-convergence business effects (frozen, real provenance) plus the pinned
 * post-convergence primitive markers. Neither half is read from the production
 * resolver, so a topology change fails instead of moving the expectation.
 */
function expectedCurrentTopology(
  fixtureId: FixtureTaskId,
): RunnerEquivalenceSnapshot {
  const baseline = PRE_CONVERGENCE_BASELINES[fixtureId];
  return {
    ...baseline,
    recovery: {
      ...baseline.recovery,
      effectKeys: [
        ...baseline.recovery.effectKeys,
        ...POST_CONVERGENCE_PRIMITIVE_EFFECT_KEYS[fixtureId],
      ].sort(),
    },
  };
}

test('V31-25: every fixture task matches its frozen pre-convergence baseline (deliverable/settlement/recovery)', async () => {
  // True before/after: same fixture task set, pre-convergence code (64bdaded8^)
  // vs post-convergence code, compared field-by-field. Includes both the LLM
  // five-stage paths (copy/note/media) and the executionPlanSnapshot
  // (snapshot-consume) paths. Note: this covers deliverable, billing/settlement
  // markers, effect idempotency keys, progress sequence and trace stage names;
  // it does not compare trace payload decoration (D-036 taxonomy fields were
  // added by the convergence commit and are pinned by their own test).
  const generated: Partial<Record<FixtureTaskId, RunnerEquivalenceSnapshot>> = {};
  for (const fixtureId of Object.keys(PRE_CONVERGENCE_BASELINES) as FixtureTaskId[]) {
    generated[fixtureId] = await runFixtureSnapshot(fixtureId);
  }
  // Write before asserting: the generator script's whole job is to capture
  // baselines, and asserting first meant a capture run that disagreed with the
  // checked-in file produced no output at all — the script could never bootstrap
  // or update a baseline.
  if (process.env.V31_PRE_CONVERGENCE_BASELINE_OUTPUT) {
    writeFileSync(
      process.env.V31_PRE_CONVERGENCE_BASELINE_OUTPUT,
      `${JSON.stringify(generated, null, 2)}\n`,
      'utf8',
    );
  }
  for (const [fixtureId, actual] of Object.entries(generated) as Array<
    [FixtureTaskId, RunnerEquivalenceSnapshot]
  >) {
    assertMatchesPreConvergenceBaseline(fixtureId, actual);
  }
});

test('V31-25 P1-F: the recovery expectation is pinned, not read back from the production resolver', async () => {
  // Drift guard for the guard: if the pinned primitive keys were derived from
  // resolveCompiledCarrierExecution again, adding a unit to a carrier recipe
  // would silently move the expectation. Here the pinned list is compared to the
  // live resolver, and a mismatch is a deliberate-update signal rather than a
  // self-fulfilling pass.
  for (const fixtureId of Object.keys(PRE_CONVERGENCE_BASELINES) as FixtureTaskId[]) {
    const fixture = FIXTURE_TASKS[fixtureId];
    const request = fixture.buildRequest();
    const resolution = resolveCompiledCarrierExecution({
      lens: request.executionSnapshot?.lens,
      frozenExecutionPlan: request.executionPlanSnapshot?.executionPlan,
    });
    assert.deepEqual(
      [...POST_CONVERGENCE_PRIMITIVE_EFFECT_KEYS[fixtureId]],
      resolution.executionPlan.units.map(
        (unit) => `compiled-primitive:${fixture.workflowId}:${unit.unitId}`,
      ),
      `${fixtureId}: carrier topology changed; update POST_CONVERGENCE_PRIMITIVE_EFFECT_KEYS deliberately`,
    );
  }
});

test('V31-25: equivalence comparison detects a mutated generated baseline', async () => {
  const actual = await runFixtureSnapshot('copy-legacy');
  const mutated = structuredClone(actual);
  if (!mutated.deliverable.delivery) throw new Error('fixture must deliver');
  mutated.deliverable.delivery.packageId = 'mutated-package';
  assert.ok(
    diffRunnerEquivalence(PRE_CONVERGENCE_BASELINES['copy-legacy'], mutated)
      .some((item) => item.path === 'deliverable.delivery.packageId'),
  );
});

test('V31-25: kill/restart replay of every fixture lands on the pre-convergence effect key multiset', async () => {
  // Recovery semantics: a durable replay must emit the same effect idempotency
  // keys as the pre-convergence runner — first run, replay run, and the
  // 64bdaded8^ baseline must all agree (multiset). Zero duplicate side effects
  // is asserted per fixture here (redundant with the single-fixture test below
  // but now proven for the full fixture task set).
  for (const fixtureId of Object.keys(PRE_CONVERGENCE_BASELINES) as FixtureTaskId[]) {
    const firstKeys = await collectFixtureEffectKeys(fixtureId);
    const secondKeys = await collectFixtureEffectKeys(fixtureId);
    assertZeroDuplicateSideEffects({
      firstEffectKeys: firstKeys,
      secondEffectKeys: secondKeys,
    });
    assert.deepEqual(
      firstKeys.sort(),
      [...expectedCurrentTopology(fixtureId).recovery.effectKeys].sort(),
      `${fixtureId} replay effect keys drifted from pre-convergence baseline`,
    );
  }
});

test('V31-25: copy fixture equivalence baseline is stable across dual runs', async () => {
  const first = await runCopyFixture('task-v31-25-copy-a');
  const second = await runCopyFixture('task-v31-25-copy-b');
  // Same fixture semantics (different workflow ids only affect effect key prefix).
  const a = stripWorkflowIds(first.snapshot);
  const b = stripWorkflowIds(second.snapshot);
  assert.deepEqual(diffRunnerEquivalence(a, b), []);
  assert.equal(a.deliverable.outcome, 'delivered');
  assert.equal(a.deliverable.delivery?.packageId, 'package-1');
  assert.equal(a.settlement.cancelled, false);
});

/**
 * V31-25 P1-E: a real restart, counted.
 *
 * The two tests around this one run the workflow twice with a fresh
 * non-durable runtime and compare effect-key multisets. Two independent runs
 * trivially produce the same keys, so those tests cannot detect duplication:
 * nothing crashes, nothing survives, and no port invocation is counted. Here a
 * single durable store survives the kill, the restart resumes against it, and
 * every business port is counted across both attempts.
 */
function durableRestartRuntime(input: {
  completed: Map<string, unknown>;
  keys: string[];
  killAt?: (key: string) => boolean;
}): HarnessWorkflowRuntime {
  return {
    ...recordingRuntime(input.keys),
    async runStep(key, operation) {
      if (input.completed.has(key)) {
        return structuredClone(input.completed.get(key)) as never;
      }
      const output = await operation();
      input.completed.set(key, structuredClone(output));
      if (input.killAt?.(key)) {
        throw new Error(`worker killed after ${key}`);
      }
      return output;
    },
    async awaitDecision(question) {
      return noteStyleOrPaidDecision(question);
    },
  };
}

type NotePortCounts = {
  compileNoteBrief: number;
  executeNoteAndSelect: number;
  assembleNoteAndDeliver: number;
  recordExecutionAssemblyStep: number;
};

function countingNoteStages(): {
  stages: HarnessNoteStagePorts;
  calls: NotePortCounts;
} {
  const calls: NotePortCounts = {
    compileNoteBrief: 0,
    executeNoteAndSelect: 0,
    assembleNoteAndDeliver: 0,
    recordExecutionAssemblyStep: 0,
  };
  const base = fixtureNoteStages();
  return {
    calls,
    stages: {
      ...base,
      async compileNoteBrief(portInput) {
        calls.compileNoteBrief += 1;
        return base.compileNoteBrief(portInput);
      },
      async executeNoteAndSelect(portInput) {
        calls.executeNoteAndSelect += 1;
        return base.executeNoteAndSelect(portInput);
      },
      async assembleNoteAndDeliver(portInput) {
        calls.assembleNoteAndDeliver += 1;
        return base.assembleNoteAndDeliver(portInput);
      },
      async recordExecutionAssemblyStep() {
        calls.recordExecutionAssemblyStep += 1;
      },
    },
  };
}

test('V31-25 P1-E: a real kill and restart invokes no note port more often than a clean run', async () => {
  const noteRequest = () => mediaTaskInput('image_text_note');

  // Baseline: one clean uninterrupted run through the same durable runtime.
  const clean = countingNoteStages();
  const cleanResult = await runHarnessWorkflow(
    'p1e-note-clean',
    noteRequest(),
    clean.stages,
    durableRestartRuntime({ completed: new Map(), keys: [] }),
  );
  assert.equal(cleanResult.delivery.packageId, 'package-1');
  assert.ok(
    clean.calls.executeNoteAndSelect > 0 && clean.calls.compileNoteBrief > 0,
    'baseline must actually exercise the paid ports',
  );

  for (const killAfter of [
    ':s3:image_text_note:',
    ':s4:image_text_note:selection',
    ':s5:package:',
  ]) {
    const { stages, calls } = countingNoteStages();
    // One durable store shared by the killed attempt and the restart.
    const completed = new Map<string, unknown>();
    let killArmed = true;
    const workflowId = `p1e-note-restart-${killAfter.replaceAll(':', '-')}`;
    const run = (killAt?: (key: string) => boolean) =>
      runHarnessWorkflow(
        workflowId,
        noteRequest(),
        stages,
        durableRestartRuntime({
          completed,
          keys: [],
          ...(killAt ? { killAt } : {}),
        }),
      );

    await assert.rejects(
      () =>
        run((key) => {
          if (!killArmed || !key.includes(killAfter)) return false;
          killArmed = false;
          return true;
        }),
      /worker killed after/,
      `${killAfter}: the kill must actually interrupt the run`,
    );
    assert.equal(killArmed, false, `${killAfter}: kill never fired`);

    const restarted = await run();
    assert.equal(restarted.delivery.packageId, 'package-1');
    assert.deepEqual(
      calls,
      clean.calls,
      `${killAfter}: restart changed port invocation counts`,
    );
  }
});

test('V31-25 P1-E: a real kill and restart does not re-run the media billing promotion', async () => {
  // finalizeMerchantExecution promotes the reserved charge, so a duplicate here
  // is a double charge. It is counted across a real restart rather than inferred
  // from effect-key equality.
  const noteRequest = () => mediaTaskInput('image');
  const build = () => {
    const calls = {
      compileMediaBrief: 0,
      executeMediaAndSelect: 0,
      assembleMediaAndDeliver: 0,
      finalizeMerchantExecution: 0,
    };
    const base = fixtureMediaStages();
    const stages: HarnessMediaStagePorts = {
      ...base,
      async compileMediaBrief(portInput) {
        calls.compileMediaBrief += 1;
        return base.compileMediaBrief(portInput);
      },
      async executeMediaAndSelect(portInput) {
        calls.executeMediaAndSelect += 1;
        return base.executeMediaAndSelect(portInput);
      },
      async assembleMediaAndDeliver(portInput) {
        calls.assembleMediaAndDeliver += 1;
        return base.assembleMediaAndDeliver(portInput);
      },
    };
    return { stages, calls };
  };
  const runtimeFor = (
    calls: { finalizeMerchantExecution: number },
    completed: Map<string, unknown>,
    killAt?: (key: string) => boolean,
  ): HarnessWorkflowRuntime => ({
    ...durableRestartRuntime({
      completed,
      keys: [],
      ...(killAt ? { killAt } : {}),
    }),
    async awaitDecision(question) {
      return approvePaid(question);
    },
    async finalizeMerchantExecution() {
      calls.finalizeMerchantExecution += 1;
    },
  });

  const clean = build();
  await runHarnessWorkflow(
    'p1e-media-clean',
    noteRequest(),
    clean.stages,
    runtimeFor(clean.calls, new Map()),
  );

  for (const killAfter of [':s4:image:selection', ':s5:package:']) {
    const { stages, calls } = build();
    const completed = new Map<string, unknown>();
    let killArmed = true;
    const workflowId = `p1e-media-restart-${killAfter.replaceAll(':', '-')}`;
    await assert.rejects(
      () =>
        runHarnessWorkflow(
          workflowId,
          noteRequest(),
          stages,
          runtimeFor(calls, completed, (key) => {
            if (!killArmed || !key.includes(killAfter)) return false;
            killArmed = false;
            return true;
          }),
        ),
      /worker killed after/,
    );
    assert.equal(killArmed, false, `${killAfter}: kill never fired`);
    const restarted = await runHarnessWorkflow(
      workflowId,
      noteRequest(),
      stages,
      runtimeFor(calls, completed),
    );
    assert.equal(restarted.delivery.packageId, 'package-1');
    assert.deepEqual(
      calls,
      clean.calls,
      `${killAfter}: restart changed media port invocation counts`,
    );
  }
});

test('V31-25: kill/restart replay yields zero duplicate side effects', async () => {
  const keys: string[] = [];
  const stages = fixtureCopyStages();
  const runtime = recordingRuntime(keys);
  await runHarnessWorkflow('task-v31-25-replay', taskInput(), stages, runtime);
  const firstKeys = [...keys];
  // Second run with same effect keys (simulates durable replay store that
  // still invokes runStep with identical keys — multiset must match).
  const keys2: string[] = [];
  const runtime2 = recordingRuntime(keys2);
  await runHarnessWorkflow('task-v31-25-replay', taskInput(), stages, runtime2);
  assertZeroDuplicateSideEffects({
    firstEffectKeys: firstKeys,
    secondEffectKeys: keys2,
  });
});

test('V31-25: note + media fixtures share progress stage taxonomy', async () => {
  const noteProgress: string[] = [];
  const mediaProgress: string[] = [];
  await runHarnessWorkflow(
    'task-v31-25-note',
    mediaTaskInput('image_text_note'),
    fixtureNoteStages(),
    {
      ...recordingRuntime([]),
      async progress(event) {
        noteProgress.push(`${event.stage}:${event.state}`);
      },
      async awaitDecision(question) {
        if (question.response.field === 'note_style') {
          return {
            idempotencyKey: `style:${question.questionId}`,
            questionId: question.questionId,
            workflowRevision: question.workflowRevision,
            patch: {
              field: question.response.field,
              value: 'story',
              reason: question.response.reason,
            },
            decision: { state: 'accepted', value: 'story' },
          };
        }
        return approvePaid(question);
      },
    },
  );
  await runHarnessWorkflow(
    'task-v31-25-media',
    mediaTaskInput('image'),
    fixtureMediaStages(),
    {
      ...recordingRuntime([]),
      async progress(event) {
        mediaProgress.push(`${event.stage}:${event.state}`);
      },
      async awaitDecision(question) {
        return approvePaid(question);
      },
    },
  );
  assert.ok(noteProgress.some((p) => p.startsWith('brief_compilation:')));
  assert.ok(mediaProgress.some((p) => p.startsWith('execution_selection:')));
  assert.ok(noteProgress.some((p) => p.startsWith('assembly_delivery:')));
  assert.ok(mediaProgress.some((p) => p.startsWith('assembly_delivery:')));
});

test('V31-25: stage traces include D-036 taxonomy fields', async () => {
  const traces: Array<{ stage: string; payload: Record<string, unknown> }> = [];
  await runHarnessWorkflow(
    'task-v31-25-taxonomy',
    taskInput(),
    fixtureCopyStages(),
    {
      ...recordingRuntime([]),
      async recordTrace(input) {
        traces.push({
          stage: input.stage,
          payload: input.payload as Record<string, unknown>,
        });
      },
    },
  );
  assert.ok(traces.length >= 3);
  for (const t of traces) {
    assert.equal(t.payload.stageRole, FIVE_STAGE_TRACE_ROLE);
    assert.equal(t.payload.metricsDimension, t.stage);
    assert.equal(t.payload.executorPath, 'compiled_plan_executor');
    assert.ok(Array.isArray(t.payload.primitives));
  }
});

// ─── Snapshot materialize note/media ────────────────────────────────────────

test('V31-25: materialize note/media brief from snapshot is deterministic and llm-free', () => {
  const snapshot = buildTestPlanSnapshot('note');
  const note = materializeNoteBriefFromSnapshot({
    snapshot,
    declaration: {
      normalizedIntent: '护理科普图文',
      taskType: 'routine_marketing_materials',
      deliveryLayer: 'finished_media',
      relevantAssetCategories: ['store'],
      usedAssetCategories: ['store'],
      route: 'customized',
      routingSource: 'policy',
      implicitConstraints: [],
    },
    request: mediaTaskInput('image_text_note'),
  });
  assert.equal(note.llmInvoked, false);
  assert.equal(note.brief.kind, 'image_text_note');
  assert.ok(note.brief.candidates.candidates.length >= 2);

  const media = materializeMediaBriefFromSnapshot({
    snapshot: buildTestPlanSnapshot('media'),
    declaration: {
      normalizedIntent: '门店活动海报',
      taskType: 'routine_marketing_materials',
      deliveryLayer: 'finished_media',
      relevantAssetCategories: ['store'],
      usedAssetCategories: ['store'],
      route: 'customized',
      routingSource: 'policy',
      implicitConstraints: [],
    },
    request: mediaTaskInput('image'),
  });
  assert.equal(media.llmInvoked, false);
  assert.equal(media.brief.kind, 'image');
});

test('V31-25: note snapshot path does not call compileNoteBrief', async () => {
  const snapshot = buildTestPlanSnapshot('note');
  let compileCalls = 0;
  const stages = fixtureNoteStages();
  stages.compileNoteBrief = async () => {
    compileCalls += 1;
    throw new Error('snapshot path must not call compileNoteBrief');
  };
  const request: HarnessWorkflowInput = {
    ...mediaTaskInput('image_text_note'),
    executionPlanSnapshot: snapshot,
  };
  const result = await runHarnessWorkflow(
    'task-v31-25-note-snap',
    request,
    stages,
    {
      ...recordingRuntime([]),
      async awaitDecision(question) {
        if (question.response.field === 'note_style') {
          const styleId = question.options[0]?.id ?? 'practical_guide';
          return {
            idempotencyKey: `style:${question.questionId}`,
            questionId: question.questionId,
            workflowRevision: question.workflowRevision,
            patch: {
              field: question.response.field,
              value: styleId,
              reason: question.response.reason,
            },
            decision: { state: 'accepted', value: styleId },
          };
        }
        return approvePaid(question);
      },
    },
  );
  assert.equal(compileCalls, 0);
  assert.ok(result.delivery);
});

test('V31-25: media snapshot path does not call compileMediaBrief', async () => {
  const snapshot = buildTestPlanSnapshot('media');
  let compileCalls = 0;
  const stages = fixtureMediaStages();
  stages.compileMediaBrief = async () => {
    compileCalls += 1;
    throw new Error('snapshot path must not call compileMediaBrief');
  };
  // No usageReservation ⇒ no paid confirmation hold (existing unpaid path).
  const request: HarnessWorkflowInput = {
    ...mediaTaskInput('image'),
    executionPlanSnapshot: snapshot,
  };
  const result = await runHarnessWorkflow(
    'task-v31-25-media-snap',
    request,
    stages,
    {
      ...recordingRuntime([]),
      async awaitDecision() {
        throw new Error('Unpaid media snapshot must not wait for confirmation');
      },
    },
  );
  assert.equal(compileCalls, 0);
  assert.ok(result.delivery);
});

// ─── D-038 five rules (constructive evidence) ───────────────────────────────

test('V31-25 D-038①: workflow-core kernel stays free of @dbos-inc import', async () => {
  const fs = await import('node:fs/promises');
  const path = new URL('./workflow-core.ts', import.meta.url);
  const source = await fs.readFile(path, 'utf8');
  assert.equal(
    /from ['"]@dbos-inc\//.test(source) || /require\(['"]@dbos-inc\//.test(source),
    false,
  );
  // compiled executor is also runtime-agnostic
  const execPath = new URL('./compiled-carrier-executor.ts', import.meta.url);
  const execSource = await fs.readFile(execPath, 'utf8');
  assert.equal(/@dbos-inc\//.test(execSource), false);
});

test('V31-25 D-038②: effect keys stay stable for at-least-once idempotency', async () => {
  const keys: string[] = [];
  await runHarnessWorkflow(
    'task-v31-25-idem',
    taskInput(),
    fixtureCopyStages(),
    recordingRuntime(keys),
  );
  assert.ok(keys.some((k) => k.startsWith('wf:task-v31-25-idem:s1:')));
  assert.ok(keys.some((k) => k.startsWith('wf:task-v31-25-idem:s3:')));
  assert.ok(keys.some((k) => k.startsWith('wf:task-v31-25-idem:s4:')));
  // Unique keys only — no accidental double-fire of same stage unit.
  assert.equal(keys.length, new Set(keys).size);
});

test('V31-25 D-038③④⑤: release SOP hook + OCC fence remain greppable', async () => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  // apps/core/src/p1/harness → repo root = 5 levels up
  const repoRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../../',
  );
  const sop = await fs.readFile(
    path.join(repoRoot, 'docs/ops/harness-release-sop.md'),
    'utf8',
  );
  assert.match(sop, /D-038/);
  assert.match(
    sop,
    /排空|in-flight|application version|HARNESS_DBOS_APPLICATION_VERSION/,
  );
  assert.match(sop, /V31-25|runner convergence|收敛/);
  // D-038④ OCC revision fencing on candidate write path (not deleted by convergence).
  const occ = await fs.readFile(
    path.join(
      repoRoot,
      'apps/core/src/p1/agent-primitives/p1-harness-candidate-runner.ts',
    ),
    'utf8',
  );
  assert.match(occ, /OCC|revision is stale|P1HarnessCandidateRevisionConflict/);
  // D-038③ large artifacts use object storage ports (asset objectKey) in media selection.
  assert.match(
    await fs.readFile(
      path.join(repoRoot, 'apps/core/src/p1/harness/workflow-core.ts'),
      'utf8',
    ),
    /objectKey|ownedAssets|assembleMediaAndDeliver/,
  );
});

// ─── Helpers ────────────────────────────────────────────────────────────────

async function runCopyFixture(workflowId: string) {
  const keys: string[] = [];
  const progress: Array<{ stage: string; state: string }> = [];
  const traces: Array<{ stage: string }> = [];
  const result = await runHarnessWorkflow(
    workflowId,
    taskInput(),
    fixtureCopyStages(),
    {
      ...recordingRuntime(keys),
      async progress(event) {
        progress.push({ stage: event.stage, state: event.state });
      },
      async recordTrace(input) {
        traces.push({ stage: input.stage });
      },
    },
  );
  return {
    result,
    snapshot: buildRunnerEquivalenceSnapshot({
      result,
      effectKeys: keys,
      progress,
      traces,
    }),
  };
}

function stripWorkflowIds(
  snapshot: ReturnType<typeof buildRunnerEquivalenceSnapshot>,
) {
  return {
    ...snapshot,
    recovery: {
      ...snapshot.recovery,
      effectKeys: snapshot.recovery.effectKeys.map((k) =>
        k
          .replace(/wf:[^:]+:/, 'wf:TASK:')
          .replace(/compiled-primitive:[^:]+:/, 'compiled-primitive:TASK:'),
      ),
    },
  };
}

function recordingRuntime(keys: string[]): HarnessWorkflowRuntime {
  return {
    async runStep(key, op) {
      keys.push(key);
      return op();
    },
    async progress() {},
    async token() {},
    async recordTrace() {},
    async awaitDecision() {
      throw new Error('unexpected decision');
    },
  };
}

function approvePaid(
  question: Parameters<HarnessWorkflowRuntime['awaitDecision']>[0],
) {
  return {
    idempotencyKey: `approve-paid-generation:${question.questionId}`,
    questionId: question.questionId,
    workflowRevision: question.workflowRevision,
    patch: {
      field: question.response.field,
      value: 'approved',
      reason: question.response.reason,
    },
    decision: { state: 'accepted' as const, value: 'approved' },
  };
}

function noteStyleOrPaidDecision(
  question: Parameters<HarnessWorkflowRuntime['awaitDecision']>[0],
) {
  if (question.response.field === 'note_style') {
    const styleId = question.options[0]?.id ?? 'practical_guide';
    return {
      idempotencyKey: `style:${question.questionId}`,
      questionId: question.questionId,
      workflowRevision: question.workflowRevision,
      patch: {
        field: question.response.field,
        value: styleId,
        reason: question.response.reason,
      },
      decision: { state: 'accepted' as const, value: styleId },
    };
  }
  return approvePaid(question);
}

function fixtureCopyStages(): HarnessStagePorts {
  return {
    async nameIntent() {
      return {
        declaration: {
          normalizedIntent: '推广本店团购',
          taskType: 'promotion_groupbuy_conversion',
          deliveryLayer: 'copy',
          relevantAssetCategories: ['promotion_activity'],
          usedAssetCategories: ['promotion_activity'],
          route: 'customized',
          routingSource: 'model',
          implicitConstraints: ['不得编造价格'],
        },
        blockingQuestion: null,
      };
    },
    async injectContext() {
      return {
        bundle: {
          bundleId: 'bundle-1',
          revision: 1,
          hash: 'a'.repeat(64),
          serializerVersion: 'context-bundle-c14n-v1',
          workspaceId: 'workspace-1',
          taskId: 'task-35',
          frozenAt: '2026-07-18T00:00:00.000Z',
          frozenBy: 'owner-1',
          previousRevision: null,
          referencedFactRevisions: [],
          sourceRevisions: {
            facts: 2,
            assets: 1,
            identity: 1,
            rights: 1,
            preferences: 1,
            recipe: 1,
            platformRules: 1,
            currentSignal: 1,
          },
          dimensions: {
            promotion_task: {},
            traffic_opportunity: {},
            expression_identity: {},
            platform_mechanism: {},
            store_facts_assets: {},
            conversion_action: {},
          },
        },
        factsRevision: 7,
        policyReferences: { sourceRefs: [], rightsRefs: [], identityRefs: [] },
      };
    },
    async fenceContext(input) {
      return input.context;
    },
    async compileBrief() {
      return {
        kind: 'copy',
        instructions:
          '请基于当前有效团购事实，面向目标顾客生成一条可直接发布的文案，保留事实引用、表达身份、平台结构和明确行动号召，不得编造价格与效果。',
        platform: 'xiaohongshu',
        cta: '私信预约',
        factRefs: ['fact-1'],
        assetRefs: [],
        identityRefs: ['identity-1'],
        constraints: ['不得编造价格'],
      };
    },
    async executeAndSelect() {
      return {
        candidates: [
          {
            candidateId: 'c01',
            title: '新团购上线',
            body: '已确认的团购信息。',
            conversionHook: '私信预约',
            score: 90,
          },
        ],
        winner: {
          candidateId: 'c01',
          title: '新团购上线',
          body: '已确认的团购信息。',
          conversionHook: '私信预约',
        },
        trace: {
          stage: 'execution_selection',
          winnerCandidateId: 'c01',
          candidateScores: [],
          blockedCandidates: [],
          rubricVersion: 'copy-quality-v1',
          rubricHash: 'rubric-hash',
        },
      };
    },
    async assembleAndDeliver() {
      return {
        packageId: 'package-1',
        versionId: 'version-3',
        revision: 3,
      };
    },
  };
}

function fixtureNoteStages(): HarnessNoteStagePorts {
  const plan = (styleId: string, styleName: string) => ({
    schema: 'note-plan/v1' as const,
    themeAnchor: '护理科普',
    style: {
      id: styleId,
      name: styleName,
      positioning: `${styleName}定位`,
    },
    pages: [
      {
        id: 'page-1',
        order: 1,
        revision: 1,
        pageRole: 'cover' as const,
        pagePurpose: 'capture_attention' as const,
        imageIntent: {
          operation: 'image.generate' as const,
          purpose: '封面配图',
          subject: '护理项目',
          scene: '真实门店场景',
          composition: '主体清晰',
          references: [],
          exactText: [],
          changes: [],
          invariants: [],
          factRefs: [],
          rightsRefs: [],
          outputPlan: { kind: 'single' as const },
        },
        textBlock: {
          title: `${styleName}标题`,
          body: `${styleName}正文`,
          exactText: [],
        },
        dependencies: [],
      },
      {
        id: 'page-2',
        order: 2,
        revision: 1,
        pageRole: 'cta_guide' as const,
        pagePurpose: 'drive_action' as const,
        imageIntent: {
          operation: 'image.generate' as const,
          purpose: '行动页配图',
          subject: '预约行动',
          scene: '真实门店场景',
          composition: '主体清晰',
          references: [],
          exactText: [],
          changes: [],
          invariants: [],
          factRefs: [],
          rightsRefs: [],
          outputPlan: { kind: 'single' as const },
        },
        textBlock: {
          title: '预约建议',
          body: '私信了解详情',
          exactText: [],
        },
        dependencies: [{ pageId: 'page-1', kind: 'text_sequence' as const }],
      },
    ],
  });
  return {
    ...fixtureCopyStages(),
    async nameIntent() {
      return {
        declaration: {
          normalizedIntent: '制作护理科普图文',
          taskType: 'daily_service_exposure',
          deliveryLayer: 'finished_media',
          relevantAssetCategories: ['product_service'],
          usedAssetCategories: ['product_service'],
          route: 'customized',
          routingSource: 'model',
          implicitConstraints: [],
        },
        blockingQuestion: null,
      };
    },
    async compileNoteBrief() {
      return {
        kind: 'image_text_note',
        candidates: {
          candidates: [
            {
              styleId: 'facts',
              styleName: '干货版',
              positioning: '适合收藏',
              plan: plan('facts', '干货版'),
            },
            {
              styleId: 'story',
              styleName: '故事版',
              positioning: '适合互动',
              plan: plan('story', '故事版'),
            },
          ],
        },
      };
    },
    async executeNoteAndSelect(input) {
      // Prefer plan from brief (snapshot materialize path); never re-call compile.
      const fromBrief = input.brief.candidates.candidates.find(
        (c) => c.styleId === input.selectedStyleId,
      );
      return {
        auditSignals: [],
        childRuns: [],
        ownedAssets: [],
        selectedStyleId: input.selectedStyleId,
        version: {
          schema: 'image-text-note-version/v1',
          plan:
            fromBrief?.plan ??
            plan(input.selectedStyleId, input.selectedStyleId),
          regenerationReceipts: [],
        },
        trace: {
          stage: 'execution_selection',
          winnerCandidateId: input.selectedStyleId,
          candidateScores: [],
          blockedCandidates: [],
          rubricVersion: 'note-style-user-choice-v1',
          rubricHash: 'note-style-rubric',
        },
      };
    },
    async assembleNoteAndDeliver() {
      return {
        packageId: 'package-1',
        versionId: 'note-version-1',
        revision: 3,
      };
    },
  };
}

function fixtureMediaStages(): HarnessMediaStagePorts {
  return {
    ...fixtureCopyStages(),
    async nameIntent() {
      return {
        declaration: {
          normalizedIntent: '制作团购成片',
          taskType: 'promotion_groupbuy_conversion',
          deliveryLayer: 'finished_media',
          relevantAssetCategories: ['promotion_activity'],
          usedAssetCategories: ['promotion_activity'],
          route: 'customized',
          routingSource: 'model',
          implicitConstraints: ['不得编造价格'],
        },
        blockingQuestion: null,
      };
    },
    async compileMediaBrief() {
      return {
        kind: 'image',
        intent: {
          operation: 'image.generate',
          purpose: '门店活动图片',
          subject: '门店项目',
          scene: '真实门店场景',
          composition: '竖版主体居中',
          references: [],
          exactText: [],
          changes: [],
          invariants: [],
          factRefs: [],
          rightsRefs: [],
          outputPlan: { kind: 'single' },
        },
        prompt:
          '为夏日护理项目生成竖版门店活动海报，保留品牌主视觉和预约行动号召。',
        referenceAssetIds: ['asset-1'],
        parameters: { ratio: '9:16', resolution: '1080p' },
        constraints: ['不得编造价格'],
      };
    },
    async executeMediaAndSelect() {
      return {
        kind: 'image',
        asset: {
          contentType: 'image/png',
          id: 'image-asset-1',
          objectKey: 'owned/image-asset-1',
          sha256: 'image-sha-1',
          sizeBytes: 1024,
        },
        childRun: {
          runId: 'image-run-1',
          runType: 'model_job',
          status: 'succeeded',
        },
        trace: {
          stage: 'execution_selection',
          winnerCandidateId: 'image-asset-1',
          candidateScores: [],
          blockedCandidates: [],
          rubricVersion: 'media-receipt-v1',
          rubricHash: 'media-rubric-hash',
        },
      };
    },
    async assembleMediaAndDeliver() {
      return {
        packageId: 'package-1',
        versionId: 'media-version-1',
        revision: 3,
      };
    },
  };
}

function taskInput(): HarnessWorkflowInput {
  return {
    actorId: 'owner-1',
    workspaceId: 'workspace-1',
    packageId: 'package-1',
    expectedRevision: 2,
    workflowRevision: 4,
    creationMode: 'customized',
    rawInput: '把新团购做一套能发的',
    intent: {
      context: {
        workId: 'work-1',
        intent: '把新团购做一套能发的',
        sourceSummaries: [],
      },
      assetReferences: [],
    },
  };
}

function mediaTaskInput(
  kind: 'image' | 'image_text_note' | 'video',
): HarnessWorkflowInput {
  const snapshot = createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId: 'workspace-1',
      idempotencyKey: `submission-${kind}-1`,
      taskId: `task-${kind}`,
      workId: 'work-1',
      contentPackageId: 'package-1',
      expectedContentPackageRevision: 2,
      creationMode: 'customized',
      intent: '把夏日护理项目做成可发布的素材',
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: { id: `recipe-${kind}-1`, revision: `recipe-${kind}-r1` },
      lens: kind,
      platform: { id: 'douyin' },
      contentPackagePlatform: 'douyin',
      distributionTarget: 'export',
      deliverable: {
        kind:
          kind === 'video'
            ? 'video_package'
            : kind === 'image_text_note'
              ? 'note'
              : 'image_set',
        quantity: 1,
        aspectRatio: '9:16',
        ...(kind === 'video' ? { durationSeconds: 8 } : {}),
        ...(kind === 'image_text_note' ? { notePageBound: 3 } : {}),
      },
      deliverables: [
        {
          id: `${kind}-main`,
          kind,
          order: 0,
          quantity: 1,
          aspectRatio: '9:16',
          ...(kind === 'video' ? { durationSeconds: 8 } : {}),
          ...(kind === 'image_text_note' ? { notePageBound: 3 } : {}),
        },
      ],
      sources: {
        assets: [{ id: 'asset-1', revision: 'asset-r1', role: 'reference' }],
      },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-1', revision: 'identity-r1' },
      modelPolicy: { id: 'policy-1', revision: 'policy-r1', mode: 'fixed' },
      catalogModel: { id: `model-${kind}-1`, revision: `model-${kind}-r1` },
      quote: { id: 'quote-1', revision: 'quote-r1' },
      route: { id: 'route-1', revision: 'route-r1' },
      briefContext: { id: 'brief-context-1', revision: 1 },
      briefConfirmation: { id: 'brief-1', revision: 'brief-r1' },
      contentModules: ['social_cover'],
    },
    '2026-07-22T09:00:00.000Z',
  );
  return { ...taskInput(), executionSnapshot: snapshot };
}

/**
 * `mutatePlan` runs BEFORE the freeze, so the result is a legitimately frozen
 * snapshot of a different compiled plan — not a tampered one. Tampering after
 * the freeze is rejected by the snapshot hash gate, which is a separate
 * invariant with its own test.
 */
function buildTestPlanSnapshot(
  kind: 'note' | 'media' | 'copy',
  mutatePlan?: (plan: CompiledExecutionPlan) => void,
) {
  const executionPlan = structuredClone(
    createCanonicalCarrierUnitRecipeRegistry().resolve(kind).plan,
  ) as CompiledExecutionPlan;
  mutatePlan?.(executionPlan);
  const content = {
    planId: `plan-${kind}-1`,
    planRevision: 1,
    intentDeclaration: {
      summary: kind === 'note' ? '护理科普图文' : '门店活动',
    },
    contextBundleRef: {
      bundleId: 'bundle-1',
      revision: 1,
      hash: 'a'.repeat(64),
    },
    executionPlan,
    deliverables: [
      {
        deliverableId: 'd1',
        kind,
        quantity: 1,
      },
    ],
    promptRevisionRefs: {},
    skillManifestRefs: {},
    routeRequirements: [],
    quoteRef: { id: 'quote-1', revision: 1 },
    rightsRevisionRefs: ['rights-1'],
    factRevisionRefs: ['fact-1'],
    boundedExecution: {
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
    },
    harnessReleaseId: 'release-1',
    approvalBasis:
      kind === 'copy'
        ? ('policy_exempt_copy' as const)
        : ('merchant_confirmed' as const),
    ...(kind !== 'copy' ? { confirmationDecisionRef: 'confirm-1' } : {}),
  };
  const { snapshotHash } = freezeExecutionPlanContent(content as never);
  return buildExecutionPlanSnapshot({
    content: content as never,
    snapshotHash,
  });
}
