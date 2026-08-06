/**
 * Catalog route search validation (C3 / #97).
 * Allowlisted params only — no draft/prompt/provider.
 * Standalone tools tab retired (D-177 / #419).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCatalogSearch } from '@/product/composer/catalog-route-model';

test('validateCatalogSearch keeps allowlisted fields', () => {
  const result = validateCatalogSearch({
    tab: 'templates',
    category: 'image_text',
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
    tab: 'templates',
    category: 'image_text',
    surfaceRevisionId: 'surf@1',
    returnKey: 'rk',
    q: 'poster',
  });
  assert.equal('prompt' in result, false);
  assert.equal('provider' in result, false);
  assert.equal('userText' in result, false);
});

test('validateCatalogSearch maps recipe alias; drops tools/tool', () => {
  assert.equal(validateCatalogSearch({ tab: 'recipe' }).tab, 'templates');
  assert.equal(validateCatalogSearch({ tab: 'tools' }).tab, undefined);
  assert.equal(validateCatalogSearch({ tab: 'tool' }).tab, undefined);
});

test('validateCatalogSearch ignores invalid tab', () => {
  assert.equal(validateCatalogSearch({ tab: 'admin' }).tab, undefined);
});
