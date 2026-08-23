/**
 * Composer conversation session model (T30 / #224, D-114 / ADR-0014).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { WorkflowProgressEnvelope } from '@meiye/contracts';

import {
  applyComposerExecutionConfirm,
  applyComposerPendingInterrupts,
  applyComposerProgress,
  applyComposerQuestion,
  applyComposerWorkflowState,
  bindComposerTask,
  COMPOSER_SESSION_STORAGE_VERSION,
  COMPOSER_SESSION_TTL_MS,
  composerFailureLocksIntent,
  composerSessionMerchantText,
  createComposerSession,
  failComposerSession,
  cancelComposerSession,
  openComposerTurn,
  rebindComposerSession,
  composerSessionStorageKey,
  readPersistedComposerSession,
  shouldPollServerRestore,
  shouldSkipPersistedComposerRestore,
  restoreComposerSession,
  restoreComposerSessionFromActiveTask,
  restoreComposerSessionFromCompletedTask,
  serializeComposerSession,
  writePersistedComposerSession,
  type ComposerSession,
} from './composer-session';

const TASK = {
  taskId: 'task-1',
  workId: 'work-1',
  packageId: 'package-1',
};

function progress(
  overrides: Partial<WorkflowProgressEnvelope> & { sequence: number }
): WorkflowProgressEnvelope {
  return {
    eventId: `workflow-1:event:${overrides.sequence}`,
    workflowId: 'workflow-1',
    workflowType: 'creation',
    stage: 'context_injection',
    state: 'success',
    occurredAt: '2026-07-25T08:00:00.000Z',
    ...overrides,
  };
}

function runningSession(): ComposerSession {
  return bindComposerTask(
    openComposerTurn(createComposerSession('session-1'), '写一条周末预约文案'),
    TASK
  );
}

test('the merchant sentence opens the run and the task binds the candidate area', () => {
  const opened = openComposerTurn(
    createComposerSession('session-1'),
    '  写一条周末预约文案  '
  );
  assert.equal(opened.phase, 'submitting');
  assert.deepEqual(opened.turns, [
    {
      kind: 'merchant',
      id: 'session-1:merchant:0',
      text: '写一条周末预约文案',
    },
  ]);

  const bound = bindComposerTask(opened, TASK);
  assert.equal(bound.phase, 'running');
  assert.deepEqual(bound.task, TASK);
  assert.deepEqual(
    bound.turns.map((turn) => turn.kind),
    ['merchant', 'candidate']
  );
  // Re-binding the same task (replayed submission) must not stack a second area.
  assert.equal(bindComposerTask(bound, TASK), bound);
});

test('blank input never opens a turn', () => {
  const session = createComposerSession('session-1');
  assert.equal(openComposerTurn(session, '   '), session);
});

test('each merchant sentence in one session gets a unique turn id', () => {
  // Regression: ISSUE-001 — duplicate React key `:merchant` on retry/revise.
  // Found by /qa on 2026-08-07
  // Report: .gstack/qa-reports/qa-report-localhost-3000-2026-08-07.md
  let session = openComposerTurn(
    createComposerSession('session-1'),
    '第一条意图'
  );
  session = openComposerTurn(session, '第二条意图');
  const merchantIds = session.turns
    .filter((turn) => turn.kind === 'merchant')
    .map((turn) => turn.id);
  assert.deepEqual(merchantIds, [
    'session-1:merchant:0',
    'session-1:merchant:1',
  ]);
});

test('intent_naming success is the D-111 route notice; other stages are stage turns', () => {
  let session = runningSession();
  session = applyComposerProgress(
    session,
    progress({
      sequence: 1,
      stage: 'intent_naming',
      message:
        '这次先按通用模式生成；以后补充门店、项目或风格资料，内容会更像你的店。',
    })
  );
  session = applyComposerProgress(
    session,
    progress({ sequence: 2, message: '已整理本次创作资料' })
  );

  const kinds = session.turns.map((turn) => turn.kind);
  // Stage announcements read above the candidate area they describe.
  assert.deepEqual(kinds, ['merchant', 'route_notice', 'stage', 'candidate']);
  const notice = session.turns[1];
  assert.equal(notice.kind, 'route_notice');
  assert.match(
    notice.kind === 'route_notice' ? notice.message : '',
    /通用模式/u
  );
});

test('replayed progress frames are idempotent', () => {
  let session = runningSession();
  const frame = progress({ sequence: 3, message: '已整理本次创作资料' });
  session = applyComposerProgress(session, frame);
  const afterFirst = session;
  session = applyComposerProgress(session, frame);
  assert.equal(session, afterFirst);
  // An older sequence from a reconnect replay is dropped too.
  session = applyComposerProgress(
    session,
    progress({ sequence: 2, message: '正在理解你的需求' })
  );
  assert.equal(session, afterFirst);
});

test('a progress frame without a message only advances the cursor', () => {
  let session = runningSession();
  session = applyComposerProgress(session, progress({ sequence: 5 }));
  assert.equal(session.progressSequence, 5);
  assert.deepEqual(
    session.turns.map((turn) => turn.kind),
    ['merchant', 'candidate']
  );
});

test('one blocking question at a time, cleared when it is answered or skipped', () => {
  let session = applyComposerQuestion(runningSession(), 'question-1');
  assert.equal(session.phase, 'awaiting_answer');
  assert.deepEqual(
    session.turns.map((turn) => turn.kind),
    ['merchant', 'question', 'candidate']
  );

  session = applyComposerQuestion(session, 'question-2');
  assert.equal(
    session.turns.filter((turn) => turn.kind === 'question').length,
    1
  );

  session = applyComposerQuestion(session, null);
  assert.equal(session.phase, 'running');
  // The cleared question keeps its turn: it anchors the interaction slot,
  // which shows the settled notice when the system answered by default.
  assert.equal(
    session.turns.filter((turn) => turn.kind === 'question').length,
    1
  );
});

test('paid-media execution_confirm is a distinct single timeline turn (P1-05)', () => {
  let session = applyComposerExecutionConfirm(
    runningSession(),
    'execution-request-1'
  );
  assert.equal(session.phase, 'awaiting_answer');
  assert.deepEqual(
    session.turns.map((turn) => turn.kind),
    ['merchant', 'execution_confirm', 'candidate']
  );

  session = applyComposerExecutionConfirm(session, 'execution-request-2');
  assert.equal(
    session.turns.filter((turn) => turn.kind === 'execution_confirm').length,
    1
  );
  const turn = session.turns.find((item) => item.kind === 'execution_confirm');
  assert.equal(
    turn && turn.kind === 'execution_confirm' ? turn.confirmId : null,
    'execution-request-2'
  );

  // Cleared confirm is removed (no settlement notice) — no empty DecisionFrame.
  session = applyComposerExecutionConfirm(session, null);
  assert.equal(session.phase, 'running');
  assert.equal(
    session.turns.filter((turn) => turn.kind === 'execution_confirm').length,
    0
  );
});

test('settled question clear does not demote phase while execution_confirm is live', () => {
  // Issue 1: note path settles note_style then holds execution_confirmation.
  // A question-clear effect must not race phase to `running` over the live hold.
  let session = applyComposerPendingInterrupts(runningSession(), {
    questionId: 'note-style-1',
    executionConfirmId: null,
  });
  assert.equal(session.phase, 'awaiting_answer');

  session = applyComposerPendingInterrupts(session, {
    questionId: null,
    executionConfirmId: 'execution-request-1',
  });
  assert.equal(session.phase, 'awaiting_answer');
  assert.equal(
    session.turns.filter((turn) => turn.kind === 'question').length,
    1
  );
  assert.equal(
    session.turns.filter((turn) => turn.kind === 'execution_confirm').length,
    1
  );

  // Re-apply the same clear + same confirm (workflow progress tick) stays waiting.
  session = applyComposerPendingInterrupts(session, {
    questionId: null,
    executionConfirmId: 'execution-request-1',
  });
  assert.equal(session.phase, 'awaiting_answer');

  // Also true for the split applyComposerQuestion clear path when confirm turn
  // is already present.
  session = applyComposerQuestion(session, null);
  assert.equal(session.phase, 'awaiting_answer');
});

test('rebind drops stale execution_confirm turns with other task-bound interrupts', () => {
  let session = applyComposerExecutionConfirm(
    runningSession(),
    'execution-request-stale'
  );
  session = applyComposerQuestion(session, 'question-stale');
  const rebound = rebindComposerSession(session, 'session-retry');
  assert.equal(
    rebound.turns.filter((turn) => turn.kind === 'execution_confirm').length,
    0
  );
  assert.equal(
    rebound.turns.filter((turn) => turn.kind === 'question').length,
    0
  );
  assert.equal(
    rebound.turns.filter((turn) => turn.kind === 'merchant').length,
    1
  );
});

test('success promotes the run into a delivery card instead of navigating', () => {
  let session = applyComposerQuestion(runningSession(), 'question-1');
  session = applyComposerWorkflowState(session, 'running');
  assert.equal(session.phase, 'awaiting_answer');

  session = applyComposerWorkflowState(session, 'success');
  assert.equal(session.phase, 'delivered');
  const delivery = session.turns.at(-1);
  assert.deepEqual(delivery, {
    kind: 'delivery',
    id: 'delivery:work-1',
    workId: 'work-1',
    taskId: 'task-1',
    packageId: 'package-1',
    // No 成品版本 frame in this fold, so the card gets no revision to bind to.
    revision: null,
  });
  // The question turn survives delivery as the settled-notice anchor; the
  // interaction slot renders the notice or nothing there, never a stale card.
  assert.equal(
    session.turns.filter((turn) => turn.kind === 'question').length,
    1
  );
  // Replayed terminal frames stay idempotent.
  const delivered = session;
  session = applyComposerWorkflowState(session, 'success');
  assert.equal(
    session.turns.filter((turn) => turn.kind === 'delivery').length,
    1
  );
  assert.equal(session.phase, delivered.phase);
});

test('a second successful attempt keeps the previous delivery and adds its own', () => {
  const first = applyComposerWorkflowState(runningSession(), 'success', {
    packageId: 'package-1',
    versionId: 'version-1',
    revision: 1,
  });
  const secondTask = {
    taskId: 'task-2',
    workId: 'work-2',
    packageId: 'package-2',
  };
  const second = applyComposerWorkflowState(
    bindComposerTask(
      openComposerTurn(
        rebindComposerSession(first, 'session-2'),
        '再写一条周末预约文案'
      ),
      secondTask
    ),
    'success',
    {
      packageId: 'package-2',
      versionId: 'version-2',
      revision: 1,
    }
  );

  const deliveries = second.turns.filter((turn) => turn.kind === 'delivery');
  assert.equal(second.phase, 'delivered');
  assert.deepEqual(
    deliveries.map((turn) => turn.workId),
    ['work-1', 'work-2']
  );
});

test('the 任务总结 lands on the delivery card, not in the progress rail', () => {
  // D-116 names 任务总结 as its own delivery-language output: 策略依据/版本定位/
  // 使用建议 describe the deliverable, so the card that carries the deliverable
  // is where the merchant reads them.
  const summary =
    '第 3 版已经准备好。策略依据：周末到店高峰。版本定位：这是本次适合小红书的主推荐。使用建议：建议先核对内容和预约引导，确认后再发布。';
  const session = applyComposerProgress(
    runningSession(),
    progress({ message: summary, sequence: 4, stage: 'assembly_delivery' })
  );
  assert.equal(session.deliveryStatement, summary);
  assert.equal(
    session.turns.some((turn) => turn.kind === 'stage'),
    false
  );
  // A non-terminal frame on the same stage is still a progress announcement.
  const running = applyComposerProgress(
    runningSession(),
    progress({
      message: '正在整理成品',
      sequence: 5,
      stage: 'assembly_delivery',
      state: 'running',
    })
  );
  assert.equal(running.deliveryStatement, null);
  assert.equal(
    running.turns.some((turn) => turn.kind === 'stage'),
    true
  );
});

test('the delivery card binds the revision the server actually delivered', () => {
  const delivery = {
    packageId: 'package-1',
    versionId: 'version-7',
    revision: 3,
  };
  let session = applyComposerWorkflowState(
    runningSession(),
    'success',
    delivery
  );
  const card = session.turns.at(-1);
  assert.equal(card?.kind, 'delivery');
  assert.deepEqual(card?.kind === 'delivery' ? card.revision : null, delivery);

  // A replayed terminal frame that arrived without the snapshot must not blank
  // out a revision already confirmed — the actions would silently unbind.
  session = applyComposerWorkflowState(session, 'success');
  const after = session.turns.at(-1);
  assert.deepEqual(
    after?.kind === 'delivery' ? after.revision : null,
    delivery
  );
});

test('a delivery card created before the revision arrived binds it late', () => {
  // The status can land first; the card must not stay unbound forever.
  let session = applyComposerWorkflowState(runningSession(), 'success');
  const unbound = session.turns.at(-1);
  assert.equal(unbound?.kind === 'delivery' ? unbound.revision : 'x', null);

  const delivery = {
    packageId: 'package-1',
    versionId: 'version-7',
    revision: 1,
  };
  session = applyComposerWorkflowState(session, 'success', delivery);
  const bound = session.turns.at(-1);
  assert.deepEqual(
    bound?.kind === 'delivery' ? bound.revision : null,
    delivery
  );
  assert.equal(
    session.turns.filter((turn) => turn.kind === 'delivery').length,
    1
  );
});

test('failure keeps the transcript so the merchant can retry in place', () => {
  const failed = applyComposerWorkflowState(runningSession(), 'failed');
  assert.equal(failed.phase, 'failed');
  // W03: the merchant's own sentence stays; the candidate area goes. A draft
  // that was blocked and will never be delivered must not be left on screen as
  // if it were usable — for a source/redline block it is exactly the text the
  // gate refused.
  assert.deepEqual(
    failed.turns.map((turn) => turn.kind),
    ['merchant']
  );

  const rejected = failComposerSession(
    openComposerTurn(createComposerSession('session-2'), '写点什么')
  );
  assert.equal(rejected.phase, 'failed');
  assert.equal(rejected.task, null);
});

test('late interrupt polls cannot revive a failed run', () => {
  const failed = applyComposerWorkflowState(runningSession(), 'failed');

  const afterLateQuestion = applyComposerQuestion(failed, 'stale-question');
  const afterLateConfirm = applyComposerExecutionConfirm(
    failed,
    'stale-execution-confirm'
  );
  const afterLatePoll = applyComposerPendingInterrupts(failed, {
    questionId: 'stale-question',
    executionConfirmId: 'stale-execution-confirm',
  });

  assert.deepEqual(afterLateQuestion, failed);
  assert.deepEqual(afterLateConfirm, failed);
  assert.deepEqual(afterLatePoll, failed);
});

/**
 * P0-2 / W03. Before this the transcript simply stopped on failure and the only
 * thing a merchant saw was a generic toast.
 */
