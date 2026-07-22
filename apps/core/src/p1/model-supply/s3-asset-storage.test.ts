import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  sharedAssetReceiptKey,
  type DiagnosticRun,
} from '@meiye/contracts';
import type { DiagnosticRepository } from '../../diagnostics/repository.js';
import { createCoreServer } from '../../server.js';
import {
  ModelSupplyApplicationService,
  type CatalogModel,
  type ModelDeployment,
  type ModelSupplyLedgerPort,
  type ProviderExecutionPort,
} from './index.js';
import {
  S3_ASSET_REGISTRATION_CLEANUP_SAFETY_WINDOW_MS,
  S3AssetRegistrationCleanupRunner,
} from './owned-asset-registration-cleanup.js';
import {
  S3CompatibleAssetStorage,
  S3CompatibleObjectClient,
  type SharedObjectClient,
} from './s3-asset-storage.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zp3sAAAAASUVORK5CYII=',
  'base64',
);

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

function memoryObjectClient(
  objects: Map<string, { bytes: Uint8Array; contentType: string }>,
): SharedObjectClient {
  return {
    async delete(key) {
      objects.delete(key);
    },
    async get(key) {
      const object = objects.get(key);
      return object
        ? {
            bytes: Uint8Array.from(object.bytes),
            contentType: object.contentType,
          }
        : null;
    },
    async head(key) {
      const object = objects.get(key);
      return object
        ? {
            contentType: object.contentType,
            sizeBytes: object.bytes.byteLength,
          }
        : null;
    },
    async list(prefix) {
      return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
    async put(key, bytes, contentType) {
      objects.set(key, {
        bytes: Uint8Array.from(bytes),
        contentType,
      });
    },
    async putIfAbsent(key, bytes, contentType) {
      if (objects.has(key)) return false;
      objects.set(key, {
        bytes: Uint8Array.from(bytes),
        contentType,
      });
      return true;
    },
  };
}

test('shared storage persists, rematerializes, and idempotently deletes authoritative objects', async () => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const client = memoryObjectClient(objects);
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
    await storage.putCanvasAsset({
      bytes: png,
      objectKey: 'workspace-a/canvas/assets/asset-a.png',
      workspaceId: 'workspace-a',
    });
    await assert.rejects(
      storage.putCanvasAsset({
        bytes: Uint8Array.from([...png, 0]),
        objectKey: 'workspace-a/canvas/assets/asset-a.png',
        workspaceId: 'workspace-a',
      }),
      /already contains different bytes/,
    );
    assert.equal((await storage.listOwnedAssetRegistrationFailures()).length, 0);
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

test('independent API and Worker adapters share a verified immutable receipt through the Core HTTP boundary', async (t) => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const client = memoryObjectClient(objects);
  const apiCache = await mkdtemp(join(tmpdir(), 'meiye-api-assets-'));
  const workerCache = await mkdtemp(join(tmpdir(), 'meiye-worker-assets-'));
  const apiStorage = new S3CompatibleAssetStorage({
    cacheDirectory: apiCache,
    client,
  });
  const workerStorage = new S3CompatibleAssetStorage({
    cacheDirectory: workerCache,
    client,
  });
  const server = createCoreServer({
    assetReader: apiStorage,
    diagnosticRepository: diagnostics,
    serviceToken: 'shared-storage-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all([
      rm(apiCache, { force: true, recursive: true }),
      rm(workerCache, { force: true, recursive: true }),
    ]);
  });

  const receipt = await workerStorage.persistGeneratedAsset({
    bytes: png,
    contentType: 'image/png',
    sourceTaskRef: 'provider-task-shared',
    workspaceId: 'workspace-a',
  });
  const verifiedReceipt = await apiStorage.readReceipt(receipt.objectKey);
  assert.deepEqual(verifiedReceipt, {
    contentType: 'image/png',
    createdAt: verifiedReceipt.createdAt,
    objectKey: receipt.objectKey,
    sha256: receipt.sha256,
    sizeBytes: receipt.sizeBytes,
    storageRevision: verifiedReceipt.storageRevision,
  });
  assert.ok(Number.isFinite(Date.parse(verifiedReceipt.createdAt)));
  assert.match(verifiedReceipt.storageRevision, /^[a-f0-9-]{16,}$/u);

  const { port } = server.address() as AddressInfo;
  const response = await fetch(
    `http://127.0.0.1:${port}/v1/assets/${receipt.objectKey}`,
    {
      headers: {
        'x-service-token': 'shared-storage-token',
        'x-workspace-id': 'workspace-a',
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
});

test('Core reads a Web-written R2 receipt through the shared storage contract', async (t) => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'meiye-web-receipt-'));
  t.after(() => rm(cacheDirectory, { force: true, recursive: true }));
  const sha256 = createHash('sha256').update(png).digest('hex');
  const objectKey = `workspace-a/assets/user-a/${sha256}.png`;
  objects.set(objectKey, { bytes: png, contentType: 'image/png' });
  objects.set(
    sharedAssetReceiptKey(
      createHash('sha256').update(objectKey).digest('hex'),
    ),
    {
      bytes: new TextEncoder().encode(JSON.stringify({
        contentType: 'image/png',
        createdAt: '2026-07-22T10:00:00.000Z',
        objectKey,
        sha256,
        sizeBytes: png.byteLength,
        storageRevision: 'web-r2-v1',
      })),
      contentType: 'application/json',
    },
  );

  const storage = new S3CompatibleAssetStorage({
    cacheDirectory,
    client: memoryObjectClient(objects),
  });
  assert.deepEqual([...(await storage.read(objectKey)).bytes], [...png]);
});

