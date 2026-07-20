import assert from 'node:assert/strict';
import test from 'node:test';

import {
  harnessLogicalId,
  harnessRuntimeId,
} from './workspace-scope.js';

test('harness runtime identities namespace the same logical ID by workspace', () => {
  const first = harnessRuntimeId('workspace-a', 'task-shared');
  const second = harnessRuntimeId('workspace-b', 'task-shared');
  assert.notEqual(first, second);
  assert.equal(harnessLogicalId(first), 'task-shared');
  assert.equal(harnessLogicalId(second), 'task-shared');
  assert.notEqual(
    harnessRuntimeId('a:b', 'c'),
    harnessRuntimeId('a', 'b:c'),
  );
});
