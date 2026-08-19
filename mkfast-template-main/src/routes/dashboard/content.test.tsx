import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'content.tsx'),
  'utf8'
);

test('the content compatibility route maps package ids and historical objects', () => {
  assert.match(source, /resolveCanonicalDeepLink/u);
  assert.match(source, /CanonicalDeepLinkUnavailable/u);
  assert.match(source, /contentId/u);
  assert.match(source, /handoffId/u);
  assert.match(source, /packageId/u);
  assert.doesNotMatch(source, /operationsCommand/u);
});
