import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PostgresRequestUnavailableError,
  bindPostgresClientSocketErrors,
  isPostgresConnectionCapacityError,
  withPostgresRequestBoundary,
} from './postgres-connection-safety';

test('detects capacity, server-restart, and socket-close PostgreSQL errors', () => {
  for (const error of [
    { code: '53300', message: 'sorry, too many clients already' },
    { code: '57P01', message: 'terminating connection due to administrator command' },
    { code: 'CONNECTION_CLOSED', message: 'write CONNECTION_CLOSED localhost:5432' },
    { code: 'ECONNRESET', message: 'socket hang up' },
  ]) {
    assert.equal(isPostgresConnectionCapacityError(error), true);
  }
  assert.equal(
    isPostgresConnectionCapacityError({
      code: '42P01',
      message: 'relation does not exist',
    }),
    false,
  );
});

test('maps a recognized PostgreSQL connection failure to a request-scoped 503 with correlation', async () => {
  const logs: Array<{ message: string; detail?: Record<string, unknown> }> = [];

  await assert.rejects(
    withPostgresRequestBoundary(
      {
        correlationId: 'corr-pg-request-1',
        route: 'auth.workspace-provisioning',
        workspaceId: 'ws-pg-request-1',
        log: (message, detail) => logs.push({ message, detail }),
      },
      async () => {
        throw Object.assign(new Error('sorry, too many clients already'), {
          code: '53300',
        });
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof PostgresRequestUnavailableError);
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, 'POSTGRES_UNAVAILABLE');
      assert.equal(error.correlationId, 'corr-pg-request-1');
      assert.equal(error.databaseCode, '53300');
      return true;
    },
  );

  assert.deepEqual(logs, [
    {
      message: 'postgres request unavailable',
      detail: {
        correlationId: 'corr-pg-request-1',
        databaseCode: '53300',
        route: 'auth.workspace-provisioning',
        workspaceId: 'ws-pg-request-1',
      },
    },
  ]);
});

test('leaves non-connection PostgreSQL errors for the request owner', async () => {
  const relationMissing = Object.assign(new Error('relation does not exist'), {
    code: '42P01',
  });
  await assert.rejects(
    withPostgresRequestBoundary(
      {
        correlationId: 'corr-pg-request-2',
        route: 'auth.workspace-provisioning',
      },
      async () => {
        throw relationMissing;
      },
      () => {},
    ),
    (error: unknown) => error === relationMissing,
  );
});

test('socket error listener does not throw or exit', () => {
  const listeners: Array<(error: unknown) => void> = [];
  bindPostgresClientSocketErrors({
    on(event: string, listener: (error: unknown) => void) {
      assert.equal(event, 'error');
      listeners.push(listener);
    },
  });
  assert.equal(listeners.length, 1);
  listeners[0]!({ code: 'ECONNRESET', message: 'socket hang up' });
});
