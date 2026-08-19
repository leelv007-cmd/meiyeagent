import assert from 'node:assert/strict';
import test from 'node:test';

import { authorizeWorkspaceCoreRequest } from '@/lib/workspace-core-authorization';
import {
  CORE_OPERATION_TIMEOUT_MS,
  CORE_TIMEOUT_CODE,
  CORE_UNAVAILABLE_CODE,
  CoreRequestBoundaryError,
  DEFAULT_CORE_TIMEOUT_MS,
  coreFetch,
  coreFetchFailureResponse,
  fetchCoreForResource,
  forwardedCorrelationId,
  forwardedIdempotencyKey,
  readRequestBytes,
  readRequestText,
  resolveCoreOperationTimeoutMs,
  workspaceCoreFetchInit,
  workspaceCoreUpstreamPath,
  workspaceAgentSemanticResource,
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

  assert.equal(result.ok, true);
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

  assert.equal(result.ok, false);
  if (result.ok) return;
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

test('stops reading an oversized chunked asset upload instead of buffering it', async () => {
  const maxBytes = 1_000_000;
  let enqueued = 0;
  const request = new Request('http://localhost/api/core/p1/assets', {
    // No content-length: a chunked upload only reveals its size while it is
    // being read, which is exactly the shape `arrayBuffer()` could not defend.
    body: new ReadableStream({
      pull(controller) {
        enqueued += 1;
        controller.enqueue(new Uint8Array(400_000));
      },
    }),
    duplex: 'half',
    method: 'PUT',
  } as RequestInit & { duplex: 'half' });

  await assert.rejects(
    readRequestBytes(request, maxBytes),
    (error: unknown) =>
      error instanceof CoreRequestBoundaryError &&
      error.code === 'REQUEST_BODY_TOO_LARGE' &&
      error.status === 413
  );
  // The stream was cancelled the moment the ceiling broke, not drained.
  assert.ok(enqueued <= 3, `read ${enqueued} chunks before giving up`);
});

test('rejects a declared oversized asset upload before reading any of it', async () => {
  const request = new Request('http://localhost/api/core/p1/assets', {
    body: new Uint8Array(16),
    headers: { 'content-length': String(30 * 1024 * 1024) },
    method: 'PUT',
  });

  await assert.rejects(
    readRequestBytes(request, 25 * 1024 * 1024),
    (error: unknown) =>
      error instanceof CoreRequestBoundaryError && error.status === 413
  );
});

test('returns the exact bytes when the upload stays under the ceiling', async () => {
  const request = new Request('http://localhost/api/core/p1/assets', {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5]));
        controller.close();
      },
    }),
    duplex: 'half',
    method: 'PUT',
  } as RequestInit & { duplex: 'half' });

  assert.deepEqual(
    [...(await readRequestBytes(request, 1024))],
    [1, 2, 3, 4, 5]
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
  // Keep Node 22's test runner alive until its unref'ed deadline fires.
  const keepAlive = setTimeout(() => undefined, 60_000);
  try {
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
  } finally {
    clearTimeout(keepAlive);
  }
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
  const request = new Request('http://localhost/api/core/p1/assistant/stream', {
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

test('V31-83: agent-thread proxy is always namespaced under the BFF workspace', () => {
  const resource = workspaceAgentSemanticResource(
    'thread-owned-by-a',
    'replay'
  );
  assert.equal(resource, 'p1/agent-threads/thread-owned-by-a/replay');
  assert.equal(
    workspaceCoreUpstreamPath(
      'workspace-b',
      resource,
      'http://localhost/api/core/p1/agent-threads/thread-owned-by-a/replay'
    ),
    '/v1/workspaces/workspace-b/p1/agent-threads/thread-owned-by-a/replay'
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

const QUOTE_COMMAND_BODY = JSON.stringify({
  action: 'quote',
  module: 'product-billing',
  payload: {},
});

function delayedCoreFetcher(delayMs: number, response: Response) {
  return (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delayMs);
      const signal = init?.signal;
      if (!signal) return;
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    });
    return response;
  }) as typeof fetch;
}

test('TIMEOUT-01: quote is the shipped 12s budget; the global default stays 10s', () => {
  assert.equal(DEFAULT_CORE_TIMEOUT_MS, 10_000);
  assert.equal(CORE_OPERATION_TIMEOUT_MS['product-billing.quote'], 12_000);
  assert.equal(
    resolveCoreOperationTimeoutMs('p1/commands', QUOTE_COMMAND_BODY),
    12_000
  );
  assert.equal(
    resolveCoreOperationTimeoutMs('p1/query', QUOTE_COMMAND_BODY),
    12_000
  );
  assert.equal(
    resolveCoreOperationTimeoutMs(
      'p1/commands',
      JSON.stringify({
        action: 'brief_confirm',
        module: 'creation-experience',
        payload: {},
      })
    ),
    DEFAULT_CORE_TIMEOUT_MS
  );
  assert.equal(
    resolveCoreOperationTimeoutMs('p1/composer/submissions'),
    CORE_OPERATION_TIMEOUT_MS['p1/composer/submissions']
  );
  assert.notEqual(
    CORE_OPERATION_TIMEOUT_MS['product-billing.quote'],
    DEFAULT_CORE_TIMEOUT_MS
  );
});

test('TIMEOUT-01: a quote Core that answers at 11s is not cut at the 10s default', async () => {
  // Production gap is 10s default / 11s Core / 12s quote. Millisecond
  // stand-ins keep the same inequality without an 11s wall-clock wait.
  const defaultBudgetMs = 20;
  const coreDelayMs = 50;
  const quoteBudgetMs = 80;
  const quoteResponse = new Response('quoted');
  const keepAlive = setTimeout(() => undefined, 60_000);
  try {
    const timedOut = coreFetchFailureResponse(
      await coreFetch(
        delayedCoreFetcher(coreDelayMs, quoteResponse),
        'http://core.test/quote',
        {},
        { timeoutMs: defaultBudgetMs }
      ).catch((error: unknown) => error)
    );
    assert.ok(timedOut);
    assert.equal(timedOut.status, 504);
    const timedOutBody = (await timedOut.json()) as {
      error: { code: string; details?: { timeoutMs: number } };
    };
    assert.equal(timedOutBody.error.code, CORE_TIMEOUT_CODE);
    assert.equal(timedOutBody.error.details?.timeoutMs, defaultBudgetMs);
    assert.notEqual(timedOutBody.error.code, CORE_UNAVAILABLE_CODE);

    const quoted = await coreFetch(
      delayedCoreFetcher(coreDelayMs, quoteResponse),
      'http://core.test/quote',
      {},
      { timeoutMs: quoteBudgetMs }
    );
    assert.equal(await quoted.text(), 'quoted');
  } finally {
    clearTimeout(keepAlive);
  }
});

test('TIMEOUT-01: quote BFF hop uses the 12s registry budget, not the 10s default', async () => {
  const seen: number[] = [];
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  Object.defineProperty(AbortSignal, 'timeout', {
    configurable: true,
    value: (ms: number) => {
      seen.push(ms);
      return originalTimeout(ms);
    },
  });
  try {
    const response = await fetchCoreForResource(
      async () => new Response('quoted'),
      'http://core.test/v1/workspaces/ws/p1/commands',
      {},
      { body: QUOTE_COMMAND_BODY, resource: 'p1/commands' }
    );
    assert.equal(await response.text(), 'quoted');
    assert.deepEqual(seen, [12_000]);
  } finally {
    Object.defineProperty(AbortSignal, 'timeout', {
      configurable: true,
      value: originalTimeout,
    });
  }
});

test('TIMEOUT-01: CORE_TIMEOUT and CORE_UNAVAILABLE stay distinct', async () => {
  const keepAlive = setTimeout(() => undefined, 60_000);
  let timeout: Response | null;
  try {
    timeout = coreFetchFailureResponse(
      await coreFetch(
        delayedCoreFetcher(40, new Response('too-late')),
        'http://core.test/quote',
        {},
        { timeoutMs: 10 }
      ).catch((error: unknown) => error)
    );
  } finally {
    clearTimeout(keepAlive);
  }
  const unavailable = coreFetchFailureResponse(new TypeError('fetch failed'));

  assert.ok(timeout);
  assert.ok(unavailable);
  assert.equal(timeout.status, 504);
  assert.equal(unavailable.status, 503);
  assert.equal(
    ((await timeout.json()) as { error: { code: string } }).error.code,
    CORE_TIMEOUT_CODE
  );
  assert.equal(
    ((await unavailable.json()) as { error: { code: string } }).error.code,
    CORE_UNAVAILABLE_CODE
  );
  assert.notEqual(CORE_TIMEOUT_CODE, CORE_UNAVAILABLE_CODE);
});

test('TIMEOUT-01: caller abort is not a Core failure and not a server commit', async () => {
  const controller = new AbortController();
  const pending = fetchCoreForResource(
    delayedCoreFetcher(60_000, new Response('committed')),
    'http://core.test/v1/workspaces/ws/p1/commands',
    { signal: controller.signal },
    { body: QUOTE_COMMAND_BODY, resource: 'p1/commands' }
  );
  const reason = new DOMException('client disconnected', 'AbortError');
  controller.abort(reason);
  await assert.rejects(pending, (error: unknown) => {
    assert.equal(error, reason);
    assert.equal(coreFetchFailureResponse(error), null);
    return true;
  });
});
