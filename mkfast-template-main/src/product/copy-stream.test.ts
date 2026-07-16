import assert from 'node:assert/strict';
import test from 'node:test';

import { copyCandidateSlots, shouldShowCopyStreamPanel } from './copy-stream';

test('keeps three stable candidate slots while partial JSON arrives', () => {
  assert.deepEqual(
    copyCandidateSlots({
      candidates: [{ title: '第一条' }, { body: '第二条正文' }],
    }),
    [{ title: '第一条' }, { body: '第二条正文' }, {}]
  );
});

test('keeps the stream panel visible when failure happens before the first chunk', () => {
  assert.equal(
    shouldShowCopyStreamPanel({
      completed: false,
      hasError: true,
      hasObject: false,
      interrupted: false,
      loading: false,
    }),
    true
  );
  assert.equal(
    shouldShowCopyStreamPanel({
      completed: false,
      hasError: false,
      hasObject: false,
      interrupted: true,
      loading: false,
    }),
    true
  );
  assert.equal(
    shouldShowCopyStreamPanel({
      completed: true,
      hasError: false,
      hasObject: true,
      interrupted: false,
      loading: false,
    }),
    false
  );
});
