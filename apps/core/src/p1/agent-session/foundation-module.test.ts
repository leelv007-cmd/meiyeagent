/**
 * V31-05 agent-session P1 action contract tests.
 * External behavior only: list / resolve / open_legacy / explicit miss.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { requiredP1Capability } from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import { P1DomainError } from '../foundation/domain.js';
import { AgentSessionFoundationModule } from './foundation-module.js';
import { MemoryAgentSessionStore } from './memory-agent-session-store.js';

const TS = '2026-08-08T12:00:00.000Z';
const TS2 = '2026-08-08T13:00:00.000Z';

function context(workspaceId = 'ws-agent-session'): P1Context {
  return {
    userId: 'user-1',
    workspaceId,
    correlationId: 'corr-agent-session',
  };
}

function moduleOf(store = new MemoryAgentSessionStore()) {
  return { store, module: new AgentSessionFoundationModule(store) };
}

test('capability map: agent-session list/restore are workspace.read', () => {
  for (const action of [
    'list_threads',
    'get_workbench_session',
    'get_thread',
  ] as const) {
    assert.equal(
      requiredP1Capability('query', 'agent-session', action),
      'workspace.read',
    );
  }
  assert.equal(
    requiredP1Capability('command', 'agent-session', 'open_legacy_work_thread'),
    'content.create',
  );
  assert.equal(
    requiredP1Capability('command', 'agent-session', 'create_thread'),
    'content.create',
  );
  assert.equal(
    requiredP1Capability('query', 'agent-session', 'unknown_action'),
    null,
  );
});

test('list_threads returns recent projection ordered by activity', async () => {
  const { store, module } = moduleOf();
  await store.createThread({
    resourceId: 'ws-agent-session',
    threadId: 'thread-old',
    title: '旧会话',
    now: TS,
  });
  await store.createThread({
    resourceId: 'ws-agent-session',
    threadId: 'thread-new',
    title: '新会话',
    now: TS2,
  });
  await store.startWriteTurn({
    resourceId: 'ws-agent-session',
    threadId: 'thread-new',
    expectedSessionRevision: 0,
    runId: 'run-new',
    trigger: 'merchant_turn',
    harnessReleaseId: 'harness-v1',
    now: TS2,
  });

  const result = (await module.query({
    context: context(),
    input: { action: 'list_threads', payload: {} },
  })) as { threads: Array<{ threadId: string; activeRunId?: string }> };

  assert.equal(result.threads[0]?.threadId, 'thread-new');
  assert.equal(result.threads[0]?.activeRunId, 'run-new');
  assert.equal(result.threads[1]?.threadId, 'thread-old');
  assert.equal(result.threads[1]?.activeRunId, undefined);
});

test('get_workbench_session: explicit threadId wins over recent active', async () => {
  const { store, module } = moduleOf();
  await store.createThread({
    resourceId: 'ws-agent-session',
    threadId: 'thread-a',
    title: 'A',
    now: TS,
  });
  await store.createThread({
    resourceId: 'ws-agent-session',
    threadId: 'thread-b',
    title: 'B',
    now: TS2,
  });
  await store.startWriteTurn({
    resourceId: 'ws-agent-session',
    threadId: 'thread-b',
    expectedSessionRevision: 0,
    runId: 'run-b',
    trigger: 'merchant_turn',
    harnessReleaseId: 'harness-v1',
    now: TS2,
  });

  const explicit = (await module.query({
    context: context(),
    input: {
      action: 'get_workbench_session',
      payload: { threadId: 'thread-a' },
    },
  })) as {
    session: { threadId: string; activeRunId?: string } | null;
    resolveSource: string;
  };

  assert.equal(explicit.resolveSource, 'explicit_thread');
  assert.equal(explicit.session?.threadId, 'thread-a');
  assert.equal(explicit.session?.activeRunId, undefined);

  const auto = (await module.query({
    context: context(),
    input: { action: 'get_workbench_session', payload: {} },
  })) as {
    session: { threadId: string; activeRunId?: string } | null;
    resolveSource: string;
  };

  assert.equal(auto.resolveSource, 'active_turn');
  assert.equal(auto.session?.threadId, 'thread-b');
  assert.equal(auto.session?.activeRunId, 'run-b');
});

test('get_workbench_session without threads is Idle', async () => {
  const { module } = moduleOf();
  const result = (await module.query({
    context: context(),
    input: { action: 'get_workbench_session', payload: {} },
  })) as { session: null; resolveSource: string };

  assert.equal(result.session, null);
  assert.equal(result.resolveSource, 'idle');
});

test('get_workbench_session explicit miss is NOT_FOUND (not Idle)', async () => {
  const { module } = moduleOf();
  await assert.rejects(
    () =>
      module.query({
        context: context(),
        input: {
          action: 'get_workbench_session',
          payload: { threadId: 'missing' },
        },
      }),
    (error: unknown) =>
      error instanceof P1DomainError && error.code === 'NOT_FOUND',
  );
});

test('open_legacy_work_thread is idempotent per legacy work', async () => {
  const { module } = moduleOf();
  const first = (await module.execute({
    context: context(),
    idempotencyKey: 'legacy-1',
    input: {
      action: 'open_legacy_work_thread',
      payload: {
        legacyWorkId: 'work-legacy-1',
        title: '历史作品',
        now: TS,
      },
    },
  })) as {
    created: boolean;
    thread: { threadId: string };
    session: { threadId: string };
  };
  assert.equal(first.created, true);
  assert.equal(first.session.threadId, first.thread.threadId);

  const second = (await module.execute({
    context: context(),
    idempotencyKey: 'legacy-2',
    input: {
      action: 'open_legacy_work_thread',
      payload: {
        legacyWorkId: 'work-legacy-1',
        title: '历史作品',
        now: TS2,
      },
    },
  })) as { created: boolean; thread: { threadId: string } };

  assert.equal(second.created, false);
  assert.equal(second.thread.threadId, first.thread.threadId);
});

test('create_thread returns session projection for new Idle→Active entry', async () => {
  const { module } = moduleOf();
  const result = (await module.execute({
    context: context(),
    idempotencyKey: 'create-1',
    input: {
      action: 'create_thread',
      payload: { title: '新对话', now: TS },
    },
  })) as {
    thread: { title: string; sessionRevision: number };
    session: { threadId: string; title: string };
  };

  assert.equal(result.thread.title, '新对话');
  assert.equal(result.thread.sessionRevision, 0);
  assert.equal(result.session.title, '新对话');
  assert.ok(result.session.threadId.length > 0);
});

test('list_threads is workspace-scoped', async () => {
  const { store, module } = moduleOf();
  await store.createThread({
    resourceId: 'ws-agent-session',
    threadId: 'mine',
    title: '本店',
    now: TS,
  });
  await store.createThread({
    resourceId: 'ws-other',
    threadId: 'theirs',
    title: '他店',
    now: TS,
  });

  const result = (await module.query({
    context: context('ws-agent-session'),
    input: { action: 'list_threads', payload: {} },
  })) as { threads: Array<{ threadId: string }> };

  assert.deepEqual(
    result.threads.map((item) => item.threadId),
    ['mine'],
  );
});

test('production api-runtime registers AgentSessionFoundationModule', () => {
  const source = readFileSync(
    new URL('../../assembly/api-runtime.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /AgentSessionFoundationModule/u);
  assert.match(
    source,
    /new AgentSessionFoundationModule\(\s*new PostgresAgentSessionStore\(pool\)\s*\)/u,
  );
  assert.match(source, /from '\.\.\/p1\/agent-session\/index\.js'/u);
});
