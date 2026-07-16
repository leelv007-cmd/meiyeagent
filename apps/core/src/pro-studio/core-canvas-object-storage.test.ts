import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryCanvasObjectStorage } from './canvas-asset-facade.js';
import {
  CompositeCanvasObjectStorage,
  CoreCanvasObjectStorage,
} from './core-canvas-object-storage.js';

test('core asset storage reads through the service boundary with workspace scope', async () => {
  const requests: Array<{ headers: Headers; url: string }> = [];
  const storage = new CoreCanvasObjectStorage({
    coreServiceToken: 'service-secret',
    coreServiceUrl: 'http://core.test',
    fetcher: async (input, init) => {
      requests.push({
        headers: new Headers(init?.headers),
        url: String(input),
      });
      return new Response(Uint8Array.from([1, 2, 3]));
    },
  });

  assert.deepEqual(
    await storage.read('workspace-a/generated/image one.png'),
    Uint8Array.from([1, 2, 3])
  );
  assert.equal(
    requests[0]?.url,
    'http://core.test/v1/assets/workspace-a%2Fgenerated%2Fimage%20one.png'
  );
  assert.equal(requests[0]?.headers.get('x-service-token'), 'service-secret');
  assert.equal(requests[0]?.headers.get('x-workspace-id'), 'workspace-a');
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
