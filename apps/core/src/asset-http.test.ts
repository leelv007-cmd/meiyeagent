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
