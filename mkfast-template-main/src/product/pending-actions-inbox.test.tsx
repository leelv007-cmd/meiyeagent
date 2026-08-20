import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { ApprovalReceiptId, PendingAction } from '@meiye/contracts';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  approveAndDeliverPendingAction,
  createPendingApprovalSubmissionGuard,
  PendingApprovalFailureFeedback,
  PendingApprovalRetryFeedback,
  PendingActionsInboxView,
  PendingDeliveryRetryError,
  pendingActionsInboxPlan,
  pendingActionsWithRetainedApprovals,
  retryPendingDeliveryAction,
} from './pending-actions-inbox';

test('blocks a duplicate approval submit until the current attempt settles', () => {
  const guard = createPendingApprovalSubmissionGuard();

  assert.equal(guard.tryStart(), true);
  assert.equal(guard.tryStart(), false);
  guard.finish();
  assert.equal(guard.tryStart(), true);
});

test('keeps a failed approval visible with an explicit retry action', () => {
  const feedback = renderToStaticMarkup(
    <PendingApprovalFailureFeedback
      disabled={false}
      onRetry={() => undefined}
    />
  );

  assert.match(feedback, /role="alert"/u);
  assert.match(feedback, /操作未完成/u);
  assert.match(feedback, /内容和历史版本没有丢失/u);
  assert.match(feedback, /重试确认并发布/u);
});

