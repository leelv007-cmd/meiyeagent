/**
 * Header ops-todo counts — pure projections over the same query payloads the
 * destination pages already use. No second data source.
 */
import type { PaymentRefundReviewItem } from '@/payment/payment-refunds';
import type { ActionableInboxItem, PendingAction } from '@meiye/contracts';
import type { ExceptionHomeView } from '@/p1/admin-exception-home-model';
import { Routes } from '@/lib/routes';

/** Wire response may be PendingAction[] or mixed ActionableInboxItem[]. */
export type PendingActionsWire = readonly (
  | PendingAction
  | ActionableInboxItem
)[];

export interface AdminOperationsTodoItem {
  count: number;
  href: string;
  id: 'exceptions' | 'pending-actions' | 'refund-review';
}

export function countPendingActions(
  items: PendingActionsWire | undefined
): number {
  return items?.length ?? 0;
}

/** Pending reviews only; resolved rows stay out of the header badge. */
export function countPendingRefundReviews(
  items: readonly PaymentRefundReviewItem[] | undefined
): number {
  if (!items) return 0;
  return items.filter((item) => item.dispositionStatus === 'pending_review')
    .length;
}

export function countExceptionEvents(
  view: Pick<ExceptionHomeView, 'exceptions'> | null | undefined
): number {
  return view?.exceptions.length ?? 0;
}

export function buildAdminOperationsTodoItems(input: {
  exceptionView?: Pick<ExceptionHomeView, 'exceptions'> | null;
  pendingActions?: PendingActionsWire;
  refundReviews?: readonly PaymentRefundReviewItem[];
}): AdminOperationsTodoItem[] {
  return [
    {
      id: 'pending-actions',
      count: countPendingActions(input.pendingActions),
      href: Routes.Admin,
    },
    {
      id: 'refund-review',
      count: countPendingRefundReviews(input.refundReviews),
      href: Routes.AdminRefundReview,
    },
    {
      id: 'exceptions',
      count: countExceptionEvents(input.exceptionView),
      href: Routes.Admin,
    },
  ];
}

export function sumAdminOperationsTodoCounts(
  items: readonly AdminOperationsTodoItem[]
): number {
  return items.reduce((total, item) => total + item.count, 0);
}
