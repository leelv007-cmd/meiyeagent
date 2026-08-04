import assert from 'node:assert/strict';
import test from 'node:test';

import type { PublicPlanOffer } from '@meiye/contracts';

import {
  formatPublishedPrice,
  planPriceForCycle,
  publishedReferenceOutputs,
} from './credit-pricing-model';

const plan: PublicPlanOffer = {
  id: 'starter',
  credits: 500,
  concurrencyLimit: 1,
  currency: 'HKD',
  cyclePrices: [
    { amountMicros: 231_000_000, cycle: 'single_month' },
    { amountMicros: 208_000_000, cycle: 'monthly' },
    { amountMicros: 2_081_000_000, cycle: 'yearly' },
  ],
  monthlyPriceMicros: 231_183_288,
  referenceOutputs: { copy: 37, image: 11, video: 4 },
};

test('billing-cycle display reads the published price and recomputes its original comparison', () => {
  assert.deepEqual(planPriceForCycle(plan, 'single_month'), {
    amountMicros: 231_000_000,
    originalAmountMicros: 231_000_000,
  });
  assert.deepEqual(planPriceForCycle(plan, 'monthly'), {
    amountMicros: 208_000_000,
    originalAmountMicros: 231_000_000,
  });
  assert.deepEqual(planPriceForCycle(plan, 'yearly'), {
    amountMicros: 2_081_000_000,
    originalAmountMicros: 2_774_000_000,
  });
});

test('merchant prices format micros without exposing the storage unit', () => {
  assert.equal(formatPublishedPrice(208_000_000, 'HKD', 'zh-CN'), 'HK$208');
  assert.equal(formatPublishedPrice(2_081_000_000, 'HKD', 'en-US'), 'HK$2,081');
});

test('pricing references pass through published values instead of deriving new counts', () => {
  assert.deepEqual(publishedReferenceOutputs(plan), {
    copy: 37,
    image: 11,
    video: 4,
  });
});
