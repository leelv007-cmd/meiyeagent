import assert from 'node:assert/strict';
import test from 'node:test';

import { createPendingApprovalRequest } from './operations/content-package-approval.js';
import {
  PendingActionsAccessError,
  PendingActionsService,
  projectExtendedActionableInbox,
} from './pending-actions.js';

test('projects authoritative questions and approval requests in stable order', async () => {
  const approval = createPendingApprovalRequest({
    actionKind: 'publish',
    contentPackageRevision: 2,
    createdAt: '2026-07-18T07:00:00.000Z',
    packageId: 'package-b',
    platform: 'douyin',
    purpose: 'publish_current_variant',
    taskId: 'task-b',
    variantVersionId: 'douyin-v2',
    workflowId: 'workflow-b',
    workflowRevision: 2,
    workspaceId: 'workspace-a',
  });
  const service = new PendingActionsService(
    {
      async listPendingQuestions() {
        return [
          {
            createdAt: '2026-07-18T06:00:00.000Z',
            question: question('task-c', 'question-c', 3),
            taskId: 'task-c',
          },
          {
            createdAt: '2026-07-18T06:00:00.000Z',
            question: question('task-a', 'question-a', 1),
            taskId: 'task-a',
          },
        ];
      },
    },
    {
      async hasMembership() {
        return true;
      },
      async loadWorkspace() {
        return {
          contentPackages: [
            { approvalRequests: [approval] } as never,
          ],
        };
      },
    }
  );

  const first = await service.list({ userId: 'owner-a', workspaceId: 'workspace-a' });
  const refreshed = await service.list({ userId: 'owner-a', workspaceId: 'workspace-a' });

  assert.deepEqual(first, refreshed);
  assert.deepEqual(
    first.map((action) => [action.taskId, action.kind, action.questionOrApprovalRef]),
    [
      ['task-a', 'question', 'question-a'],
      ['task-c', 'question', 'question-c'],
      ['task-b', 'approval', approval.id],
    ]
  );
});

test('checks workspace ownership before reading either authoritative source', async () => {
  let reads = 0;
  const service = new PendingActionsService(
    {
      async listPendingQuestions() {
        reads += 1;
        return [];
      },
    },
    {
      async hasMembership() {
        return false;
      },
      async loadWorkspace() {
        reads += 1;
        return null;
      },
    }
  );

  await assert.rejects(
    service.list({ userId: 'intruder', workspaceId: 'workspace-a' }),
    (error: unknown) => error instanceof PendingActionsAccessError
  );
  assert.equal(reads, 0);
});

test('rejects a second concurrent blocking node for one task', async () => {
  const approval = createPendingApprovalRequest({
    actionKind: 'publish',
    contentPackageRevision: 2,
    createdAt: '2026-07-18T07:00:00.000Z',
    packageId: 'package-a',
    platform: 'douyin',
    purpose: 'publish_current_variant',
    taskId: 'task-a',
    variantVersionId: 'douyin-v2',
    workflowId: 'task-a',
    workflowRevision: 2,
    workspaceId: 'workspace-a',
  });
  const service = new PendingActionsService(
    {
      async listPendingQuestions() {
        return [
          {
            createdAt: '2026-07-18T06:00:00.000Z',
            question: question('task-a', 'question-a', 2),
            taskId: 'task-a',
          },
        ];
      },
    },
    {
      async hasMembership() {
        return true;
      },
      async loadWorkspace() {
        return { contentPackages: [{ approvalRequests: [approval] } as never] };
      },
    }
  );

  await assert.rejects(
    service.list({ userId: 'owner-a', workspaceId: 'workspace-a' }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'TASK_BLOCKING_NODE_CONFLICT'
  );
});

function question(workflowId: string, questionId: string, workflowRevision: number) {
  return {
    freeText: { enabled: true },
    options: [],
    question: '请确认唯一缺口',
    questionId,
    response: { field: 'intent.cta', reason: '继续生成所必需' },
    scope: 'current_task' as const,
    workflowId,
    workflowRevision,
  };
}

test('extended actionable inbox keeps PendingAction compatibility and adds terminal sources', () => {
  const pending = {
    createdAt: '2026-07-18T06:00:00.000Z',
    kind: 'question' as const,
    nodeId: 'question-a',
    questionOrApprovalRef: 'question-a',
    taskId: 'task-a',
    workflowId: 'workflow-a',
    workflowRevision: 1,
  };
  const items = projectExtendedActionableInbox({
    pendingActions: [pending],
    tasks: [
      {
        taskId: 'task-done',
        workspaceId: 'workspace-a',
        workId: 'work-done',
        taskStatus: 'completed',
        occurredAt: '2026-07-18T08:00:00.000Z',
      },
    ],
    deliveryEvents: [
      {
        eventId: 'ev-1',
        packageId: 'pkg-1',
        workspaceId: 'workspace-a',
        workId: 'work-del',
        occurredAt: '2026-07-18T09:00:00.000Z',
        eventType: 'manual_publish_result',
        deliveryStatus: 'published',
      },
    ],
    workIdByTaskId: { 'task-a': 'work-a' },
  });

  const kinds = new Set(items.map((item) => item.statusKind));
  assert.ok(kinds.has('needs_choice_or_confirm'));
  assert.ok(kinds.has('result_available'));
  assert.ok(kinds.has('delivery_completed'));
  const pendingItem = items.find(
    (item) => item.statusKind === 'needs_choice_or_confirm',
  );
  assert.deepEqual(pendingItem?.pendingAction, pending);
});
