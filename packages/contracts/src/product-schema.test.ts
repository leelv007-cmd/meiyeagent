import assert from 'node:assert/strict';
import test from 'node:test';

import { productCommandSchema } from './product-schema.js';

test('create_lead accepts one canonical package source and rejects ambiguous sources', () => {
  assert.equal(
    productCommandSchema.safeParse({
      type: 'create_lead',
      packageId: 'package-1',
      lead: { source: 'direct_message' },
    }).success,
    true
  );
  assert.equal(
    productCommandSchema.safeParse({
      type: 'create_lead',
      contentId: 'legacy-content-1',
      lead: {
        projectId: 'project-1',
        source: 'direct_message',
      },
    }).success,
    true
  );
  assert.equal(
    productCommandSchema.safeParse({
      type: 'create_lead',
      contentId: 'legacy-content-1',
      packageId: 'package-1',
      lead: {
        projectId: 'project-1',
        source: 'direct_message',
      },
    }).success,
    false
  );
  assert.equal(
    productCommandSchema.safeParse({
      type: 'create_lead',
      lead: { source: 'direct_message' },
    }).success,
    false
  );
});
