/**
 * V31-27 mid-run steering model: entry admission (including the kill switch),
 * unit projection from the note outline, and how a Core classification reads
 * back as 影响范围 / 费用.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSteeringEntryVisible,
  projectSteeringHistory,
  projectSteeringImpact,
  type SteeringSubmitResult,
} from './steering-composer';

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
    impact: {
      affectedLabels: ['封面', '第2页'],
      preservedLabels: ['第3页'],
      rebilled: false,
      alreadyInvokedUnitIds: [],
      requiresRequote: false,
      requiresCorrection: false,
      feeNote:
        '封面、第2页还没开始做，直接按你的话调整，不额外算积分；其余页也不受影响。',
      settledNote: null,
      queueNote: '当前这一步做完就按你的话改。',
    },
    nextAction: 'queue_wait',
    replayed: false,
    ...overrides,
  } as SteeringSubmitResult;
}

test('entry shows on a steerable run and hides everywhere else', () => {
  const base = {
    taskId: 'task-1',
    threadId: 'thread-1',
    gateEnabled: true,
  } as const;
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

/**
 * V31-105 §3. Core admits a steer only from the submission's own
 * `agentBinding.threadId` (`STEERING_AUTHORITY_BINDING_SQL`), so a run whose
 * bound thread the browser does not hold cannot be steered from here at all.
 * Offering the box anyway meant the merchant wrote a sentence and got a 409
 * about a binding she has no way to see.
 */
test('a run with no bound thread is not steerable', () => {
  const base = {
    phase: 'running',
    taskId: 'task-1',
    gateEnabled: true,
  } as const;
  assert.equal(isSteeringEntryVisible({ ...base, threadId: null }), false);
  assert.equal(isSteeringEntryVisible({ ...base, threadId: undefined }), false);
  assert.equal(isSteeringEntryVisible({ ...base, threadId: '   ' }), false);
  assert.equal(isSteeringEntryVisible({ ...base, threadId: 'thread-1' }), true);
});

test('disable_make_steering kill switch removes the entry entirely', () => {
  assert.equal(
    isSteeringEntryVisible({
      phase: 'running',
      taskId: 'task-1',
      threadId: 'thread-1',
      gateEnabled: false,
    }),
    false
  );
});

test("the panel renders Core's scope and credit answer verbatim", () => {
  // Nothing about money or scope is recomputed in the browser. Core sees the
  // real unit progress (including the 确认执行 hold, where nothing has been sent
  // upstream despite the outline saying 「配图中」) and answers; a browser that
  // re-derived it would be a second truth next to the Make queue.
  const impact = projectSteeringImpact({ result: submitResult() });
  assert.equal(impact.kind, 'future_step_patch');
  assert.equal(impact.summary, '已应用到封面和第2页；其他页面不变。');
  assert.deepEqual(impact.affectedLabels, ['封面', '第2页']);
  assert.deepEqual(impact.preservedLabels, ['第3页']);
  assert.equal(impact.rebilled, false);
  assert.equal(impact.settledNote, null);
  assert.match(impact.feeNote, /不额外算积分/u);
  assert.equal(impact.queueNote, '当前这一步做完就按你的话改。');
});

test("a rebilled change carries Core's fee and settled sentences unchanged", () => {
  const impact = projectSteeringImpact({
    result: submitResult({
      applicationStatus: 'accepted',
      nextAction: 'create_derived_revision',
      classification: {
        kind: 'derived_revision',
        completedUnits: ['page-1'],
        requiresRequote: false,
      },
      impact: {
        affectedLabels: ['封面'],
        preservedLabels: ['第2页', '第3页'],
        rebilled: true,
        alreadyInvokedUnitIds: ['page-1'],
        requiresRequote: false,
        requiresCorrection: false,
        feeNote:
          '封面会按你的改法重新生成并计 12 积分；其余页不动，不另算积分。',
        settledNote: '之前已经生成的那次照常计费、不退回，原来那版也会留着。',
        queueNote: null,
      },
    }),
  });
  assert.equal(impact.rebilled, true);
  assert.match(impact.feeNote, /并计 12 积分/u);
  assert.match(impact.settledNote ?? '', /照常计费、不退回/u);
  // D-061: the merchant reads 积分, never an upstream provider price.
  assert.doesNotMatch(impact.feeNote, /成本|上游|供应商|provider/iu);
});

test('plan_change and unsafe answers come through as Core classified them', () => {
  const requote = projectSteeringImpact({
    result: submitResult({
      applicationStatus: 'requires_replan_confirm',
      nextAction: 'replan_requote_confirm',
      classification: {
        kind: 'plan_change',
        reason: '数量变化',
        requiresReplan: true,
      },
      impact: {
        affectedLabels: [],
        preservedLabels: ['封面', '第2页', '第3页'],
        rebilled: false,
        alreadyInvokedUnitIds: [],
        requiresRequote: true,
        requiresCorrection: false,
        feeNote: '这次改动会动到方案范围，积分要重新算一次，确认后才继续。',
        settledNote: null,
        queueNote: null,
      },
    }),
  });
  assert.equal(requote.requiresRequote, true);
  assert.equal(requote.rebilled, false);
  assert.equal(requote.preservedLabels.length, 3);

  const unsafe = projectSteeringImpact({
    result: submitResult({
      applicationStatus: 'rejected_unsafe',
      nextAction: 'ask_merchant_correct',
      classification: {
        kind: 'unsafe_or_conflicting',
        reason: '无法确定影响范围，请指明要改的页面或步骤',
      },
      impact: {
        affectedLabels: [],
        preservedLabels: [],
        rebilled: false,
        alreadyInvokedUnitIds: [],
        requiresRequote: false,
        requiresCorrection: true,
        feeNote: '',
        settledNote: null,
        queueNote: null,
      },
    }),
  });
  assert.equal(unsafe.requiresCorrection, true);
  assert.equal(unsafe.feeNote, '');
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
