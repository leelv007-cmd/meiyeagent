import assert from 'node:assert/strict';
import test from 'node:test';

import { publicBillingBalanceSchema } from './billing-balance.js';

test('public billing balance is an exact copy/image/video projection', () => {
  const balance = publicBillingBalanceSchema.parse({
    copy: {
      allowance: 12,
      available: 9,
      committed: 2,
      released: 1,
      reserved: 1,
    },
    image: {
      allowance: 7,
      available: 7,
      committed: 0,
      released: 0,
      reserved: 0,
    },
    video: {
      allowance: 2,
      available: 1,
      committed: 1,
      released: 0,
      reserved: 0,
    },
  });

  assert.deepEqual(Object.keys(balance), ['copy', 'image', 'video']);
  assert.equal(
    publicBillingBalanceSchema.safeParse({
      ...balance,
      audio: balance.copy,
    }).success,
    false,
  );
});