test('a failed run states its reason, its next step and the refund in the flow', () => {
  const report = {
    kind: 'failure' as const,
    category: 'media_generation' as const,
    message: '这次图片没有顺利生成。你可以重新生成，或换一张参考素材再试。',
    nextStep: '可以直接重新生成，或者先改用文字方案发布。',
    actions: ['retry' as const, 'switch_form' as const],
    quotaRefunded: true,
  };
  const failed = applyComposerWorkflowState(
    runningSession(),
    'failed',
    undefined,
    undefined,
    report
  );

  assert.equal(failed.phase, 'failed');
  const turn = failed.turns.at(-1);
  assert.equal(turn?.kind, 'report');
  if (turn?.kind !== 'report') return;
  assert.deepEqual(turn.report, report);

  // Replay hands the same terminal frame back on every reconnect; the card must
  // not multiply.
  const replayed = applyComposerWorkflowState(
    failed,
    'failed',
    undefined,
    undefined,
    report
  );
  assert.equal(
    replayed.turns.filter((item) => item.kind === 'report').length,
    1
  );
});

/**
 * 改一下要求 keeps the conversation and rebinds it to a new attempt, so the
 * container has to tell what belongs to which run. Everything the previous run
 * left behind — its progress cursor, its 任务总结, its 申报 — would otherwise be
 * read as the new run's, and the new stream (numbered from zero) would be
 * dropped frame by frame against a cursor that outranks all of it.
 */
