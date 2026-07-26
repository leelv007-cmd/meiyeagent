import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  FileSystemAssetStorage,
  fileSystemAssetStorageFromEnv,
} from './filesystem-asset-storage.js';
import { modelAssetStorageFromEnv } from './asset-storage-from-env.js';
import { S3CompatibleAssetStorage } from './s3-asset-storage.js';
import { RecordedAdapterRouter, recordedRequest } from './adapters.js';
import { MemoryModelAssetStorage } from './index.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zp3sAAAAASUVORK5CYII=',
  'base64'
);

test('default asset storage stays anchored to the core package across launch directories', () => {
  const originalDirectory = process.cwd();
  try {
    process.chdir(resolve(originalDirectory, '../..'));
    const storage = fileSystemAssetStorageFromEnv({});
    const rootDirectory = (storage as unknown as { rootDirectory: string })
      .rootDirectory;

    assert.equal(
      rootDirectory,
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../..',
        '.data/p1-assets'
      )
    );
  } finally {
    process.chdir(originalDirectory);
  }
});

test('relative asset storage configuration stays anchored to the core package', () => {
  const originalDirectory = process.cwd();
  try {
    process.chdir(resolve(originalDirectory, '../..'));
    const storage = fileSystemAssetStorageFromEnv({
      P1_ASSET_STORAGE_DIR: './.data/configured-assets',
    });
    const rootDirectory = (storage as unknown as { rootDirectory: string })
      .rootDirectory;

    assert.equal(
      rootDirectory,
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../..',
        '.data/configured-assets'
      )
    );
  } finally {
    process.chdir(originalDirectory);
  }
});

test('main and worker storage assembly share the same default public asset URL', () => {
  const storage = fileSystemAssetStorageFromEnv({
    APP_BASE_URL: 'http://web.test',
    P1_ASSET_STORAGE_DIR: './.data/test-assets',
  });
  const objectKey = `workspace-a/generated/${'a'.repeat(64)}.png`;
  assert.equal(
    storage.publicUrl(objectKey),
    `http://web.test/api/core/p1/assets?objectKey=${encodeURIComponent(objectKey)}`
  );
});

