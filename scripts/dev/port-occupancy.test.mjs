import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import test from 'node:test';
import {
  assertStackPortsAvailable,
  formatPortOccupiedError,
  inspectListeningPort,
} from './port-occupancy.mjs';

function listenOnEphemeral() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected a TCP address.'));
        return;
      }
      resolve({ port: address.port, server });
    });
    server.once('error', reject);
  });
}

test('inspectListeningPort reports pid and cmdline for a listener', async () => {
  const { port, server } = await listenOnEphemeral();
  try {
    const occupants = await inspectListeningPort(port);
    assert.ok(occupants.length >= 1, 'expected at least one listener');
    assert.match(String(occupants[0].pid), /^\d+$/u);
    assert.match(
      occupants[0].cmdline || occupants[0].command,
      /node/i,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('inspectListeningPort is empty when the port is free', async () => {
  const { port, server } = await listenOnEphemeral();
  await new Promise((resolve) => server.close(resolve));
  const occupants = await inspectListeningPort(port);
  assert.deepEqual(occupants, []);
});

test('assertStackPortsAvailable names the occupant when a stack port is taken', async () => {
  const { port, server } = await listenOnEphemeral();
  try {
    await assert.rejects(
      () =>
        assertStackPortsAvailable({
          CORE_PORT: String(port),
          PORT: String(port),
        }),
      (error) => {
        assert.match(error.message, new RegExp(`port ${port} is already in use`, 'u'));
        assert.match(error.message, /pid=/u);
        assert.match(error.message, /cmdline=/u);
        return true;
      },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('formatPortOccupiedError includes pid and cmdline', () => {
  const message = formatPortOccupiedError('core', 4179, [
    { pid: '4242', command: 'node', cmdline: 'node scripts/dev/start-stack.mjs' },
  ]);
  assert.match(message, /core port 4179/u);
  assert.match(message, /pid=4242/u);
  assert.match(message, /node scripts\/dev\/start-stack.mjs/u);
});
