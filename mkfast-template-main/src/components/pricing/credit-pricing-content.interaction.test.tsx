import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicPlanCatalog } from '@meiye/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { websiteConfig } from '@/config/website';
import type { PricePlan } from '@/payment/types';

const paymentApi = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  createCreditPackageCheckoutSession: vi.fn(),
}));

vi.mock('@/api/payment', () => paymentApi);

const { CreditPricingContent } = await import('./credit-pricing-content');

const catalog: PublicPlanCatalog = {
  addOns: [
    {
      amountMicros: 57_000_000,
      credits: 100,
      currency: 'HKD',
      expireDays: 7,
      id: 'credits-100',
    },
    {
      amountMicros: 161_000_000,
      credits: 300,
      currency: 'HKD',
      expireDays: 7,
      id: 'credits-300',
    },
    {
      amountMicros: 498_000_000,
      credits: 1_000,
      currency: 'HKD',
      expireDays: 7,
      id: 'credits-1000',
    },
  ],
  plans: [
    plan('trial', 100, 0, 0, 0, { copy: 100, image: 20, video: 2 }),
    plan('starter', 500, 231, 208, 2_081, {
      copy: 500,
      image: 100,
      video: 10,
    }),
    plan('growth', 1_300, 580, 522, 5_217, {
      copy: 1_300,
      image: 260,
      video: 26,
    }),
    plan('pro', 2_800, 1_044, 940, 9_400, {
      copy: 2_800,
      image: 560,
      video: 56,
    }),
  ],
};

beforeEach(() => {
  paymentApi.createCheckoutSession.mockReset();
  paymentApi.createCreditPackageCheckoutSession.mockReset();
  paymentApi.createCheckoutSession.mockResolvedValue({
    id: 'checkout-subscription',
  });
  paymentApi.createCreditPackageCheckoutSession.mockResolvedValue({
    id: 'checkout-booster',
  });
  if (!websiteConfig.payment?.price) {
    throw new Error('Payment config is required for the pricing test.');
  }
  websiteConfig.payment.enable = true;
  websiteConfig.payment.provider = 'waffo';
  websiteConfig.payment.price.plans = Object.fromEntries(
    ['starter', 'growth', 'pro'].map((planId) => [planId, checkoutPlan(planId)])
  );
});

describe('credit pricing', () => {
  it('switches published prices and wires the selected subscription checkout', async () => {
    const user = userEvent.setup();
    render(
      <CreditPricingContent
        catalog={catalog}
        isAuthenticated
        userId="merchant-1"
      />
    );

    expect(screen.getByTestId('pricing-price-starter')).toHaveTextContent(
      'HK$208'
    );
    await user.click(screen.getByRole('button', { name: '包年付费' }));
    expect(screen.getByTestId('pricing-price-starter')).toHaveTextContent(
      'HK$2,081'
    );
    expect(screen.getByTestId('pricing-original-starter')).toHaveTextContent(
      'HK$2,772'
    );

    await user.click(screen.getByTestId('pricing-checkout-starter-yearly'));
    expect(paymentApi.createCheckoutSession).toHaveBeenCalledWith({
      data: {
        metadata: { userId: 'merchant-1' },
        planId: 'starter',
        priceId: 'product-starter-yearly',
      },
    });
  });

  it('wires a governed credit-package SKU to the existing checkout boundary', async () => {
    const user = userEvent.setup();
    render(
      <CreditPricingContent
        catalog={catalog}
        isAuthenticated
        userId="merchant-1"
      />
    );

    await user.click(
      screen.getByTestId('pricing-booster-checkout-credits-300')
    );
    expect(paymentApi.createCreditPackageCheckoutSession).toHaveBeenCalledWith({
      data: { offerId: 'credits-300' },
    });
  });
});

function plan(
  id: PublicPlanCatalog['plans'][number]['id'],
  credits: number,
  singleMonth: number,
  monthly: number,
  yearly: number,
  referenceOutputs: PublicPlanCatalog['plans'][number]['referenceOutputs']
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
    referenceOutputs,
  };
}

function checkoutPlan(planId: string): PricePlan {
  return {
    id: planId,
    isFree: false,
    isLifetime: false,
    prices: ['single_month', 'monthly', 'yearly'].map((interval) => ({
      amount: 1,
      currency: 'HKD',
      interval: interval as 'single_month' | 'monthly' | 'yearly',
      priceId: `product-${planId}-${interval}`,
      type: 'subscription',
    })),
  };
}
