/**
 * V31-27 mid-run steering model: entry admission (including the kill switch),
 * unit projection from the note outline, and how a Core classification reads
 * back as 影响范围 / 费用.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { NotePlanTimeline } from './note-plan-timeline';
import {
  isSteeringEntryVisible,
  projectSteeringHistory,
  projectSteeringImpact,
  steeringUnitsFromNotePlan,
  type SteeringSubmitResult,
} from './steering-composer';

function timelineFixture(): NotePlanTimeline {
  return {
    schema: 'note-plan-timeline/v1',
    themeAnchor: '奶油风美甲',
    pages: [
      {
        pageId: 'page-1',
        order: 1,
        pageRole: 'cover',
        pagePurpose: 'capture_attention',
        title: '封面',
        body: '最后两个名额',
        imageStatus: 'pending',
        revision: 1,
        outlineDirty: false,
        regenerateRequested: false,
      },
      {
        pageId: 'page-2',
        order: 2,
        pageRole: 'solution_show',
        pagePurpose: 'explain_solution',
        title: '款式',
        body: '大段文字',
        imageStatus: 'generating',
        revision: 1,
        outlineDirty: false,
        regenerateRequested: false,
      },
      {
        pageId: 'page-3',
        order: 3,
        pageRole: 'solution_show',
        pagePurpose: 'explain_solution',
        title: '价格',
        body: '价目',
        imageStatus: 'ready',
        revision: 1,
        outlineDirty: false,
        regenerateRequested: false,
      },
    ],
  };
}

/** The state at the execution_confirm hold: outline out, nothing sent yet. */
function pendingTimelineFixture(): NotePlanTimeline {
  const timeline = timelineFixture();
  return {
    ...timeline,
    pages: timeline.pages.map((page) => ({
      ...page,
      imageStatus: 'pending' as const,
    })),
  };
}

// Unit ids are branded at the contract boundary; the fixture builds plain
// literals and casts once at the end rather than branding every id by hand.
function submitResult(
  overrides: Partial<Record<keyof SteeringSubmitResult, unknown>> = {}
): SteeringSubmitResult {
  return {
    command: {
      schemaVersion: 'steering-command/v1',
      commandId: 'steer-1',
      threadId: 'thread-1',
      taskId: 'task-1',
      sourcePlanRevision: 1,
      sourceContentVersionIds: [],
      instruction: '封面不要写最后两个名额，第二页少点字',
      classification: {
        kind: 'future_step_patch',
        affectedUnits: ['page-1', 'page-2'],
        requiresRequote: false,
      },
      affectedUnitIds: ['page-1', 'page-2'],
      queueMode: 'steer',
      createdAt: '2026-08-09T00:00:00.000Z',
      actorId: 'user-1',
    },
    classification: {
      kind: 'future_step_patch',
      affectedUnits: ['page-1', 'page-2'],
      requiresRequote: false,
    },
    queueMode: 'steer',
    applicationStatus: 'queued_steer',
    impactSummary: '已应用到封面和第2页；其他页面不变。',
    preservedUnitIds: ['page-3'],
    affectedUnitIds: ['page-1', 'page-2'],
    nextAction: 'queue_wait',
    replayed: false,
    ...overrides,
  } as SteeringSubmitResult;
}

test('entry shows on a steerable run and hides everywhere else', () => {
  const base = { taskId: 'task-1', gateEnabled: true } as const;
  assert.equal(isSteeringEntryVisible({ ...base, phase: 'running' }), true);
  assert.equal(
    isSteeringEntryVisible({ ...base, phase: 'awaiting_answer' }),
    true
  );
  for (const phase of ['idle', 'delivered', 'cancelled', 'failed'] as const) {
    assert.equal(isSteeringEntryVisible({ ...base, phase }), false);
  }
  // No bound run: nothing to interrupt.
  assert.equal(
    isSteeringEntryVisible({ ...base, phase: 'running', taskId: null }),
    false
  );
});

test('disable_make_steering kill switch removes the entry entirely', () => {
  assert.equal(
    isSteeringEntryVisible({
      phase: 'running',
      taskId: 'task-1',
      gateEnabled: false,
    }),
    false
  );
});

test('note outline projects to Make units with merchant page labels', () => {
  assert.deepEqual(steeringUnitsFromNotePlan(timelineFixture()), [
    { unitId: 'page-1', status: 'pending', label: '封面', pageIndex: 0 },
    { unitId: 'page-2', status: 'running', label: '第2页', pageIndex: 1 },
    { unitId: 'page-3', status: 'completed', label: '第3页', pageIndex: 2 },
  ]);
  // Without an outline Core is told nothing rather than being handed a guess.
  assert.deepEqual(steeringUnitsFromNotePlan(null), []);
});

test('pages held on 确认执行 are pending, not in flight', () => {
  // Live-caught 2026-08-09: execution_selection reports `suspended` while the
  // confirmation gate waits, which paints every page 「配图中」 even though the
  // gate exists precisely so nothing is sent until the merchant agrees.
  // Reading that as work-in-flight billed a free edit.
  const units = steeringUnitsFromNotePlan(timelineFixture(), {
    generationStarted: false,
  });
  assert.deepEqual(
    units.map((unit) => unit.status),
    ['pending', 'pending', 'pending']
  );
  const impact = projectSteeringImpact({ result: submitResult(), units });
  assert.equal(impact.rebilled, false);
  assert.match(impact.feeNote, /不额外算积分/u);

  // Default stays conservative: unknown means assume the call went out.
  assert.equal(
    steeringUnitsFromNotePlan(timelineFixture())[1]?.status,
    'running'
  );
});

