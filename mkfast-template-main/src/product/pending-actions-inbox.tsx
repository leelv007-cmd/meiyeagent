import type {
  ApprovalReceipt,
  PendingAction,
  PublicContentPackage,
} from '@meiye/contracts';
import { contentPackageDeliveryAttemptId } from '@meiye/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  content_package_action_failed,
  content_package_action_failed_description,
  content_package_retry_delivery,
  pending_actions_approval_retry,
  pending_actions_approval_success,
  pending_actions_count,
  pending_actions_current,
  pending_actions_title,
} from '@/locale/paraglide/messages';
import { operationsCommand, operationsQuery } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { ContentPackageApprovalCard } from '@/p1/content-package-approval-card';
import { HarnessQuestionCard } from '@/product/harness-question-card';

export function createPendingApprovalSubmissionGuard() {
  let pending = false;
  return {
    finish() {
      pending = false;
    },
    tryStart() {
      if (pending) return false;
      pending = true;
      return true;
    },
  };
}

export function pendingActionsInboxPlan(actions: PendingAction[]) {
  return {
    current: actions[0],
    items: actions,
  };
}

export function pendingActionsWithRetainedApprovals(
  actions: PendingAction[],
  retainedApprovals: PendingApprovalAction[]
) {
  const actionRefs = new Set(
    actions.map((action) => action.questionOrApprovalRef)
  );
  return [
    ...actions,
    ...retainedApprovals.filter(
      (action) => !actionRefs.has(action.questionOrApprovalRef)
    ),
  ];
}

interface PendingApprovalInput {
  accountId: string;
  actionScheduledAt: string;
  cost: { amount: number; currency: 'CNY' };
}

interface PendingApprovalDependencies {
  command(
    action: string,
    payload: Record<string, unknown>,
    idempotencyKey: string
  ): Promise<unknown>;
  readPackage(packageId: string): Promise<PendingDeliveryPackage>;
}

type PendingApprovalAction = Extract<PendingAction, { kind: 'approval' }>;
type PendingDeliveryPackage = Pick<
  PublicContentPackage,
  'approvalReceipts' | 'deliveryEvents' | 'revision'
>;

const defaultPendingApprovalDependencies: PendingApprovalDependencies = {
  command: operationsCommand,
  readPackage: (packageId) =>
    operationsQuery<PublicContentPackage>('content_package', { packageId }),
};

export class PendingDeliveryRetryError extends Error {
  constructor(
    readonly receiptId: string,
    options?: { cause?: unknown }
  ) {
    super('The approved delivery is ready to retry.', options);
    this.name = 'PendingDeliveryRetryError';
  }
}

export async function approveAndDeliverPendingAction(
  action: PendingApprovalAction,
  input: PendingApprovalInput,
  approvalKey: string,
  dependencies: PendingApprovalDependencies = defaultPendingApprovalDependencies
) {
  const request = action.approvalRequest;
  const currentPackage = await dependencies.readPackage(request.packageId);
  const receipt = (await dependencies.command(
    'approve_content_package_action',
    {
      ...input,
      actionKind: request.actionKind,
      approvalKey,
      expectedRevision: currentPackage.revision,
      packageId: request.packageId,
      platform: request.platform,
      purpose: request.purpose,
      requestId: request.id,
      variantVersionId: request.variantVersionId,
    },
    approvalKey
  )) as ApprovalReceipt;
  try {
    const delivered = (await dependencies.command(
      'deliver_content_package',
      deliveryPayload(action, input, currentPackage.revision + 1, receipt.id),
      contentPackageDeliveryAttemptId(receipt.id)
    )) as PendingDeliveryPackage;
    if (completedDelivery(delivered, action, receipt.id)) {
      await preparePendingInboxHandoff(action, delivered, dependencies);
      return receipt;
    }
    if (approvedReceipt(delivered, action, receipt.id)) {
      throw new PendingDeliveryRetryError(receipt.id);
    }
    return receipt;
  } catch (error) {
    if (error instanceof PendingDeliveryRetryError) throw error;
    const current = await dependencies.readPackage(request.packageId);
    if (completedDelivery(current, action, receipt.id)) {
      await preparePendingInboxHandoff(action, current, dependencies);
      return receipt;
    }
    if (approvedReceipt(current, action, receipt.id)) {
      throw new PendingDeliveryRetryError(receipt.id, { cause: error });
    }
    throw error;
  }
}