test('filesystem storage serves the narrow legacy ProductAsset key allowed by the Web BFF', async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'meiye-legacy-product-asset-'));
  const objectKey = 'workspace-a/assets/user-a/legacy-store-front.png';
  try {
    await mkdir(dirname(join(rootDirectory, objectKey)), { recursive: true });
    await writeFile(join(rootDirectory, objectKey), png);
    const storage = new FileSystemAssetStorage({
      publicBaseUrl: 'http://web.test/api/core/p1/assets?objectKey=',
      rootDirectory,
    });
    assert.deepEqual((await storage.read(objectKey)).bytes, png);
    assert.equal(
      storage.publicUrl(objectKey),
      `http://web.test/api/core/p1/assets?objectKey=${encodeURIComponent(objectKey)}`,
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('filesystem storage serves the ProductAsset WebM key allowed by the Web BFF', async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'meiye-product-asset-webm-'));
  const objectKey = `workspace-a/assets/user-a/${'a'.repeat(64)}.webm`;
  const webm = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]);
  try {
    await mkdir(dirname(join(rootDirectory, objectKey)), { recursive: true });
    await writeFile(join(rootDirectory, objectKey), webm);
    const storage = new FileSystemAssetStorage({ rootDirectory });
    assert.equal((await storage.head(objectKey)).contentType, 'video/webm');
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('production refuses local-only asset storage while explicit test environments retain it', () => {
  assert.throws(
    () =>
      fileSystemAssetStorageFromEnv({
        APP_ENV: 'production',
        P1_ASSET_STORAGE_DIR: '/tmp/production-assets',
      }),
    /shared object storage is required/i,
  );
  assert.throws(
    () => modelAssetStorageFromEnv({ APP_ENV: 'production' }),
    /shared object storage is required/i,
  );
  assert.throws(
    () => modelAssetStorageFromEnv({}),
    /APP_ENV explicitly selects development, test, or e2e/i,
  );
  assert.doesNotThrow(() => modelAssetStorageFromEnv({ APP_ENV: 'e2e' }));
  assert.throws(
    () =>
      modelAssetStorageFromEnv({
        APP_ENV: 'production',
        P1_ASSET_STORAGE_MODE: 's3',
      }),
    /P1_ASSET_S3_ENDPOINT is required/,
  );
  const sharedStorageEnv = {
    APP_ENV: 'production',
    P1_ASSET_STORAGE_MODE: 's3',
    P1_ASSET_S3_ACCESS_KEY_ID: 'access-key',
    P1_ASSET_S3_BUCKET: 'asset-bucket',
    P1_ASSET_S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    P1_ASSET_S3_SECRET_ACCESS_KEY: 'secret-key',
  } as const;
  assert.throws(
    () => modelAssetStorageFromEnv(sharedStorageEnv),
    /P1_ASSET_PUBLIC_BASE_URL or APP_BASE_URL is required/,
  );
  assert.throws(
    () =>
      modelAssetStorageFromEnv({
        ...sharedStorageEnv,
        APP_BASE_URL: 'http://app.example.com',
      }),
    /non-local HTTPS URL/,
  );
  assert.throws(
    () =>
      modelAssetStorageFromEnv({
        ...sharedStorageEnv,
        APP_ENV: 'staging',
        P1_ASSET_PUBLIC_BASE_URL:
          'https://localhost/api/core/p1/assets?objectKey=',
      }),
    /non-local HTTPS URL/,
  );
  assert.equal(
    modelAssetStorageFromEnv({
      ...sharedStorageEnv,
      APP_BASE_URL: 'https://app.example.com/',
    }) instanceof S3CompatibleAssetStorage,
    true,
  );
  const publicBaseStorage = modelAssetStorageFromEnv({
    ...sharedStorageEnv,
    P1_ASSET_PUBLIC_BASE_URL:
      'https://assets.example.com/api/core/p1/assets?objectKey=',
  });
  assert.equal(
    publicBaseStorage.publicUrl('workspace-a/generated/asset.png'),
    'https://assets.example.com/api/core/p1/assets?objectKey=workspace-a%2Fgenerated%2Fasset.png',
  );
  assert.doesNotThrow(() =>
    fileSystemAssetStorageFromEnv({
      APP_ENV: 'test',
      P1_ASSET_STORAGE_DIR: '/tmp/test-assets',
    }),
  );
});

test('ffprobe is killed after its configured deadline', async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'meiye-ffprobe-timeout-'));
  const ffprobePath = join(rootDirectory, 'hanging-ffprobe');
  await writeFile(
    ffprobePath,
    '#!/bin/sh\nwhile true; do sleep 1; done\n',
    'utf8',
  );
  await chmod(ffprobePath, 0o755);
  const storage = new FileSystemAssetStorage({
    ffprobePath,
    ffprobeTimeoutMs: 25,
    rootDirectory,
  });
  const mp4 = Uint8Array.from([
    0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  ]);

  try {
    await assert.rejects(
      storage.persistGeneratedAsset({
        bytes: mp4,
        contentType: 'video/mp4',
        workspaceId: 'workspace-a',
      }),
      (error: unknown) =>
        error instanceof Error &&
        ('killed' in error || /aborted|timed out|timeout/i.test(error.message)),
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('filesystem storage keeps real bytes and restores a verified receipt after restart', async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'meiye-assets-test-'));
  try {
    const first = new FileSystemAssetStorage({
      publicBaseUrl: 'http://core.test/v1/assets',
      rootDirectory,
    });
    const receipt = await first.persistGeneratedAsset({
      bytes: png,
      contentType: 'image/png',
      sourceTaskRef: 'provider-image-task',
      workspaceId: 'workspace-a',
    });
    assert.equal(receipt.sizeBytes, png.byteLength);
    assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
    assert.equal(receipt.sourceTaskRef, 'provider-image-task');
    assert.equal(
      first.publicUrl(receipt.objectKey),
      `http://core.test/v1/assets/${receipt.objectKey}`
    );

    const restarted = new FileSystemAssetStorage({
      publicBaseUrl: 'http://core.test/v1/assets',
      rootDirectory,
    });
    const materialized = await restarted.materialize({
      asset: receipt,
      workspaceId: 'workspace-a',
    });
    const restored = await restarted.read(receipt.objectKey);
    assert.equal(materialized.path.startsWith(rootDirectory), true);
    assert.deepEqual(restored.bytes, png);
    assert.equal(restored.contentType, 'image/png');
    await assert.rejects(
      restarted.read(`${receipt.objectKey}.json`),
      /public media asset/
    );
    await assert.rejects(
      restarted.read(`workspace-b/private/${receipt.sha256}.png`),
      /public media asset/
    );
    assert.throws(
      () => restarted.publicUrl(`${receipt.objectKey}.json`),
      /public media asset/
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('filesystem storage accepts Canvas-owned bytes only under the active workspace key', async () => {
  const rootDirectory = await mkdtemp(
    join(tmpdir(), 'meiye-canvas-assets-test-'),
  );
  try {
    const storage = new FileSystemAssetStorage({ rootDirectory });
    const objectKey = 'workspace-a/canvas/assets/asset-1.png';

    await storage.putCanvasAsset({
      bytes: png,
      objectKey,
      workspaceId: 'workspace-a',
    });

    assert.deepEqual(await storage.head(objectKey), {
      contentType: 'image/png',
      sizeBytes: png.byteLength,
    });
    assert.equal(
      await storage.verifyCanvasAssetReceipt({
        contentType: 'image/png',
        objectKey,
        sha256: createHash('sha256').update(png).digest('hex'),
        sizeBytes: png.byteLength,
        workspaceId: 'workspace-a',
      }),
      true,
    );
    assert.equal(
      await storage.verifyCanvasAssetReceipt({
        contentType: 'image/png',
        objectKey,
        sha256: '0'.repeat(64),
        sizeBytes: png.byteLength,
        workspaceId: 'workspace-a',
      }),
      false,
    );
    assert.deepEqual((await storage.read(objectKey)).bytes, png);
    await assert.rejects(
      storage.putCanvasAsset({
        bytes: png,
        objectKey,
        workspaceId: 'workspace-b',
      }),
      /outside the active workspace/,
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('filesystem storage rejects audio whose MIME and container do not match', async () => {
  const rootDirectory = await mkdtemp(
    join(tmpdir(), 'meiye-audio-storage-test-')
  );
  try {
    const storage = new FileSystemAssetStorage({ rootDirectory });
    await assert.rejects(
      storage.persistGeneratedAsset({
        bytes: Buffer.from('not-an-mp3'),
        contentType: 'audio/mpeg',
        sourceTaskRef: 'audio-task-invalid',
        workspaceId: 'workspace-a',
      }),
      /audio payload/i
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('filesystem storage serves a persisted ContentPackage export archive', async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'meiye-export-test-'));
  try {
    const storage = new FileSystemAssetStorage({ rootDirectory });
    const archive = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const receipt = await storage.persistGeneratedAsset({
      bytes: archive,
      contentType: 'application/zip',
      sourceTaskRef: 'content-package-export:package-a:version-a',
      workspaceId: 'workspace-a',
    });

    const restored = await storage.read(receipt.objectKey);
    assert.deepEqual(restored.bytes, archive);
    assert.equal(restored.contentType, 'application/zip');
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('generated receipts stay replay-safe while identical bytes from different provider tasks remain distinct', async () => {
  const rootDirectory = await mkdtemp(
    join(tmpdir(), 'meiye-assets-identity-test-')
  );
  try {
    const storage = new FileSystemAssetStorage({ rootDirectory });
    const first = await storage.persistGeneratedAsset({
      bytes: png,
      contentType: 'image/png',
      sourceTaskRef: 'provider-task-a',
      workspaceId: 'workspace-a',
    });
    const replayed = await storage.persistGeneratedAsset({
      bytes: png,
      contentType: 'image/png',
      sourceTaskRef: 'provider-task-a',
      workspaceId: 'workspace-a',
    });
    const second = await storage.persistGeneratedAsset({
      bytes: png,
      contentType: 'image/png',
      sourceTaskRef: 'provider-task-b',
      workspaceId: 'workspace-a',
    });

    assert.equal(replayed.id, first.id);
    assert.equal(replayed.objectKey, first.objectKey);
    assert.notEqual(second.id, first.id);
    assert.notEqual(second.objectKey, first.objectKey);
    assert.equal(second.sha256, first.sha256);

    const memory = new MemoryModelAssetStorage();
    const memoryFirst = await memory.persistGeneratedAsset({
      bytes: png,
      contentType: 'image/png',
      sourceTaskRef: 'provider-task-a',
      workspaceId: 'workspace-a',
    });
    const memorySecond = await memory.persistGeneratedAsset({
      bytes: png,
      contentType: 'image/png',
      sourceTaskRef: 'provider-task-b',
      workspaceId: 'workspace-a',
    });
    assert.notEqual(memorySecond.id, memoryFirst.id);
    assert.notEqual(memorySecond.objectKey, memoryFirst.objectKey);
    assert.equal(memorySecond.sha256, memoryFirst.sha256);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('composed output is persisted as a validated playable asset receipt', async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'meiye-composed-test-'));
  try {
    const outputPath = join(rootDirectory, 'ffmpeg-output.mp4');
    await writeFile(outputPath, Buffer.from('recorded-valid-video-fixture'));
    const storage = new FileSystemAssetStorage({
      rootDirectory,
      videoProbe: async () => ({
        codec: 'h264',
        durationSeconds: 3,
        height: 1280,
        playable: true,
        width: 720,
      }),
    });
    const asset = await storage.persistComposedVideo({
      compositionEvidence: {
        aigc: {
          requested: false,
          visibleLabel: { actual: false, validated: true },
          implicitMetadata: { actual: false, validated: true },
          validationMethod: 'composition_manifest',
        },
        brandWatermark: {
          actual: false,
          requested: false,
          validated: true,
          validationMethod: 'composition_manifest',
        },
        clipCount: 2,
        outputSha256: createHash('sha256')
          .update('recorded-valid-video-fixture')
          .digest('hex'),
        outputSizeBytes: Buffer.byteLength('recorded-valid-video-fixture'),
        rendererRevision: 'product-renderer-validation-v1',
        sourceAssetIds: ['clip-a', 'clip-b'],
      },
      compositionKey: 'composition-hash',
      path: outputPath,
      sourceAssetIds: ['clip-a', 'clip-b'],
      workflowId: 'workflow-a',
      workspaceId: 'workspace-a',
    });
    assert.equal(asset.contentType, 'video/mp4');
    assert.equal(asset.technicalValidation?.playable, true);
    assert.equal(asset.technicalValidation?.hashVerified, true);
    assert.equal(asset.compositionEvidence?.aigc.requested, false);
    assert.match(asset.objectKey, /^workspace-a\/composed\//);
    const sidecar = JSON.parse(
      await readFile(join(rootDirectory, `${asset.objectKey}.json`), 'utf8')
    ) as { compositionEvidence?: unknown };
    assert.deepEqual(sidecar.compositionEvidence, asset.compositionEvidence);
    assert.notEqual(sidecar.compositionEvidence, undefined);
    assert.deepEqual(
      (await storage.read(asset.objectKey)).bytes,
      Buffer.from('recorded-valid-video-fixture')
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('recorded video bytes pass ffprobe and persist', async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'meiye-ffmpeg-e2e-'));
  try {
    const storage = new FileSystemAssetStorage({ rootDirectory });
    const provider = new RecordedAdapterRouter();
    const request = recordedRequest('seedance-2', 'video.generate', {
      durationSeconds: 1,
    });
    const effectRequest = {
      ...request,
      effectIdempotencyKey: 'recorded-video-ffmpeg-e2e',
    };
    const submitted = await provider.submit(effectRequest);
    assert.ok(submitted.taskRef);
    const downloaded = await provider.download({
      ...effectRequest,
      taskRef: submitted.taskRef,
    });
    const clip = await storage.persistGeneratedAsset({
      bytes: downloaded.bytes,
      contentType: downloaded.contentType,
      sourceTaskRef: submitted.taskRef,
      workspaceId: 'workspace-a',
    });
    assert.equal(clip.technicalValidation?.playable, true);

    assert.ok((await storage.read(clip.objectKey)).bytes.byteLength > 0);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test('recorded audio bytes pass the production decode gate and persist', async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'meiye-audio-e2e-'));
  try {
    const storage = new FileSystemAssetStorage({ rootDirectory });
    const provider = new RecordedAdapterRouter();
    const request = recordedRequest('audio-speech-fixture', 'audio.speech', {
      format: 'wav',
      inputAssets: [],
      language: 'zh-CN',
      maxDurationSeconds: 30,
      referenceAssetIds: [],
      speed: 1,
      tone: 'natural',
      voice: 'default',
    });
    const effectRequest = {
      ...request,
      effectIdempotencyKey: 'recorded-audio-ffmpeg-e2e',
    };
    const submitted = await provider.submit(effectRequest);
    assert.ok(submitted.taskRef);
    const downloaded = await provider.download({
      ...effectRequest,
      taskRef: submitted.taskRef,
    });
    const audio = await storage.persistGeneratedAsset({
      bytes: downloaded.bytes,
      contentType: downloaded.contentType,
      sourceTaskRef: submitted.taskRef,
      workspaceId: 'workspace-a',
    });
    assert.equal(audio.contentType, 'audio/wav');
    assert.deepEqual(
      (await storage.read(audio.objectKey)).bytes,
      downloaded.bytes
    );
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
