import assert from 'node:assert/strict';
import test from 'node:test';

import {
  directSourceHref,
  optionalSourceId,
  sourceObjectElementId,
  storeSourceTab,
} from './source-object-navigation';

test('builds direct content, asset, and publication URLs without a full-text search fallback', () => {
  assert.equal(
    directSourceHref('content', 'content/a'),
    '/dashboard/content?contentId=content%2Fa'
  );
  assert.equal(
    directSourceHref('asset', 'asset a'),
    '/dashboard/assets/asset%20a'
  );
  assert.equal(
    directSourceHref('publish', 'handoff/a'),
    '/dashboard/content?handoffId=handoff%2Fa'
  );
  assert.equal(directSourceHref('content', '  '), undefined);
});

test('creates stable highlight ids and validates legacy store tabs', () => {
  assert.equal(
    sourceObjectElementId('content', 'content/a'),
    'source-content-content%2Fa'
  );
  assert.equal(optionalSourceId(' asset-a '), 'asset-a');
  assert.equal(optionalSourceId(42), undefined);
  assert.equal(storeSourceTab(undefined, 'asset-a'), 'assets');
  assert.equal(storeSourceTab('qualification', 'asset-a'), 'qualification');
});
