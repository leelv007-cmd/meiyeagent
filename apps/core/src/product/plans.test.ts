import assert from 'node:assert/strict';
import test from 'node:test';

import { PUBLIC_PLAN_ALLOWANCE_SEED } from '@meiye/contracts';

import { defaultProductPlanConfig } from './plans.js';

test('legacy ProductState normalization keeps its historical plan values', () => {
  for (const offer of PUBLIC_PLAN_ALLOWANCE_SEED) {
    const plan = defaultProductPlanConfig[offer.id as 'starter' | 'growth' | 'pro'];
    assert.equal(plan.content, offer.allowance.copy, `${offer.id} copy`);
    assert.equal(plan.image, offer.allowance.image, `${offer.id} image`);
    assert.equal(plan.video, offer.allowance.video, `${offer.id} video`);
    assert.equal(
      plan.concurrencyLimit,
      offer.concurrencyLimit,
      `${offer.id} concurrency`,
    );
  }
});
