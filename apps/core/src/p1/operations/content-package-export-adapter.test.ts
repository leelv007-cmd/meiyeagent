import assert from 'node:assert/strict';
import { it } from 'node:test';
import { contentPackageExportReceiptSchema } from '@meiye/contracts';
import { strFromU8, unzipSync } from 'fflate';
import sharp from 'sharp';
import { MemoryModelAssetStorage } from '../model-supply/index.js';
import {
  ContentPackageZipExportAdapter,
  OperationsContentPackageExportAssetReader,
} from './content-package-export-adapter.js';
import type { OperationsRepository } from './repository.js';

function repositoryWithOwnedAsset(asset: {
  contentType: string;
  id: string;
  objectKey: string;
  sha256: string;
  sizeBytes?: number;
}) {
  return {
    async loadWorkspace() {
      return {
        contentPackages: [{ generated: { ownedAssets: [asset] } }],
      };
    },
  } as unknown as OperationsRepository;
}

it('builds one durable zip with copy and ordered owned images', async () => {
  const storage = new MemoryModelAssetStorage();
  const image = await storage.persistGeneratedAsset({
    bytes: Uint8Array.from([137, 80, 78, 71]),
    contentType: 'image/png',
    workspaceId: 'workspace-export',
  });
  const adapter = new ContentPackageZipExportAdapter(storage, {
    async readOwnedAsset(input) {
      assert.equal(input.assetId, image.id);
      const bytes = storage.read(image.objectKey);
      assert.ok(bytes);
      return {
        asset: { ...image, contentType: 'image/png' as const },
        bytes,
      };
    },
  });

  const artifact = await adapter.export({
    compliance: { aigcLabelEnabled: false, watermarkEnabled: false },
    kind: 'image_text',
    packageId: 'package-export',
    platform: 'xiaohongshu',
    version: {
      body: '导出正文',
      createdAt: '2026-07-15T09:00:00.000Z',
      id: 'version-export',
      orderedAssetIds: [image.id],
      title: '导出标题',
      topics: ['美业'],
    },
    workspaceId: 'workspace-export',
  });

  assert.equal(artifact.contentType, 'application/zip');
  assert.match(
    artifact.artifactObjectKey,
    /^workspace-export\/generated\/.+\.zip$/
  );
  assert.ok(artifact.sizeBytes > 0);
  assert.ok(storage.read(`workspace-export/generated/${artifact.artifactAssetId.replace('asset-', '')}.zip`) || artifact.sha256);
});

it('retries the same export with identical archive bytes and object key', async () => {
  const storage = new MemoryModelAssetStorage();
  const image = await storage.persistGeneratedAsset({
    bytes: Uint8Array.from([137, 80, 78, 71]),
    contentType: 'image/png',
    workspaceId: 'workspace-export-retry',
  });
  const adapter = new ContentPackageZipExportAdapter(storage, {
    async readOwnedAsset() {
      const bytes = storage.read(image.objectKey);
      assert.ok(bytes);
      return {
        asset: { ...image, contentType: 'image/png' as const },
        bytes,
      };
    },
  });
  const input = {
    compliance: { aigcLabelEnabled: false, watermarkEnabled: false },
    kind: 'image_text' as const,
    packageId: 'package-export-retry',
    platform: 'xiaohongshu' as const,
    version: {
      body: '正文',
      createdAt: '2026-07-15T09:00:00.000Z',
      id: 'version-export-retry',
      orderedAssetIds: [image.id],
      title: '标题',
      topics: [],
    },
    workspaceId: 'workspace-export-retry',
  };
  const originalNow = Date.now;

  try {
    Date.now = () => new Date(2026, 0, 1, 0, 0, 0).getTime();
    const first = await adapter.export(input);
    const firstBytes = storage.read(first.artifactObjectKey);
    assert.ok(firstBytes);

    Date.now = () => new Date(2026, 0, 1, 0, 0, 4).getTime();
    const replayed = await adapter.export(input);
    const replayedBytes = storage.read(replayed.artifactObjectKey);
    assert.ok(replayedBytes);

    assert.deepEqual(replayedBytes, firstBytes);
    assert.equal(replayed.artifactObjectKey, first.artifactObjectKey);
  } finally {
    Date.now = originalNow;
  }
});

