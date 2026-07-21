import assert from 'node:assert/strict';
import test from 'node:test';
import type { PricePlan } from '@/payment/types';
import { projectCurrentPlan } from './payment-current-plan';

test('current plan projection does not evaluate presentation getters', () => {
  let presentationGetterReads = 0;
  const plan = {
    id: 'free',
    isFree: true,
    isLifetime: false,
    prices: [],
  } as PricePlan;
  Object.defineProperty(plan, 'name', {
    enumerable: true,
    get() {
      presentationGetterReads += 1;
      return 'Starter';
    },
  });

  assert.deepEqual(projectCurrentPlan(plan), {
    id: 'free',
    isFree: true,
    isLifetime: false,
  });
  assert.equal(presentationGetterReads, 0);
});
