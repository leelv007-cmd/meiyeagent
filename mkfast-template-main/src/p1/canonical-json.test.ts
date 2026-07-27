import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalJsonString,
  canonicalJsonValue,
  stableJsonHash,
} from './canonical-json';

test('key order does not change the canonical form', () => {
  assert.equal(
    canonicalJsonString({ b: 1, a: { d: 2, c: 3 } }),
    '{"a":{"c":3,"d":2},"b":1}'
  );
  assert.equal(
    canonicalJsonString({ a: { c: 3, d: 2 }, b: 1 }),
    canonicalJsonString({ b: 1, a: { d: 2, c: 3 } })
  );
});

test('array order is meaning, not incidental order', () => {
  assert.notEqual(canonicalJsonString([1, 2]), canonicalJsonString([2, 1]));
  assert.deepEqual(canonicalJsonValue([{ b: 1, a: 2 }]), [{ a: 2, b: 1 }]);
});

test('undefined members drop out exactly as JSON.stringify drops them', () => {
  assert.equal(
    canonicalJsonString({ a: 1, b: undefined }),
    canonicalJsonString({ a: 1 })
  );
});

test('the digest is stable, order-independent and payload-sensitive', () => {
  const payload = {
    catalogModelId: 'model-copy',
    operation: 'copy.generate',
    quantity: 1,
    submission: { creationMode: 'customized', intent: '写一条到店预约文案' },
  };
  const digest = stableJsonHash(payload);

  assert.match(digest, /^[0-9a-f]{16}$/u);
  assert.equal(stableJsonHash(payload), digest);
  assert.equal(
    stableJsonHash({
      submission: { intent: '写一条到店预约文案', creationMode: 'customized' },
      quantity: 1,
      operation: 'copy.generate',
      catalogModelId: 'model-copy',
    }),
    digest
  );
  // One character of the merchant's sentence is enough to move it.
  assert.notEqual(
    stableJsonHash({
      ...payload,
      submission: { ...payload.submission, intent: '写一条到店预约文案。' },
    }),
    digest
  );
  assert.notEqual(stableJsonHash({ ...payload, quantity: 2 }), digest);
});