test('a second attempt in the same conversation starts with its own progress and no stale 申报', () => {
  const report = {
    kind: 'failure' as const,
    category: 'content_source' as const,
    message: '这次的说法在门店资料里找不到依据，所以没有交付。',
    nextStep: '补一条门店已确认的资料，或者去掉这条没依据的说法后再来一次。',
    actions: ['adjust_intent' as const, 'retry' as const],
    quotaRefunded: true,
  };
  const failed = applyComposerProgress(
    applyComposerWorkflowState(
      applyComposerProgress(runningSession(), progress({ sequence: 7 })),
      'failed',
      undefined,
      undefined,
      report
    ),
    progress({ sequence: 8, message: '第一次的进度' })
  );
  assert.equal(failed.progressSequence, 8);

  // Asserted on the rebind itself, before anything is bound: this is the state
  // the merchant sits in while they rewrite, and the window a later
  // bindComposerTask would otherwise paper over.
  const rebound = rebindComposerSession(failed, 'session-2');
  assert.equal(rebound.sessionId, 'session-2');
  // The finished run is unbound — the event stream keys on this handle, so
  // leaving it would let that run keep writing into the new session.
  assert.equal(rebound.task, null);
  assert.equal(rebound.progressSequence, -1);
  assert.equal(rebound.deliveryStatement, null);
  assert.equal(rebound.phase, 'idle');
  assert.equal(
    rebound.turns.filter((turn) => turn.kind === 'report').length,
    0
  );
  // The conversation itself is not the run's: what they said stays on screen.
  assert.deepEqual(
    rebound.turns.filter((turn) => turn.kind === 'merchant').length,
    1
  );
  const retried = bindComposerTask(
    openComposerTurn(rebound, '写一条不提价格的到店体验文案'),
    { taskId: 'task-2', workId: 'work-2', packageId: 'package-2' }
  );

  // The previous run's 申报 is not this run's story.
  assert.equal(
    retried.turns.filter((turn) => turn.kind === 'report').length,
    0
  );
  // …and its cursor does not swallow the new stream.
  assert.equal(retried.progressSequence, -1);
  assert.equal(retried.deliveryStatement, null);
  const streamed = applyComposerProgress(
    retried,
    progress({ sequence: 0, message: '正在读你的门店资料' })
  );
  assert.equal(streamed.progressSequence, 0);
  assert.ok(
    streamed.turns.some(
      (turn) => turn.kind === 'stage' && turn.message === '正在读你的门店资料'
    )
  );

  // A second failure of the same kind is a second failure, not a replay.
  const failedAgain = applyComposerWorkflowState(
    streamed,
    'failed',
    undefined,
    undefined,
    { ...report, message: '第二次也没能通过门店资料核对。' }
  );
  const reports = failedAgain.turns.filter((turn) => turn.kind === 'report');
  assert.equal(reports.length, 1);
  assert.equal(
    reports[0]?.kind === 'report' ? reports[0].report.message : '',
    '第二次也没能通过门店资料核对。'
  );

  // The handle that gets persisted names the run it is actually bound to.
  assert.equal(
    composerSessionMerchantText(failedAgain),
    '写一条不提价格的到店体验文案'
  );
});

