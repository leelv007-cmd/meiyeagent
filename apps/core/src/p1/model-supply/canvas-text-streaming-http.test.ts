import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createCoreServer } from '../../server.js';
import type { CanvasTextQueuePort } from './control-plane-ports.js';
import type { CanvasTextGenerationStreamEvent } from './foundation-module.js';

test('Canvas text SSE enforces the Canvas service boundary and forwards durable resume ids', async (t) => {
  let calls = 0;
  let received:
    | {
        afterSequence: number;
        hasAbortSignal: boolean;
        jobId: string;
        projectId: string;
        userId: string;
      }
    | undefined;
  const canvasTextStreams: CanvasTextQueuePort = {
    async streamCanvasTextGeneration(context, input) {
      calls += 1;
      received = {
        afterSequence: input.afterSequence,
        hasAbortSignal: input.abortSignal instanceof AbortSignal,
        jobId: input.jobId,
        projectId: input.projectId,
        userId: context.userId,
      };
      await input.onReady?.();
      await input.onEvent({
        createdAt: '2026-07-23T00:00:00.000Z',
        delta: '原生',
        jobId: input.jobId,
        sequence: 8,
        type: 'delta',
      });
      await input.onEvent({
        createdAt: '2026-07-23T00:00:01.000Z',
        jobId: input.jobId,
        result: { failureCode: undefined, status: 'completed' } as never,
        sequence: 9,
        type: 'terminal',
      } satisfies CanvasTextGenerationStreamEvent);
    },
  };
  const server = createCoreServer({
    canvasTextStreams,
    serviceToken: 'canvas-test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/v1/workspaces/workspace-a/canvas/text/stream`;
  const headers = {
    'content-type': 'application/json',
    'last-event-id': '7',
    'x-core-actor': 'worker',
    'x-service-token': 'canvas-test-service-token',
    'x-user-id': 'owner-a',
    'x-workspace-id': 'workspace-a',
  };
  const response = await fetch(url, {
    body: JSON.stringify({ jobId: 'job-a', projectId: 'project-a' }),
    headers,
    method: 'POST',
  });
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get('x-meiye-stream-protocol'),
    'canvas-text-events-v1',
  );
  assert.equal(response.headers.get('x-service-token'), null);
  assert.equal(body.includes('canvas-test-service-token'), false);
  assert.match(body, /id: 8\nevent: canvas\.text\.delta/u);
  assert.match(body, /id: 9\nevent: canvas\.text\.terminal/u);
  assert.deepEqual(received, {
    afterSequence: 7,
    hasAbortSignal: true,
    jobId: 'job-a',
    projectId: 'project-a',
    userId: 'owner-a',
  });
  assert.equal(calls, 1);

  const forbidden = await fetch(url, {
    body: JSON.stringify({ jobId: 'job-a', projectId: 'project-a' }),
    headers: {
      'content-type': 'application/json',
      'x-service-token': 'canvas-test-service-token',
      'x-user-id': 'owner-a',
      'x-workspace-id': 'workspace-a',
      'x-workspace-role': 'owner',
    },
    method: 'POST',
  });
  assert.equal(forbidden.status, 403);
  assert.equal(calls, 1);

  const invalidCursor = await fetch(url, {
    body: JSON.stringify({ jobId: 'job-a', projectId: 'project-a' }),
    headers: { ...headers, 'last-event-id': 'not-a-sequence' },
    method: 'POST',
  });
  assert.equal(invalidCursor.status, 400);
  assert.equal(calls, 1);
});

test('Canvas text SSE aborts an idle HTTP subscriber after its response closes', async (t) => {
  let observeAbort!: () => void;
  const subscriberAborted = new Promise<void>((resolve) => {
    observeAbort = resolve;
  });
  let abortObserved = false;
  const canvasTextStreams: CanvasTextQueuePort = {
    async streamCanvasTextGeneration(_context, input) {
      await input.onReady?.();
      await new Promise<void>((resolve) => {
        const abort = () => {
          abortObserved = true;
          observeAbort();
          resolve();
        };
        if (input.abortSignal?.aborted) {
          abort();
          return;
        }
        input.abortSignal?.addEventListener('abort', abort, { once: true });
      });
    },
  };
  const server = createCoreServer({
    canvasTextStreams,
    serviceToken: 'canvas-test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const abortController = new AbortController();
  const response = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-a/canvas/text/stream`,
    {
      body: JSON.stringify({ jobId: 'job-a', projectId: 'project-a' }),
      headers: {
        'content-type': 'application/json',
        'x-core-actor': 'worker',
        'x-service-token': 'canvas-test-service-token',
        'x-user-id': 'owner-a',
        'x-workspace-id': 'workspace-a',
      },
      method: 'POST',
      signal: abortController.signal,
    },
  );
  assert.equal(response.status, 200);
  assert.ok(response.body);
  const reader = response.body.getReader();
  await reader.read();
  abortController.abort();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      subscriberAborted,
      new Promise<void>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Canvas HTTP subscriber was not aborted.')),
          2_000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    reader.releaseLock();
  }
  assert.equal(abortObserved, true);
});
