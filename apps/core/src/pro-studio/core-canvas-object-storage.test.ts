import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryCanvasObjectStorage } from './canvas-asset-facade.js';
import {
  CompositeCanvasObjectStorage,
  CoreCanvasObjectStorage,
} from './core-canvas-object-storage.js';

test('core asset storage reads and writes through the service boundary with workspace scope', async () => {
  const requests: Array<{
    body: Uint8Array;
    headers: Headers;
    method: string;
    url: string;
  }> = [];
  const storage = new CoreCanvasObjectStorage({
    coreServiceToken: 'service-secret',
    coreServiceUrl: 'http://core.test',
    fetcher: async (input, init) => {
      const request = new Request(input, init);
      requests.push({
        body: new Uint8Array(await request.arrayBuffer()),
        headers: request.headers,
        method: request.method,
        url: String(input),
      });
      return request.method === 'PUT'
        ? new Response(null, { status: 204 })
        : new Response(Uint8Array.from([1, 2, 3]));
    },
  });

  await storage.put(
    'workspace-a/canvas/assets/local one.png',
    Uint8Array.from([4, 5]),
  );
  assert.deepEqual(
    await storage.read('workspace-a/generated/image one.png'),
    Uint8Array.from([1, 2, 3])
  );
  assert.equal(
    requests[0]?.url,
    'http://core.test/v1/assets/workspace-a%2Fcanvas%2Fassets%2Flocal%20one.png'
  );
  assert.equal(requests[0]?.method, 'PUT');
  assert.deepEqual(requests[0]?.body, Uint8Array.from([4, 5]));
  assert.equal(requests[0]?.headers.get('content-type'), 'image/png');
  assert.equal(
    requests[1]?.url,
    'http://core.test/v1/assets/workspace-a%2Fgenerated%2Fimage%20one.png'
  );
  assert.equal(requests[1]?.headers.get('x-service-token'), 'service-secret');
  assert.equal(requests[1]?.headers.get('x-workspace-id'), 'workspace-a');
});

test('composite asset storage writes locally and falls back to Core reads', async () => {
  const local = new MemoryCanvasObjectStorage();
  const fallback = new MemoryCanvasObjectStorage();
  await fallback.put('workspace-a/generated/core.png', Uint8Array.from([4]));
  const storage = new CompositeCanvasObjectStorage(local, fallback);

  await storage.put('workspace-a/canvas/local.png', Uint8Array.from([5]));

  assert.deepEqual(
    await storage.read('workspace-a/canvas/local.png'),
    Uint8Array.from([5])
  );
  assert.deepEqual(
    await storage.read('workspace-a/generated/core.png'),
    Uint8Array.from([4])
  );
});