test('a partial delivery shows both the deliverable and what did not land', () => {
  const delivered = applyComposerWorkflowState(
    runningSession(),
    'success',
    { packageId: 'package-1', versionId: 'version-1', revision: 3 },
    undefined,
    {
      kind: 'partial',
      category: 'consistency',
      message: '整套图文已经生成好了；其中 1 页的画面和文字还没完全对上。',
      nextStep: '可以先用已经对好的页面发布，稍后再让我重做那一页。',
      actions: ['review_partial', 'retry'],
      quotaRefunded: false,
    }
  );

  assert.equal(delivered.phase, 'delivered');
  assert.equal(
    delivered.turns.some((turn) => turn.kind === 'delivery'),
    true,
    'a partial run still delivers what it has'
  );
  assert.equal(
    delivered.turns.some((turn) => turn.kind === 'report'),
    true,
    'and says what it could not finish'
  );
});

test('an in-flight run is rebuilt from the server, not from the browser', () => {
  const restored = restoreComposerSessionFromActiveTask({
    sessionId: 'session-9',
    task: {
      taskId: 'task-1',
      workId: 'work-1',
      packageId: 'package-1',
      agentThreadId: 'thread-1',
      agentRunId: 'run-1',
      executionConfirmationRequestId: 'confirmation-1',
      merchantText: '写一条周末预约文案',
      submittedAt: '2026-07-27T08:00:00.000Z',
    },
  });

  assert.equal(restored.phase, 'running');
  assert.deepEqual(restored.task, {
    ...TASK,
    agentThreadId: 'thread-1',
    agentRunId: 'run-1',
    executionConfirmationRequestId: 'confirmation-1',
  });
  // Same shape as the sessionStorage restore: merchant turn + candidate area,
  // everything else comes back from the event replay.
  assert.deepEqual(
    restored.turns.map((turn) => turn.kind),
    ['merchant', 'candidate']
  );
  assert.equal(composerSessionMerchantText(restored), '写一条周末预约文案');
});

