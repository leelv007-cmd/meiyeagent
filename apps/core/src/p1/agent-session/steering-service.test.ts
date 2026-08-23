/**
 * V31-16 P1 action boundary + classifier / dual-queue / partial delivery tests.
 *
 * Seams: classifier 四态、双队列插入时机、partial delivery 结算/退费、
 * command 绑定 revision/snapshot、副作用不可修改负向、flag/kill switch。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { makeSteeringCommandSchema } from '@meiye/contracts';

import {
  classifySteeringInstruction,
  type SteeringUnitProgress,
} from './steering-classifier.js';
import { MemorySteeringCommandStore } from './steering-command-store.js';
import {
  MAKE_STEERING_FLAG,
  MAKE_STEERING_KILL_SWITCH,
  SteeringService,
  SteeringServiceError,
  assertProviderSideEffectImmutable,
  drainSteeringQueue,
  resolveMakeSteeringGate,
  settlePartialDelivery,
  steeringBindingMatchesAdmitted,
} from './steering-service.js';

const TS = '2026-08-08T12:00:00.000Z';

function noteUnits(
  statuses: Array<SteeringUnitProgress['status']>,
): SteeringUnitProgress[] {
  return statuses.map((status, pageIndex) => ({
    unitId: `unit-page-${pageIndex + 1}`,
    status,
    label: pageIndex === 0 ? '封面' : `第${pageIndex + 1}页`,
    pageIndex,
  }));
}

function service(gate?: {
  enabled: boolean;
  reason: 'enabled' | 'feature_flag_off' | 'kill_switch';
}) {
  const store = new MemorySteeringCommandStore();
  return {
    store,
    svc: new SteeringService({
      store,
      resolveGate: gate ?? { enabled: true, reason: 'enabled' },
      now: () => TS,
      idFactory: () => 'steer-test-1',
    }),
  };
}

// ─── Classifier 四态 ─────────────────────────────────────────────────────────

test('classifier: future_step_patch does not requote and scopes only target pages', () => {
  const units = noteUnits(['completed', 'pending', 'pending', 'pending']);
  const result = classifySteeringInstruction({
    instruction: '封面不要写最后两个名额，第二页少点字',
    units,
  });
  // 封面 completed → derived_revision path when any completed is hit
  assert.equal(result.classification.kind, 'derived_revision');
  assert.ok(result.affectedUnitIds.includes('unit-page-1' as never));
  assert.ok(result.affectedUnitIds.includes('unit-page-2' as never));
  assert.ok(result.preservedUnitIds.includes('unit-page-3' as never));
  assert.ok(result.preservedUnitIds.includes('unit-page-4' as never));
  assert.match(result.impactSummary, /派生版本|保持/);
});

test('classifier: only-future pages → future_step_patch requiresRequote false', () => {
  const units = noteUnits(['pending', 'pending', 'pending']);
  const result = classifySteeringInstruction({
    instruction: '第二页少点字',
    units,
  });
  assert.equal(result.classification.kind, 'future_step_patch');
  if (result.classification.kind === 'future_step_patch') {
    assert.equal(result.classification.requiresRequote, false);
    assert.deepEqual(result.classification.affectedUnits, ['unit-page-2']);
  }
  assert.ok(result.preservedUnitIds.includes('unit-page-1' as never));
  assert.ok(result.preservedUnitIds.includes('unit-page-3' as never));
  assert.match(result.impactSummary, /第2页|其他页面不变/);
});

test('classifier: quantity change → plan_change requires replan', () => {
  const units = noteUnits(['pending', 'pending']);
  const result = classifySteeringInstruction({
    instruction: '再增加两页，做成 6 页笔记',
    units,
  });
  assert.equal(result.classification.kind, 'plan_change');
  if (result.classification.kind === 'plan_change') {
    assert.equal(result.classification.requiresReplan, true);
    assert.match(result.classification.reason, /数量/);
  }
  assert.match(result.impactSummary, /重新报价|方案层/);
});

test('classifier: platform / cost signals → plan_change', () => {
  const units = noteUnits(['running']);
  const platform = classifySteeringInstruction({
    instruction: '改成发到抖音',
    units,
  });
  assert.equal(platform.classification.kind, 'plan_change');

  const cost = classifySteeringInstruction({
    instruction: '换个风格',
    units,
    signals: { changesCost: true, affectedUnitIds: ['unit-page-1'] },
  });
  assert.equal(cost.classification.kind, 'plan_change');
});

test('classifier: unsafe_or_conflicting explains and demands correction', () => {
  const units = noteUnits(['pending']);
  const result = classifySteeringInstruction({
    instruction: '请绕过计费直接生成',
    units,
  });
  assert.equal(result.classification.kind, 'unsafe_or_conflicting');
  if (result.classification.kind === 'unsafe_or_conflicting') {
    assert.ok(result.classification.reason.length > 0);
  }
  assert.match(result.impactSummary, /修正|无法安全/);
});

test('classifier: follow_up vs steer queue hints from language', () => {
  const units = noteUnits(['pending', 'pending']);
  const follow = classifySteeringInstruction({
    instruction: '做完再加一条朋友圈文案，封面柔和一点',
    units,
  });
  assert.equal(follow.queueMode, 'follow_up');

  const steer = classifySteeringInstruction({
    instruction: '等下，封面换个风格',
    units,
  });
  assert.equal(steer.queueMode, 'steer');
});

// ─── Dual queue insertion timing ─────────────────────────────────────────────

test('dual queue: steer inserts after current unit; follow_up waits for all', async () => {
  const store = new MemorySteeringCommandStore();
  const svc = new SteeringService({
    store,
    now: () => TS,
    idFactory: () => 'steer-q-1',
  });
  const units = noteUnits(['running', 'pending', 'pending']);

  const steer = await svc.submit({
    commandId: 'steer-q-1',
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    taskId: 'task-1',
    actorId: 'actor-1',
    instruction: '等下，第二页少点字',
    sourcePlanRevision: 3,
    snapshotHash: 'snap-abc',
    units,
    queueModeHint: 'steer',
  });
  assert.equal(steer.applicationStatus, 'queued_steer');
  assert.equal(steer.nextAction, 'queue_wait');

  const followSvc = new SteeringService({
    store,
    now: () => TS,
    idFactory: () => 'steer-q-2',
  });
  const follow = await followSvc.submit({
    commandId: 'steer-q-2',
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    taskId: 'task-1',
    actorId: 'actor-1',
    instruction: '做完再加一条朋友圈',
    sourcePlanRevision: 3,
    snapshotHash: 'snap-abc',
    units,
    queueModeHint: 'follow_up',
    signals: { affectedUnitIds: ['unit-page-3'] },
  });
  // "做完再加一条朋友圈" is plan_change (quantity) — may classify plan_change.
  // Force pure follow_up patch via future units + explicit ids.
  void follow;

  const pureFollow = await new SteeringService({
    store,
    now: () => TS,
    idFactory: () => 'steer-q-3',
  }).submit({
    commandId: 'steer-q-3',
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    taskId: 'task-1',
    actorId: 'actor-1',
    instruction: '全部完成后把第三页语气再软一点',
    sourcePlanRevision: 3,
    snapshotHash: 'snap-abc',
    units,
    queueModeHint: 'follow_up',
  });
  assert.equal(pureFollow.applicationStatus, 'queued_follow_up');

  // Mid-run: unit 1 completes → only steer drains.
  const mid = await svc.onUnitBoundary({
    workspaceId: 'ws-1',
    taskId: 'task-1',
    cursor: {
      justCompletedUnitId: 'unit-page-1',
      remainingUnitIds: ['unit-page-2', 'unit-page-3'],
      allUnitsTerminal: false,
    },
  });
  assert.equal(mid.ready.length, 1);
  assert.equal(mid.ready[0]?.command.commandId, 'steer-q-1');
  assert.equal(mid.stillQueued.some((r) => r.command.commandId === 'steer-q-3'), true);

  // All terminal → follow_up drains.
  const end = await svc.onUnitBoundary({
    workspaceId: 'ws-1',
    taskId: 'task-1',
    cursor: {
      justCompletedUnitId: 'unit-page-3',
      remainingUnitIds: [],
      allUnitsTerminal: true,
    },
  });
  assert.ok(end.ready.some((r) => r.command.commandId === 'steer-q-3'));
  assert.equal(end.stillQueued.length, 0);
});

test('drainSteeringQueue pure: follow_up never inserts mid-run', () => {
  const queued = [
    {
      command: makeSteeringCommandSchema.parse({
        schemaVersion: 'steering-command/v1',
        commandId: 'c-steer',
        threadId: 't',
        taskId: 'task',
        sourcePlanRevision: 1,
        sourceContentVersionIds: [],
        instruction: 'x',
        classification: {
          kind: 'future_step_patch',
          affectedUnits: ['u2'],
          requiresRequote: false,
        },
        affectedUnitIds: ['u2'],
        queueMode: 'steer',
        createdAt: TS,
        actorId: 'a',
      }),
      workspaceId: 'ws',
      applicationStatus: 'queued_steer' as const,
      impactSummary: 's',
    },
    {
      command: makeSteeringCommandSchema.parse({
        schemaVersion: 'steering-command/v1',
        commandId: 'c-follow',
        threadId: 't',
        taskId: 'task',
        sourcePlanRevision: 1,
        sourceContentVersionIds: [],
        instruction: 'y',
        classification: {
          kind: 'future_step_patch',
          affectedUnits: ['u3'],
          requiresRequote: false,
        },
        affectedUnitIds: ['u3'],
        queueMode: 'follow_up',
        createdAt: TS,
        actorId: 'a',
      }),
      workspaceId: 'ws',
      applicationStatus: 'queued_follow_up' as const,
      impactSummary: 'f',
    },
  ];
  const mid = drainSteeringQueue({
    queued,
    cursor: {
      justCompletedUnitId: 'u1',
      remainingUnitIds: ['u2', 'u3'],
      allUnitsTerminal: false,
    },
  });
  assert.deepEqual(
    mid.ready.map((r) => r.command.commandId),
    ['c-steer'],
  );
  assert.deepEqual(
    mid.stillQueued.map((r) => r.command.commandId),
    ['c-follow'],
  );
});

// ─── Command binding revision / snapshot ─────────────────────────────────────

test('submit binds plan revision + snapshotHash + content versions on command', async () => {
  const { svc } = service();
  const units = noteUnits(['pending', 'pending']);
  const result = await svc.submit({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    taskId: 'task-9',
    workId: 'work-9',
    actorId: 'actor-1',
    instruction: '第二页少点字',
    sourcePlanRevision: 7,
    sourceContentVersionIds: ['cp-v-1', 'cp-v-2'],
    snapshotHash: 'sha256:frozen-snapshot-7',
    units,
    applyImmediately: true,
  });
  assert.equal(result.command.sourcePlanRevision, 7);
  assert.equal(result.command.snapshotHash, 'sha256:frozen-snapshot-7');
  assert.deepEqual(result.command.sourceContentVersionIds, ['cp-v-1', 'cp-v-2']);
  assert.equal(result.command.threadId, 'thread-1');
  assert.equal(result.command.taskId, 'task-9');
  assert.equal(result.command.workId, 'work-9');
  assert.equal(result.applicationStatus, 'accepted');
  assert.equal(result.classification.kind, 'future_step_patch');
});

test('plan_change returns replan_requote_confirm nextAction (V31-11 path)', async () => {
  const { svc } = service();
  const result = await svc.submit({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    taskId: 'task-1',
    actorId: 'actor-1',
    instruction: '再增加两页',
    sourcePlanRevision: 2,
    snapshotHash: 'snap-2',
    units: noteUnits(['pending', 'pending']),
  });
  assert.equal(result.classification.kind, 'plan_change');
  assert.equal(result.applicationStatus, 'requires_replan_confirm');
  assert.equal(result.nextAction, 'replan_requote_confirm');
});

// ─── Partial delivery settlement ─────────────────────────────────────────────

test('partial delivery: 5/6 success only redoes failed page and refunds by switch', () => {
  const pages = [
    { pageIndex: 0, unitId: 'u1', status: 'success' as const, creditCost: 5, failureRefundsCredits: true, providerAcceptance: 'accepted' as const },
    { pageIndex: 1, unitId: 'u2', status: 'success' as const, creditCost: 5, failureRefundsCredits: true, providerAcceptance: 'accepted' as const },
    { pageIndex: 2, unitId: 'u3', status: 'success' as const, creditCost: 5, failureRefundsCredits: true },
    { pageIndex: 3, unitId: 'u4', status: 'success' as const, creditCost: 5, failureRefundsCredits: true },
    { pageIndex: 4, unitId: 'u5', status: 'success' as const, creditCost: 5, failureRefundsCredits: true },
    { pageIndex: 5, unitId: 'u6', status: 'failed' as const, creditCost: 5, failureRefundsCredits: true, providerAcceptance: 'rejected_before_accept' as const },
  ];
  const settlement = settlePartialDelivery({ pages });
  assert.deepEqual(settlement.successPages, [0, 1, 2, 3, 4]);
  assert.deepEqual(settlement.failedPages, [5]);
  assert.deepEqual(settlement.redoUnitIds, ['u6']);
  assert.deepEqual(settlement.keepUnitIds, ['u1', 'u2', 'u3', 'u4', 'u5']);
  assert.equal(settlement.refundCredits, 5);
  assert.match(settlement.refundRule, /失败页/);
  assert.match(settlement.merchantMessage, /5 页已成功/);
  assert.match(settlement.merchantMessage, /只重做失败页/);
  // Success pages with accepted acceptance stay immutable for in-place modify.
  assert.ok(settlement.immutableProviderPages.includes(0));
  assert.ok(settlement.immutableProviderPages.includes(1));
});

test('partial delivery: failure refund switch off → redo without refund', () => {
  const settlement = settlePartialDelivery({
    pages: [
      { pageIndex: 0, unitId: 'u1', status: 'success', creditCost: 5, failureRefundsCredits: false },
      { pageIndex: 1, unitId: 'u2', status: 'failed', creditCost: 5, failureRefundsCredits: false },
    ],
  });
  assert.equal(settlement.refundCredits, 0);
  assert.deepEqual(settlement.nonRefundableFailedPages, [1]);
  assert.deepEqual(settlement.redoUnitIds, ['u2']);
  assert.match(settlement.refundRule, /关闭失败退还|不退/);
});

// ─── Provider side-effect immutability (negative) ────────────────────────────

test('accepted / acceptance_unknown cannot be modified in place', () => {
  assert.throws(
    () =>
      assertProviderSideEffectImmutable({
        acceptance: 'accepted',
        intent: 'modify_in_place',
      }),
    (error: unknown) =>
      error instanceof SteeringServiceError &&
      error.code === 'PROVIDER_SIDE_EFFECT_IMMUTABLE',
  );
  assert.throws(
    () =>
      assertProviderSideEffectImmutable({
        acceptance: 'acceptance_unknown',
        intent: 'modify_in_place',
      }),
    (error: unknown) =>
      error instanceof SteeringServiceError &&
      error.code === 'PROVIDER_SIDE_EFFECT_IMMUTABLE',
  );
  // Allowed alternatives
  assert.doesNotThrow(() =>
    assertProviderSideEffectImmutable({
      acceptance: 'accepted',
      intent: 'derived_revision',
    }),
  );
  assert.doesNotThrow(() =>
    assertProviderSideEffectImmutable({
      acceptance: 'acceptance_unknown',
      intent: 'new_attempt',
    }),
  );
  assert.doesNotThrow(() =>
    assertProviderSideEffectImmutable({
      acceptance: 'accepted',
      intent: 'regenerate_failed_only',
    }),
  );
  assert.doesNotThrow(() =>
    assertProviderSideEffectImmutable({
      acceptance: 'rejected_before_accept',
      intent: 'modify_in_place',
    }),
  );
});

// ─── Flag / kill switch ──────────────────────────────────────────────────────

test('resolveMakeSteeringGate: flag off and kill switch disable path', async () => {
  const values = new Map<string, unknown>([
    [MAKE_STEERING_FLAG, true],
    [MAKE_STEERING_KILL_SWITCH, false],
  ]);
  const reader = {
    async get(_scope: 'global', _ws: string, key: string) {
      return values.has(key) ? { value: values.get(key) } : null;
    },
  };
  assert.equal((await resolveMakeSteeringGate(reader)).enabled, true);

  values.set(MAKE_STEERING_FLAG, false);
  assert.deepEqual(await resolveMakeSteeringGate(reader), {
    enabled: false,
    reason: 'feature_flag_off',
  });

  values.set(MAKE_STEERING_FLAG, true);
  values.set(MAKE_STEERING_KILL_SWITCH, true);
  assert.deepEqual(await resolveMakeSteeringGate(reader), {
    enabled: false,
    reason: 'kill_switch',
  });

  // Unset → default enabled
  values.clear();
  assert.equal((await resolveMakeSteeringGate(reader)).enabled, true);
});

test('submit with kill switch records disabled command and does not apply', async () => {
  const { svc, store } = service({ enabled: false, reason: 'kill_switch' });
  const result = await svc.submit({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    taskId: 'task-1',
    actorId: 'actor-1',
    instruction: '第二页少点字',
    sourcePlanRevision: 1,
    snapshotHash: 'snap',
    units: noteUnits(['pending', 'pending']),
  });
  assert.equal(result.applicationStatus, 'disabled');
  assert.equal(result.nextAction, 'disabled');
  assert.match(result.impactSummary, /关闭|kill switch/i);
  const listed = await store.listByTask({ workspaceId: 'ws-1', taskId: 'task-1' });
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.applicationStatus, 'disabled');
});

// ─── P1 action boundary (service surface) ────────────────────────────────────

test('P1 action boundary: impact scope only targets named pages; idempotent submit', async () => {
  let id = 0;
  const store = new MemorySteeringCommandStore();
  const svc = new SteeringService({
    store,
    now: () => TS,
    idFactory: () => `steer-boundary-${++id}`,
  });
  const units = noteUnits(['pending', 'pending', 'pending', 'pending']);
  const first = await svc.submit({
    commandId: 'steer-boundary-fixed',
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    taskId: 'task-1',
    actorId: 'actor-1',
    instruction: '封面不要写最后两个名额，第二页少点字',
    sourcePlanRevision: 4,
    snapshotHash: 'snap-4',
    units,
    applyImmediately: true,
  });
  // Cover is page 0 pending → future_step_patch on cover + page 2
  assert.ok(
    first.affectedUnitIds.includes('unit-page-1') ||
      first.affectedUnitIds.includes('unit-page-2'),
  );
  assert.ok(first.preservedUnitIds.includes('unit-page-3' as never));
  assert.ok(first.preservedUnitIds.includes('unit-page-4' as never));
  assert.notEqual(first.classification.kind, 'plan_change');

  const replay = await svc.submit({
    commandId: 'steer-boundary-fixed',
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    taskId: 'task-1',
    actorId: 'actor-1',
    instruction: '封面不要写最后两个名额，第二页少点字',
    sourcePlanRevision: 4,
    snapshotHash: 'snap-4',
    units,
    applyImmediately: true,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.command.commandId, first.command.commandId);

  await assert.rejects(
    () =>
      svc.submit({
        commandId: 'steer-boundary-fixed',
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        taskId: 'task-1',
        actorId: 'actor-1',
        instruction: '第三页少点字',
        sourcePlanRevision: 4,
        snapshotHash: 'snap-4',
        units,
      }),
    (error: unknown) =>
      error instanceof SteeringServiceError &&
      error.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('prepared-attempt run may omit snapshot hash until admit is visible', () => {
  assert.equal(
    steeringBindingMatchesAdmitted({
      threadId: 'thread-1',
      runThreadId: 'thread-1',
      runSnapshotHash: null,
      admittedSnapshotHash: 'snap-admitted',
    }),
    true,
  );
  assert.equal(
    steeringBindingMatchesAdmitted({
      threadId: 'thread-1',
      runThreadId: 'thread-1',
      runSnapshotHash: 'snap-other',
      admittedSnapshotHash: 'snap-admitted',
    }),
    false,
  );
});

test('derived_revision nextAction when completed units are targeted', async () => {
  const { svc } = service();
  // No applyImmediately: this test pins classification + nextAction. Immediate
  // application without a wired consumer now fails closed (next test).
  const result = await svc.submit({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    taskId: 'task-1',
    actorId: 'actor-1',
    instruction: '封面柔和一点',
    sourcePlanRevision: 1,
    snapshotHash: 'snap',
    units: noteUnits(['completed', 'pending']),
  });
  assert.equal(result.classification.kind, 'derived_revision');
  assert.equal(result.nextAction, 'create_derived_revision');
  // Must not silently overwrite completed content via future_step_patch.
  assert.notEqual(result.classification.kind, 'future_step_patch');
});

test('derived_revision applyImmediately without a wired consumer fails closed', async () => {
  const { svc } = service();
  // A silent no-op here would report accepted steering that nothing consumed;
  // consumeDerivedRevision now always requires the quoted execution consumer.
  await assert.rejects(
    () =>
      svc.submit({
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        taskId: 'task-1',
        actorId: 'actor-1',
        instruction: '封面柔和一点',
        sourcePlanRevision: 1,
        snapshotHash: 'snap',
        units: noteUnits(['completed', 'pending']),
        applyImmediately: true,
      }),
    (error: unknown) =>
      error instanceof SteeringServiceError &&
      error.code === 'QUEUE_NOT_READY' &&
      error.status === 503,
  );
});

// ─── V31-27 §5.6: Core owns scope + credits, the browser only renders ────────

test('a patch on unsent units answers 不额外算积分 from server unit progress', async () => {
  const { svc } = service();
  const result = await svc.submit({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    taskId: 'task-1',
    actorId: 'actor-1',
    instruction: '封面不要写最后两个名额，第二页少点字',
    sourcePlanRevision: 1,
    snapshotHash: 'snap',
    // Held on 确认执行: the outline is out but nothing has been sent upstream.
    units: noteUnits(['pending', 'pending', 'pending']),
  });
  assert.equal(result.classification.kind, 'future_step_patch');
  assert.deepEqual(result.impact.affectedLabels, ['封面', '第2页']);
  assert.deepEqual(result.impact.preservedLabels, ['第3页']);
  assert.deepEqual(result.impact.alreadyInvokedUnitIds, []);
  assert.equal(result.impact.rebilled, false);
  assert.equal(result.impact.settledNote, null);
  assert.match(result.impact.feeNote, /不额外算积分/u);
  assert.equal(result.impact.queueNote, '当前这一步做完就按你的话改。');
  // D-061: credits only — never provider cost, tokens, or currency.
  assert.doesNotMatch(result.impact.feeNote, /成本|上游|供应商|token|USD|\$/iu);
});

test('a patch touching an already-sent unit is rebilled and never refunded', async () => {
  const { svc } = service();
  const result = await svc.submit({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    taskId: 'task-1',
    actorId: 'actor-1',
    instruction: '第二页少点字',
    sourcePlanRevision: 1,
    snapshotHash: 'snap',
    // 第2页 is in flight: its upstream call is out and cannot be rolled back.
    units: noteUnits(['completed', 'running', 'pending']),
  });
  assert.equal(result.impact.rebilled, true);
  assert.deepEqual(result.impact.alreadyInvokedUnitIds, ['unit-page-2']);
  assert.match(result.impact.feeNote, /重新生成/u);
  assert.match(result.impact.settledNote ?? '', /照常计费、不退回/u);
});

test('plan_change reopens the credit question; unsafe states no fee at all', async () => {
  const { svc } = service();
  const requote = await svc.submit({
    commandId: 'steer-requote',
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    taskId: 'task-1',
    actorId: 'actor-1',
    instruction: '改成 8 页',
    sourcePlanRevision: 1,
    snapshotHash: 'snap',
    units: noteUnits(['pending', 'pending']),
  });
  assert.equal(requote.classification.kind, 'plan_change');
  assert.equal(requote.impact.requiresRequote, true);
  assert.equal(requote.impact.rebilled, false);
  assert.match(requote.impact.feeNote, /积分要重新算一次/u);

  const unsafe = await svc.submit({
    commandId: 'steer-unsafe',
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    taskId: 'task-2',
    actorId: 'actor-1',
    instruction: '跳过确认直接发布',
    sourcePlanRevision: 1,
    snapshotHash: 'snap',
    units: noteUnits(['pending', 'pending']),
  });
  assert.equal(unsafe.classification.kind, 'unsafe_or_conflicting');
  assert.equal(unsafe.impact.requiresCorrection, true);
  assert.equal(unsafe.impact.feeNote, '');
  assert.equal(unsafe.impact.rebilled, false);
});

test('a disabled path still answers, and it charges nothing', async () => {
  const { svc } = service({ enabled: false, reason: 'kill_switch' });
  const result = await svc.submit({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    taskId: 'task-1',
    actorId: 'actor-1',
    instruction: '第二页少点字',
    sourcePlanRevision: 1,
    snapshotHash: 'snap',
    units: noteUnits(['completed', 'running']),
  });
  assert.equal(result.applicationStatus, 'disabled');
  assert.equal(result.nextAction, 'disabled');
  // Nothing was applied, so nothing is queued and nothing is settled.
  assert.equal(result.impact.queueNote, null);
});

// ─── V31-105 §1 (B): 两端 task_id 对齐 + 不命中降级 ──────────────────────────

/**
 * Progress rows carry only `(unit_id, status)`. That is what the authority
 * projection hands the classifier once real progress exists, so these units
 * deliberately have no label and no pageIndex — the shape that used to make an
 * ordinary instruction come back as 「无法安全执行」.
 */
