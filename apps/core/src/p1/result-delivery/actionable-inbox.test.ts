import assert from 'node:assert/strict';
import test from 'node:test';

import {
  actionableInboxStatusKinds,
  type PendingAction,
} from '@meiye/contracts';

import {
  ACTIONABLE_INBOX_REQUIRED_STATUS_KINDS,
  projectActionableInbox,
  type InboxDeliveryEventSource,
  type InboxTaskTerminalSource,
} from './actionable-inbox.js';

const baseTask = (
  overrides: Partial<InboxTaskTerminalSource> &
    Pick<InboxTaskTerminalSource, 'taskId' | 'taskStatus' | 'occurredAt'>,
): InboxTaskTerminalSource => ({
  workspaceId: 'ws-1',
  workId: 'work-1',
  title: undefined,
  ...overrides,
});

const pendingQuestion: PendingAction = {
  createdAt: '2026-07-20T10:00:00.000Z',
  kind: 'question',
  nodeId: 'q-1',
  questionOrApprovalRef: 'q-1',
  taskId: 'task-pending',
  workflowId: 'wf-1',
  workflowRevision: 1,
};

test('six notification status kinds each have an event-source projection', () => {
  const tasks: InboxTaskTerminalSource[] = [
    baseTask({
      taskId: 'task-done',
      taskStatus: 'completed',
      occurredAt: '2026-07-20T08:00:00.000Z',
      workId: 'work-done',
    }),
    baseTask({
      taskId: 'task-unknown',
      taskStatus: 'acceptance_unknown',
      occurredAt: '2026-07-20T08:30:00.000Z',
      workId: 'work-unknown',
    }),
    baseTask({
      taskId: 'task-fail',
      taskStatus: 'failed',
      occurredAt: '2026-07-20T09:00:00.000Z',
      workId: 'work-fail',
    }),
  ];

  const deliveryEvents: InboxDeliveryEventSource[] = [
    {
      eventId: 'ev-partial',
      packageId: 'pkg-1',
      workspaceId: 'ws-1',
      workId: 'work-partial',
      occurredAt: '2026-07-20T11:00:00.000Z',
      eventType: 'automatic_publish_result',
      deliveryStatus: 'failed',
      partial: true,
    },
    {
      eventId: 'ev-done',
      packageId: 'pkg-2',
      workspaceId: 'ws-1',
      workId: 'work-delivered',
      occurredAt: '2026-07-20T12:00:00.000Z',
      eventType: 'manual_publish_result',
      deliveryStatus: 'published',
    },
  ];

  const items = projectActionableInbox({
    tasks,
    deliveryEvents,
    pendingActions: [pendingQuestion],
    workIdByTaskId: { 'task-pending': 'work-pending' },
  });

  const byKind = new Map(items.map((item) => [item.statusKind, item]));

  for (const kind of ACTIONABLE_INBOX_REQUIRED_STATUS_KINDS) {
    assert.ok(byKind.has(kind), `missing projection for ${kind}`);
  }

  assert.deepEqual(
    [...actionableInboxStatusKinds].sort(),
    [...ACTIONABLE_INBOX_REQUIRED_STATUS_KINDS].sort(),
  );

  // result_available ← task completed terminal
  const resultAvailable = byKind.get('result_available')!;
  assert.equal(resultAvailable.eventSource.kind, 'task_terminal');
  assert.equal(
    resultAvailable.eventSource.kind === 'task_terminal' &&
      resultAvailable.eventSource.taskStatus,
    'completed',
  );
  assert.equal(resultAvailable.target?.workId, 'work-done');
  assert.equal(resultAvailable.nextActionLabel, '查看结果');

  // needs_choice_or_confirm ← PendingAction (question|approval compatible)
  const needsConfirm = byKind.get('needs_choice_or_confirm')!;
  assert.equal(needsConfirm.eventSource.kind, 'pending_action');
  assert.deepEqual(needsConfirm.pendingAction, pendingQuestion);
  assert.equal(needsConfirm.target?.workId, 'work-pending');
  assert.equal(needsConfirm.nextActionLabel, '处理当前问题');

  // acceptance_unknown_recovery ← task acceptance_unknown
  const recovery = byKind.get('acceptance_unknown_recovery')!;
  assert.equal(recovery.eventSource.kind, 'task_terminal');
  assert.equal(
    recovery.eventSource.kind === 'task_terminal' &&
      recovery.eventSource.taskStatus,
    'acceptance_unknown',
  );
  assert.equal(recovery.nextActionLabel, '处理当前问题');

  // task_failed ← task failed terminal
  const failed = byKind.get('task_failed')!;
  assert.equal(failed.eventSource.kind, 'task_terminal');
  assert.equal(
    failed.eventSource.kind === 'task_terminal' &&
      failed.eventSource.taskStatus,
    'failed',
  );
  assert.equal(failed.nextActionLabel, '处理当前问题');

  // delivery_partial_or_unknown ← deliveryEvents partial/failed/unknown
  const partial = byKind.get('delivery_partial_or_unknown')!;
  assert.equal(partial.eventSource.kind, 'delivery_event');
  assert.equal(
    partial.eventSource.kind === 'delivery_event' &&
      partial.eventSource.deliveryStatus,
    'failed',
  );
  assert.equal(partial.target?.panel, 'delivery');
  assert.equal(partial.nextActionLabel, '继续交付');

  // delivery_completed ← deliveryEvents published
  const delivered = byKind.get('delivery_completed')!;
  assert.equal(delivered.eventSource.kind, 'delivery_event');
  assert.equal(
    delivered.eventSource.kind === 'delivery_event' &&
      delivered.eventSource.deliveryStatus,
    'published',
  );
  assert.equal(delivered.nextActionLabel, '查看结果');
});

