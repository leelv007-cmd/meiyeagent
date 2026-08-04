import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  configuredProPriceIds,
  resolvePaidPlanTier,
  resolvePaymentEntitlement,
} from './payment-entitlement';

const now = new Date('2026-07-10T00:00:00.000Z');

describe('payment entitlement resolution', () => {
  it('maps lifetime price ids to pro, not growth', () => {
    const pro = configuredProPriceIds({
      VITE_STRIPE_PRICE_LIFETIME: 'price-life',
    } as unknown as NodeJS.ProcessEnv);
    assert.equal(pro.has('price-life'), true);
    assert.equal(
      resolvePaidPlanTier({
        priceId: 'price-life',
        interval: 'lifetime',
        env: {
          VITE_STRIPE_PRICE_LIFETIME: 'price-life',
        } as unknown as NodeJS.ProcessEnv,
      }),
      'pro'
    );
    assert.equal(
      resolvePaidPlanTier({
        priceId: 'price-growth',
        interval: 'month',
        env: {
          VITE_STRIPE_PRICE_PRO_MONTHLY: 'price-growth',
        } as unknown as NodeJS.ProcessEnv,
      }),
      'growth'
    );
  });

  it('grants growth only for a configured and currently valid paid price', () => {
    assert.equal(
      resolvePaymentEntitlement(
        {
          paid: true,
          periodEnd: new Date('2026-08-10T00:00:00.000Z'),
          priceId: 'price-growth',
          status: 'active',
          type: 'subscription',
        },
        new Set(['price-growth']),
        now
      ),
      'growth'
    );
  });

  it('grants pro for a completed lifetime purchase', () => {
    assert.equal(
      resolvePaymentEntitlement(
        {
          paid: true,
          periodEnd: null,
          priceId: 'price-life',
          status: 'completed',
          type: 'one_time',
        },
        new Set(['price-growth']),
        now,
        new Set(['price-life'])
      ),
      'pro'
    );
  });

  it('rejects unknown, unpaid, failed, and expired payment facts', () => {
    const configured = new Set(['price-growth']);
    assert.equal(
      resolvePaymentEntitlement(
        {
          paid: true,
          periodEnd: null,
          priceId: 'price-unknown',
          status: 'completed',
          type: 'one_time',
        },
        configured,
        now
      ),
      'starter'
    );
    assert.equal(
      resolvePaymentEntitlement(
        {
          paid: false,
          periodEnd: null,
          priceId: 'price-growth',
          status: 'completed',
          type: 'one_time',
        },
        configured,
        now
      ),
      'starter'
    );
    assert.equal(
      resolvePaymentEntitlement(
        {
          paid: true,
          periodEnd: null,
          priceId: 'price-growth',
          status: 'failed',
          type: 'one_time',
        },
        configured,
        now
      ),
      'starter'
    );
    assert.equal(
      resolvePaymentEntitlement(
        {
          paid: true,
          periodEnd: new Date('2026-07-09T23:59:59.000Z'),
          priceId: 'price-growth',
          status: 'canceled',
          type: 'subscription',
        },
        configured,
        now
      ),
      'starter'
    );
  });
});