/**
 * V31-105 §12. A run that finished before the tab could read it used to be
 * unreachable: `readActiveHarnessTasks` lists only what is still running, so a
 * short run had already left every list the browser could ask for. The second
 * handle brings it back on the card it actually reached.
 */
test('a run that already finished comes back on its terminal card', () => {
  const delivered = restoreComposerSessionFromCompletedTask({
    sessionId: 'session-10',
    task: {
      taskId: 'task-1',
      workId: 'work-1',
      packageId: 'package-1',
      agentThreadId: 'thread-1',
      agentRunId: 'run-1',
      merchantText: '端午套餐做成视频',
      submittedAt: '2026-08-23T08:00:00.000Z',
      outcome: 'delivered',
      completedAt: '2026-08-23T08:04:00.000Z',
    },
  });
  assert.equal(delivered.phase, 'delivered');
  assert.deepEqual(delivered.task, {
    ...TASK,
    agentThreadId: 'thread-1',
    agentRunId: 'run-1',
  });
  // The 成品交付卡 is what the merchant came back for, and it carries the
  // workId the Result Center opens from.
  const deliveryTurn = delivered.turns.find((turn) => turn.kind === 'delivery');
  assert.ok(deliveryTurn, 'a delivered run must remount its delivery card');
  assert.equal(
    deliveryTurn && 'workId' in deliveryTurn ? deliveryTurn.workId : null,
    'work-1'
  );
  assert.equal(composerSessionMerchantText(delivered), '端午套餐做成视频');

  const failed = restoreComposerSessionFromCompletedTask({
    sessionId: 'session-11',
    task: {
      taskId: 'task-2',
      workId: 'work-2',
      packageId: 'package-2',
      merchantText: '这条没做成',
      submittedAt: '2026-08-23T08:00:00.000Z',
      outcome: 'failed',
      completedAt: '2026-08-23T08:02:00.000Z',
    },
  });
  assert.equal(failed.phase, 'failed');
  // A failed run has no delivery to hand back — the 申报卡 is its terminal.
  assert.equal(
    failed.turns.some((turn) => turn.kind === 'delivery'),
    false
  );
});

test('hold expiry is a visible cancelled/refunded terminal, never a delivery', () => {
  let cancelled = applyComposerWorkflowState(
    applyComposerQuestion(runningSession(), 'question-1'),
    'success',
    undefined,
    {
      merchantMessage: '超时未选择，本次任务已取消，积分已退回',
      outcome: 'cancelled',
      resolutionSource: 'core_hold_expired',
    }
  );
  assert.equal(cancelled.phase, 'cancelled');
  assert.equal(
    cancelled.turns.some((turn) => turn.kind === 'delivery'),
    false
  );
  assert.deepEqual(cancelled.turns.at(-1), {
    id: 'terminal:task-1',
    kind: 'terminal',
    message: '超时未选择，本次任务已取消，积分已退回',
    outcome: 'cancelled',
  });
  cancelled = applyComposerQuestion(cancelled, 'question-1');
  assert.equal(cancelled.phase, 'cancelled');
  assert.equal(
    cancelled.turns.some((turn) => turn.kind === 'question'),
    true
  );
});

