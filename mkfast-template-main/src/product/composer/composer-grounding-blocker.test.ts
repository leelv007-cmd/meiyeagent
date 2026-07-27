import assert from 'node:assert/strict';
import test from 'node:test';

import { groundingBlockerFromMissing } from './composer-grounding-blocker';

test('a regulated store missing its qualification is named, not silently blocked', () => {
  assert.equal(
    groundingBlockerFromMissing([
      'confirmed_store',
      'confirmed_project',
      'confirmed_qualification',
    ]),
    'qualification'
  );
});

test('an unusable source still outranks the qualification gap', () => {
  assert.equal(
    groundingBlockerFromMissing([
      'confirmed_qualification',
      'real_authorized_asset',
    ]),
    'source'
  );
});

/*
 * Store and project gaps stay unnamed here on purpose: the five-step intake card
 * already asks for them inline, so a second blocker would double up.
 */
test('store and project gaps stay with the inline intake card', () => {
  assert.equal(
    groundingBlockerFromMissing(['confirmed_store', 'confirmed_project']),
    null
  );
  assert.equal(groundingBlockerFromMissing([]), null);
});
