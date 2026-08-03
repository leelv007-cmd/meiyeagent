import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';
import type { DiagnosticRun } from '@meiye/contracts';
import type { DiagnosticRepository } from './diagnostics/repository.js';
import { ProductService } from './product/product-service.js';
import { MemoryProductRepository } from './product/repository.js';
import { P1DomainError } from './p1/foundation/domain.js';
import { createCoreServer } from './server.js';

const diagnostics: DiagnosticRepository = {
  async create(run: DiagnosticRun) {
    return run;
  },
  async get() {
    return null;
  },
  async save(run: DiagnosticRun) {
    return run;
  },
};

test('Core rejects an oversized chunked JSON request before request end', async (t) => {
  const { port } = await coreServer(t);
  const status = await responseBeforeRequestEnd(port, (outgoing) => {
    outgoing.write(Buffer.alloc(1024 * 1024));
    outgoing.write(Buffer.from([1]));
  });

  assert.equal(status, 413);
});

test('Core rejects an invalid idempotency key instead of replacing it', async (t) => {
  const { port } = await coreServer(t);
  const response = await fetch(commandUrl(port), {
    body: JSON.stringify({ type: 'check_content', text: '测试内容' }),
    headers: {
      ...commandHeaders(),
      'idempotency-key': 'invalid key with spaces',
    },
    method: 'POST',
  });

  assert.equal(response.status, 400);
  assert.equal(
    ((await response.json()) as { error: { code: string } }).error.code,
    'INVALID_IDEMPOTENCY_KEY',
  );
});

test('Core regenerates an unsafe correlation id', async (t) => {
  const { port } = await coreServer(t);
  const response = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-a/state`,
    {
      headers: {
        ...commandHeaders(),
        'x-correlation-id': 'unsafe correlation value',
      },
    },
  );
  const payload = (await response.json()) as {
    meta: { correlationId: string };
  };

  assert.equal(response.status, 200);
  assert.notEqual(payload.meta.correlationId, 'unsafe correlation value');
  assert.match(payload.meta.correlationId, /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u);
});

test('Core lets only the trusted worker bootstrap a matching workspace', async (t) => {
  const calls: Array<{
    idempotencyKey: string;
    ownerEmail: string;
    ownerName: string;
    ownerUserId: string;
    workspaceId: string;
    workspaceName: string;
  }> = [];
  const server = createCoreServer({
    diagnosticRepository: diagnostics,
    serviceToken: 'test-service-token',
    workspaceBootstrapper: {
      async bootstrap(input) {
        calls.push(input);
        return { created: true };
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/v1/workspaces/workspace-new/bootstrap`;
  const headers = {
    'content-type': 'application/json',
    'idempotency-key': 'workspace-bootstrap:v1',
    'x-core-actor': 'worker',
    'x-service-token': 'test-service-token',
    'x-user-id': 'owner-new',
    'x-workspace-id': 'workspace-new',
  };

  const accepted = await fetch(url, {
    body: JSON.stringify({
      name: 'New workspace',
      owner: { email: 'owner-new@example.test', name: 'New owner' },
    }),
    headers,
    method: 'POST',
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(calls, [
    {
      idempotencyKey: 'workspace-bootstrap:v1',
      ownerEmail: 'owner-new@example.test',
      ownerName: 'New owner',
      ownerUserId: 'owner-new',
      workspaceId: 'workspace-new',
      workspaceName: 'New workspace',
    },
  ]);

  let conflict = true;
  const conflictServer = createCoreServer({
    diagnosticRepository: diagnostics,
    serviceToken: 'test-service-token',
    workspaceBootstrapper: {
      async bootstrap(input) {
        if (conflict) {
          conflict = false;
          throw new P1DomainError(
            'IDEMPOTENCY_CONFLICT',
            'The bootstrap idempotency key was already used for different facts.'
          );
        }
        return { created: false };
      },
    },
  });
  conflictServer.listen(0, '127.0.0.1');
  await once(conflictServer, 'listening');
  t.after(() => conflictServer.close());
  const conflictPort = (conflictServer.address() as AddressInfo).port;
  const conflictResponse = await fetch(
    `http://127.0.0.1:${conflictPort}/v1/workspaces/workspace-new/bootstrap`,
    {
      body: JSON.stringify({
        name: 'New workspace',
        owner: { email: 'owner-new@example.test', name: 'New owner' },
      }),
      headers,
      method: 'POST',
    }
  );
  assert.equal(conflictResponse.status, 409);
  assert.equal(
    ((await conflictResponse.json()) as { error: { code: string } }).error.code,
    'IDEMPOTENCY_CONFLICT'
  );

  const rejected = await fetch(url, {
    body: JSON.stringify({
      name: 'New workspace',
      owner: { email: 'owner-new@example.test', name: 'New owner' },
    }),
    headers: { ...headers, 'x-core-actor': 'payment' },
    method: 'POST',
  });
  assert.equal(rejected.status, 403);
  assert.equal(calls.length, 1);
});

async function coreServer(t: TestContext) {
  const repository = new MemoryProductRepository();
  repository.grantMembership('user-a', 'workspace-a');
  const server = createCoreServer({
    diagnosticRepository: diagnostics,
    productService: new ProductService(repository),
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return server.address() as AddressInfo;
}

function commandUrl(port: number) {
  return `http://127.0.0.1:${port}/v1/workspaces/workspace-a/commands`;
}

function commandHeaders() {
  return {
    'content-type': 'application/json',
    'idempotency-key': 'boundary-test-request',
    'x-service-token': 'test-service-token',
    'x-user-id': 'user-a',
    'x-workspace-id': 'workspace-a',
    'x-workspace-role': 'owner',
  };
}

function responseBeforeRequestEnd(
  port: number,
  write: (outgoing: ReturnType<typeof request>) => void,
) {
  return new Promise<number | undefined>((resolve, reject) => {
    const outgoing = request(
      {
        headers: commandHeaders(),
        host: '127.0.0.1',
        method: 'POST',
        path: '/v1/workspaces/workspace-a/commands',
        port,
      },
      (response) => {
        response.resume();
        response.once('end', () => {
          clearTimeout(timeout);
          outgoing.destroy();
          resolve(response.statusCode);
        });
      },
    );
    const timeout = setTimeout(() => {
      outgoing.destroy();
      reject(new Error('Core did not reject the oversized stream promptly.'));
    }, 5_000);
    outgoing.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    write(outgoing);
    outgoing.flushHeaders();
  });
}
