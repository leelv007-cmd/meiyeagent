/**
 * Composer conversation session model (T30 / #224, D-114 / ADR-0014).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { WorkflowProgressEnvelope } from '@meiye/contracts';

import {
  applyComposerProgress,
  applyComposerQuestion,
  applyComposerWorkflowState,
  bindComposerTask,
  COMPOSER_SESSION_STORAGE_VERSION,
  COMPOSER_SESSION_TTL_MS,
  composerSessionMerchantText,
  createComposerSession,
  failComposerSession,
  openComposerTurn,
  restoreComposerSession,
  restoreComposerSessionFromActiveTask,
  serializeComposerSession,
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
    { kind: 'merchant', id: 'session-1:merchant', text: '写一条周末预约文案' },
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
  assert.equal(
    session.turns.some((turn) => turn.kind === 'question'),
    false
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
  // A stale question never survives delivery.
  assert.equal(
    session.turns.some((turn) => turn.kind === 'question'),
    false
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
      merchantText: '写一条周末预约文案',
      submittedAt: '2026-07-27T08:00:00.000Z',
    },
  });

  assert.equal(restored.phase, 'running');
  assert.deepEqual(restored.task, TASK);
  // Same shape as the sessionStorage restore: merchant turn + candidate area,
  // everything else comes back from the event replay.
  assert.deepEqual(
    restored.turns.map((turn) => turn.kind),
    ['merchant', 'candidate']
  );
  assert.equal(composerSessionMerchantText(restored), '写一条周末预约文案');
});

test('hold expiry is a visible cancelled/refunded terminal, never a delivery', () => {
  let cancelled = applyComposerWorkflowState(
    applyComposerQuestion(runningSession(), 'question-1'),
    'success',
    undefined,
    {
      merchantMessage: '超时未选择，本次任务已取消，额度已退回',
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
    message: '超时未选择，本次任务已取消，额度已退回',
    outcome: 'cancelled',
  });
  cancelled = applyComposerQuestion(cancelled, 'question-1');
  assert.equal(cancelled.phase, 'cancelled');
  assert.equal(
    cancelled.turns.some((turn) => turn.kind === 'question'),
    true
  );
});

test('only the task handle persists — the transcript comes back from replay', () => {
  const session = applyComposerProgress(
    runningSession(),
    progress({ sequence: 1, message: '已整理本次创作资料' })
  );
  const persisted = serializeComposerSession(
    session,
    '2026-07-25T08:00:00.000Z'
  );
  assert.deepEqual(persisted, {
    schema: COMPOSER_SESSION_STORAGE_VERSION,
    sessionId: 'session-1',
    updatedAt: '2026-07-25T08:00:00.000Z',
    merchantText: '写一条周末预约文案',
    task: TASK,
  });

  const restored = restoreComposerSession({
    raw: JSON.stringify(persisted),
    nowIso: '2026-07-25T09:00:00.000Z',
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
      '2026-07-25T08:00:00.000Z'
    ),
    null
  );
});

test('missing, corrupt, foreign-schema and expired handles all refuse to restore', () => {
  assert.equal(
    restoreComposerSession({ raw: null, nowIso: '2026-07-25T08:00:00.000Z' })
      .kind,
    'missing'
  );
  assert.equal(
    restoreComposerSession({ raw: '{', nowIso: '2026-07-25T08:00:00.000Z' })
      .kind,
    'invalid_data'
  );
  assert.equal(
    restoreComposerSession({
      raw: JSON.stringify({
        schema: 'composer-session/v0',
        sessionId: 'session-1',
        updatedAt: '2026-07-25T08:00:00.000Z',
        merchantText: '写点什么',
        task: TASK,
      }),
      nowIso: '2026-07-25T08:00:00.000Z',
    }).kind,
    'invalid_data'
  );
  assert.equal(
    restoreComposerSession({
      raw: JSON.stringify({
        schema: COMPOSER_SESSION_STORAGE_VERSION,
        sessionId: 'session-1',
        updatedAt: '2026-07-25T08:00:00.000Z',
        merchantText: '写点什么',
        task: { taskId: 'task-1', workId: '', packageId: 'package-1' },
      }),
      nowIso: '2026-07-25T08:00:00.000Z',
    }).kind,
    'invalid_data'
  );
  assert.equal(
    restoreComposerSession({
      raw: JSON.stringify({
        schema: COMPOSER_SESSION_STORAGE_VERSION,
        sessionId: 'session-1',
        updatedAt: '2026-07-25T08:00:00.000Z',
        merchantText: '写点什么',
        task: TASK,
      }),
      nowIso: new Date(
        Date.parse('2026-07-25T08:00:00.000Z') + COMPOSER_SESSION_TTL_MS + 1
      ).toISOString(),
    }).kind,
    'expired'
  );
});
