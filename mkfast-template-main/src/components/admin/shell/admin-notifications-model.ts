/**
 * Admin notification centre projection — maps existing ops signals into a
 * read-only alert stream. Sources: pending-actions, refund reviews, exception
 * home. No new fetch contract.
 */
import type { ActionableInboxItem, PendingAction } from '@meiye/contracts';
import type { PaymentRefundReviewItem } from '@/payment/payment-refunds';
import type { ExceptionHomeView } from '@/p1/admin-exception-home-model';
import { Routes } from '@/lib/routes';

export type AdminNotificationKind =
  | 'exception'
  | 'pending-action'
  | 'refund-review';

export type AdminNotificationVariant = 'info' | 'warning' | 'destructive';

export interface AdminNotificationItem {
  body: string;
  href: string;
  id: string;
  kind: AdminNotificationKind;
  time?: string;
  title: string;
  unread: boolean;
  variant: AdminNotificationVariant;
}

function isPendingAction(
  item: PendingAction | ActionableInboxItem
): item is PendingAction {
  return 'kind' in item && (item.kind === 'question' || item.kind === 'approval');
}

export function projectAdminNotifications(input: {
  exceptionView?: Pick<ExceptionHomeView, 'exceptions'> | null;
  pendingActions?: readonly (PendingAction | ActionableInboxItem)[];
  refundReviews?: readonly PaymentRefundReviewItem[];
  labels: {
    exceptionBody: (severity: string) => string;
    exceptionTitle: (title: string) => string;
    pendingActionBody: string;
    pendingActionTitle: (kind: string) => string;
    refundBody: (orderId: string) => string;
    refundTitle: string;
  };
}): AdminNotificationItem[] {
  const items: AdminNotificationItem[] = [];

  for (const action of input.pendingActions ?? []) {
    if (isPendingAction(action)) {
      items.push({
        body: input.labels.pendingActionBody,
        href: Routes.Admin,
        id: `pending-action:${action.taskId}:${action.questionOrApprovalRef}`,
        kind: 'pending-action',
        time: action.createdAt,
        title: input.labels.pendingActionTitle(action.kind),
        unread: true,
        variant: 'warning',
      });
      continue;
    }
    items.push({
      body: input.labels.pendingActionBody,
      href: Routes.Admin,
      id: `pending-action:inbox:${action.createdAt}:${action.title}`,
      kind: 'pending-action',
      time: action.createdAt,
      title: input.labels.pendingActionTitle(action.statusKind),
      unread: true,
      variant: 'warning',
    });
  }

  for (const review of input.refundReviews ?? []) {
    if (review.dispositionStatus !== 'pending_review') continue;
    items.push({
      body: input.labels.refundBody(review.orderId),
      href: Routes.AdminRefundReview,
      id: `refund-review:${review.providerEventId}`,
      kind: 'refund-review',
      time: review.receivedAt,
      title: input.labels.refundTitle,
      unread: true,
      variant: 'info',
    });
  }

  for (const row of input.exceptionView?.exceptions ?? []) {
    items.push({
      body: input.labels.exceptionBody(row.severity),
      href: row.technicalHandoff.href || Routes.Admin,
      id: `exception:${row.rootCauseKey}`,
      kind: 'exception',
      time: row.lastChangedAt,
      title: input.labels.exceptionTitle(row.title),
      unread: true,
      variant:
        row.severity === 'blocked' || row.severity === 'degraded'
          ? 'destructive'
          : 'warning',
    });
  }

  return items.sort((left, right) => {
    const leftAt = left.time ?? '';
    const rightAt = right.time ?? '';
    return rightAt.localeCompare(leftAt);
  });
}

export function countUnreadAdminNotifications(
  items: readonly AdminNotificationItem[]
): number {
  return items.filter((item) => item.unread).length;
}