it('uses ordered safe image entry names even when Product asset ids are hostile paths', async () => {
  const storage = new MemoryModelAssetStorage();
  const firstBytes = new Uint8Array(
    await sharp({
      create: {
        background: '#a35c44',
        channels: 3,
        height: 13,
        width: 11,
      },
    })
      .jpeg()
      .toBuffer(),
  );
  const secondBytes = new Uint8Array(
    await sharp({
      create: {
        background: '#456b8a',
        channels: 4,
        height: 19,
        width: 17,
      },
    })
      .png()
      .toBuffer(),
  );
  const assetIds = ['../../product\\photo', 'C:\\absolute\\product-photo'];
  const assets = new Map([
    [
      assetIds[0],
      {
        asset: {
          contentType: 'image/jpeg' as const,
          id: assetIds[0]!,
          sha256: '1'.repeat(64),
          sizeBytes: firstBytes.byteLength,
        },
        bytes: firstBytes,
      },
    ],
    [
      assetIds[1],
      {
        asset: {
          contentType: 'image/png' as const,
          id: assetIds[1]!,
          sha256: '2'.repeat(64),
          sizeBytes: secondBytes.byteLength,
        },
        bytes: secondBytes,
      },
    ],
  ]);
  const adapter = new ContentPackageZipExportAdapter(storage, {
    async readOwnedAsset({ assetId }) {
      const resolved = assets.get(assetId);
      assert.ok(resolved);
      return resolved;
    },
  });

  const artifact = await adapter.export({
    compliance: { aigcLabelEnabled: false, watermarkEnabled: false },
    kind: 'image_text',
    packageId: 'package-hostile-asset-ids',
    platform: 'xiaohongshu',
    version: {
      body: '正文',
      createdAt: '2026-07-15T09:00:00.000Z',
      id: 'version-hostile-asset-ids',
      orderedAssetIds: assetIds,
      title: '标题',
      topics: [],
    },
    workspaceId: 'workspace-hostile-asset-ids',
  });

  const archiveBytes = storage.read(artifact.artifactObjectKey);
  assert.ok(archiveBytes);
  const files = unzipSync(archiveBytes);
  assert.deepEqual(Object.keys(files).sort(), [
    'content.json',
    'images/01.png',
    'images/02.png',
  ]);
  for (const key of Object.keys(files)) {
    assert.equal(key.includes('..'), false);
    assert.equal(key.includes('\\'), false);
    assert.equal(/^(?:\/|[A-Za-z]:[\\/])/u.test(key), false);
  }
  const first = files['images/01.png'];
  const second = files['images/02.png'];
  assert.ok(first);
  assert.ok(second);
  const firstMetadata = await sharp(first).metadata();
  const secondMetadata = await sharp(second).metadata();
  assert.deepEqual(
    {
      format: firstMetadata.format,
      height: firstMetadata.height,
      width: firstMetadata.width,
    },
    { format: 'png', height: 13, width: 11 }
  );
  assert.deepEqual(
    {
      format: secondMetadata.format,
      height: secondMetadata.height,
      width: secondMetadata.width,
    },
    { format: 'png', height: 19, width: 17 }
  );
});

it('builds a platform-specific video zip with the MP4 and variant content', async () => {
  const storage = new MemoryModelAssetStorage();
  const videoBytes = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112]);
  const video = await storage.persistGeneratedAsset({
    bytes: videoBytes,
    contentType: 'video/mp4',
    workspaceId: 'workspace-video-export',
  });
  const adapter = new ContentPackageZipExportAdapter(storage, {
    async readOwnedAsset(input) {
      assert.equal(input.assetId, video.id);
      const bytes = storage.read(video.objectKey);
      assert.ok(bytes);
      return {
        asset: { ...video, contentType: 'video/mp4' as const },
        bytes,
      };
    },
  });

  const artifact = await adapter.export({
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    kind: 'video',
    packageId: 'package-video-export',
    platform: 'douyin',
    version: {
      body: '抖音版正文',
      conversionHook: '评论区留言预约',
      createdAt: '2026-07-15T09:00:00.000Z',
      id: 'version-video-douyin',
      orderedAssetIds: [video.id],
      title: '抖音版标题',
      topics: ['同城美业', '护肤'],
    },
    workspaceId: 'workspace-video-export',
  });

  assert.equal(artifact.contentType, 'application/zip');
  assert.notEqual(artifact.artifactAssetId, video.id);
  const archiveBytes = storage.read(artifact.artifactObjectKey);
  assert.ok(archiveBytes);
  const files = unzipSync(archiveBytes);
  assert.deepEqual(files['video.mp4'], videoBytes);
  const content = files['content.json'];
  assert.ok(content);
  assert.deepEqual(JSON.parse(strFromU8(content)), {
    body: '抖音版正文',
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    conversionHook: '评论区留言预约',
    platform: 'douyin',
    title: '抖音版标题',
    topics: ['同城美业', '护肤'],
    versionId: 'version-video-douyin',
  });
  const receipt = {
    ...artifact,
    createdAt: '2026-07-15T09:01:00.000Z',
    id: 'receipt-video-douyin',
    platform: 'douyin',
    status: 'succeeded',
    variantVersionId: 'version-video-douyin',
  };
  assert.equal(
    contentPackageExportReceiptSchema.safeParse(receipt).success,
    true
  );
});

