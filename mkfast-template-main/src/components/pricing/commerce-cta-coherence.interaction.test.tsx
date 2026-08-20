import type { PublicPlanCatalog } from '@meiye/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  evaluateCommerceReadiness,
  toPublicCommerceReadiness,
  type CommerceReadinessPorts,
  type WaffoCreditPackageProductFacts,
  type WaffoSubscriptionProductFacts,
} from '@/payment/commerce-readiness';

const paymentApi = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  createCreditPackageCheckoutSession: vi.fn(),
  createCustomerPortalSession: vi.fn(),
}));

const billingState = vi.hoisted(() => ({
  billing: null as null | {
    creditsThisPeriod: number;
    interval: 'monthly';
    periodEndsAt: string;
    tier: 'growth';
  },
  portalReady: true,
}));

vi.mock('@/api/payment', () => paymentApi);

vi.mock('@/product/use-merchant-credit-detail', () => ({
  useMerchantCreditDetail: () => ({
    data: { billing: billingState.billing },
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
    useQuery: () => ({ data: { ready: { portal: billingState.portalReady } } }),
  };
});

const { CreditPricingContent } = await import('./credit-pricing-content');
const { BillingCard } = await import('../settings/billing/billing-card');
const { CheckoutButton, CreditPackageCheckoutButton } = await import(
  './create-checkout-button'
);
const { CustomerPortalButton } = await import('./customer-portal-button');

const ACTIVE_BILLING = {
  creditsThisPeriod: 1_300,
  interval: 'monthly' as const,
  periodEndsAt: '2026-09-19T00:00:00.000Z',
  tier: 'growth' as const,
};

beforeEach(() => {
  paymentApi.createCheckoutSession.mockReset();
  paymentApi.createCreditPackageCheckoutSession.mockReset();
  paymentApi.createCustomerPortalSession.mockReset();
  paymentApi.createCheckoutSession.mockResolvedValue({ url: '/checkout' });
  paymentApi.createCreditPackageCheckoutSession.mockResolvedValue({
    url: '/addon',
  });
  paymentApi.createCustomerPortalSession.mockResolvedValue({ url: '/portal' });
  billingState.billing = { ...ACTIVE_BILLING };
  billingState.portalReady = true;
});

describe('CREDIT-01B commerce CTA coherence', () => {
  it.each([
    {
      name: 'checkout mode disabled',
      mutate: (input: TestPortsInput) => {
        input.testCheckoutEnabled = false;
      },
    },
    {
      name: 'server secret absent',
      mutate: (input: TestPortsInput) => {
        input.privateKey = '';
      },
    },
  ] as const)('$name hides every payment CTA behind the same honest exit', async ({
    mutate,
  }) => {
    const input = readyInput();
    mutate(input);
    const projection = toPublicCommerceReadiness(
      await evaluateCommerceReadiness(ports(input))
    );
    billingState.portalReady = projection.ready.portal;

    render(
      <>
        <CreditPricingContent
          catalog={projection.catalog}
          commerceReadiness={projection.ready}
          isAuthenticated
          userId="merchant-1"
        />
        <BillingCard />
      </>
    );

    await assertNoLivePaymentCtas();
    expect(
      screen.getAllByTestId('commerce-unavailable-exit').length
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/先买加油包/u)).toBeNull();
    expect(
      screen.getAllByText('支付通道尚未在此环境接通。').length
    ).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: '升级套餐' })).toBeVisible();
    assertProviderIdle();
  });

  it('missing plan mapping disables plan checkout and leaves add-on/portal on their own flags', async () => {
    const input = readyInput();
    input.snapshot.paymentMapping = null;
    const projection = toPublicCommerceReadiness(
      await evaluateCommerceReadiness(ports(input))
    );
    billingState.portalReady = projection.ready.portal;

    render(
      <>
        <CreditPricingContent
          catalog={projection.catalog}
          commerceReadiness={projection.ready}
          isAuthenticated
          userId="merchant-1"
        />
        <BillingCard />
      </>
    );

    expect(screen.queryAllByTestId(/pricing-checkout-/u)).toHaveLength(0);
    expect(
      screen.getByTestId('pricing-booster-checkout-credits-100')
    ).toBeEnabled();
    expect(screen.getByTestId('customer-portal')).toBeEnabled();
    expect(
      screen.getAllByTestId('commerce-unavailable-exit').length
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/先买加油包/u).length).toBeGreaterThan(0);
    assertProviderIdle();
  });

  it('missing add-on mapping disables add-on checkout only', async () => {
    const input = readyInput();
    input.creditPackageProductMapping = '';
    const projection = toPublicCommerceReadiness(
      await evaluateCommerceReadiness(ports(input))
    );
    billingState.portalReady = projection.ready.portal;

    render(
      <>
        <CreditPricingContent
          catalog={projection.catalog}
          commerceReadiness={projection.ready}
          isAuthenticated
          userId="merchant-1"
        />
        <BillingCard />
      </>
    );

    expect(screen.getByTestId('pricing-checkout-growth-monthly')).toBeEnabled();
    expect(screen.queryAllByTestId(/pricing-booster-checkout-/u)).toHaveLength(
      0
    );
    expect(screen.getByTestId('customer-portal')).toBeEnabled();
    expect(
      screen.getAllByTestId('commerce-unavailable-exit').length
    ).toBeGreaterThan(0);
    assertProviderIdle();
  });

  it('hides portal without an active subscription and keeps only upgrade', async () => {
    const projection = toPublicCommerceReadiness(
      await evaluateCommerceReadiness(ports(readyInput()))
    );
    billingState.billing = null;
    billingState.portalReady = projection.ready.portal;

    render(<BillingCard />);

    expect(screen.queryByTestId('customer-portal')).toBeNull();
    expect(screen.getByRole('link', { name: '升级套餐' })).toBeVisible();
    assertProviderIdle();
  });

  it('refuses to invoke the provider from the real checkout and portal buttons when not ready', async () => {
    const user = userEvent.setup();
    render(
      <>
        <CheckoutButton cycle="monthly" planId="growth" ready={false}>
          Subscribe
        </CheckoutButton>
        <CreditPackageCheckoutButton offerId="credits-100" ready={false}>
          Buy pack
        </CreditPackageCheckoutButton>
        <CustomerPortalButton ready={false}>Renew</CustomerPortalButton>
      </>
    );

    for (const name of ['Subscribe', 'Buy pack', 'Renew']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      await user.click(button);
    }
    assertProviderIdle();
  });
});

