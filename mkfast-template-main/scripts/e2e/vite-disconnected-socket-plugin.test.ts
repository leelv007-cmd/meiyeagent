import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { attachDisconnectedSocketGuard } from './vite-disconnected-socket-plugin';

test('E2E Vite sockets contain disconnected reads and writes', () => {
  const server = new EventEmitter();
  const socket = new EventEmitter();
  attachDisconnectedSocketGuard(
    server as unknown as Parameters<typeof attachDisconnectedSocketGuard>[0]
  );
  server.emit('connection', socket);

  assert.doesNotThrow(() => {
    socket.emit(
      'error',
      Object.assign(new Error('read ECONNRESET'), {
        code: 'ECONNRESET',
        syscall: 'read',
      })
    );
  });
  assert.doesNotThrow(() => {
    socket.emit(
      'error',
      Object.assign(new Error('write ECONNRESET'), {
        code: 'ECONNRESET',
        syscall: 'write',
      })
    );
  });
  assert.throws(() => {
    socket.emit(
      'error',
      Object.assign(new Error('connect ECONNRESET'), {
        code: 'ECONNRESET',
        syscall: 'connect',
      })
    );
  }, /connect ECONNRESET/u);
  assert.throws(() => {
    socket.emit(
      'error',
      Object.assign(new Error('broken invariant'), { code: 'EINVAL' })
    );
  }, /broken invariant/u);
});
