import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { NodeVolcengineTtsSocketFactory } from './volcengine-tts-node-socket.js';

test('Node socket factory sends custom headers and preserves binary frames', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  let observedHeader: string | undefined;
  server.on('connection', (socket, request) => {
    const header = request.headers['x-api-key'];
    observedHeader = Array.isArray(header) ? header[0] : header;
    socket.on('message', (data, isBinary) => {
      assert.equal(isBinary, true);
      socket.send(data, { binary: true });
    });
  });

  const factory = new NodeVolcengineTtsSocketFactory({
    openTimeoutMs: 1_000,
    receiveTimeoutMs: 1_000,
  });
  const socket = await factory.connect({
    headers: { 'X-Api-Key': 'fixture-key' },
    url: `ws://127.0.0.1:${address.port}`,
  });
  try {
    await socket.send(Uint8Array.from([1, 2, 3]));
    assert.deepEqual(await socket.receive(), Uint8Array.from([1, 2, 3]));
    assert.equal(observedHeader, 'fixture-key');
  } finally {
    await socket.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