it('burns enabled AIGC and brand labels into exported image bytes', async () => {
  const sourceBytes = new Uint8Array(
    await sharp({
      create: {
        background: '#f5f5f5',
        channels: 4,
        height: 400,
        width: 400,
      },
    })
      .png()
      .toBuffer(),
  );
  const sourceSnapshot = sourceBytes.slice();
  let archiveBytes: Uint8Array | undefined;
  const sourceAsset = {
    contentType: 'image/png' as const,
    id: 'owned-source-image',
    objectKey: 'workspace-export/generated/source.png',
    sha256: 'b'.repeat(64),
    sizeBytes: sourceBytes.byteLength,
  };
  const adapter = new ContentPackageZipExportAdapter(
    {
      async persistGeneratedAsset(input) {
        archiveBytes = input.bytes;
        return {
          contentType: input.contentType,
          id: 'owned-labeled-export',
          objectKey: 'workspace-export/generated/labeled.zip',
          sha256: 'c'.repeat(64),
          sizeBytes: input.bytes.byteLength,
        };
      },
    },
    {
      async readOwnedAsset() {
        return { asset: sourceAsset, bytes: sourceBytes };
      },
    },
  );

  await adapter.export({
    compliance: {
      aigcLabelEnabled: true,
      watermarkEnabled: true,
      watermarkText: '清风美学',
    },
    kind: 'image_text',
    packageId: 'package-labeled',
    platform: 'xiaohongshu',
    version: {
      body: '正文',
      createdAt: '2026-07-15T09:00:00.000Z',
      id: 'version-labeled',
      orderedAssetIds: [sourceAsset.id],
      title: '标题',
      topics: ['美业'],
    },
    workspaceId: 'workspace-export',
  });

  assert.ok(archiveBytes);
  const files = unzipSync(archiveBytes);
  const labeled = files['images/01.png'];
  assert.ok(labeled);
  assert.notDeepEqual(labeled, sourceBytes);
  assert.deepEqual(sourceBytes, sourceSnapshot);
});

it('rejects labeled image export without persisting when the CJK font is unavailable', async () => {
  const sourceBytes = new Uint8Array(
    await sharp({
      create: {
        background: '#f5f5f5',
        channels: 4,
        height: 400,
        width: 400,
      },
    })
      .png()
      .toBuffer(),
  );
  let persisted = false;
  const sourceAsset = {
    contentType: 'image/png' as const,
    id: 'owned-source-without-font',
    sha256: 'd'.repeat(64),
    sizeBytes: sourceBytes.byteLength,
  };
  const adapter = new ContentPackageZipExportAdapter(
    {
      async persistGeneratedAsset() {
        persisted = true;
        throw new Error('The archive must not be persisted.');
      },
    },
    {
      async readOwnedAsset() {
        return { asset: sourceAsset, bytes: sourceBytes };
      },
    },
    { fontFilePath: '/missing/content-package-cjk-font.ttc' },
  );

  await assert.rejects(
    adapter.export({
      compliance: {
        aigcLabelEnabled: true,
        watermarkEnabled: true,
        watermarkText: '清风美学',
      },
      kind: 'image_text',
      packageId: 'package-without-cjk-font',
      platform: 'xiaohongshu',
      version: {
        body: '正文',
        createdAt: '2026-07-15T09:00:00.000Z',
        id: 'version-without-cjk-font',
        orderedAssetIds: [sourceAsset.id],
        title: '标题',
        topics: ['美业'],
      },
      workspaceId: 'workspace-without-cjk-font',
    }),
    /CJK font/u,
  );
  assert.equal(persisted, false);
});

