import assert from 'node:assert/strict';
import test from 'node:test';

import { workspaceCoreFetchInit } from './core-request';

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
