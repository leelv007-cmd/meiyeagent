import assert from 'node:assert/strict';
import test from 'node:test';

import { productCommandSchema } from './product-schema.js';

test('D-144 retires the lead ledger commands from the product contract', () => {
  assert.equal(
    productCommandSchema.safeParse({
      type: 'create_lead',
      packageId: 'package-1',
      lead: { source: 'direct_message' },
    }).success,
    false
  );
  assert.equal(
    productCommandSchema.safeParse({
      type: 'update_lead',
      leadId: 'lead-1',
      status: 'contacted',
    }).success,
    false
  );
});
