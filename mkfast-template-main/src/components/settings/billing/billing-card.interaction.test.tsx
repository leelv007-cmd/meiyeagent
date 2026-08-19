import { render, screen } from '@testing-library/react';
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

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: () => ({ data: { portalReady: state.portalReady } }),
  };
});

vi.mock('@/components/pricing/customer-portal-button', () => ({
  CustomerPortalButton: ({ children }: { children: React.ReactNode }) => (
    <button data-testid="customer-portal" type="button">
      {children}
    </button>
  ),
}));

const { BillingCard } = await import('./billing-card');

describe('BillingCard commerce exits', () => {
  beforeEach(() => {
    state.billing = null;
    state.portalReady = true;
  });

  it('shows only upgrade when there is no active subscription', () => {
    render(<BillingCard />);

    expect(screen.queryByTestId('customer-portal')).toBeNull();
    expect(screen.getByRole('link', { name: '升级套餐' })).toBeVisible();
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