test('reference projection is deterministic and ignores non-actionable delivery noise', () => {
  const deliveryEvents: InboxDeliveryEventSource[] = [
    {
      eventId: 'ev-prepare',
      packageId: 'pkg-1',
      workspaceId: 'ws-1',
      workId: 'work-1',
      occurredAt: '2026-07-20T09:00:00.000Z',
      eventType: 'assisted_handoff_prepared',
    },
    {
      eventId: 'ev-legacy-open',
      packageId: 'pkg-1',
      workspaceId: 'ws-1',
      workId: 'work-1',
      occurredAt: '2026-07-20T09:05:00.000Z',
      eventType: 'legacy_handoff_event',
    },
    {
      eventId: 'ev-unknown',
      packageId: 'pkg-1',
      workspaceId: 'ws-1',
      workId: 'work-1',
      occurredAt: '2026-07-20T09:10:00.000Z',
      eventType: 'automatic_publish_result',
      deliveryStatus: 'unknown',
    },
  ];

  const first = projectActionableInbox({ deliveryEvents });
  const second = projectActionableInbox({ deliveryEvents });

  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.equal(first[0]?.statusKind, 'delivery_partial_or_unknown');
  assert.equal(
    first[0]?.eventSource.kind === 'delivery_event' &&
      first[0]?.eventSource.eventId,
    'ev-unknown',
  );
});

test('pending action without work mapping stays PendingAction-compatible without guessed target', () => {
  const items = projectActionableInbox({
    pendingActions: [pendingQuestion],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.statusKind, 'needs_choice_or_confirm');
  assert.equal(items[0]?.target, undefined);
  assert.equal(items[0]?.pendingAction?.kind, 'question');
  assert.equal(items[0]?.pendingAction?.questionOrApprovalRef, 'q-1');
});

test('sort is stable by createdAt then statusKind then event source key', () => {
  const items = projectActionableInbox({
    tasks: [
      baseTask({
        taskId: 't-b',
        taskStatus: 'failed',
        occurredAt: '2026-07-20T10:00:00.000Z',
        workId: 'work-b',
      }),
      baseTask({
        taskId: 't-a',
        taskStatus: 'completed',
        occurredAt: '2026-07-20T09:00:00.000Z',
        workId: 'work-a',
      }),
    ],
  });
  assert.deepEqual(
    items.map((item) => item.eventSource.kind === 'task_terminal' && item.eventSource.taskId),
    ['t-a', 't-b'],
  );
});
