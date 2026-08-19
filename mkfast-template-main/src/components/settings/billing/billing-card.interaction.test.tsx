import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  billing: null as null | {
    creditsThisPeriod: number;
    interval: 'monthly';
    periodEndsAt: string;
    tier: 'growth';
  },
  portalReady: true,
}));

const paymentApi = vi.hoisted(() => ({
  createCustomerPortalSession: vi.fn(),
}));

vi.mock('@/product/use-merchant-credit-detail', () => ({
  useMerchantCreditDetail: () => ({
    data: { billing: state.billing },
    error: null,
    isPending: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/api/commerce-readiness', () => ({
  getCommerceReadiness: vi.fn(),
}));

vi.mock('@/api/payment', () => paymentApi);

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: () => ({ data: { ready: { portal: state.portalReady } } }),
  };
});

const { BillingCard } = await import('./billing-card');

describe('BillingCard commerce exits', () => {
  beforeEach(() => {
    state.billing = null;
    state.portalReady = true;
    paymentApi.createCustomerPortalSession.mockReset();
    paymentApi.createCustomerPortalSession.mockResolvedValue({
      url: '/portal',
    });
  });

  it('shows only upgrade when there is no active subscription', async () => {
    const user = userEvent.setup();
    render(<BillingCard />);

    expect(screen.queryByTestId('customer-portal')).toBeNull();
    expect(screen.getByRole('link', { name: '升级套餐' })).toBeVisible();
    await user.click(screen.getByRole('link', { name: '升级套餐' }));
    expect(paymentApi.createCustomerPortalSession).not.toHaveBeenCalled();
  });

  it('shows the portal only for an active subscription and ready commerce', () => {
    state.billing = {
      creditsThisPeriod: 1_300,
      interval: 'monthly',
      periodEndsAt: '2026-09-19T00:00:00.000Z',
      tier: 'growth',
    };
    render(<BillingCard />);
    expect(screen.getByTestId('customer-portal')).toBeVisible();
  });

  it('hides the portal when the shared commerce projection is not ready', () => {
    state.billing = {
      creditsThisPeriod: 1_300,
      interval: 'monthly',
      periodEndsAt: '2026-09-19T00:00:00.000Z',
      tier: 'growth',
    };
    state.portalReady = false;
    render(<BillingCard />);
    expect(screen.queryByTestId('customer-portal')).toBeNull();
  });
});
