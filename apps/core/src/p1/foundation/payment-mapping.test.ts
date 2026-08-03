import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  billingPeriodFromProvider,
  defaultPriceCatalogFromEnv,
  defaultTierForInterval,
  resolvePaymentTier,
} from './payment-mapping.js';

describe('payment-mapping', () => {
  it('defaults monthly/yearly to growth and lifetime to pro', () => {
    assert.equal(defaultTierForInterval('single_month'), 'growth');
    assert.equal(defaultTierForInterval('monthly'), 'growth');
    assert.equal(defaultTierForInterval('yearly'), 'growth');
    assert.equal(defaultTierForInterval('month'), 'growth');
    assert.equal(defaultTierForInterval('year'), 'growth');
    assert.equal(defaultTierForInterval('lifetime'), 'pro');
    assert.equal(defaultTierForInterval('one_time'), 'pro');
  });

  it('resolves admin-config exact and any mappings first', () => {
    const config = {
      mappings: [
        {
          paymentProductId: 'price_month',
          interval: 'month' as const,
          tier: 'pro' as const,
        },
        {
          paymentProductId: 'price_any',
          interval: 'any' as const,
          tier: 'growth' as const,
        },
      ],
    };
    assert.equal(
      resolvePaymentTier({
        paymentProductId: 'price_month',
        interval: 'month',
        config,
      }),
      'pro'
    );
    assert.equal(
      resolvePaymentTier({
        paymentProductId: 'price_any',
        interval: 'year',
        config,
      }),
      'growth'
    );
  });

  it('keeps the three paid period products distinct in an admin mapping', () => {
    const config = {
      mappings: [
        {
          interval: 'single_month' as const,
          paymentProductId: 'PROD_STARTER_SINGLE',
          tier: 'starter' as const,
        },
        {
          interval: 'monthly' as const,
          paymentProductId: 'PROD_GROWTH_MONTHLY',
          tier: 'growth' as const,
        },
        {
          interval: 'yearly' as const,
          paymentProductId: 'PROD_PRO_YEARLY',
          tier: 'pro' as const,
        },
      ],
    };
    assert.equal(
      resolvePaymentTier({
        config,
        interval: 'single_month',
        paymentProductId: 'PROD_STARTER_SINGLE',
      }),
      'starter'
    );
    assert.equal(
      resolvePaymentTier({
        config,
        interval: 'monthly',
        paymentProductId: 'PROD_GROWTH_MONTHLY',
      }),
      'growth'
    );
    assert.equal(
      resolvePaymentTier({
        config,
        interval: 'yearly',
        paymentProductId: 'PROD_PRO_YEARLY',
      }),
      'pro'
    );
  });

  it('fails closed for Waffo unless a complete catalog has an exact canonical match', () => {
    const config = {
      mappings: [
        ...(['starter', 'growth', 'pro'] as const).flatMap((tier) =>
          (['single_month', 'monthly', 'yearly'] as const).map((interval) => ({
            interval,
            paymentProductId: `PROD_${tier}_${interval}`,
            tier,
          }))
        ),
      ],
    };

    assert.equal(
      resolvePaymentTier({
        config,
        interval: 'monthly',
        paymentProductId: 'PROD_growth_monthly',
        paymentProvider: 'waffo',
      }),
      'growth'
    );
    for (const input of [
      {
        config,
        interval: 'monthly' as const,
        paymentProductId: 'PROD_legacy_cny',
      },
      {
        config,
        interval: null,
        paymentProductId: 'PROD_growth_monthly',
      },
      {
        config: {
          mappings: [
            ...config.mappings.slice(0, -1),
            {
              interval: 'any' as const,
              paymentProductId: 'PROD_pro_yearly',
              tier: 'pro' as const,
            },
          ],
        },
        interval: 'yearly' as const,
        paymentProductId: 'PROD_pro_yearly',
      },
    ]) {
      assert.throws(
        () => resolvePaymentTier({ ...input, paymentProvider: 'waffo' }),
        /Waffo payment mapping/
      );
    }
  });

  it('falls back to env price catalog then interval defaults', () => {
    const catalog = defaultPriceCatalogFromEnv({
      monthly: 'price_m',
      yearly: 'price_y',
      lifetime: 'price_life',
    });
    assert.equal(
      resolvePaymentTier({
        paymentProductId: 'price_m',
        interval: 'month',
        defaultPriceCatalog: catalog,
      }),
      'growth'
    );
    assert.equal(
      resolvePaymentTier({
        paymentProductId: 'price_life',
        interval: 'lifetime',
        defaultPriceCatalog: catalog,
      }),
      'pro'
    );
    assert.equal(
      resolvePaymentTier({
        paymentProductId: 'unknown_price',
        interval: 'lifetime',
      }),
      'pro'
    );
  });

  it('prefers provider billing period over calendar month', () => {
    const period = billingPeriodFromProvider({
      interval: 'year',
      periodStartsAt: '2026-03-15T12:00:00.000Z',
      periodEndsAt: '2027-03-15T12:00:00.000Z',
    });
    assert.equal(period.periodStartsAt, '2026-03-15T12:00:00.000Z');
    assert.equal(period.periodEndsAt, '2027-03-15T12:00:00.000Z');
    assert.equal(period.periodStrategy, 'provider_period');
    assert.match(period.periodId, /^provider-/);
  });

  it('derives year/lifetime ends when provider omits periodEnd', () => {
    const year = billingPeriodFromProvider({
      interval: 'year',
      periodStartsAt: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(year.periodEndsAt, '2027-01-01T00:00:00.000Z');

    const life = billingPeriodFromProvider({
      interval: 'lifetime',
      periodStartsAt: '2026-01-01T00:00:00.000Z',
    });
    assert.equal(life.periodEndsAt.startsWith('2126-'), true);
  });
});
