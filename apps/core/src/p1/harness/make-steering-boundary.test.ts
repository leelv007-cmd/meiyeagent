/**
 * V31-16 Make dual-queue unit-boundary hang (production drain path).
 *
 * - unit success drains steer (future_step_patch accepted; other pages untouched)
 * - follow_up waits until all units terminal
 * - flag off / kill switch ⇒ zero service calls
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemorySteeringCommandStore,
  SteeringService,
} from '../agent-session/index.js';
import { createNotePageProgressReporter } from './note-page-execution-frame.js';
import {
  applyFutureStepPatchesToNotePage,
  createMakeSteeringBoundaryPort,
  createNotePageSteeringBoundaryTracker,
} from './make-steering-boundary.js';
import { settleHarnessTerminalSuccess } from './dbos-workflow.js';
import {
  DEFAULT_NOTE_STYLES,
  NotePlanCompiler,
  passingNoteEvaluation,
  type NotePlanStructuredPort,
} from './note-plan-compiler.js';
import type { NotePlan } from '@meiye/contracts';

const TS = '2026-08-08T15:00:00.000Z';

const plan = {
  pages: [
    { id: 'page-1', order: 1, textBlock: { title: '封面' } },
    { id: 'page-2', order: 2, textBlock: { title: '第二页' } },
    { id: 'page-3', order: 3, textBlock: { title: '第三页' } },
  ],
};

function unitsFor(statuses: Array<'pending' | 'running' | 'completed'>) {
  return plan.pages.map((page, i) => ({
    unitId: page.id,
    status: statuses[i] ?? 'pending',
    label: page.order === 1 ? '封面' : `第${page.order}页`,
    pageIndex: page.order - 1,
  }));
}

test('unit boundary drains steer: future_step_patch applies after current page; other pages untouched', async () => {
  const store = new MemorySteeringCommandStore();
  const svc = new SteeringService({
    store,
    now: () => TS,
    idFactory: () => 'steer-boundary-1',
  });
  let serviceCalls = 0;
  const wrapped: Pick<SteeringService, 'onUnitBoundary'> = {
    async onUnitBoundary(input) {
      serviceCalls += 1;
      return svc.onUnitBoundary(input);
    },
  };
  const boundary = createMakeSteeringBoundaryPort({
    service: wrapped,
    resolveGate: () => ({ enabled: true, reason: 'enabled' }),
  });

  // Mid-run: page-1 running, page-2/3 pending. Steer targets page-2 only.
  await svc.submit({
    commandId: 'steer-boundary-1',
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    taskId: 'task-note-1',
    actorId: 'actor-1',
    instruction: '第二页少点字',
    sourcePlanRevision: 2,
    snapshotHash: 'snap-2',
    units: unitsFor(['running', 'pending', 'pending']),
    queueModeHint: 'steer',
    signals: { affectedUnitIds: ['page-2'] },
  });
  const queued = await store.listQueued({
    workspaceId: 'ws-1',
    taskId: 'task-note-1',
  });
  assert.equal(queued.length, 1);
  assert.equal(queued[0]?.applicationStatus, 'queued_steer');
  assert.deepEqual(queued[0]?.command.affectedUnitIds, ['page-2']);

  const tracker = createNotePageSteeringBoundaryTracker({
    workspaceId: 'ws-1',
    taskId: 'task-note-1',
    unitIds: plan.pages.map((p) => p.id),
    boundary,
  });

  // Completing page-1 (current unit) drains steer → accepted for next unit (page-2).
  const afterPage1 = await tracker.onPageSuccess('page-1');
  assert.equal(serviceCalls, 1);
  assert.equal(afterPage1?.ready.length, 1);
  assert.equal(afterPage1?.ready[0]?.command.commandId, 'steer-boundary-1');
  assert.equal(afterPage1?.ready[0]?.applicationStatus, 'accepted');
  assert.equal(afterPage1?.stillQueued.length, 0);

  const applied = await store.getById('steer-boundary-1');
  assert.equal(applied?.applicationStatus, 'accepted');
  // Scope: only page-2 affected; page-1/3 not in affectedUnitIds.
  assert.deepEqual(applied?.command.affectedUnitIds as string[], ['page-2']);
  const affected = applied?.command.affectedUnitIds as string[];
  assert.ok(!affected.includes('page-1'));
  assert.ok(!affected.includes('page-3'));
});

test('follow_up stays queued mid-run and drains only when all units terminal', async () => {
  const store = new MemorySteeringCommandStore();
  const svc = new SteeringService({
    store,
    now: () => TS,
    idFactory: () => 'steer-follow-1',
  });
  const boundary = createMakeSteeringBoundaryPort({
    service: svc,
    resolveGate: () => ({ enabled: true, reason: 'enabled' }),
  });

  await svc.submit({
    commandId: 'steer-follow-1',
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    taskId: 'task-note-2',
    actorId: 'actor-1',
    instruction: '全部完成后第三页语气再软一点',
    sourcePlanRevision: 1,
    snapshotHash: 'snap-1',
    units: unitsFor(['pending', 'pending', 'pending']),
    queueModeHint: 'follow_up',
    signals: { affectedUnitIds: ['page-3'] },
  });
  assert.equal(
    (await store.getById('steer-follow-1'))?.applicationStatus,
    'queued_follow_up',
  );

  const tracker = createNotePageSteeringBoundaryTracker({
    workspaceId: 'ws-1',
    taskId: 'task-note-2',
    unitIds: plan.pages.map((p) => p.id),
    boundary,
  });

  const mid = await tracker.onPageSuccess('page-1');
  assert.equal(mid?.ready.length, 0);
  assert.equal(mid?.stillQueued.length, 1);
  assert.equal(
    (await store.getById('steer-follow-1'))?.applicationStatus,
    'queued_follow_up',
  );

  await tracker.onPageSuccess('page-2');
  assert.equal(
    (await store.getById('steer-follow-1'))?.applicationStatus,
    'queued_follow_up',
  );

  // Last page success → allUnitsTerminal → follow_up accepted.
  const end = await tracker.onPageSuccess('page-3');
  assert.equal(end?.ready.length, 1);
  assert.equal(end?.ready[0]?.command.commandId, 'steer-follow-1');
  assert.equal(
    (await store.getById('steer-follow-1'))?.applicationStatus,
    'accepted',
  );
});

test('note page progress reporter fires steering boundary only on page success', async () => {
  const calls: string[] = [];
  const boundary = {
    async onUnitBoundary(input: {
      workspaceId: string;
      taskId: string;
      cursor: {
        justCompletedUnitId: string | null;
        remainingUnitIds: readonly string[];
        allUnitsTerminal: boolean;
      };
    }) {
      calls.push(
        `${input.cursor.justCompletedUnitId}:${input.cursor.allUnitsTerminal}`,
      );
      return { ready: [], stillQueued: [] };
    },
  };
  const report = createNotePageProgressReporter({
    plan,
    reportProgress: async () => {},
    makeSteeringBoundary: {
      ...boundary,
      resolveFutureStepPatches: async () => [],
    },
    steeringContext: { workspaceId: 'ws-1', taskId: 'task-1' },
  });

  await report({ pageId: 'page-1', state: 'running' });
  assert.deepEqual(calls, []);

  await report({ pageId: 'page-1', state: 'success' });
  assert.deepEqual(calls, ['page-1:false']);

  await report({ pageId: 'page-2', state: 'success' });
  assert.deepEqual(calls, ['page-1:false', 'page-2:false']);

  await report({ pageId: 'page-3', state: 'success' });
  assert.deepEqual(calls, ['page-1:false', 'page-2:false', 'page-3:true']);
});

test('flag off / kill switch: zero service onUnitBoundary calls', async () => {
  let serviceCalls = 0;
  const svc = {
    async onUnitBoundary() {
      serviceCalls += 1;
      return { ready: [], stillQueued: [] };
    },
  };
  const off = createMakeSteeringBoundaryPort({
    service: svc,
    resolveGate: () => ({ enabled: false, reason: 'feature_flag_off' }),
  });
  const killed = createMakeSteeringBoundaryPort({
    service: svc,
    resolveGate: () => ({ enabled: false, reason: 'kill_switch' }),
  });

  assert.equal(
    await off.onUnitBoundary({
      workspaceId: 'ws',
      taskId: 't',
      cursor: {
        justCompletedUnitId: 'u1',
        remainingUnitIds: ['u2'],
        allUnitsTerminal: false,
      },
    }),
    undefined,
  );
  assert.equal(
    await killed.onUnitBoundary({
      workspaceId: 'ws',
      taskId: 't',
      cursor: {
        justCompletedUnitId: null,
        remainingUnitIds: [],
        allUnitsTerminal: true,
      },
    }),
    undefined,
  );
  assert.equal(serviceCalls, 0);
});

test('settleHarnessTerminalSuccess drains follow_up at all-units-terminal hang', async () => {
  const store = new MemorySteeringCommandStore();
  const svc = new SteeringService({
    store,
    now: () => TS,
    idFactory: () => 'steer-term-1',
  });
  await svc.submit({
    commandId: 'steer-term-1',
    workspaceId: 'ws-term',
    threadId: 'thread-term',
    taskId: 'wf-term-1',
    actorId: 'actor-1',
    instruction: '做完后再把语气软一点',
    sourcePlanRevision: 1,
    snapshotHash: 'snap',
    units: unitsFor(['pending', 'pending', 'pending']),
    queueModeHint: 'follow_up',
    signals: { affectedUnitIds: ['page-1'] },
  });
  assert.equal(
    (await store.getById('steer-term-1'))?.applicationStatus,
    'queued_follow_up',
  );

  const boundary = createMakeSteeringBoundaryPort({
    service: svc,
    resolveGate: () => ({ enabled: true, reason: 'enabled' }),
  });
  const steps: string[] = [];
  await settleHarnessTerminalSuccess({
    request: { workspaceId: 'ws-term' } as never,
    runStep: async (name, op) => {
      steps.push(name);
      return op();
    },
    settlement: null,
    workflowId: 'wf-term-1',
    makeSteeringBoundary: boundary,
  });
  assert.ok(steps.includes('make-steering-all-units-terminal'));
  assert.equal(
    (await store.getById('steer-term-1'))?.applicationStatus,
    'accepted',
  );
});

test('settleHarnessTerminalSuccess with flag-off boundary is a no-op step', async () => {
  let serviceCalls = 0;
  const boundary = createMakeSteeringBoundaryPort({
    service: {
      async onUnitBoundary() {
        serviceCalls += 1;
        return { ready: [], stillQueued: [] };
      },
    },
    resolveGate: () => ({ enabled: false, reason: 'kill_switch' }),
  });
  await settleHarnessTerminalSuccess({
    request: { workspaceId: 'ws' } as never,
    runStep: async (_name, op) => op(),
    settlement: null,
    workflowId: 'wf-1',
    makeSteeringBoundary: boundary,
  });
  assert.equal(serviceCalls, 0);
});

test('applyFutureStepPatchesToNotePage overlays only when patches present (no snapshot mutate)', () => {
  const page = {
    id: 'page-2',
    textBlock: { title: '标题', body: '原文案', exactText: ['原文案'] as const },
    imageIntent: { purpose: '原配图意图' },
  };
  const untouched = applyFutureStepPatchesToNotePage(page, []);
  assert.equal(untouched, page);

  const patched = applyFutureStepPatchesToNotePage(page, [
    { instruction: '第二页少点字' },
  ]);
  assert.notEqual(patched, page);
  assert.equal(page.textBlock.body, '原文案');
  assert.equal(page.imageIntent.purpose, '原配图意图');
  assert.match(patched.textBlock.body, /中途修正.*第二页少点字/);
  assert.match(patched.imageIntent.purpose, /商家中途修正.*第二页少点字/);
});

test('selectAndGenerate: next page generation input contains accepted future_step_patch; others unchanged', async () => {
  const store = new MemorySteeringCommandStore();
  const svc = new SteeringService({
    store,
    now: () => TS,
    idFactory: () => 'steer-apply-1',
  });
  // Pre-accept a future_step_patch targeting page-2 only (as if prior unit boundary drained).
  await svc.submit({
    commandId: 'steer-apply-1',
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    taskId: 'task-apply',
    actorId: 'actor-1',
    instruction: '第二页少点字，不要写最后两个名额',
    sourcePlanRevision: 1,
    snapshotHash: 'snap-apply',
    units: [
      { unitId: 'page-1', status: 'completed', pageIndex: 0, label: '封面' },
      { unitId: 'page-2', status: 'pending', pageIndex: 1, label: '第2页' },
    ],
    queueModeHint: 'steer',
    signals: { affectedUnitIds: ['page-2'] },
    applyImmediately: true,
  });
  assert.equal(
    (await store.getById('steer-apply-1'))?.applicationStatus,
    'accepted',
  );

  const boundary = createMakeSteeringBoundaryPort({
    service: svc,
    resolveGate: () => ({ enabled: true, reason: 'enabled' }),
  });

  const generateInputs: Array<{
    pageId: string;
    purpose: string;
    body: string;
    evaluationReason?: string;
  }> = [];

  const base: NotePlan = {
    schema: 'note-plan/v1',
    themeAnchor: '夏日护理先看真实需求',
    style: {
      id: 'planning',
      name: '规划中',
      positioning: '等待风格草稿',
    },
    pages: [
      notePage('page-1', 1, 'cover', 'capture_attention'),
      notePage('page-2', 2, 'cta_guide', 'drive_action'),
    ],
  };

  const structured: NotePlanStructuredPort = {
    async plan() {
      return structuredClone(base);
    },
    async draftPage({ page, previousTextBlock, style }) {
      return {
        title: `${style.name}-${page.pageRole}标题`,
        body: `${previousTextBlock?.body ?? ''}${page.pageRole}正文`,
        exactText: page.textBlock.exactText,
      };
    },
    async evaluate() {
      return passingNoteEvaluation(TS);
    },
  };

  const compiler = new NotePlanCompiler(structured, {
    async generate({ page, evaluationReason }) {
      generateInputs.push({
        pageId: page.id,
        purpose: page.imageIntent.purpose,
        body: page.textBlock.body,
        ...(evaluationReason ? { evaluationReason } : {}),
      });
      return {
        asset: {
          id: `asset-${page.id}`,
          objectKey: `workspace/generated/${page.id}.png`,
          contentType: 'image/png',
          sha256: 'a'.repeat(64),
          sizeBytes: 100,
        },
        childRun: {
          runId: `run-${page.id}`,
          runType: 'model_job' as const,
          status: 'succeeded' as const,
          assetIds: [`asset-${page.id}`],
          productUsage: { quantity: 1, status: 'committed' as const },
        },
      };
    },
  });

  const drafts = await compiler.compileDrafts({
    intent: '介绍护理',
    factRefs: [],
    rightsRefs: [],
    styles: DEFAULT_NOTE_STYLES,
    notePageBound: 3,
  });

  const selectedStyleId = drafts.candidates[0]!.styleId;
  const result = await compiler.selectAndGenerate({
    candidates: drafts,
    selectedStyleId,
    notePageBound: 3,
    resolveFutureStepPatches: (pageId) =>
      boundary.resolveFutureStepPatches({
        workspaceId: 'ws-1',
        taskId: 'task-apply',
        unitId: pageId,
      }),
  });

  assert.equal(generateInputs.length, 2);
  const page1 = generateInputs.find((row) => row.pageId === 'page-1');
  const page2 = generateInputs.find((row) => row.pageId === 'page-2');
  assert.ok(page1 && page2);

  // Target page generation input carries the patch instruction.
  assert.match(page2.purpose, /第二页少点字/);
  assert.match(page2.body, /中途修正.*第二页少点字/);
  assert.match(page2.evaluationReason ?? '', /第二页少点字/);

  // Unaffected page keeps original generation input (no mid-run overlay).
  assert.doesNotMatch(page1.purpose, /中途修正|第二页少点字/);
  assert.doesNotMatch(page1.body, /中途修正|第二页少点字/);
  assert.equal(page1.evaluationReason, undefined);

  // Delivery plan reflects overlay only on page-2.
  const delivered2 = result.version.plan.pages.find((p) => p.id === 'page-2');
  const delivered1 = result.version.plan.pages.find((p) => p.id === 'page-1');
  assert.match(delivered2?.textBlock.body ?? '', /中途修正/);
  assert.doesNotMatch(delivered1?.textBlock.body ?? '', /中途修正/);
});

function notePage(
  id: string,
  order: number,
  pageRole: NotePlan['pages'][number]['pageRole'],
  pagePurpose: NotePlan['pages'][number]['pagePurpose'],
): NotePlan['pages'][number] {
  const exact = `${pageRole}精确字`;
  return {
    id,
    order,
    revision: 1,
    pageRole,
    pagePurpose,
    imageIntent: {
      operation: 'image.generate',
      purpose: `${pageRole}配图`,
      subject: '门店护理项目',
      scene: '真实门店场景',
      composition: '主体清晰',
      references: [],
      exactText: [{ text: exact, treatment: 'exact' }],
      changes: [],
      invariants: [],
      factRefs: [],
      rightsRefs: [],
      outputPlan: { kind: 'single' },
    },
    textBlock: {
      title: `${pageRole}标题`,
      body: `${pageRole}正文`,
      exactText: [exact],
    },
    dependencies: [],
  };
}