test('a fresh adapter reads media and ZIP receipts after local cache loss', async (t) => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const firstCache = await mkdtemp(join(tmpdir(), 'meiye-restart-first-'));
  const secondCache = await mkdtemp(join(tmpdir(), 'meiye-restart-second-'));
  t.after(() => Promise.all([
    rm(firstCache, { force: true, recursive: true }),
    rm(secondCache, { force: true, recursive: true }),
  ]));
  const writer = new S3CompatibleAssetStorage({
    cacheDirectory: firstCache,
    client: memoryObjectClient(objects),
  });
  const archive = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
  const receipt = await writer.persistGeneratedAsset({
    bytes: archive,
    contentType: 'application/zip',
    sourceTaskRef: 'content-package-export:package-a:version-a',
    workspaceId: 'workspace-a',
  });
  const restarted = new S3CompatibleAssetStorage({
    cacheDirectory: secondCache,
    client: memoryObjectClient(objects),
  });
  assert.deepEqual((await restarted.read(receipt.objectKey)).bytes, archive);
});

test('does not expose a shared object without a durable receipt', async (t) => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'meiye-legacy-receipt-'));
  t.after(() => rm(cacheDirectory, { force: true, recursive: true }));
  const objectKey = 'workspace-a/generated/pre-rollout.zip';
  const archive = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
  objects.set(objectKey, {
    bytes: archive,
    contentType: 'application/zip',
  });
  const storage = new S3CompatibleAssetStorage({
    cacheDirectory,
    client: memoryObjectClient(objects),
  });

  await assert.rejects(storage.read(objectKey), /no durable storage receipt/);
});

test('does not delete a receipt-less object when cleanup lacks durable generation proof', async (t) => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'meiye-receipt-failure-'));
  const base = memoryObjectClient(objects);
  const storage = new S3CompatibleAssetStorage({
    cacheDirectory,
    client: {
      ...base,
      async putIfAbsent(key, bytes, contentType) {
        if (key.startsWith('_meiye-asset-receipts/')) {
          throw new Error('simulated receipt write failure');
        }
        return base.putIfAbsent!(key, bytes, contentType);
      },
    },
  });
  t.after(() => rm(cacheDirectory, { force: true, recursive: true }));

  await assert.rejects(
    storage.persistGeneratedAsset({
      bytes: png,
      contentType: 'image/png',
      workspaceId: 'workspace-a',
    }),
    /simulated receipt write failure/,
  );

  const [failure] = await storage.listOwnedAssetRegistrationFailures();
  assert.equal(failure?.failureStage, 'receipt_registration');
  assert.ok(failure);
  assert.ok(failure.storageRevision);
  assert.equal(await storage.hasSharedObject(failure.objectKey), true);
  const runner = new S3AssetRegistrationCleanupRunner(storage, {
    async isReferenced() {
      throw new Error('receipt-less objects must not be reference checked');
    },
  });
  assert.deepEqual(await runner.run(new Date(
    Date.parse(failure.recordedAt) + S3_ASSET_REGISTRATION_CLEANUP_SAFETY_WINDOW_MS,
  ).toISOString()), {
    alertCount: 1,
    deferredCount: 0,
    deletedCount: 0,
    failedCount: 1,
    referencedCount: 0,
    targetCount: 1,
  });
  assert.equal(await storage.hasSharedObject(failure.objectKey), true);
});

test('records cleanup and removes the cache after post-write verification is unavailable', async (t) => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'meiye-post-write-failure-'));
  const base = memoryObjectClient(objects);
  let failVerificationRead = true;
  const storage = new S3CompatibleAssetStorage({
    cacheDirectory,
    client: {
      ...base,
      async get(key) {
        if (
          key.startsWith('workspace-a/generated/') &&
          objects.has(key) &&
          failVerificationRead
        ) {
          failVerificationRead = false;
          throw new Error('simulated post-write verification timeout');
        }
        return base.get(key);
      },
    },
  });
  t.after(() => rm(cacheDirectory, { force: true, recursive: true }));

  await assert.rejects(
    storage.persistGeneratedAsset({
      bytes: png,
      contentType: 'image/png',
      workspaceId: 'workspace-a',
    }),
    /post-write verification/,
  );

  const [failure] = await storage.listOwnedAssetRegistrationFailures();
  assert.ok(failure);
  assert.equal(failure.failureStage, 'receipt_registration');
  assert.equal(await storage.hasSharedObject(failure.objectKey), true);
  await assert.rejects(readFile(join(cacheDirectory, failure.objectKey)), {
    code: 'ENOENT',
  });
});

