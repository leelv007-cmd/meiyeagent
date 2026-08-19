import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasCall,
  identifiers,
  literals,
  parseProductionSource,
  parseSourceText,
} from '../../test-support/ast-boundary';

const home = parseProductionSource(
  new URL('./composer-home.tsx', import.meta.url)
);

test('a second identity query key fails the T33 cache boundary', () => {
  const preFix = parseSourceText(
    'pre-fix.ts',
    "useQuery({ queryKey: ['marketing-identity-projection'] });"
  );
  assert.ok(literals(preFix).includes('marketing-identity-projection'));
});

test('Composer shares the T33 identity query and module invalidation', () => {
  assert.ok(identifiers(home).has('marketingIdentityProjectionQuery'));
  assert.equal(hasCall(home, 'invalidateMarketingIdentity'), true);
  assert.equal(literals(home).includes('marketing-identity-projection'), false);
});
