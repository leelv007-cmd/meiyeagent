import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const home = readFileSync(
  fileURLToPath(new URL('./composer-home.tsx', import.meta.url)),
  'utf8'
);

test('Composer shares the T33 identity query and module invalidation', () => {
  assert.match(home, /marketingIdentityProjectionQuery/u);
  assert.match(home, /invalidateMarketingIdentity/u);
  assert.doesNotMatch(home, /\[['"]marketing-identity-projection['"]\]/u);
});
