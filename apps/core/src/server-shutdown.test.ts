import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import {
  closeHttpServerWithDeadline,
  shutdownCoreRuntime,
} from './server-shutdown.js';

test('shutdown closes a long-lived response when the deadline expires', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write('event: heartbeat\ndata: {}\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}`);
  assert.equal(response.status, 200);

  await closeHttpServerWithDeadline(server, 10);

  assert.equal(server.listening, false);
});

test('runtime shutdown attempts every dependency and reports failures', async () => {
  const completed: string[] = [];

  await assert.rejects(
    shutdownCoreRuntime({
      async closeHttp() {
        completed.push('http');
        throw new Error('http close failed');
      },
      async shutdownDbos() {
        completed.push('dbos');
      },
      async stopJobs() {
        completed.push('jobs');
      },
      async closePool() {
        completed.push('pool');
      },
    }),
    AggregateError,
  );

  assert.deepEqual(completed.sort(), ['dbos', 'http', 'jobs', 'pool']);
});