async function assertNoLivePaymentCtas() {
  expect(screen.queryAllByTestId(/pricing-checkout-/u)).toHaveLength(0);
  expect(screen.queryAllByTestId(/pricing-booster-checkout-/u)).toHaveLength(0);
  const portal = screen.queryByTestId('customer-portal');
  if (portal) {
    expect(portal).toBeDisabled();
  }
  expect(screen.queryByRole('button', { name: '立即订阅' })).toBeNull();
  expect(screen.queryByRole('button', { name: '购买加油包' })).toBeNull();
  const renew = screen.queryByRole('button', { name: '管理续费' });
  if (renew) {
    expect(renew).toBeDisabled();
  }
}

function assertProviderIdle() {
  expect(paymentApi.createCheckoutSession).not.toHaveBeenCalled();
  expect(paymentApi.createCreditPackageCheckoutSession).not.toHaveBeenCalled();
  expect(paymentApi.createCustomerPortalSession).not.toHaveBeenCalled();
}

interface TestPortsInput {
  creditPackageProductMapping: string;
  environment: 'test' | 'production';
  facts: WaffoSubscriptionProductFacts[];
  merchantId: string;
  privateKey: string;
  snapshot: {
    catalog: PublicPlanCatalog;
    paymentMapping: {
      mappings: Array<{
        interval: 'single_month' | 'monthly' | 'yearly';
        paymentProductId: string;
        tier: 'starter' | 'growth' | 'pro';
      }>;
      revision: number;
    } | null;
    planRevision: string;
  };
  storeId: string;
  testCheckoutEnabled: boolean;
}

