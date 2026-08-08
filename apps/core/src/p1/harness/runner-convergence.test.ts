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
import test from 'node:test';

import {
  COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
  HARNESS_STAGES,
} from '@meiye/contracts';

import {
  assertCarrierRegistrationComplete,
  createCanonicalCarrierUnitRecipeRegistry,
  lensToContentCarrier,
} from './carrier-unit-recipes.js';
import {
  assertNoGrammarInterpreter,
  assertRecipesHavePrograms,
  createCarrierProgramRegistry,
  executeCompiledCarrierPlan,
  resolveCompiledCarrierExecution,
} from './compiled-carrier-executor.js';
import {
  attachStageTaxonomy,
  FIVE_STAGE_TRACE_ROLE,
  STAGE_TO_PRIMITIVES,
  stageTaxonomyPayload,
} from './five-stage-trace-taxonomy.js';
import {
  materializeMediaBriefFromSnapshot,
  materializeNoteBriefFromSnapshot,
} from './make-snapshot-consume.js';
import {
  assertZeroDuplicateSideEffects,
  buildRunnerEquivalenceSnapshot,
  diffRunnerEquivalence,
} from './runner-equivalence.js';
import {
  runHarnessWorkflow,
  type HarnessMediaStagePorts,
  type HarnessNoteStagePorts,
  type HarnessStagePorts,
  type HarnessWorkflowRuntime,
} from './workflow-core.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import { createCreationExecutionSnapshot } from '../execution-spine/creation-execution-snapshot.js';
import {
  buildExecutionPlanSnapshot,
  freezeExecutionPlanContent,
} from './execution-plan-admission.js';

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
    assert.ok(recipe.plan.units.length >= 3);
    assertNoGrammarInterpreter(recipe.plan);
    for (const unit of recipe.plan.units) {
      const retry = recipe.plan.boundedRetry[unit.unitId];
      assert.equal(retry?.retry.enabled, false);
    }
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
        hasCarrierProgram: true,
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
        hasCarrierProgram: false,
        hasTest: true,
      }),
    /missing carrier program/,
  );
  assertCarrierRegistrationComplete({
    carrier: 'copy',
    hasRecipe: true,
    hasUnitTypes: true,
    hasCarrierProgram: true,
    hasTest: true,
  });
});

test('V31-25: single executor requires recipe+program pairing', async () => {
  const recipes = createCanonicalCarrierUnitRecipeRegistry();
  const programs = createCarrierProgramRegistry<
    { carrier: string },
    { ok: true }
  >({
    copy: async () => ({ ok: true }),
    note: async () => ({ ok: true }),
    // media intentionally missing
  });
  assert.throws(
    () => assertRecipesHavePrograms({ recipes, programs: programs as never }),
    /media/,
  );
  await assert.rejects(
    () =>
      executeCompiledCarrierPlan({
        context: { lens: 'image' },
        programInput: { carrier: 'media' },
        programs,
      }),
    /media.*no program|No carrier program for media/i,
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
  const legacy = resolveCompiledCarrierExecution({
    lens: 'copy',
    forceLegacyFiveStage: true,
  });
  assert.equal(legacy.executorPath, 'legacy_five_stage_runner');
});

// ─── Equivalence baseline + kill/restart ─────────────────────────────────────

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
        k.replace(/wf:[^:]+:/, 'wf:TASK:'),
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

function buildTestPlanSnapshot(kind: 'note' | 'media' | 'copy') {
  const unitType =
    kind === 'note'
      ? 'note.generate'
      : kind === 'media'
        ? 'media.generate'
        : 'copy.generate';
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
    executionPlan: {
      schemaVersion: COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
      units: [
        {
          unitId: 'unit-1',
          unitType,
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
    },
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