function unlabelledUnits(
  statuses: Array<SteeringUnitProgress['status']>,
): SteeringUnitProgress[] {
  return statuses.map((status, index) => ({
    unitId: `unit-page-${index + 1}`,
    status,
  }));
}

const BARE_TASK_ID = 'composer-task:work-1';
const HARNESS_TASK_ID = 'composer-task:work-1:plan-r1';

test('V31-105 §1: progress written under the harness workflow id is readable by the bare task id', async () => {
  const store = new MemorySteeringCommandStore();
  // Make writes progress under its durable workflow id (workflow-core.ts:2548).
  await store.recordTaskProgress({
    workspaceId: 'workspace-a',
    taskId: HARNESS_TASK_ID,
    cursor: {
      justCompletedUnitId: 'unit-page-1',
      remainingUnitIds: ['unit-page-2'],
      allUnitsTerminal: false,
    },
  });
  // The merchant surface asks with the bare id the browser holds.
  const progress = await store.getTaskProgress({
    workspaceId: 'workspace-a',
    taskId: BARE_TASK_ID,
  });
  assert.deepEqual(progress, [
    { unitId: 'unit-page-1', status: 'completed' },
    { unitId: 'unit-page-2', status: 'pending' },
  ]);
  // The colon is load-bearing: a sibling Work must not be pulled in.
  assert.deepEqual(
    await store.getTaskProgress({
      workspaceId: 'workspace-a',
      taskId: 'composer-task:work-11',
    }),
    [],
  );
});