test('announces the durable destination after approval succeeds', () => {
  const source = readFileSync(
    new URL('./pending-actions-inbox.tsx', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /toast\.success\(pending_actions_approval_success\(\)\)/u
  );
});

test('shows three authoritative actions, pins one, advances after processing, and counts the badge', () => {
  const actions = [
    questionAction('task-a', 'question-a', '2026-07-18T06:00:00.000Z'),
    approvalAction('task-b', 'approval-b', '2026-07-18T07:00:00.000Z'),
    questionAction('task-c', 'question-c', '2026-07-18T08:00:00.000Z'),
  ];
  const html = render(actions);

  assert.equal((html.match(/data-pending-action-ref=/gu) ?? []).length, 3);
  assert.equal((html.match(/data-current="true"/gu) ?? []).length, 1);
  assert.match(
    html,
    /data-current="true"[^>]*data-pending-action-ref="question-a"/u
  );
  assert.match(html, />3 项</u);

  const remaining = actions.filter(
    (action) => action.questionOrApprovalRef !== 'question-a'
  );
  assert.equal(
    pendingActionsInboxPlan(remaining).current?.questionOrApprovalRef,
    'approval-b'
  );
  assert.match(
    render(remaining),
    /data-current="true"[^>]*data-pending-action-ref="approval-b"/u
  );
});

test('renders no pending section or badge for the authoritative empty state', () => {
  assert.equal(render([]), '');
});

test('approves with the live package revision after the pending request revision advances', async () => {
  const action = approvalAction(
    'task-live-revision',
    'approval-live-revision',
    '2026-07-18T07:00:00.000Z'
  );
  assert.equal(action.kind, 'approval');
  const commands: Array<{
    action: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }> = [];

  await approveAndDeliverPendingAction(
    action,
    {
      accountId: 'douyin-account-live',
      actionScheduledAt: '2026-07-18T09:00:00.000Z',
      cost: { amount: 0, currency: 'CNY' },
    },
    'approval-key-live',
    {
      async command(commandAction, payload, idempotencyKey) {
        commands.push({ action: commandAction, idempotencyKey, payload });
        if (commandAction === 'approve_content_package_action') {
          return { id: 'receipt-live-revision' };
        }
        return {};
      },
      async readPackage() {
        return { revision: 5 };
      },
    }
  );

  assert.equal(action.approvalRequest.contentPackageRevision, 2);
  assert.deepEqual(
    commands.map(({ action: commandAction, payload }) => [
      commandAction,
      payload.expectedRevision,
    ]),
    [
      ['approve_content_package_action', 5],
      ['deliver_content_package', 6],
    ]
  );
});

test('assisted handoff settles without retry and advances then hides the inbox', async () => {
  const pendingApproval = approvalAction(
    'task-assisted-success',
    'approval-assisted-success',
    '2026-07-18T07:00:00.000Z'
  );
  assert.equal(pendingApproval.kind, 'approval');
  const action = {
    ...pendingApproval,
    approvalRequest: {
      ...pendingApproval.approvalRequest,
      platform: 'xiaohongshu' as const,
    },
  };
  const nextAction = questionAction(
    'task-after-assisted',
    'question-after-assisted',
    '2026-07-18T08:00:00.000Z'
  );
  const receiptId = 'receipt-assisted-success';
  const commands: string[] = [];

  await approveAndDeliverPendingAction(
    action,
    {
      accountId: 'xiaohongshu-account-assisted',
      actionScheduledAt: '2026-07-18T09:00:00.000Z',
      cost: { amount: 0, currency: 'CNY' },
    },
    'approval-key-assisted',
    {
      async command(commandAction) {
        commands.push(commandAction);
        if (commandAction === 'approve_content_package_action') {
          return { id: receiptId };
        }
        if (commandAction === 'prepare_mobile_publish_handoff') {
          return {};
        }
        return {
          approvalReceipts: [
            {
              binding: {
                actionKind: action.approvalRequest.actionKind,
                packageId: action.approvalRequest.packageId,
                platform: action.approvalRequest.platform,
                purpose: action.approvalRequest.purpose,
                variantVersionId: action.approvalRequest.variantVersionId,
              },
              id: receiptId,
              status: 'approved',
            },
          ],
          deliveryEvents: [
            {
              actorId: 'owner-assisted',
              deliveryIdentity: {
                approvalReceiptId: receiptId,
                deliveryAttemptId: `content-package-delivery:${receiptId}`,
                schema: 'approval_receipt_v1' as const,
              },
              id: 'delivery-assisted-success',
              occurredAt: '2026-07-18T09:00:01.000Z',
              platform: action.approvalRequest.platform,
              source: 'native',
              type: 'assisted_handoff_prepared',
              variantVersionId: action.approvalRequest.variantVersionId,
            },
          ],
          revision: 6,
        };
      },
      async readPackage() {
        return { revision: 4 };
      },
    }
  );

  assert.deepEqual(commands, [
    'approve_content_package_action',
    'deliver_content_package',
    'prepare_mobile_publish_handoff',
  ]);

  const visibleAfterSettlement = pendingActionsWithRetainedApprovals(
    [nextAction],
    []
  );
  const advancedHtml = renderToStaticMarkup(
    <PendingActionsInboxView
      actions={visibleAfterSettlement}
      renderAction={(visibleAction) =>
        visibleAction.kind === 'approval' ? (
          <PendingApprovalRetryFeedback
            disabled={false}
            onRetry={() => undefined}
          />
        ) : (
          <span>{visibleAction.questionOrApprovalRef}</span>
        )
      }
    />
  );
  assert.match(
    advancedHtml,
    /data-current="true"[^>]*data-pending-action-ref="question-after-assisted"/u
  );
  assert.doesNotMatch(advancedHtml, /approval-assisted-success/u);
  assert.doesNotMatch(advancedHtml, /重试交付/u);
  assert.equal(render([]), '');
});

test('keeps a retry action after approval succeeds and delivery fails, then retries successfully', async () => {
  const action = approvalAction(
    'task-delivery-retry',
    'approval-delivery-retry',
    '2026-07-18T07:00:00.000Z'
  );
  assert.equal(action.kind, 'approval');
  const approvalInput = {
    accountId: 'douyin-account-retry',
    actionScheduledAt: '2026-07-18T09:00:00.000Z',
    cost: { amount: 0, currency: 'CNY' as const },
  };
  let revision = 4;
  let receiptStatus: 'approved' | 'consumed' | undefined;
  let deliveryAttempts = 0;
  const packageFact = () => ({
    approvalReceipts: receiptStatus
      ? [
          {
            binding: {
              ...approvalInput,
              actionKind: 'publish' as const,
              contentRevision: 1,
              contextBundle: {
                bundleId: 'bundle-retry',
                hash: 'bundle-hash-retry',
                revision: 1,
              },
              packageId: action.approvalRequest.packageId,
              platform: action.approvalRequest.platform,
              purpose: action.approvalRequest.purpose,
              variantVersionId: action.approvalRequest.variantVersionId,
              workspaceId: action.approvalRequest.workspaceId,
            },
            events: [
              {
                actorId: 'owner-retry',
                eventId: 'receipt-delivery-retry:approved',
                occurredAt: '2026-07-18T09:00:00.000Z',
                type: 'approved' as const,
              },
            ],
            id: 'receipt-delivery-retry' as ApprovalReceiptId,
            idempotencyKey: 'approval-key-retry',
            payloadFingerprint: 'fingerprint-retry',
            status: receiptStatus,
          },
        ]
      : [],
    revision,
  });
  const dependencies = {
    async command(commandAction: string, payload: Record<string, unknown>) {
      if (commandAction === 'approve_content_package_action') {
        assert.equal(payload.expectedRevision, 4);
        revision = 5;
        receiptStatus = 'approved';
        return { id: 'receipt-delivery-retry' };
      }
      if (commandAction === 'prepare_mobile_publish_handoff') {
        return {};
      }
      deliveryAttempts += 1;
      if (deliveryAttempts === 1) {
        assert.equal(payload.expectedRevision, 5);
        revision = 7;
        receiptStatus = 'approved';
        throw new Error('provider unavailable');
      }
      assert.equal(payload.expectedRevision, 7);
      revision = 8;
      receiptStatus = 'consumed';
      return packageFact();
    },
    async readPackage() {
      return packageFact();
    },
  };

  await assert.rejects(
    approveAndDeliverPendingAction(
      action,
      approvalInput,
      'approval-key-retry',
      dependencies
    ),
    (error: unknown) =>
      error instanceof PendingDeliveryRetryError &&
      error.receiptId === 'receipt-delivery-retry'
  );
  const retainedAfterRequestConsumption = pendingActionsWithRetainedApprovals(
    [],
    [action]
  );
  assert.equal(
    retainedAfterRequestConsumption[0]?.questionOrApprovalRef,
    action.questionOrApprovalRef
  );
  const feedback = renderToStaticMarkup(
    <PendingApprovalRetryFeedback disabled={false} onRetry={() => undefined} />
  );
  assert.match(feedback, /操作未完成/u);
  assert.match(feedback, /重试交付/u);

  await retryPendingDeliveryAction(
    action,
    approvalInput,
    'receipt-delivery-retry',
    dependencies
  );
  assert.equal(deliveryAttempts, 2);
  assert.equal(receiptStatus, 'consumed');
});

test('does not settle a new receipt from an older delivery of the same variant', async () => {
  const action = approvalAction(
    'task-exact-delivery-receipt',
    'approval-exact-delivery-receipt',
    '2026-07-18T07:00:00.000Z'
  );
  assert.equal(action.kind, 'approval');
  const receiptId = 'receipt-current-delivery';
  const packageFact = {
    approvalReceipts: [
      {
        binding: {
          accountId: 'douyin-account-current',
          actionKind: action.approvalRequest.actionKind,
          actionScheduledAt: '2026-07-18T09:00:00.000Z',
          contentRevision: 1,
          contextBundle: {
            bundleId: 'bundle-current-delivery',
            hash: 'bundle-hash-current-delivery',
            revision: 1,
          },
          cost: { amount: 0, currency: 'CNY' as const },
          packageId: action.approvalRequest.packageId,
          platform: action.approvalRequest.platform,
          purpose: action.approvalRequest.purpose,
          variantVersionId: action.approvalRequest.variantVersionId,
          workspaceId: action.approvalRequest.workspaceId,
        },
        events: [
          {
            actorId: 'owner-current-delivery',
            eventId: `${receiptId}:approved`,
            occurredAt: '2026-07-18T09:00:00.000Z',
            type: 'approved' as const,
          },
        ],
        id: receiptId as ApprovalReceiptId,
        idempotencyKey: 'approval-key-current-delivery',
        payloadFingerprint: 'fingerprint-current-delivery',
        status: 'approved' as const,
      },
    ],
    deliveryEvents: [
      {
        actorId: 'owner-old-delivery',
        id: 'delivery-old-delivery',
        occurredAt: '2026-07-17T09:00:00.000Z',
        platform: action.approvalRequest.platform,
        source: 'native' as const,
        type: 'assisted_handoff_prepared' as const,
        variantVersionId: action.approvalRequest.variantVersionId,
      },
    ],
    revision: 7,
  };

  await assert.rejects(
    approveAndDeliverPendingAction(
      action,
      {
        accountId: 'douyin-account-current',
        actionScheduledAt: '2026-07-18T09:00:00.000Z',
        cost: { amount: 0, currency: 'CNY' },
      },
      'approval-key-current-delivery',
      {
        async command(commandAction) {
          if (commandAction === 'approve_content_package_action') {
            return { id: receiptId };
          }
          throw new Error('current delivery transport failed');
        },
        async readPackage() {
          return packageFact;
        },
      }
    ),
    (error: unknown) =>
      error instanceof PendingDeliveryRetryError &&
      error.receiptId === receiptId
  );
});

function render(actions: PendingAction[]) {
  return renderToStaticMarkup(
    <PendingActionsInboxView
      actions={actions}
      renderAction={(action) => <span>{action.questionOrApprovalRef}</span>}
    />
  );
}

function questionAction(
  taskId: string,
  questionOrApprovalRef: string,
  createdAt: string
): PendingAction {
  return {
    createdAt,
    kind: 'question',
    nodeId: questionOrApprovalRef,
    questionOrApprovalRef,
    taskId,
    workflowId: taskId,
    workflowRevision: 1,
  };
}

function approvalAction(
  taskId: string,
  questionOrApprovalRef: string,
  createdAt: string
): PendingAction {
  return {
    approvalRequest: {
      actionKind: 'publish',
      contentPackageRevision: 2,
      createdAt,
      id: questionOrApprovalRef,
      nodeId: `approval:${taskId}`,
      packageId: `package-${taskId}`,
      platform: 'douyin',
      purpose: 'publish_current_variant',
      status: 'pending',
      taskId,
      variantVersionId: `variant-${taskId}`,
      workflowId: taskId,
      workflowRevision: 1,
      workspaceId: 'workspace-a',
    },
    createdAt,
    kind: 'approval',
    nodeId: `approval:${taskId}`,
    questionOrApprovalRef,
    taskId,
    workflowId: taskId,
    workflowRevision: 1,
  };
}
