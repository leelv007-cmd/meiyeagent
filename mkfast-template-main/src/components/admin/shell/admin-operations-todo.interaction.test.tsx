/**
 * Header ops-todo popover: same mock drives header counts and page numbers.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminPaymentRefundReview } from '@/p1/admin-payment-refund-review';
import { PAYMENT_REFUND_REVIEW_QUERY_KEY } from '@/p1/admin-payment-refund-review';
import { buildCapabilityRegistry } from '@/p1/admin-capability-registry-model';
import {
  projectLiveExceptionHome,
  projectPendingActionsForExceptionHome,
} from '@/p1/admin-exception-home';
import { pendingActionsQueryKey } from '@/product/pending-actions-client';
import type { PaymentRefundReviewItem } from '@/payment/payment-refunds';
import type { PendingAction } from '@meiye/contracts';
import { AdminOperationsTodoPopover } from './admin-operations-todo-popover';
import {
  buildAdminOperationsTodoItems,
  countPendingActions,
  countPendingRefundReviews,
} from './admin-operations-todo-model';

const paymentRefundApi = vi.hoisted(() => ({
  listPaymentRefundReviews: vi.fn(),
  resolvePaymentRefund: vi.fn(),
}));

const pendingActionsApi = vi.hoisted(() => ({
  readPendingActions: vi.fn(),
}));

const capabilityProjection = vi.hoisted(() => ({
  useAdminCapabilityRegistryProjection: vi.fn(),
}));

vi.mock('@/api/payment-refunds', () => paymentRefundApi);
vi.mock('@/product/pending-actions-client', async () => {
  const actual = await vi.importActual<
    typeof import('@/product/pending-actions-client')
  >('@/product/pending-actions-client');
  return {
    ...actual,
    readPendingActions: pendingActionsApi.readPendingActions,
  };
});
vi.mock('@/p1/admin-capability-registry', async () => {
  const actual = await vi.importActual<
    typeof import('@/p1/admin-capability-registry')
  >('@/p1/admin-capability-registry');
  return {
    ...actual,
    useAdminCapabilityRegistryProjection:
      capabilityProjection.useAdminCapabilityRegistryProjection,
  };
});

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const pendingActions: PendingAction[] = [
  {
    createdAt: '2026-08-06T01:00:00.000Z',
    kind: 'question',
    nodeId: 'node-1',
    questionOrApprovalRef: 'q-1',
    taskId: 'task-1',
    workflowId: 'workflow-1',
    workflowRevision: 1,
  },
  {
    createdAt: '2026-08-06T01:05:00.000Z',
    kind: 'question',
    nodeId: 'node-2',
    questionOrApprovalRef: 'q-2',
    taskId: 'task-2',
    workflowId: 'workflow-2',
    workflowRevision: 1,
  },
];

const pendingReview: PaymentRefundReviewItem = {
  amount: '161.00',
  currency: 'HKD',
  dispositionActorUserId: null,
  dispositionNote: null,
  dispositionStatus: 'pending_review',
  eventStatus: 'succeeded',
  orderId: 'waffo-order-pending',
  provider: 'waffo',
  providerEventId: 'waffo:refund.succeeded:refund-pending',
  providerOccurredAt: '2026-08-04T01:02:03.000Z',
  receivedAt: '2026-08-04T01:02:04.000Z',
  resolvedAt: null,
};

const resolvedReview: PaymentRefundReviewItem = {
  ...pendingReview,
  amount: '57.00',
  dispositionActorUserId: 'admin-existing',
  dispositionNote: 'checked',
  dispositionStatus: 'resolved',
  orderId: 'waffo-order-resolved',
  providerEventId: 'waffo:refund.succeeded:refund-resolved',
  resolvedAt: '2026-08-04T02:03:04.000Z',
};

function seedClient(client: QueryClient) {
  client.setQueryData(pendingActionsQueryKey, pendingActions);
  client.setQueryData(PAYMENT_REFUND_REVIEW_QUERY_KEY, [
    pendingReview,
    resolvedReview,
  ]);
}

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  seedClient(client);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    ),
  };
}

beforeEach(() => {
  navigate.mockReset();
  paymentRefundApi.listPaymentRefundReviews.mockReset();
  paymentRefundApi.resolvePaymentRefund.mockReset();
  pendingActionsApi.readPendingActions.mockReset();
  paymentRefundApi.listPaymentRefundReviews.mockResolvedValue([
    pendingReview,
    resolvedReview,
  ]);
  pendingActionsApi.readPendingActions.mockResolvedValue(pendingActions);
  capabilityProjection.useAdminCapabilityRegistryProjection.mockReturnValue({
    hasMetricsData: true,
    hasSupplyData: true,
    isSettled: true,
    metricsFailed: false,
    metricsQuery: { error: null },
    supplyFailed: false,
    supplyQuery: { error: null },
    view: buildCapabilityRegistry(),
  });
});

describe('AdminOperationsTodoPopover', () => {
  it('shows header counts that match the same mock as the destination pages', async () => {
    const user = userEvent.setup();
    const registry = buildCapabilityRegistry();
    // Same projection pipeline as exception home / header hook.
    const exceptionView = projectLiveExceptionHome({
      inboxItems: projectPendingActionsForExceptionHome(pendingActions),
      registry,
    });
    const expected = buildAdminOperationsTodoItems({
      exceptionView,
      pendingActions,
      refundReviews: [pendingReview, resolvedReview],
    });

    // Page-side numbers from the same payloads.
    expect(countPendingActions(pendingActions)).toBe(
      expected.find((item) => item.id === 'pending-actions')?.count
    );
    expect(countPendingRefundReviews([pendingReview, resolvedReview])).toBe(
      expected.find((item) => item.id === 'refund-review')?.count
    );
    expect(exceptionView.exceptions.length).toBe(
      expected.find((item) => item.id === 'exceptions')?.count
    );

    const { client } = renderWithClient(
      <>
        <AdminOperationsTodoPopover />
        <AdminPaymentRefundReview />
      </>
    );

    // Refund review page lists the same pending row.
    expect(
      await screen.findByTestId(
        `refund-review-${pendingReview.providerEventId}`
      )
    ).toBeInTheDocument();
    // Page row count for pending disposition must match header.
    const pagePendingCount = [pendingReview, resolvedReview].filter(
      (row) => row.dispositionStatus === 'pending_review'
    ).length;
    expect(pagePendingCount).toBe(
      expected.find((item) => item.id === 'refund-review')?.count
    );

    // Cached query identity: header and page share the same key.
    expect(client.getQueryData(PAYMENT_REFUND_REVIEW_QUERY_KEY)).toEqual([
      pendingReview,
      resolvedReview,
    ]);
    expect(client.getQueryData(pendingActionsQueryKey)).toEqual(
      pendingActions
    );

    await user.click(screen.getByTestId('admin-ops-todo-trigger'));
    const popover = await screen.findByTestId('admin-ops-todo-popover');
    expect(
      within(popover).getByTestId('admin-ops-todo-count-pending-actions')
    ).toHaveTextContent(String(expected.find((i) => i.id === 'pending-actions')?.count));
    expect(
      within(popover).getByTestId('admin-ops-todo-count-refund-review')
    ).toHaveTextContent(String(expected.find((i) => i.id === 'refund-review')?.count));
    expect(
      within(popover).getByTestId('admin-ops-todo-count-exceptions')
    ).toHaveTextContent(String(expected.find((i) => i.id === 'exceptions')?.count));
  });
});
