import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';
import type { DiagnosticRun } from '@meiye/contracts';
import type { DiagnosticRepository } from './diagnostics/repository.js';
import { ProductService } from './product/product-service.js';
import { MemoryProductRepository } from './product/repository.js';
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
