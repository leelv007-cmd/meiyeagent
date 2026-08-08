import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentRunIdSchema,
  agentThreadIdSchema,
  apiErrorCodeSchema,
  approvalReceiptIdSchema,
  harnessReleaseIdSchema,
  identifierSchema,
  marketingGoalIdSchema,
  nonEmptyTrimmedStringSchema,
} from './index.js';

test('shared identifier schemas trim and reject blank values', () => {
  assert.equal(identifierSchema.parse('  work-1  '), 'work-1');
  assert.equal(nonEmptyTrimmedStringSchema.safeParse('   ').success, false);
  assert.equal(approvalReceiptIdSchema.parse('receipt-1'), 'receipt-1');
});

test('agent-domain branded IDs trim and reject blank values', () => {
  assert.equal(agentThreadIdSchema.parse('  thread-1  '), 'thread-1');
  assert.equal(agentRunIdSchema.parse('run-1'), 'run-1');
  assert.equal(marketingGoalIdSchema.parse('goal-1'), 'goal-1');
  assert.equal(harnessReleaseIdSchema.parse('release-1'), 'release-1');
  assert.equal(agentThreadIdSchema.safeParse('   ').success, false);
});

test('transport error vocabulary rejects unregistered codes', () => {
  assert.equal(apiErrorCodeSchema.parse('NOT_FOUND'), 'NOT_FOUND');
  assert.equal(apiErrorCodeSchema.safeParse('provider_timeout').success, false);
});
