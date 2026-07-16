import assert from 'node:assert/strict';
import test from 'node:test';

import { publishedTransitions } from './published-transition';

test('establishes a baseline without celebrating an already published record', () => {
  assert.deepEqual(
    publishedTransitions(undefined, [{ id: 'l1:a', status: 'published' }]),
    {
      newlyPublished: [],
      snapshot: { 'l1:a': 'published' },
    }
  );
});

test('celebrates only a real non-published to published transition', () => {
  const transition = publishedTransitions(
    { 'l1:a': 'submitted', 'l3:b': 'published' },
    [
      { id: 'l1:a', status: 'published' },
      { id: 'l3:b', status: 'published' },
    ]
  );
  assert.deepEqual(transition.newlyPublished, ['l1:a']);
});