test('a reprice supersession keeps the session alive for the successor card (V31-63)', () => {
  const before = applyComposerQuestion(runningSession(), 'question-1');
  const after = applyComposerWorkflowState(before, 'success', undefined, {
    merchantMessage:
      '报价已更新，本次未执行也未扣费；新的确认卡已准备好，请确认最新方案后继续。',
    outcome: 'superseded_by_reprice',
  });
  // Neither delivered nor cancelled: the interaction poll (gated on a live
  // session) must keep running so the projected successor confirmation card
  // can appear in this same thread.
  assert.equal(after, before);
  assert.equal(
    after.turns.some(
      (turn) => turn.kind === 'delivery' || turn.kind === 'terminal'
    ),
    false
  );
});

test('only the task handle persists — the transcript comes back from replay', () => {
  const session = applyComposerProgress(
    runningSession(),
    progress({ sequence: 1, message: '已整理本次创作资料' })
  );
  const persisted = serializeComposerSession(
    session,
    '2026-07-25T08:00:00.000Z',
    'workspace-1'
  );
  assert.deepEqual(persisted, {
    schema: COMPOSER_SESSION_STORAGE_VERSION,
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    updatedAt: '2026-07-25T08:00:00.000Z',
    merchantText: '写一条周末预约文案',
    task: TASK,
  });

  const restored = restoreComposerSession({
    raw: JSON.stringify(persisted),
    nowIso: '2026-07-25T09:00:00.000Z',
    workspaceId: 'workspace-1',
  });
  assert.equal(restored.kind, 'restored');
  if (restored.kind !== 'restored') return;
  assert.equal(restored.session.phase, 'running');
  assert.deepEqual(restored.session.task, TASK);
  assert.deepEqual(
    restored.session.turns.map((turn) => turn.kind),
    ['merchant', 'candidate']
  );
  // Progress is intentionally absent — it is replayed, never stored.
  assert.equal(restored.session.progressSequence, -1);
});

test('an unbound session has nothing worth persisting', () => {
  assert.equal(
    serializeComposerSession(
      openComposerTurn(createComposerSession('session-1'), '写点什么'),
      '2026-07-25T08:00:00.000Z',
      'workspace-1'
    ),
    null
  );
});

test('missing, corrupt, foreign-schema and expired handles all refuse to restore', () => {
  assert.equal(
    restoreComposerSession({
      raw: null,
      nowIso: '2026-07-25T08:00:00.000Z',
      workspaceId: 'workspace-1',
    }).kind,
    'missing'
  );
  assert.equal(
    restoreComposerSession({
      raw: '{',
      nowIso: '2026-07-25T08:00:00.000Z',
      workspaceId: 'workspace-1',
    }).kind,
    'invalid_data'
  );
  assert.equal(
    restoreComposerSession({
      raw: JSON.stringify({
        schema: 'composer-session/v0',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        updatedAt: '2026-07-25T08:00:00.000Z',
        merchantText: '写点什么',
        task: TASK,
      }),
      nowIso: '2026-07-25T08:00:00.000Z',
      workspaceId: 'workspace-1',
    }).kind,
    'invalid_data'
  );
  assert.equal(
    restoreComposerSession({
      raw: JSON.stringify({
        schema: COMPOSER_SESSION_STORAGE_VERSION,
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        updatedAt: '2026-07-25T08:00:00.000Z',
        merchantText: '写点什么',
        task: { taskId: 'task-1', workId: '', packageId: 'package-1' },
      }),
      nowIso: '2026-07-25T08:00:00.000Z',
      workspaceId: 'workspace-1',
    }).kind,
    'invalid_data'
  );
  assert.equal(
    restoreComposerSession({
      raw: JSON.stringify({
        schema: COMPOSER_SESSION_STORAGE_VERSION,
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        updatedAt: '2026-07-25T08:00:00.000Z',
        merchantText: '写点什么',
        task: TASK,
      }),
      nowIso: new Date(
        Date.parse('2026-07-25T08:00:00.000Z') + COMPOSER_SESSION_TTL_MS + 1
      ).toISOString(),
      workspaceId: 'workspace-1',
    }).kind,
    'expired'
  );
});

