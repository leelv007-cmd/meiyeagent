/**
 * Merchant support reference pure tests (P0-E1 / #144).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatMerchantSupportReference,
  looksLikeInternalUuid,
} from './merchant-support-reference';

const workId = 'work_9fef6e5d-1fd2-4a44-9ce1-8ea3b4e76a07';

test('support reference is stable for the same internal id', () => {
  const first = formatMerchantSupportReference(workId);
  const second = formatMerchantSupportReference(workId);
  assert.equal(first, second);
  assert.match(first, /^MY-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/u);
});

test('support reference never embeds the raw UUID or work prefix', () => {
  const ref = formatMerchantSupportReference(workId);
  assert.equal(looksLikeInternalUuid(ref), false);
  assert.doesNotMatch(ref, /9fef6e5d/iu);
  assert.doesNotMatch(ref, /work_/iu);
  assert.notEqual(ref, workId);
});

test('distinct internal ids produce distinct support references', () => {
  const left = formatMerchantSupportReference(workId);
  const right = formatMerchantSupportReference(
    'work_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  );
  assert.notEqual(left, right);
});

test('looksLikeInternalUuid detects UUID shapes only', () => {
  assert.equal(looksLikeInternalUuid(workId), true);
  assert.equal(looksLikeInternalUuid('MY-AB12CD'), false);
  assert.equal(looksLikeInternalUuid('not-a-uuid'), false);
});
