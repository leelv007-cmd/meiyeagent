import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient } from '@tanstack/react-query';

import {
  invalidateMarketingIdentity,
  marketingIdentitiesQuery,
  marketingIdentityProjectionQuery,
} from './marketing-identity-queries';

test('identity list and remembered default share one invalidation namespace', async () => {
  assert.deepEqual(marketingIdentitiesQuery.queryKey.slice(0, 2), [
    'p1',
    'marketing-identity',
  ]);
  assert.deepEqual(marketingIdentityProjectionQuery.queryKey.slice(0, 2), [
    'p1',
    'marketing-identity',
  ]);

  const queryClient = new QueryClient();
  queryClient.setQueryData(marketingIdentitiesQuery.queryKey, []);
  queryClient.setQueryData(marketingIdentityProjectionQuery.queryKey, {
    defaultDecision: null,
    defaultIdentity: null,
    identities: [],
  });

  await invalidateMarketingIdentity(queryClient);

  assert.equal(
    queryClient.getQueryState(marketingIdentitiesQuery.queryKey)?.isInvalidated,
    true
  );
  assert.equal(
    queryClient.getQueryState(marketingIdentityProjectionQuery.queryKey)
      ?.isInvalidated,
    true
  );
});
