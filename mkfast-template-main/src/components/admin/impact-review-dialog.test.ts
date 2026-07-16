import assert from 'node:assert/strict';
import test from 'node:test';
import { impactReasonSchema } from './impact-review-dialog';

test('requires a concrete audit reason before a high-impact admin action', () => {
  assert.equal(impactReasonSchema.safeParse('').success, false);
  assert.equal(impactReasonSchema.safeParse('   ').success, false);
  assert.equal(
    impactReasonSchema.safeParse('Publish the evaluated catalog revision')
      .success,
    true
  );
});