test('future_step_patch on unsent pages applies free of extra credits', () => {
  // Every page still pending: nothing has gone upstream, so nothing is rebilled.
  const units = steeringUnitsFromNotePlan(pendingTimelineFixture());
  const impact = projectSteeringImpact({ result: submitResult(), units });
  assert.equal(impact.kind, 'future_step_patch');
  assert.equal(impact.summary, '已应用到封面和第2页；其他页面不变。');
  assert.deepEqual(impact.affectedLabels, ['封面', '第2页']);
  assert.deepEqual(impact.preservedLabels, ['第3页']);
  assert.equal(impact.requiresRequote, false);
  assert.equal(impact.requiresCorrection, false);
  assert.equal(impact.rebilled, false);
  assert.equal(impact.settledNote, null);
  assert.match(impact.feeNote, /不额外算积分/u);
  assert.equal(impact.queueNote, '当前这一步做完就按你的话改。');
});

test('future_step_patch touching an already-sent page is rebilled', () => {
  // 第2页 is generating — its upstream call is out. Steering cannot roll that
  // back, so the change is a fresh billable generation.
  const units = steeringUnitsFromNotePlan(timelineFixture());
  const impact = projectSteeringImpact({ result: submitResult(), units });
  assert.equal(impact.kind, 'future_step_patch');
  assert.equal(impact.rebilled, true);
  assert.match(impact.feeNote, /重新生成/u);
  assert.match(impact.feeNote, /按正常生成一样算积分/u);
  assert.match(impact.feeNote, /其余页不动，不另算积分/u);
  assert.match(impact.settledNote ?? '', /照常计费、不退回/u);
});

test('derived_revision always rebills and keeps the original version', () => {
  const impact = projectSteeringImpact({
    result: submitResult({
      classification: {
        kind: 'derived_revision',
        completedUnits: ['page-1'],
        requiresRequote: false,
      },
      applicationStatus: 'accepted',
      nextAction: 'create_derived_revision',
      impactSummary:
        '已完成内容将产生派生版本（封面和第2页）；其他页面保持不变。',
    }),
    units: steeringUnitsFromNotePlan(pendingTimelineFixture()),
  });
  assert.equal(impact.rebilled, true);
  assert.match(impact.feeNote, /会按你的改法重新生成/u);
  assert.match(impact.settledNote ?? '', /原来那版也会留着/u);
});

test('a server-priced rebill prints the number; a missing one never invents it', () => {
  const units = steeringUnitsFromNotePlan(timelineFixture());
  const priced = projectSteeringImpact({
    result: submitResult(),
    units,
    rebillCredits: 12,
  });
  assert.match(priced.feeNote, /并计 12 积分/u);

  const unpriced = projectSteeringImpact({ result: submitResult(), units });
  assert.doesNotMatch(unpriced.feeNote, /\d+\s*积分/u);
});

test('plan_change asks for a requote instead of applying silently', () => {
  const impact = projectSteeringImpact({
    result: submitResult({
      classification: {
        kind: 'plan_change',
        reason: '数量变化',
        requiresReplan: true,
      },
      applicationStatus: 'requires_replan_confirm',
      nextAction: 'replan_requote_confirm',
      impactSummary:
        '该指令会改变方案范围或费用（数量变化），需回到方案层重新报价并确认。',
      affectedUnitIds: [],
      preservedUnitIds: ['page-1', 'page-2', 'page-3'],
    }),
    units: steeringUnitsFromNotePlan(timelineFixture()),
  });
  assert.equal(impact.requiresRequote, true);
  assert.deepEqual(impact.affectedLabels, []);
  assert.equal(impact.preservedLabels.length, 3);
  assert.equal(impact.rebilled, false);
  // D-061: the merchant reads 积分, never an upstream provider price.
  assert.match(impact.feeNote, /积分要重新算一次/u);
  assert.doesNotMatch(impact.feeNote, /成本|上游|供应商|provider/iu);
});

test('unsafe_or_conflicting explains and asks the merchant to correct', () => {
  const impact = projectSteeringImpact({
    result: submitResult({
      classification: {
        kind: 'unsafe_or_conflicting',
        reason: '无法确定影响范围，请指明要改的页面或步骤',
      },
      applicationStatus: 'rejected_unsafe',
      nextAction: 'ask_merchant_correct',
      impactSummary:
        '该指令无法安全执行：无法确定影响范围，请指明要改的页面或步骤。请修正后再试。',
      affectedUnitIds: [],
      preservedUnitIds: [],
    }),
    units: [],
  });
  assert.equal(impact.requiresCorrection, true);
  assert.equal(impact.requiresRequote, false);
  assert.equal(impact.feeNote, '');
});

test('restored history reads each command back with where it landed', () => {
  const command = submitResult().command;
  assert.deepEqual(
    projectSteeringHistory([
      {
        command,
        applicationStatus: 'accepted',
        impactSummary: '已应用到封面和第2页；其他页面不变。',
      },
    ]),
    [
      {
        commandId: 'steer-1',
        instruction: '封面不要写最后两个名额，第二页少点字',
        statusLabel: '已应用',
        impactSummary: '已应用到封面和第2页；其他页面不变。',
        createdAt: '2026-08-09T00:00:00.000Z',
      },
    ]
  );
});