it('exports an authorized Product JPEG as a normalized PNG visual', async () => {
  const storage = new MemoryModelAssetStorage();
  const sourceBytes = new Uint8Array(
    await sharp({
      create: {
        background: '#d8b4ae',
        channels: 3,
        height: 24,
        width: 24,
      },
    })
      .jpeg()
      .toBuffer(),
  );
  const reader = new OperationsContentPackageExportAssetReader(
    {
      async loadWorkspace() {
        return { contentPackages: [] };
      },
    } as unknown as OperationsRepository,
    storage,
    {
      async resolve(workspaceId, assetIds) {
        assert.equal(workspaceId, 'workspace-product-export');
        assert.deepEqual(assetIds, ['product-photo']);
        return [
          {
            assetId: 'product-photo',
            bytes: sourceBytes,
            contentType: 'image/jpeg',
            kind: 'resolved' as const,
            providerReadableUrl: 'data:image/jpeg;base64,fixture',
            sha256: 'd'.repeat(64),
          },
        ];
      },
    },
  );
  let archiveBytes: Uint8Array | undefined;
  const adapter = new ContentPackageZipExportAdapter(
    {
      async persistGeneratedAsset(input) {
        archiveBytes = input.bytes;
        return {
          contentType: input.contentType,
          id: 'product-export-archive',
          objectKey: 'workspace-product-export/generated/export.zip',
          sha256: 'e'.repeat(64),
          sizeBytes: input.bytes.byteLength,
        };
      },
    },
    reader,
  );

  await adapter.export({
    compliance: { aigcLabelEnabled: false, watermarkEnabled: false },
    kind: 'image_text',
    packageId: 'package-product-photo',
    platform: 'xiaohongshu',
    version: {
      body: '正文',
      createdAt: '2026-07-15T09:00:00.000Z',
      id: 'version-product-photo',
      orderedAssetIds: ['product-photo'],
      title: '标题',
      topics: [],
    },
    workspaceId: 'workspace-product-export',
  });

  assert.ok(archiveBytes);
  const exportedImage = unzipSync(archiveBytes)['images/01.png'];
  assert.ok(exportedImage);
  assert.equal((await sharp(exportedImage).metadata()).format, 'png');
});

it('reads a verified owned asset from the current workspace', async () => {
  const storage = new MemoryModelAssetStorage();
  const sourceBytes = Uint8Array.from([137, 80, 78, 71]);
  const receipt = await storage.persistGeneratedAsset({
    bytes: sourceBytes,
    contentType: 'image/png',
    workspaceId: 'workspace-owned-valid',
  });
  const reader = new OperationsContentPackageExportAssetReader(
    repositoryWithOwnedAsset(receipt),
    storage,
  );

  const resolved = await reader.readOwnedAsset({
    assetId: receipt.id,
    workspaceId: 'workspace-owned-valid',
  });

  assert.deepEqual(resolved.bytes, sourceBytes);
  assert.deepEqual(resolved.asset, receipt);
});

it('rejects a cross-workspace owned object key before reading storage', async () => {
  let storageRead = false;
  const reader = new OperationsContentPackageExportAssetReader(
    repositoryWithOwnedAsset({
      contentType: 'video/mp4',
      id: 'foreign-video',
      objectKey: `workspace-b/composed/${'a'.repeat(64)}.mp4`,
      sha256: 'b'.repeat(64),
      sizeBytes: 8,
    }),
    {
      read() {
        storageRead = true;
        return Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112]);
      },
    },
  );

  await assert.rejects(
    reader.readOwnedAsset({
      assetId: 'foreign-video',
      workspaceId: 'workspace-a',
    }),
    /another workspace/u,
  );
  assert.equal(storageRead, false);
});

it('rejects owned bytes when their hash or size differs from the receipt', async () => {
  const storage = new MemoryModelAssetStorage();
  const sourceBytes = Uint8Array.from([137, 80, 78, 71]);
  const receipt = await storage.persistGeneratedAsset({
    bytes: sourceBytes,
    contentType: 'image/png',
    workspaceId: 'workspace-owned-integrity',
  });
  const cases = [
    {
      asset: receipt,
      bytes: Uint8Array.from([137, 80, 78, 70]),
      label: 'sha256',
    },
    {
      asset: { ...receipt, sizeBytes: receipt.sizeBytes + 1 },
      bytes: sourceBytes,
      label: 'size',
    },
  ];

  for (const testCase of cases) {
    const reader = new OperationsContentPackageExportAssetReader(
      repositoryWithOwnedAsset(testCase.asset),
      {
        read() {
          return {
            bytes: testCase.bytes,
            contentType: 'image/png' as const,
          };
        },
      },
    );

    await assert.rejects(
      reader.readOwnedAsset({
        assetId: receipt.id,
        workspaceId: 'workspace-owned-integrity',
      }),
      /no longer matches its durable receipt/u,
      testCase.label,
    );
  }
});
