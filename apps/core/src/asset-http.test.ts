import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import type { DiagnosticRun } from '@meiye/contracts';
import type { DiagnosticRepository } from './diagnostics/repository.js';
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

test('Canvas can persist workspace-owned bytes through the authenticated Core boundary', async (t) => {
  const writes: Array<{
    bytes: Uint8Array;
    objectKey: string;
    workspaceId: string;
  }> = [];
  const server = createCoreServer({
    assetReader: {
      async read() {
        throw new Error('not found');
      },
      async putCanvasAsset(input) {
        writes.push(input);
      },
    },
    diagnosticRepository: diagnostics,
    serviceToken: 'canvas-write-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const objectKey = 'workspace-a/canvas/assets/asset-1.png';
  const url = `http://127.0.0.1:${port}/v1/assets/${encodeURIComponent(objectKey)}`;

  const response = await fetch(url, {
    body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    headers: {
      'content-type': 'image/png',
      'x-service-token': 'canvas-write-token',
      'x-workspace-id': 'workspace-a',
    },
    method: 'PUT',
  });

  assert.equal(response.status, 204);
  assert.deepEqual(writes, [
    {
      bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      objectKey,
      workspaceId: 'workspace-a',
    },
  ]);
  assert.equal(
    (
      await fetch(url, {
        body: Buffer.from([1]),
        headers: {
          'x-service-token': 'canvas-write-token',
          'x-workspace-id': 'workspace-b',
        },
        method: 'PUT',
      })
    ).status,
    403,
  );
});

test('Canvas asset upload rejects declared and streamed overflow before request end', async (t) => {
  let writes = 0;
  const server = createCoreServer({
    assetReader: {
      async read() {
        throw new Error('not found');
      },
      async putCanvasAsset() {
        writes += 1;
      },
    },
    diagnosticRepository: diagnostics,
    serviceToken: 'canvas-write-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const path = `/v1/assets/${encodeURIComponent('workspace-a/canvas/assets/asset-large.png')}`;
  const baseHeaders = {
    'content-type': 'image/png',
    'x-service-token': 'canvas-write-token',
    'x-workspace-id': 'workspace-a',
  };

  const declaredStatus = await responseBeforeRequestEnd({
    headers: { ...baseHeaders, 'content-length': 25 * 1024 * 1024 + 1 },
    path,
    port,
  });
  const streamedStatus = await responseBeforeRequestEnd(
    { headers: baseHeaders, path, port },
    (outgoing) => {
      const chunk = Buffer.alloc(1024 * 1024);
      for (let index = 0; index < 25; index += 1) outgoing.write(chunk);
      outgoing.write(Buffer.from([1]));
    },
  );

  assert.equal(declaredStatus, 413);
  assert.equal(streamedStatus, 413);
  assert.equal(writes, 0);
});

test('persisted canvas assets have a browser-readable content-addressed route', async (t) => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const objectKey = `workspace-a/generated/${'a'.repeat(64)}.png`;
  const server = createCoreServer({
    assetReader: {
      async read(requestedKey) {
        assert.equal(requestedKey, objectKey);
        return { bytes: png, contentType: 'image/png' };
      },
    },
    diagnosticRepository: diagnostics,
    serviceToken: 'unused-for-content-addressed-assets',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/v1/assets/${objectKey}`;
  const unauthenticated = await fetch(url);
  assert.equal(unauthenticated.status, 401);
  const response = await fetch(url, {
    headers: {
      'x-service-token': 'unused-for-content-addressed-assets',
      'x-workspace-id': 'workspace-a',
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.match(response.headers.get('cache-control') ?? '', /immutable/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);

  const crossWorkspace = await fetch(url, {
    headers: {
      'x-service-token': 'unused-for-content-addressed-assets',
      'x-workspace-id': 'workspace-b',
    },
  });
  assert.equal(crossWorkspace.status, 403);

  const sidecar = await fetch(`${url}.json`, {
    headers: {
      'x-service-token': 'unused-for-content-addressed-assets',
      'x-workspace-id': 'workspace-a',
    },
  });
  assert.equal(sidecar.status, 404);

  const malformedStatus = await new Promise<number | undefined>(
    (resolve, reject) => {
      const malformed = request(
        {
          headers: {
            'x-service-token': 'unused-for-content-addressed-assets',
            'x-workspace-id': 'workspace-a',
          },
          host: '127.0.0.1',
          path: '/v1/assets/%',
          port,
        },
        (result) => {
          result.resume();
          result.once('end', () => resolve(result.statusCode));
        }
      );
      malformed.once('error', reject);
      malformed.end();
    }
  );
  assert.equal(malformedStatus, 400);
});

test('persisted ContentPackage ZIP artifacts remain downloadable by their receipt key', async (t) => {
  const archive = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const objectKey = `workspace-a/generated/${'b'.repeat(64)}.zip`;
  const server = createCoreServer({
    assetReader: {
      async read(requestedKey) {
        assert.equal(requestedKey, objectKey);
        return { bytes: archive, contentType: 'application/zip' };
      },
    },
    diagnosticRepository: diagnostics,
    serviceToken: 'content-package-export-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const response = await fetch(
    `http://127.0.0.1:${port}/v1/assets/${objectKey}`,
    {
      headers: {
        'x-service-token': 'content-package-export-token',
        'x-workspace-id': 'workspace-a',
      },
    }
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), archive);
});

function responseBeforeRequestEnd(
  input: {
    headers: Record<string, string | number>;
    path: string;
    port: number;
  },
  write?: (outgoing: ReturnType<typeof request>) => void,
) {
  return new Promise<number | undefined>((resolve, reject) => {
    const outgoing = request(
      {
        headers: input.headers,
        host: '127.0.0.1',
        method: 'PUT',
        path: input.path,
        port: input.port,
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
      reject(new Error('Server did not reject the oversized stream promptly.'));
    }, 5_000);
    outgoing.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    write?.(outgoing);
    outgoing.flushHeaders();
  });
}
