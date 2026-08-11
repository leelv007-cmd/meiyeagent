import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  attachDisconnectedSocketGuard,
  isDisconnectedSocketError,
} from './vite-disconnected-socket-plugin';

test('E2E Vite sockets contain disconnected resets and broken writes', () => {
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
  // connect-time reset is not a mid-request peer drop; still fail closed.
  // (isDisconnectedSocketError now treats missing syscall as disconnected for
  // process-level containment — connection-path errors still carry syscall.)
  assert.throws(() => {
    socket.emit(
      'error',
      Object.assign(new Error('connect ECONNRESET'), {
        code: 'ECONNRESET',
        syscall: 'connect',
      })
    );
  }, /connect ECONNRESET/u);
  assert.doesNotThrow(() => {
    socket.emit(
      'error',
      Object.assign(new Error('write EPIPE'), {
        code: 'EPIPE',
        syscall: 'write',
      })
    );
  });
  assert.throws(() => {
    socket.emit(
      'error',
      Object.assign(new Error('read EPIPE'), {
        code: 'EPIPE',
        syscall: 'read',
      })
    );
  }, /read EPIPE/u);
  assert.throws(() => {
    socket.emit(
      'error',
      Object.assign(new Error('broken invariant'), { code: 'EINVAL' })
    );
  }, /broken invariant/u);
});

test('isDisconnectedSocketError classifies peer drops with and without syscall', () => {
  assert.equal(
    isDisconnectedSocketError(
      Object.assign(new Error('read ECONNRESET'), {
        code: 'ECONNRESET',
        syscall: 'read',
      })
    ),
    true
  );
  assert.equal(
    isDisconnectedSocketError(
      Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })
    ),
    true
  );
  assert.equal(
    isDisconnectedSocketError(
      Object.assign(new Error('connect ECONNRESET'), {
        code: 'ECONNRESET',
        syscall: 'connect',
      })
    ),
    false
  );
  assert.equal(
    isDisconnectedSocketError(
      Object.assign(new Error('write EPIPE'), {
        code: 'EPIPE',
        syscall: 'write',
      })
    ),
    true
  );
  assert.equal(
    isDisconnectedSocketError(
      Object.assign(new Error('EINVAL'), { code: 'EINVAL' })
    ),
    false
  );
});

test('clientError peer resets are swallowed by the HTTP server guard', () => {
  const server = new EventEmitter();
  const socket = Object.assign(new EventEmitter(), {
    destroy(this: EventEmitter) {
      this.emit('destroyed');
    },
  });
  let destroyed = false;
  socket.on('destroyed', () => {
    destroyed = true;
  });
  attachDisconnectedSocketGuard(
    server as unknown as Parameters<typeof attachDisconnectedSocketGuard>[0]
  );
  assert.doesNotThrow(() => {
    server.emit(
      'clientError',
      Object.assign(new Error('read ECONNRESET'), {
        code: 'ECONNRESET',
        syscall: 'read',
      }),
      socket
    );
  });
  assert.equal(destroyed, true);
});
