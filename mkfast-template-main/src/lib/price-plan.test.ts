import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSubscriptionPrice } from '@/lib/price-plan';

test('formats the Waffo HKD subscription catalog as HKD copy', () => {
  assert.equal(
    formatSubscriptionPrice({ amount: 52_200, currency: 'HKD' }),
    'HK$522'
  );
});