test('V31-83: a foreign workspace handle is discarded and never migrated', () => {
  const nowIso = '2026-07-25T08:00:00.000Z';
  const owned = serializeComposerSession(
    runningSession(),
    nowIso,
    'workspace-a'
  );
  assert.ok(owned);
  assert.equal(
    restoreComposerSession({
      raw: JSON.stringify(owned),
      nowIso,
      workspaceId: 'workspace-b',
    }).kind,
    'foreign_owner'
  );
  assert.equal(
    restoreComposerSession({
      raw: JSON.stringify({
        schema: COMPOSER_SESSION_STORAGE_VERSION,
        sessionId: 'session-1',
        updatedAt: nowIso,
        merchantText: '写一条周末预约文案',
        task: TASK,
      }),
      nowIso,
      workspaceId: 'workspace-a',
    }).kind,
    'invalid_data'
  );
  assert.equal(serializeComposerSession(runningSession(), nowIso, ''), null);
});

test('V31-83: A writes a scoped handle and B cannot read it', () => {
  const storage = new MemoryStorage();
  const nowIso = '2026-07-25T08:00:00.000Z';
  writePersistedComposerSession({
    nowIso,
    session: runningSession(),
    storage,
    workspaceId: 'workspace-a',
  });
  storage.setItem(
    'composer-session::composer-session/v1',
    JSON.stringify({
      schema: COMPOSER_SESSION_STORAGE_VERSION,
      sessionId: 'legacy-a',
      updatedAt: nowIso,
      merchantText: 'A 的旧无作用域会话',
      task: TASK,
    })
  );

  assert.equal(
    composerSessionStorageKey('workspace-a'),
    'composer-session::composer-session/v1::workspace-a'
  );
  const forA = readPersistedComposerSession({
    nowIso,
    storage,
    workspaceId: 'workspace-a',
  });
  assert.equal(forA.kind, 'restored');
  if (forA.kind !== 'restored') return;
  assert.equal(forA.session.task?.taskId, 'task-1');

  const forB = readPersistedComposerSession({
    nowIso,
    storage,
    workspaceId: 'workspace-b',
  });
  assert.equal(forB.kind, 'missing');
  assert.equal(
    storage.getItem('composer-session::composer-session/v1') !== null,
    true,
    'legacy leftover stays until the auth-boundary sweep; restore never reads it'
  );
});

test('a terminal failed or cancelled session is not persisted as an in-flight lock', () => {
  assert.equal(
    serializeComposerSession(
      failComposerSession(runningSession()),
      '2026-08-13T00:00:00.000Z',
      'workspace-a'
    ),
    null
  );
  assert.equal(
    serializeComposerSession(
      cancelComposerSession(runningSession()),
      '2026-08-13T00:00:00.000Z',
      'workspace-a'
    ),
    null
  );
});

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test('a delivered session persists without the live task handle', () => {
  const delivered: ComposerSession = {
    ...bindComposerTask(
      openComposerTurn(
        createComposerSession('session-1'),
        '写一条周末预约文案'
      ),
      TASK
    ),
    phase: 'delivered',
    lastDeliveredWorkId: TASK.workId,
    lastDeliveredPackageId: TASK.packageId,
  };
  const persisted = serializeComposerSession(
    delivered,
    '2026-07-25T08:00:00.000Z',
    'workspace-1'
  );
  assert.ok(persisted);
  assert.equal(persisted.task, undefined);
  assert.equal(persisted.lastDeliveredWorkId, TASK.workId);
  assert.equal(persisted.lastDeliveredTaskId, TASK.taskId);
  const restored = restoreComposerSession({
    raw: JSON.stringify(persisted),
    nowIso: '2026-07-25T09:00:00.000Z',
    workspaceId: 'workspace-1',
  });
  assert.equal(restored.kind, 'restored');
  if (restored.kind !== 'restored') return;
  assert.equal(restored.session.phase, 'delivered');
  assert.equal(restored.session.task, null);
  const delivery = restored.session.turns.find(
    (turn) => turn.kind === 'delivery'
  );
  assert.ok(delivery);
  assert.equal(delivery.workId, TASK.workId);
  assert.equal(delivery.taskId, TASK.taskId);
});

test('fail-closed rebind does not restore the in-flight work as delivered', () => {
  const failed = failComposerSession(
    bindComposerTask(createComposerSession('session-old'), {
      ...TASK,
      agentThreadId: 'thread-keep',
    })
  );
  const rebound = rebindComposerSession(failed, 'session-new');
  assert.equal(rebound.task, null);
  assert.equal(rebound.phase, 'idle');
  assert.equal(rebound.continuedAgentThreadId, 'thread-keep');
  assert.equal(rebound.lastDeliveredWorkId, undefined);
  assert.equal(rebound.lastDeliveredPackageId, undefined);
  const storage = new MemoryStorage();
  writePersistedComposerSession({
    nowIso: new Date().toISOString(),
    session: rebound,
    storage,
    workspaceId: 'ws-1',
  });
  assert.equal(storage.getItem(composerSessionStorageKey('ws-1')), null);
  const restored = readPersistedComposerSession({
    nowIso: new Date().toISOString(),
    storage,
    workspaceId: 'ws-1',
  });
  assert.equal(restored.kind, 'missing');
});

