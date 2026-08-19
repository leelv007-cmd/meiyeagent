import assert from 'node:assert/strict';
import test from 'node:test';

import { selectActiveAgentThreadId } from './active-agent-thread';

test('an explicit Thread deep link replaces a restored session Thread', () => {
  assert.equal(
    selectActiveAgentThreadId({
      agentBindingThreadId: 'thread-binding-a',
      continuedAgentThreadId: 'thread-continued-a',
      explicitThreadId: 'thread-b',
      phase: 'delivered',
      taskAgentThreadId: 'thread-task-a',
    }),
    'thread-b'
  );
});

test('a session Thread remains the fallback without an explicit deep link', () => {
  assert.equal(
    selectActiveAgentThreadId({
      agentBindingThreadId: 'thread-binding-a',
      continuedAgentThreadId: 'thread-continued-a',
      explicitThreadId: null,
      phase: 'delivered',
      taskAgentThreadId: 'thread-task-a',
    }),
    'thread-task-a'
  );
});