test('records and safely replays orphan cleanup after a database registration failure', async (t) => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'meiye-asset-cleanup-'));
  const storage = new S3CompatibleAssetStorage({
    cacheDirectory,
    client: memoryObjectClient(objects),
  });
  t.after(() => rm(cacheDirectory, { force: true, recursive: true }));

  const model: CatalogModel = {
    id: 'storage-test-image',
    modality: 'image',
    operations: ['image.generate'],
    displayName: 'Storage test image',
    qualityRank: 100,
  };
  const deployment: ModelDeployment = {
    id: 'storage-test-deployment',
    catalogModelId: model.id,
    apiFamily: 'image',
    channel: 'managed',
    region: 'overseas',
    status: 'active',
  };
  const ledger: ModelSupplyLedgerPort = {
    async checkpointAttempt() {
      return { replayed: false };
    },
    async settleAttempt() {
      throw new Error('simulated database transaction failure');
    },
  };
  const execution: ProviderExecutionPort = {
    async execute() {
      return {
        kind: 'completed',
        assetBytes: png,
        contentType: 'image/png',
        providerCost: { amount: 0.1, currency: 'USD', usage: { mediaUnits: 1 } },
      };
    },
  };
  const models = new ModelSupplyApplicationService({
    assetStorage: storage,
    deployments: [deployment],
    execution,
    ledger,
    models: [model],
  });

  await assert.rejects(
    models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'storage-cleanup-failure',
      operation: 'image.generate',
      prompt: 'A verified test image',
      selection: { mode: 'fixed', catalogModelId: model.id },
      workspaceId: 'workspace-a',
    }),
    /simulated database transaction failure/,
  );

  const failures = await storage.listOwnedAssetRegistrationFailures();
  assert.equal(failures.length, 1);
  assert.equal(failures[0]?.failureStage, 'ledger_settlement');
  assert.equal(failures[0]?.workspaceId, 'workspace-a');
  assert.ok(await storage.readReceipt(failures[0]!.objectKey));

  const runner = new S3AssetRegistrationCleanupRunner(storage, {
    async isReferenced() {
      return false;
    },
  });
  const recordedAt = failures[0]!.recordedAt;
  assert.deepEqual(await runner.run(recordedAt), {
    alertCount: 0,
    deferredCount: 1,
    deletedCount: 0,
    failedCount: 0,
    referencedCount: 0,
    targetCount: 1,
  });
  assert.equal((await storage.listOwnedAssetRegistrationFailures()).length, 1);
  assert.deepEqual(await runner.run(new Date(
    Date.parse(recordedAt) + S3_ASSET_REGISTRATION_CLEANUP_SAFETY_WINDOW_MS,
  ).toISOString()), {
    alertCount: 0,
    deferredCount: 0,
    deletedCount: 1,
    failedCount: 0,
    referencedCount: 0,
    targetCount: 1,
  });
  assert.equal(await storage.listOwnedAssetRegistrationFailures().then((items) => items.length), 0);
  await assert.rejects(storage.readReceipt(failures[0]!.objectKey));
});

test('retains an object when Foundation has already registered its receipt', async (t) => {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'meiye-asset-reference-'));
  const storage = new S3CompatibleAssetStorage({
    cacheDirectory,
    client: memoryObjectClient(objects),
  });
  t.after(() => rm(cacheDirectory, { force: true, recursive: true }));

  const asset = await storage.persistGeneratedAsset({
    bytes: png,
    contentType: 'image/png',
    sourceTaskRef: 'provider-task-referenced',
    workspaceId: 'workspace-a',
  });
  await storage.recordOwnedAssetRegistrationFailure({
    asset,
    error: new Error('result projection temporarily unavailable'),
    failureStage: 'result_persistence',
    workspaceId: 'workspace-a',
  });

  const runner = new S3AssetRegistrationCleanupRunner(storage, {
    async isReferenced(input) {
      return input.receipt.objectKey === asset.objectKey;
    },
  });
  assert.deepEqual(await runner.run(new Date(
    Date.parse((await storage.listOwnedAssetRegistrationFailures())[0]!.recordedAt) +
      S3_ASSET_REGISTRATION_CLEANUP_SAFETY_WINDOW_MS,
  ).toISOString()), {
    alertCount: 0,
    deferredCount: 0,
    deletedCount: 0,
    failedCount: 0,
    referencedCount: 1,
    targetCount: 1,
  });
  assert.equal((await storage.readReceipt(asset.objectKey)).sha256, asset.sha256);
  assert.equal((await storage.listOwnedAssetRegistrationFailures()).length, 0);
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