export async function retryPendingDeliveryAction(
  action: PendingApprovalAction,
  input: PendingApprovalInput,
  receiptId: string,
  dependencies: PendingApprovalDependencies = defaultPendingApprovalDependencies
) {
  const current = await dependencies.readPackage(
    action.approvalRequest.packageId
  );
  if (!approvedReceipt(current, action, receiptId)) {
    throw new Error('The approved delivery is no longer available to retry.');
  }
  try {
    const delivered = (await dependencies.command(
      'deliver_content_package',
      deliveryPayload(action, input, current.revision, receiptId),
      contentPackageDeliveryAttemptId(receiptId)
    )) as PendingDeliveryPackage;
    if (completedDelivery(delivered, action, receiptId)) {
      await preparePendingInboxHandoff(action, delivered, dependencies);
      return delivered;
    }
    if (approvedReceipt(delivered, action, receiptId)) {
      throw new PendingDeliveryRetryError(receiptId);
    }
    return delivered;
  } catch (error) {
    if (error instanceof PendingDeliveryRetryError) throw error;
    const refreshed = await dependencies.readPackage(
      action.approvalRequest.packageId
    );
    if (completedDelivery(refreshed, action, receiptId)) {
      await preparePendingInboxHandoff(action, refreshed, dependencies);
      return refreshed;
    }
    if (approvedReceipt(refreshed, action, receiptId)) {
      throw new PendingDeliveryRetryError(receiptId, { cause: error });
    }
    throw error;
  }
}

async function preparePendingInboxHandoff(
  action: PendingApprovalAction,
  contentPackage: PendingDeliveryPackage,
  dependencies: PendingApprovalDependencies
) {
  const request = action.approvalRequest;
  await dependencies.command(
    'prepare_mobile_publish_handoff',
    {
      expectedRevision: contentPackage.revision,
      packageId: request.packageId,
      platform: request.platform,
      variantVersionId: request.variantVersionId,
    },
    `prepare-mobile-publish-handoff:inbox:${request.packageId}:${request.variantVersionId}`
  );
}

function deliveryPayload(
  action: PendingApprovalAction,
  input: PendingApprovalInput,
  expectedRevision: number,
  receiptId: string
) {
  const request = action.approvalRequest;
  return {
    ...input,
    actionKind: request.actionKind,
    expectedRevision,
    packageId: request.packageId,
    platform: request.platform,
    purpose: request.purpose,
    receiptId,
    variantVersionId: request.variantVersionId,
  };
}

function approvedReceipt(
  contentPackage: PendingDeliveryPackage,
  action: PendingApprovalAction,
  receiptId: string
) {
  const request = action.approvalRequest;
  return contentPackage.approvalReceipts?.find(
    (receipt) =>
      receipt.id === receiptId &&
      receipt.status === 'approved' &&
      receipt.binding.packageId === request.packageId &&
      receipt.binding.platform === request.platform &&
      receipt.binding.variantVersionId === request.variantVersionId &&
      receipt.binding.actionKind === request.actionKind &&
      receipt.binding.purpose === request.purpose
  );
}

function completedDelivery(
  contentPackage: PendingDeliveryPackage,
  action: PendingApprovalAction,
  receiptId: string
) {
  const request = action.approvalRequest;
  const deliveryAttemptId = contentPackageDeliveryAttemptId(receiptId);
  return contentPackage.deliveryEvents?.some((event) => {
    const identity =
      'deliveryIdentity' in event ? event.deliveryIdentity : undefined;
    return (
      event.platform === request.platform &&
      event.variantVersionId === request.variantVersionId &&
      identity?.schema === 'approval_receipt_v1' &&
      identity.approvalReceiptId === receiptId &&
      identity.deliveryAttemptId === deliveryAttemptId &&
      (event.type === 'assisted_handoff_prepared' ||
        (event.type === 'automatic_publish_result' &&
          event.status === 'published'))
    );
  });
}

