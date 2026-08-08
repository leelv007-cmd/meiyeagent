import assert from 'node:assert/strict';
import test from 'node:test';

import { toHttpError } from '../../http-errors.js';
import { AgentSessionError } from './agent-session-store.js';
import { runAgentSessionStoreConformance } from './agent-session-store-conformance.js';
import { MemoryAgentSessionStore } from './memory-agent-session-store.js';

runAgentSessionStoreConformance({
  label: 'memory agent session store',
  createFixture: async () => ({
    store: new MemoryAgentSessionStore(),
    resourceId: 'resource-memory',
    dispose: async () => undefined,
  }),
});

test('a concurrent turn conflict reaches the API envelope with the current session revision', async () => {
  const store = new MemoryAgentSessionStore();
  await store.createThread({
    resourceId: 'resource-http',
    threadId: 'thread-http',
    title: '双端并发提示',
    now: '2026-08-08T11:00:00.000Z',
  });
  await store.startWriteTurn({
    resourceId: 'resource-http',
    threadId: 'thread-http',
    expectedSessionRevision: 0,
    runId: 'run-http-1',
    trigger: 'merchant_turn',
    harnessReleaseId: 'harness-release-v1',
    now: '2026-08-08T11:01:00.000Z',
  });

  let conflict: unknown;
  try {
    await store.startWriteTurn({
      resourceId: 'resource-http',
      threadId: 'thread-http',
      expectedSessionRevision: 0,
      runId: 'run-http-2',
      trigger: 'merchant_turn',
      harnessReleaseId: 'harness-release-v1',
      now: '2026-08-08T11:02:00.000Z',
    });
  } catch (error) {
    conflict = error;
  }

  assert.ok(conflict instanceof AgentSessionError);
  assert.deepEqual(
    toHttpError(conflict, {
      code: 'AGENT_SESSION_ERROR',
      message: 'Agent session write failed.',
      status: 500,
    }),
    {
      code: 'AGENT_SESSION_REVISION_CONFLICT',
      details: {
        threadId: 'thread-http',
        expectedSessionRevision: 0,
        currentSessionRevision: 1,
      },
      message: conflict.message,
      status: 409,
    },
  );
});
