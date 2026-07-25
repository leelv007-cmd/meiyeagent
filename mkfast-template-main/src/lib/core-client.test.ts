import assert from 'node:assert/strict';
import test from 'node:test';

import { authorizeWorkspaceCoreRequest } from '@/lib/workspace-core-authorization';
import {
  CoreRequestBoundaryError,
  coreFetch,
  forwardedCorrelationId,
  forwardedIdempotencyKey,
  readRequestText,
  workspaceCoreFetchInit,
  workspaceCoreUpstreamPath,
  workspaceHarnessDecisionResource,
  workspaceWorkflowEventResource,
} from '@/lib/core-request';

const staleAdminSession = {
  session: { createdAt: new Date(Date.now() - 16 * 60 * 1000) },
  user: { emailVerified: true, id: 'admin-a', role: 'admin' },
};

test('workspace Core authorization lets a non-sensitive command continue with cached auth', async () => {
  const calls: unknown[] = [];
  const result = await authorizeWorkspaceCoreRequest(
    new Request('http://localhost/api/core/p1/commands'),
    'p1/commands',
    JSON.stringify({
      action: 'recipe_preview',
      module: 'creation-experience',
      payload: {},
    }),
    async (options) => {
      calls.push(options);
      return staleAdminSession as never;
    }
  );

  assert.equal('session' in result, true);
  assert.deepEqual(calls, [
    {
      headers: new Headers(),
    },
  ]);
});

test('workspace Core authorization blocks a stale sensitive command with cache bypassed', async () => {
  const calls: unknown[] = [];
  const result = await authorizeWorkspaceCoreRequest(
    new Request('http://localhost/api/core/p1/commands'),
    'p1/commands',
    JSON.stringify({
      action: 'admin_supply_action',
      module: 'model-supply',
      payload: {},
    }),
    async (options) => {
      calls.push(options);
      return staleAdminSession as never;
    }
  );

  assert.equal('response' in result, true);
  if (!('response' in result)) return;
  assert.equal(result.response.status, 403);
  assert.deepEqual(await result.response.json(), {
    code: 'RECENT_AUTHENTICATION_REQUIRED',
    error: 'Recent authentication is required.',
  });
  assert.deepEqual(calls, [
    {
      headers: new Headers(),
      query: { disableCookieCache: true, disableRefresh: true },
    },
  ]);
});

test('rejects oversized chunked Core proxy bodies before buffering them all', async () => {
  const request = new Request('http://localhost/api/core/p1/commands', {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(700_000));
        controller.enqueue(new Uint8Array(400_000));
        controller.close();
      },
    }),
    duplex: 'half',
    method: 'POST',
  } as RequestInit & { duplex: 'half' });

  await assert.rejects(
    readRequestText(request),
    (error: unknown) =>
      error instanceof CoreRequestBoundaryError &&
      error.code === 'REQUEST_BODY_TOO_LARGE' &&
      error.status === 413
  );
});

test('validates forwarded request IDs at the Web boundary', () => {
  assert.throws(
    () => forwardedIdempotencyKey('invalid key with spaces'),
    (error: unknown) =>
      error instanceof CoreRequestBoundaryError &&
      error.code === 'INVALID_IDEMPOTENCY_KEY' &&
      error.status === 400
  );
  assert.equal(forwardedIdempotencyKey('valid-key'), 'valid-key');
  assert.notEqual(
    forwardedCorrelationId('unsafe correlation value'),
    'unsafe correlation value'
  );
});

test('applies a total deadline to ordinary Core calls', async () => {
  let observedSignal: AbortSignal | null = null;
  await assert.rejects(
    coreFetch(
      async (_input, init) => {
        observedSignal = init?.signal ?? null;
        return await new Promise<Response>((_resolve, reject) => {
          observedSignal?.addEventListener(
            'abort',
            () => reject(observedSignal?.reason),
            { once: true }
          );
        });
      },
      'http://core.test/v1/query',
      {},
      { timeoutMs: 10 }
    )
  );
  assert.equal((observedSignal as AbortSignal | null)?.aborted, true);
});

test('uses a connect deadline rather than a short total deadline for streams', async () => {
  const response = await coreFetch(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            setTimeout(() => {
              controller.enqueue(new TextEncoder().encode('event: ready\n\n'));
              controller.close();
            }, 25);
          },
        })
      ),
    'http://core.test/v1/events',
    {},
    { idleTimeoutMs: 100, stream: true, timeoutMs: 10 }
  );

  assert.equal(await response.text(), 'event: ready\n\n');
});

test('the workspace stream proxy forwards the browser Request signal upstream', async () => {
  const controller = new AbortController();
  const request = new Request('http://localhost/api/core/p1/copy/stream', {
    body: '{}',
    method: 'POST',
    signal: controller.signal,
  });
  const init = workspaceCoreFetchInit(request, new Headers(), '{}');
  const reason = new DOMException('client disconnected', 'AbortError');
  const upstream = new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
      once: true,
    });
  });

  assert.equal(init.signal, request.signal);
  controller.abort(reason);
  await assert.rejects(
    upstream,
    (error: unknown) => error === reason && request.signal.aborted
  );
});

test('the harness decision proxy encodes one task path without changing the workspace route', () => {
  const request = new Request(
    'http://localhost/api/core/p1/harness/tasks/task%2Fone/decision'
  );
  const resource = workspaceHarnessDecisionResource('task/one');

  assert.equal(resource, 'p1/harness/tasks/task%2Fone/decision');
  assert.equal(
    workspaceCoreUpstreamPath('workspace-a', resource, request.url),
    '/v1/workspaces/workspace-a/p1/harness/tasks/task%2Fone/decision'
  );
});

test('the harness task collection keeps the authenticated workspace path', () => {
  assert.equal(
    workspaceCoreUpstreamPath(
      'workspace-a',
      'p1/harness/tasks',
      'http://localhost/api/core/p1/harness/tasks'
    ),
    '/v1/workspaces/workspace-a/p1/harness/tasks'
  );
});

test('the workflow proxy preserves Last-Event-ID, query, and one encoded dynamic path', () => {
  const request = new Request(
    'http://localhost/api/core/p1/workflows/task%2Fone/events?source=video',
    { headers: { 'last-event-id': 'task-one:7:running' } }
  );
  const headers = new Headers();
  const init = workspaceCoreFetchInit(request, headers, undefined);
  const resource = workspaceWorkflowEventResource('task/one');

  assert.equal(init.headers, headers);
  assert.equal(headers.get('last-event-id'), 'task-one:7:running');
  assert.equal(resource, 'p1/workflows/task%2Fone/events');
  assert.equal(
    workspaceCoreUpstreamPath('workspace-a', resource, request.url),
    '/v1/workspaces/workspace-a/p1/workflows/task%2Fone/events?source=video'
  );
});
