import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PaymentRefundReviewItem } from '@/payment/payment-refunds';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPaymentRefundReview } from './admin-payment-refund-review';

const paymentRefundApi = vi.hoisted(() => ({
  listPaymentRefundReviews: vi.fn(),
  resolvePaymentRefund: vi.fn(),
}));

vi.mock('@/api/payment-refunds', () => paymentRefundApi);

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
  dispositionNote: 'Provider receipt checked.',
  dispositionStatus: 'resolved',
  orderId: 'waffo-order-resolved',
  providerEventId: 'waffo:refund.succeeded:refund-resolved',
  resolvedAt: '2026-08-04T02:03:04.000Z',
};

describe('AdminPaymentRefundReview', () => {
  beforeEach(() => {
    paymentRefundApi.listPaymentRefundReviews.mockReset();
    paymentRefundApi.resolvePaymentRefund.mockReset();
  });

  it('reads refund audit facts and resolves a pending review through the mounted control', async () => {
    const reviews = [pendingReview, resolvedReview];
    paymentRefundApi.listPaymentRefundReviews.mockImplementation(async () =>
      structuredClone(reviews)
    );
    paymentRefundApi.resolvePaymentRefund.mockImplementation(async () => {
      reviews[0] = {
        ...pendingReview,
        dispositionActorUserId: 'admin-current',
        dispositionNote: 'Matched the signed provider refund receipt.',
        dispositionStatus: 'resolved',
        resolvedAt: '2026-08-04T03:04:05.000Z',
      };
      return 'resolved';
    });
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AdminPaymentRefundReview />
      </QueryClientProvider>
    );

    const pendingRow = await screen.findByTestId(
      `refund-review-${pendingReview.providerEventId}`
    );
    expect(pendingRow).toHaveTextContent('HKD 161.00');
    const existingResolvedRow = screen.getByTestId(
      `refund-review-${resolvedReview.providerEventId}`
    );
    expect(existingResolvedRow).toHaveTextContent('Provider receipt checked.');
    expect(existingResolvedRow).toHaveTextContent('admin-existing');

    const resolveButton = within(pendingRow).getByRole('button', {
      name: 'Resolve review',
    });
    expect(resolveButton).toBeDisabled();
    await user.type(
      within(pendingRow).getByLabelText('Resolution note'),
      'Matched the signed provider refund receipt.'
    );
    expect(resolveButton).toBeEnabled();
    await user.click(resolveButton);

    await waitFor(() =>
      expect(paymentRefundApi.resolvePaymentRefund).toHaveBeenCalledWith({
        data: {
          eventStatus: 'succeeded',
          note: 'Matched the signed provider refund receipt.',
          providerEventId: pendingReview.providerEventId,
        },
      })
    );
    await waitFor(() =>
      expect(
        screen.getByTestId(`refund-review-${pendingReview.providerEventId}`)
      ).toHaveTextContent('admin-current')
    );
  });

  it('shows no refund action when the protected list rejects an unauthorized request', async () => {
    paymentRefundApi.listPaymentRefundReviews.mockRejectedValue(
      new Error('Unauthorized')
    );
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AdminPaymentRefundReview />
      </QueryClientProvider>
    );

    await screen.findByText('Refund reviews could not be loaded.');
    expect(
      screen.queryByRole('button', { name: 'Resolve review' })
    ).not.toBeInTheDocument();
    expect(paymentRefundApi.resolvePaymentRefund).not.toHaveBeenCalled();
  });
});
