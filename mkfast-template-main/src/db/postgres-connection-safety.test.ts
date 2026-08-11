import assert from 'node:assert/strict';
import test from 'node:test';
import {
  attachPostgresClientErrorSink,
  isPostgresConnectionCapacityError,
} from './postgres-connection-safety';

test('detects 53300 and too-many-clients message as capacity errors', () => {
  assert.equal(
    isPostgresConnectionCapacityError({
      code: '53300',
      message: 'sorry, too many clients already',
    }),
    true,
  );
  assert.equal(
    isPostgresConnectionCapacityError({
      message: 'FATAL: too many clients already',
    }),
    true,
  );
  assert.equal(
    isPostgresConnectionCapacityError({
      code: 'ECONNRESET',
      message: 'read ECONNRESET',
    }),
    false,
  );
  assert.equal(
    isPostgresConnectionCapacityError({
      code: '42P01',
      message: 'relation does not exist',
    }),
    false,
  );
  assert.equal(
    isPostgresConnectionCapacityError({
      name: 'PostgresError',
      message: 'Connection terminated unexpectedly',
    }),
    true,
  );
});

test('attachPostgresClientErrorSink chains onclose without throwing capacity errors', () => {
  const calls: number[] = [];
  const client = {
    options: {
      onclose: (id: number) => {
        calls.push(id);
        throw { code: '53300', message: 'sorry, too many clients already' };
      },
    },
  };
  const logs: Array<{ message: string; detail?: Record<string, unknown> }> = [];
  attachPostgresClientErrorSink(client, (message, detail) => {
    logs.push({ message, detail });
  });
  assert.doesNotThrow(() => client.options.onclose?.(7));
  assert.deepEqual(calls, [7]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.detail?.code, '53300');
});

test('attachPostgresClientErrorSink rethrows non-connection errors from previous onclose', () => {
  const client = {
    options: {
      onclose: (_connId: number) => {
        throw new Error('unexpected close hook failure');
      },
    },
  };
  attachPostgresClientErrorSink(client, () => {});
  assert.throws(
    () => client.options.onclose?.(1),
    /unexpected close hook failure/u,
  );
});