function catalog(): PublicPlanCatalog {
  return {
    addOns: [
      addon('credits-100', 100, 57),
      addon('credits-300', 300, 161),
      addon('credits-1000', 1_000, 498),
    ],
    plans: [
      plan('trial', 100, 0, 0, 0),
      plan('starter', 500, 231, 208, 2_081),
      plan('growth', 1_300, 580, 522, 5_217),
      plan('pro', 2_800, 1_044, 940, 9_400),
    ],
  };
}

function mappings() {
  return (['starter', 'growth', 'pro'] as const).flatMap((tier) =>
    (['single_month', 'monthly', 'yearly'] as const).map((interval) => ({
      interval,
      paymentProductId: `product-${tier}-${interval}`,
      tier,
    }))
  );
}

function readyInput(): TestPortsInput {
  const governed = catalog();
  return {
    creditPackageProductMapping: JSON.stringify({
      'credits-100': 'product-addon-100',
      'credits-300': 'product-addon-300',
      'credits-1000': 'product-addon-1000',
    }),
    environment: 'test',
    facts: mappings().map((mapping) => {
      const offer = governed.plans.find(
        (candidate) => candidate.id === mapping.tier
      );
      const price = offer?.cyclePrices.find(
        (candidate) => candidate.cycle === mapping.interval
      );
      return {
        amount: ((price?.amountMicros ?? 0) / 1_000_000).toFixed(2),
        billingPeriod: mapping.interval === 'yearly' ? 'yearly' : 'monthly',
        currency: 'HKD',
        metadata: {
          commercePeriod: mapping.interval,
          commerceTier: mapping.tier,
        },
        productId: mapping.paymentProductId,
        status: 'active',
      };
    }),
    merchantId: 'merchant-test',
    privateKey: 'test-private-key',
    snapshot: {
      catalog: governed,
      paymentMapping: { mappings: mappings(), revision: 3 },
      planRevision: 'plan.credits@cta',
    },
    storeId: 'store-test',
    testCheckoutEnabled: true,
  };
}

function ports(input: TestPortsInput): CommerceReadinessPorts {
  const addOnFacts: WaffoCreditPackageProductFacts[] =
    input.snapshot.catalog.addOns
      .map((offer): WaffoCreditPackageProductFacts | null => {
        const productId = JSON.parse(
          input.creditPackageProductMapping || '{}'
        ) as Record<string, string>;
        if (!productId[offer.id]) return null;
        return {
          amount: (offer.amountMicros / 1_000_000).toFixed(2),
          currency: offer.currency,
          metadata: {
            commerceSku: offer.id,
            credits: offer.credits,
            expireDays: offer.expireDays,
          },
          productId: productId[offer.id],
          status: 'active',
        };
      })
      .filter((fact): fact is WaffoCreditPackageProductFacts => fact != null);
  return {
    checkoutAuthority: {
      creditPackageProductMapping: input.creditPackageProductMapping,
      environment: input.environment,
      merchantId: input.merchantId,
      privateKey: input.privateKey,
      provider: 'waffo',
      storeId: input.storeId,
      testCheckoutEnabled: input.testCheckoutEnabled,
    },
    readCoreSnapshot: async () => input.snapshot,
    readCreditPackageProductFacts: async () => addOnFacts,
    readSubscriptionProductFacts: async (productIds) =>
      input.facts.filter((fact) => productIds.includes(fact.productId)),
  };
}

function plan(
  id: PublicPlanCatalog['plans'][number]['id'],
  credits: number,
  singleMonth: number,
  monthly: number,
  yearly: number
): PublicPlanCatalog['plans'][number] {
  return {
    id,
    credits,
    concurrencyLimit: 1,
    currency: 'HKD',
    cyclePrices: [
      { amountMicros: singleMonth * 1_000_000, cycle: 'single_month' },
      { amountMicros: monthly * 1_000_000, cycle: 'monthly' },
      { amountMicros: yearly * 1_000_000, cycle: 'yearly' },
    ],
    monthlyPriceMicros: singleMonth * 1_000_000,
    referenceOutputs: { copy: 100, image: 20, video: 2 },
  };
}

function addon(
  id: string,
  credits: number,
  amount: number
): PublicPlanCatalog['addOns'][number] {
  return {
    amountMicros: amount * 1_000_000,
    credits,
    currency: 'HKD',
    expireDays: 7,
    id,
  };
}
