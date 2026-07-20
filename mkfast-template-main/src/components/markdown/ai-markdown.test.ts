import assert from 'node:assert/strict';
import test from 'node:test';

import { sameResponseStreamChildren } from './response-stream';

test('streaming markdown memoization compares only received children', () => {
  assert.equal(
    sameResponseStreamChildren(
      { children: '已收到正文' },
      { children: '已收到正文' }
    ),
    true
  );
  assert.equal(
    sameResponseStreamChildren(
      { children: '已收到正文' },
      { children: '已收到正文。' }
    ),
    false
  );
});
