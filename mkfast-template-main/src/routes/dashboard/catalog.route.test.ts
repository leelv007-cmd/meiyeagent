/**
 * Catalog route search validation (C3 / #97).
 * Allowlisted params only — no draft/prompt/provider.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCatalogSearch } from './catalog';

test('validateCatalogSearch keeps allowlisted fields', () => {
  const result = validateCatalogSearch({
    tab: 'tools',
    category: 'image',
    surfaceRevisionId: 'surf@1',
    returnKey: 'rk',
    q: 'poster',
    // Sensitive / unknown fields must be dropped.
    prompt: 'secret',
    provider: 'openai',
    userText: 'full draft',
    body: 'nope',
  });
  assert.deepEqual(result, {
    tab: 'tools',
    category: 'image',
    surfaceRevisionId: 'surf@1',
    returnKey: 'rk',
    q: 'poster',
  });
  assert.equal('prompt' in result, false);
  assert.equal('provider' in result, false);
  assert.equal('userText' in result, false);
});

test('validateCatalogSearch maps recipe/tool aliases', () => {
  assert.equal(validateCatalogSearch({ tab: 'recipe' }).tab, 'templates');
  assert.equal(validateCatalogSearch({ tab: 'tool' }).tab, 'tools');
});

test('validateCatalogSearch ignores invalid tab', () => {
  assert.equal(validateCatalogSearch({ tab: 'admin' }).tab, undefined);
});
