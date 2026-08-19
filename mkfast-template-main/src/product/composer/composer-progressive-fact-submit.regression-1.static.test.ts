import assert from 'node:assert/strict';
import test from 'node:test';

import {
  identifiers,
  literals,
  parseProductionSource,
  parseSourceText,
} from '../../test-support/ast-boundary';

const home = parseProductionSource(
  new URL('./composer-home.tsx', import.meta.url)
);

test('a fake revealed-state toggle fails the store-action focus boundary', () => {
  const preFix = parseSourceText(
    'pre-fix.ts',
    'const onRevealStoreFacts = () => { setFactReviewRevealed(true); };'
  );
  assert.ok(identifiers(preFix).has('setFactReviewRevealed'));
});

test('progressive fact submit focuses the existing store action', () => {
  assert.ok(identifiers(home).has('onRevealStoreFacts'));
  assert.ok(
    literals(home).some((value) =>
      value.includes('progressive-fact-store-link')
    )
  );
  assert.ok(
    identifiers(home).has('scrollIntoView') || identifiers(home).has('focus')
  );
  assert.equal(identifiers(home).has('setFactReviewRevealed'), false);
});