test('a failed 申报 locks the intent; 改一下要求 drops the tab handle', () => {
  const report = {
    kind: 'failure' as const,
    category: 'content_source' as const,
    message: '这次的说法在门店资料里找不到依据，所以没有交付。',
    nextStep: '改一下要求后再来一次。',
    actions: ['adjust_intent' as const, 'retry' as const],
    quotaRefunded: true,
  };
  const failed = applyComposerWorkflowState(
    bindComposerTask(createComposerSession('session-old'), {
      ...TASK,
      agentThreadId: 'thread-keep',
    }),
    'failed',
    undefined,
    undefined,
    report
  );
  assert.equal(composerFailureLocksIntent(failed), true);
  assert.equal(
    composerFailureLocksIntent(failComposerSession(runningSession())),
    false
  );
  const rebound = rebindComposerSession(failed, 'session-new');
  assert.equal(composerFailureLocksIntent(rebound), false);
  assert.equal(rebound.continuedAgentThreadId, 'thread-keep');
  assert.equal(
    serializeComposerSession(rebound, '2026-08-20T00:00:00.000Z', 'ws-1'),
    null
  );
  const storage = new MemoryStorage();
  writePersistedComposerSession({
    nowIso: '2026-08-20T00:00:00.000Z',
    session: rebound,
    storage,
    workspaceId: 'ws-1',
  });
  assert.equal(storage.getItem(composerSessionStorageKey('ws-1')), null);
});

test('a typed draft skips tab restore unless a named task asked for it', () => {
  assert.equal(
    shouldSkipPersistedComposerRestore({ merchantDraftTouched: true }),
    true
  );
  assert.equal(
    shouldSkipPersistedComposerRestore({
      merchantDraftTouched: true,
      namedTaskId: 'task-1',
    }),
    false
  );
  assert.equal(
    shouldSkipPersistedComposerRestore({ merchantDraftTouched: false }),
    false
  );
});

test('delivered rebind keeps thread id across persist and restore (EXEC-04)', () => {
  const opened = bindComposerTask(createComposerSession('session-old'), {
    ...TASK,
    agentThreadId: 'thread-keep',
  });
  const delivered = applyComposerWorkflowState(opened, 'success');
  const rebound = rebindComposerSession(delivered, 'session-new');
  assert.equal(rebound.task, null);
  assert.equal(rebound.continuedAgentThreadId, 'thread-keep');
  assert.equal(rebound.lastDeliveredWorkId, 'work-1');
  assert.equal(rebound.lastDeliveredPackageId, 'package-1');
  const storage = new MemoryStorage();
  writePersistedComposerSession({
    nowIso: new Date().toISOString(),
    session: rebound,
    storage,
    workspaceId: 'ws-1',
  });
  const restored = readPersistedComposerSession({
    nowIso: new Date().toISOString(),
    storage,
    workspaceId: 'ws-1',
  });
  assert.equal(restored.kind, 'restored');
  if (restored.kind === 'restored') {
    assert.equal(restored.session.continuedAgentThreadId, 'thread-keep');
    assert.equal(restored.session.lastDeliveredWorkId, 'work-1');
    assert.equal(restored.session.lastDeliveredPackageId, 'package-1');
    assert.equal(
      restored.session.phase,
      'delivered',
      'a finished rebound must not restore as submitting'
    );
  }
});

test('a bare tab keeps asking the server for a run it could still adopt', () => {
  // The mount read is one sample of a window the run itself closes; keep
  // sampling until something is bound.
  assert.equal(
    shouldPollServerRestore({
      elapsedMs: 0,
      hasBoundTask: false,
      merchantDraftTouched: false,
      restoredFromServer: false,
    }),
    true
  );
  assert.equal(
    shouldPollServerRestore({
      elapsedMs: 9_000,
      hasBoundTask: false,
      merchantDraftTouched: false,
      restoredFromServer: false,
    }),
    true
  );
});

test('the restore window closes on adoption, on a draft, and on time', () => {
  const base = {
    elapsedMs: 0,
    hasBoundTask: false,
    merchantDraftTouched: false,
    restoredFromServer: false,
  };
  // Adopted: the composer holds the run, nothing left to look for.
  assert.equal(shouldPollServerRestore({ ...base, hasBoundTask: true }), false);
  assert.equal(
    shouldPollServerRestore({ ...base, restoredFromServer: true }),
    false
  );
  // A sentence typed on this mount is the merchant's own turn (D-145 /
  // shouldSkipPersistedComposerRestore): adopting over it would replace it.
  assert.equal(
    shouldPollServerRestore({ ...base, merchantDraftTouched: true }),
    false
  );
  // Bounded: an idle composer must not poll for the life of the tab.
  assert.equal(shouldPollServerRestore({ ...base, elapsedMs: 20_000 }), false);
  assert.equal(
    shouldPollServerRestore({ ...base, elapsedMs: 4_000, windowMs: 3_000 }),
    false
  );
});