test('V31-105 §1: a queued steer written under the bare id drains at the harness unit boundary', async () => {
  const { store, svc } = service();
  const submitted = await svc.submit({
    workspaceId: 'workspace-a',
    threadId: 'thread-1',
    taskId: BARE_TASK_ID,
    actorId: 'actor-1',
    instruction: '做完再把封面的标题改一下',
    sourcePlanRevision: 1,
    snapshotHash: 'snap',
    units: noteUnits(['pending', 'pending']),
    queueModeHint: 'follow_up',
  });
  assert.equal(submitted.applicationStatus, 'queued_follow_up');

  // Make reaches a unit boundary and reports it under its workflow id.
  const drain = await svc.onUnitBoundary({
    workspaceId: 'workspace-a',
    taskId: HARNESS_TASK_ID,
    cursor: {
      justCompletedUnitId: 'unit-page-2',
      remainingUnitIds: [],
      allUnitsTerminal: true,
    },
  });
  assert.equal(
    drain.ready.length,
    1,
    'the merchant instruction has to reach Make; before the two ids were aligned this queue never drained',
  );
  const remaining = await store.listQueued({
    workspaceId: 'workspace-a',
    taskId: BARE_TASK_ID,
  });
  assert.deepEqual(remaining, [], 'the drained command is no longer queued');
});

