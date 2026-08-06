/**
 * Shared query wiring for header ops-todo + notifications.
 * Reuses the same keys and fetchers as the destination pages.
 */
import { listPaymentRefundReviews } from '@/api/payment-refunds';
import {
  projectLiveExceptionHome,
  projectPendingActionsForExceptionHome,
} from '@/p1/admin-exception-home';
import { useAdminCapabilityRegistryProjection } from '@/p1/admin-capability-registry';
import {
  PAYMENT_REFUND_REVIEW_QUERY_KEY,
} from '@/p1/admin-payment-refund-review';
import {
  pendingActionsQueryKey,
  readPendingActions,
} from '@/product/pending-actions-client';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

export function useAdminOpsHeaderQueries() {
  const pendingActions = useQuery({
    queryKey: pendingActionsQueryKey,
    queryFn: ({ signal }) => readPendingActions(signal),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });

  const refundReviews = useQuery({
    queryKey: PAYMENT_REFUND_REVIEW_QUERY_KEY,
    queryFn: () => listPaymentRefundReviews({ data: { limit: 100 } }),
    refetchOnWindowFocus: true,
  });

  const projection = useAdminCapabilityRegistryProjection();

  const exceptionView = useMemo(
    () =>
      projectLiveExceptionHome({
        inboxItems: pendingActions.data
          ? projectPendingActionsForExceptionHome(pendingActions.data)
          : undefined,
        pendingActionsFailed: pendingActions.isError,
        registry: projection.view,
      }),
    [pendingActions.data, pendingActions.isError, projection.view]
  );

  const isLoading =
    pendingActions.isPending ||
    refundReviews.isPending ||
    !projection.isSettled;

  return {
    exceptionView,
    isLoading,
    pendingActions,
    projection,
    refundReviews,
  };
}
