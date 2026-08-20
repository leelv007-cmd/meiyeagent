import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createCoreServer } from '../../server.js';

test('Canvas text SSE is a retired 410 tombstone, not a live stream', async (t) => {
  const server = createCoreServer({ serviceToken: 'canvas-test-service-token' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/v1/workspaces/workspace-a/canvas/text/stream`;

  const response = await fetch(url, {
    body: JSON.stringify({ jobId: 'job-a', projectId: 'project-a' }),
    headers: {
      'content-type': 'application/json',
      'last-event-id': '7',
      'x-core-actor': 'worker',
      'x-service-token': 'canvas-test-service-token',
      'x-user-id': 'owner-a',
      'x-workspace-id': 'workspace-a',
    },
    method: 'POST',
  });
  assert.equal(response.status, 410);
  assert.equal(response.headers.get('x-meiye-stream-protocol'), null);
  const payload = (await response.json()) as {
    error: { code: string; message: string };
  };
  assert.equal(payload.error.code, 'CANVAS_TEXT_STREAM_RETIRED');
  assert.match(payload.error.message, /retired/i);
});
