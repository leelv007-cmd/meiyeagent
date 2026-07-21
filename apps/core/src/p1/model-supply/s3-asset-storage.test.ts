import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  S3CompatibleAssetStorage,
  S3CompatibleObjectClient,
  type SharedObjectClient,
} from './s3-asset-storage.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zp3sAAAAASUVORK5CYII=',
  'base64',
);

test('shared storage persists, rematerializes, and idempotently deletes authoritative objects', async () => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const client: SharedObjectClient = {
    async delete(key) {
      objects.delete(key);
    },
    async get(key) {
      const value = objects.get(key);
      return value
        ? { bytes: Uint8Array.from(value.bytes), contentType: value.contentType }
        : null;
    },
    async head(key) {
      const value = objects.get(key);
      return value
        ? { contentType: value.contentType, sizeBytes: value.bytes.byteLength }
        : null;
    },
    async put(key, bytes, contentType) {
      objects.set(key, { bytes: Uint8Array.from(bytes), contentType });
    },
  };
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'meiye-shared-assets-'));
  try {
    const storage = new S3CompatibleAssetStorage({ cacheDirectory, client });
    const receipt = await storage.persistGeneratedAsset({
      bytes: png,
      contentType: 'image/png',
      workspaceId: 'workspace-a',
    });
    assert.deepEqual(
      [...((await client.get(receipt.objectKey))?.bytes ?? [])],
      [...png],
    );

    const materialized = await storage.materialize({
      asset: receipt,
      workspaceId: 'workspace-a',
    });
    assert.deepEqual([...(await readFile(materialized.path))], [...png]);
    await storage.releaseMaterialized([materialized.path]);
    await assert.rejects(readFile(materialized.path), { code: 'ENOENT' });

    await storage.putCanvasAsset({
      bytes: png,
      objectKey: 'workspace-a/canvas/assets/asset-a.png',
      workspaceId: 'workspace-a',
    });
    await storage.deleteCanvasAsset({
      objectKey: 'workspace-a/canvas/assets/asset-a.png',
      workspaceId: 'workspace-a',
    });
    await storage.deleteCanvasAsset({
      objectKey: 'workspace-a/canvas/assets/asset-a.png',
      workspaceId: 'workspace-a',
    });
    assert.equal(await client.get('workspace-a/canvas/assets/asset-a.png'), null);
  } finally {
    await rm(cacheDirectory, { recursive: true, force: true });
  }
});

test('S3-compatible client signs and executes put/get/head/delete requests', async () => {
  const requests: Request[] = [];
  const client = new S3CompatibleObjectClient({
    accessKeyId: 'access-key',
    bucket: 'asset-bucket',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    fetcher: async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.method === 'GET') {
        return new Response(png, { headers: { 'content-type': 'image/png' } });
      }
      if (request.method === 'HEAD') {
        return new Response(null, {
          headers: { 'content-length': String(png.byteLength), 'content-type': 'image/png' },
        });
      }
      return new Response(null, { status: 204 });
    },
    region: 'auto',
    secretAccessKey: 'secret-key',
  });

  await client.put('workspace-a/generated/a.png', png, 'image/png');
  assert.deepEqual(
    [...((await client.get('workspace-a/generated/a.png'))?.bytes ?? [])],
    [...png],
  );
  assert.equal((await client.head('workspace-a/generated/a.png'))?.sizeBytes, png.byteLength);
  await client.delete('workspace-a/generated/a.png');
  assert.deepEqual(requests.map((request) => request.method), [
    'PUT',
    'GET',
    'HEAD',
    'DELETE',
  ]);
  for (const request of requests) {
    assert.match(request.headers.get('authorization') ?? '', /^AWS4-HMAC-SHA256 /);
    assert.match(request.url, /asset-bucket\/workspace-a\/generated\/a\.png$/);
  }
});

test('S3-compatible client rejects plaintext and credential-bearing endpoints', () => {
  const options = {
    accessKeyId: 'access-key',
    bucket: 'asset-bucket',
    region: 'auto',
    secretAccessKey: 'secret-key',
  };
  assert.throws(
    () =>
      new S3CompatibleObjectClient({
        ...options,
        endpoint: 'http://account.r2.cloudflarestorage.com',
      }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      new S3CompatibleObjectClient({
        ...options,
        endpoint: 'https://user:password@account.r2.cloudflarestorage.com',
      }),
    /username or password/,
  );
});

test('S3-compatible client cancels 404 response bodies before returning', async () => {
  let cancellations = 0;
  const client = new S3CompatibleObjectClient({
    accessKeyId: 'access-key',
    bucket: 'asset-bucket',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    fetcher: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancellations += 1;
          },
        }),
        { status: 404 },
      ),
    region: 'auto',
    secretAccessKey: 'secret-key',
  });

  assert.equal(await client.get('workspace-a/generated/missing.png'), null);
  assert.equal(await client.head('workspace-a/generated/missing.png'), null);
  await client.delete('workspace-a/generated/missing.png');
  assert.equal(cancellations, 3);
});
