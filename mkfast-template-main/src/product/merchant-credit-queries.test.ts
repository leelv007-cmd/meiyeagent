import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { p1QueryKeys } from '@/p1/query-keys';
import {
  invalidateMerchantCreditQueries,
  merchantCreditQueryKeys,
} from './merchant-credit-queries';

test('merchant credit invalidation targets projection, detail, and balance together', async () => {
  assert.deepEqual(
    merchantCreditQueryKeys.projection,
    p1QueryKeys.request('entitlements', 'projection')
  );
  assert.deepEqual(
    merchantCreditQueryKeys.creditDetail,
    p1QueryKeys.request('entitlements', 'credit_detail')
  );
  assert.deepEqual(
    merchantCreditQueryKeys.balance,
    p1QueryKeys.request('entitlements', 'balance')
  );

  const keys: unknown[] = [];
  await invalidateMerchantCreditQueries({
    invalidateQueries: async (options: { queryKey: unknown }) => {
      keys.push(options.queryKey);
    },
  } as never);

  assert.deepEqual(keys, [
    merchantCreditQueryKeys.projection,
    merchantCreditQueryKeys.creditDetail,
    merchantCreditQueryKeys.balance,
  ]);
});

test('shipped redeem clients invalidate projection and credit detail together', () => {
  const redemptionCard = readFileSync(
    new URL('../p1/redemption-card.tsx', import.meta.url),
    'utf8'
  );
  const recoveryHost = readFileSync(
    new URL('./composer/quota-blocking-card.tsx', import.meta.url),
    'utf8'
  );
  const composerHome = readFileSync(
    new URL('./composer/composer-home.tsx', import.meta.url),
    'utf8'
  );

  for (const source of [redemptionCard, recoveryHost, composerHome]) {
    assert.match(source, /invalidateMerchantCreditQueries/u);
  }
  assert.doesNotMatch(
    redemptionCard,
    /queryKey: p1QueryKeys\.request\(\s*'entitlements',\s*'projection'\s*\)/u
  );
});
