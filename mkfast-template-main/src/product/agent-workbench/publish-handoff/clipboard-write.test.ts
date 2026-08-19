import assert from 'node:assert/strict';
import test from 'node:test';

import { writeMerchantClipboardText } from './clipboard-write';

test('write succeeds only after writeText resolves', async () => {
  const calls: string[] = [];
  const ok = await writeMerchantClipboardText('周末护理', {
    writeText: async (value) => {
      calls.push(value);
    },
  });
  assert.equal(ok, true);
  assert.deepEqual(calls, ['周末护理']);
});

test('missing clipboard API is not success', async () => {
  assert.equal(await writeMerchantClipboardText('周末护理'), false);
  assert.equal(await writeMerchantClipboardText('周末护理', null), false);
  assert.equal(
    await writeMerchantClipboardText('周末护理', {} as never),
    false
  );
});

test('rejected writeText is not success', async () => {
  const ok = await writeMerchantClipboardText('周末护理', {
    writeText: async () => {
      throw new Error('denied');
    },
  });
  assert.equal(ok, false);
});