export function PendingActionsInboxView({
  actions,
  renderAction,
}: {
  actions: PendingAction[];
  renderAction(action: PendingAction): ReactNode;
}) {
  const plan = pendingActionsInboxPlan(actions);
  if (!plan.current) return null;

  return (
    <section
      aria-labelledby="pending-actions-title"
      data-testid="pending-actions"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-medium" id="pending-actions-title">
          {pending_actions_title()}
        </h3>
        <Badge data-testid="pending-actions-badge" variant="secondary">
          {pending_actions_count({ count: plan.items.length })}
        </Badge>
      </div>
      <ol className="space-y-3">
        {plan.items.map((action, index) => (
          <li
            className="rounded-xl border border-divider bg-background p-3"
            data-current={index === 0 ? 'true' : undefined}
            data-pending-action-ref={action.questionOrApprovalRef}
            key={`${action.kind}:${action.questionOrApprovalRef}`}
          >
            {index === 0 ? (
              <Badge className="mb-3" variant="default">
                {pending_actions_current()}
              </Badge>
            ) : null}
            {renderAction(action)}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PendingActionsInbox({
  actions,
  onSettled,
}: {
  actions: PendingAction[];
  onSettled: () => void;
}) {
  const [retainedApprovals, setRetainedApprovals] = useState<
    PendingApprovalAction[]
  >([]);
  const visibleActions = pendingActionsWithRetainedApprovals(
    actions,
    retainedApprovals
  );
  const settle = (action: PendingAction) => {
    setRetainedApprovals((current) =>
      current.filter(
        (candidate) =>
          candidate.questionOrApprovalRef !== action.questionOrApprovalRef
      )
    );
    onSettled();
  };
  return (
    <PendingActionsInboxView
      actions={visibleActions}
      renderAction={(action) => (
        <PendingActionBody
          action={action}
          onRetryable={(retryable) =>
            setRetainedApprovals((current) =>
              current.some(
                (candidate) =>
                  candidate.questionOrApprovalRef ===
                  retryable.questionOrApprovalRef
              )
                ? current
                : [...current, retryable]
            )
          }
          onSettled={() => settle(action)}
        />
      )}
    />
  );
}

function PendingActionBody({
  action,
  onRetryable,
  onSettled,
}: {
  action: PendingAction;
  onRetryable(action: PendingApprovalAction): void;
  onSettled: () => void;
}) {
  if (action.kind === 'question') {
    return (
      <HarnessQuestionCard
        onMissing={onSettled}
        onResolved={onSettled}
        taskId={action.taskId}
      />
    );
  }
  return (
    <PendingApprovalAction
      action={action}
      onRetryable={onRetryable}
      onSettled={onSettled}
    />
  );
}

function PendingApprovalAction({
  action,
  onRetryable,
  onSettled,
}: {
  action: PendingApprovalAction;
  onRetryable(action: PendingApprovalAction): void;
  onSettled: () => void;
}) {
  const queryClient = useQueryClient();
  const request = action.approvalRequest;
  const submissionGuardRef = useRef(createPendingApprovalSubmissionGuard());
  const [approvalKey] = useState(
    () => `content-package-approval:${request.id}:${crypto.randomUUID()}`
  );
  const [retryReceiptId, setRetryReceiptId] = useState<string>();
  const approval = useMutation({
    mutationFn: async (input: {
      accountId: string;
      actionScheduledAt: string;
      cost: { amount: number; currency: 'CNY' };
    }) =>
      retryReceiptId
        ? retryPendingDeliveryAction(action, input, retryReceiptId)
        : approveAndDeliverPendingAction(action, input, approvalKey),
    onError: (error) => {
      toast.error(content_package_action_failed());
      if (!(error instanceof PendingDeliveryRetryError)) return;
      setRetryReceiptId(error.receiptId);
      onRetryable(action);
    },
    onSuccess: () => {
      setRetryReceiptId(undefined);
      toast.success(pending_actions_approval_success());
      onSettled();
    },
    onSettled: async () => {
      submissionGuardRef.current.finish();
      await queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('operations'),
      });
    },
  });
  const submit = (input: PendingApprovalInput) => {
    if (!submissionGuardRef.current.tryStart()) return;
    approval.mutate(input);
  };

  return (
    <div className="space-y-2">
      {retryReceiptId && approval.variables ? (
        <PendingApprovalRetryFeedback
          disabled={approval.isPending}
          onRetry={() => submit(approval.variables)}
        />
      ) : approval.isError && approval.variables ? (
        <PendingApprovalFailureFeedback
          disabled={approval.isPending}
          onRetry={() => submit(approval.variables)}
        />
      ) : (
        <ContentPackageApprovalCard
          disabled={approval.isPending}
          onApprove={submit}
        />
      )}
    </div>
  );
}

export function PendingApprovalFailureFeedback({
  disabled,
  onRetry,
}: {
  disabled: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <div className="text-sm text-destructive" role="alert">
        <p className="font-medium">{content_package_action_failed()}</p>
        <p className="mt-1">{content_package_action_failed_description()}</p>
      </div>
      <Button
        disabled={disabled}
        onClick={onRetry}
        size="sm"
        type="button"
        variant="outline"
      >
        {pending_actions_approval_retry()}
      </Button>
    </div>
  );
}

export function PendingApprovalRetryFeedback({
  disabled,
  onRetry,
}: {
  disabled: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <div className="text-sm text-destructive" role="alert">
        <p className="font-medium">{content_package_action_failed()}</p>
        <p className="mt-1">{content_package_action_failed_description()}</p>
      </div>
      <Button
        disabled={disabled}
        onClick={onRetry}
        size="sm"
        type="button"
        variant="outline"
      >
        {content_package_retry_delivery()}
      </Button>
    </div>
  );
}