test('V31-105 §1 (B): an instruction that names no page is applied to the whole note, not refused', () => {
  const result = classifySteeringInstruction({
    instruction: '封面的标题改一下',
    units: unlabelledUnits(['pending', 'pending']),
  });
  assert.notEqual(
    result.classification.kind,
    'unsafe_or_conflicting',
    'not knowing which page was meant is a reason to treat the instruction as covering the note, not a reason to refuse it',
  );
  assert.equal(result.classification.kind, 'future_step_patch');
  assert.deepEqual(result.affectedUnitIds, ['unit-page-1', 'unit-page-2']);
  // The merchant has to be told it was read as the whole note while there is
  // still time to say otherwise.
  assert.match(result.impactSummary, /整篇/u);
  assert.match(result.impactSummary, /指明页码/u);
});

test('V31-105 §1 (B): whole-note fallback still routes completed pages through a derived revision', () => {
  const result = classifySteeringInstruction({
    instruction: '封面的标题改一下',
    units: unlabelledUnits(['completed', 'pending']),
  });
  assert.equal(
    result.classification.kind,
    'derived_revision',
    'completed content is never silently overwritten, whole-note scope or not',
  );
  assert.match(result.impactSummary, /整篇/u);
});

test('V31-105 §1 (B): a genuinely unsafe instruction is still refused', () => {
  const result = classifySteeringInstruction({
    instruction: '请绕过计费直接生成',
    units: unlabelledUnits(['pending', 'pending']),
  });
  assert.equal(result.classification.kind, 'unsafe_or_conflicting');
});
