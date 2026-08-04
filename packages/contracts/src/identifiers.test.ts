import assert from 'node:assert/strict';
import test from 'node:test';

import {
  apiErrorCodeSchema,
  approvalReceiptIdSchema,
  identifierSchema,
  nonEmptyTrimmedStringSchema,
} from './index.js';

test('shared identifier schemas trim and reject blank values', () => {
  assert.equal(identifierSchema.parse('  work-1  '), 'work-1');
  assert.equal(nonEmptyTrimmedStringSchema.safeParse('   ').success, false);
  assert.equal(approvalReceiptIdSchema.parse('receipt-1'), 'receipt-1');
});

test('transport error vocabulary rejects unregistered codes', () => {
  assert.equal(apiErrorCodeSchema.parse('NOT_FOUND'), 'NOT_FOUND');
  assert.equal(apiErrorCodeSchema.safeParse('provider_timeout').success, false);
});
