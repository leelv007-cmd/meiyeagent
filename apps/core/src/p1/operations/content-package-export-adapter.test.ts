import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { it } from 'node:test';
import { contentPackageExportReceiptSchema } from '@meiye/contracts';
import { unzipSync } from 'fflate';
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
  assert.ok(files['manifest.json']);
  assert.ok(files['caption.txt']);
  assert.ok(files['platform-checklist.md']);
  assert.ok(files['evidence/rights-and-facts.json']);
  assert.ok(files['cover.jpg']);
  assert.ok(files['images/01.jpg']);
  assert.ok(files['images/02.png']);
  for (const key of Object.keys(files)) {
    assert.equal(key.includes('..'), false);
    assert.equal(key.includes('\\'), false);
    assert.equal(/^(?:\/|[A-Za-z]:[\\/])/u.test(key), false);
  }
  const first = files['images/01.jpg'];
  const second = files['images/02.png'];
  assert.ok(first);
  assert.ok(second);
  assert.deepEqual(first, firstBytes);
  assert.deepEqual(second, secondBytes);
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  assert.equal(manifest.schema, 'beauty-delivery-manifest/v1');
  assert.equal(manifest.platform, 'xiaohongshu');
  const firstMetadata = await sharp(first).metadata();
  const secondMetadata = await sharp(second).metadata();
  assert.deepEqual(
    {
      format: firstMetadata.format,
      height: firstMetadata.height,
      width: firstMetadata.width,
    },
    { format: 'jpeg', height: 13, width: 11 }
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

it('rejects a labeled video export before persisting without verifiable burn-in evidence', async () => {
  let persisted = false;
  const adapter = new ContentPackageZipExportAdapter(
    {
      async persistGeneratedAsset() {
        persisted = true;
        throw new Error('The artifact must not be persisted.');
      },
    },
    {
      async readOwnedAsset() {
        return {
          asset: {
            contentType: 'video/mp4' as const,
            id: 'video-without-compliance-evidence',
            sha256: 'a'.repeat(64),
            sizeBytes: 8,
          },
          bytes: Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112]),
        };
      },
    },
  );

  await assert.rejects(
    adapter.export({
      compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
      kind: 'video',
      packageId: 'package-video-unverified-compliance',
      platform: 'douyin',
      version: {
        body: 'video body',
        createdAt: '2026-07-15T09:00:00.000Z',
        id: 'version-video-unverified-compliance',
        orderedAssetIds: ['video-without-compliance-evidence'],
        title: 'video title',
        topics: [],
      },
      workspaceId: 'workspace-video-export',
    }),
    /video compliance burn-in cannot be verified/i,
  );
  assert.equal(persisted, false);
});

it('exports an unlabeled video package as a durable direct MP4 with stable receipt bytes', async () => {
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

  const input = {
    compliance: { aigcLabelEnabled: false, watermarkEnabled: false },
    kind: 'video' as const,
    packageId: 'package-video-export',
    platform: 'douyin' as const,
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
  };
  const artifact = await adapter.export(input);

  assert.equal(artifact.contentType, 'video/mp4');
  assert.notEqual(artifact.artifactAssetId, video.id);
  assert.match(artifact.artifactObjectKey, /\.mp4$/u);
  assert.deepEqual(storage.read(artifact.artifactObjectKey), videoBytes);
  const replayed = await adapter.export(input);
  assert.equal(replayed.artifactObjectKey, artifact.artifactObjectKey);
  assert.equal(replayed.sha256, artifact.sha256);
  assert.equal(replayed.sizeBytes, artifact.sizeBytes);
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

it('preserves authorized Product JPEG bytes when compliance labels are disabled', async () => {
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
  const exportedImage = unzipSync(archiveBytes)['images/01.jpg'];
  assert.ok(exportedImage);
  assert.deepEqual(exportedImage, sourceBytes);
  assert.equal((await sharp(exportedImage).metadata()).format, 'jpeg');
});

it('preserves unlabeled WebP bytes and renders either compliance label as PNG', async () => {
  const sourceBytes = new Uint8Array(
    await sharp({
      create: {
        background: '#cfb8a8',
        channels: 4,
        height: 320,
        width: 320,
      },
    })
      .webp()
      .toBuffer(),
  );
  const storage = new MemoryModelAssetStorage();
  const sourceAsset = {
    contentType: 'image/webp' as const,
    id: 'owned-source-webp',
    sha256: createHash('sha256').update(sourceBytes).digest('hex'),
    sizeBytes: sourceBytes.byteLength,
  };
  const adapter = new ContentPackageZipExportAdapter(storage, {
    async readOwnedAsset() {
      return { asset: sourceAsset, bytes: sourceBytes };
    },
  });
  const exportFiles = async (
    compliance: {
      aigcLabelEnabled: boolean;
      watermarkEnabled: boolean;
      watermarkText?: string;
    },
    suffix: string,
  ) => {
    const artifact = await adapter.export({
      compliance,
      kind: 'image_text',
      packageId: `package-webp-export-${suffix}`,
      platform: 'xiaohongshu',
      version: {
        body: '正文',
        createdAt: '2026-07-15T09:00:00.000Z',
        id: `version-webp-export-${suffix}`,
        orderedAssetIds: [sourceAsset.id],
        title: '标题',
        topics: [],
      },
      workspaceId: 'workspace-webp-export',
    });
    const archiveBytes = storage.read(artifact.artifactObjectKey);
    assert.ok(archiveBytes);
    return unzipSync(archiveBytes);
  };

  const unlabeled = await exportFiles(
    { aigcLabelEnabled: false, watermarkEnabled: false },
    'unlabeled',
  );
  assert.ok(unlabeled['manifest.json']);
  assert.ok(unlabeled['images/01.webp']);
  const exportedImage = unlabeled['images/01.webp'];
  assert.ok(exportedImage);
  assert.deepEqual(exportedImage, sourceBytes);
  assert.equal((await sharp(exportedImage).metadata()).format, 'webp');
  const unlabeledManifest = JSON.parse(
    new TextDecoder().decode(unlabeled['manifest.json']),
  );
  assert.equal(unlabeledManifest.schema, 'beauty-delivery-manifest/v1');

  for (const [suffix, compliance] of [
    [
      'aigc',
      { aigcLabelEnabled: true, watermarkEnabled: false },
    ],
    [
      'watermark',
      {
        aigcLabelEnabled: false,
        watermarkEnabled: true,
        watermarkText: '清风美学',
      },
    ],
  ] as const) {
    const labeled = await exportFiles(compliance, suffix);
    assert.ok(labeled['manifest.json']);
    assert.ok(labeled['images/01.png']);
    const labeledImage = labeled['images/01.png'];
    assert.ok(labeledImage);
    assert.notDeepEqual(labeledImage, sourceBytes);
    assert.equal((await sharp(labeledImage).metadata()).format, 'png');
  }
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

it('reads a migrated Product video from its verified legacy videos namespace', async () => {
  const bytes = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const objectKey = 'workspace-product-video/videos/legacy-result.mp4';
  const reader = new OperationsContentPackageExportAssetReader(
    repositoryWithOwnedAsset({
      contentType: 'video/mp4',
      id: 'legacy-video-artifact',
      objectKey,
      sha256,
      sizeBytes: bytes.byteLength,
    }),
    {
      read(requestedObjectKey) {
        assert.equal(requestedObjectKey, objectKey);
        return { bytes, contentType: 'video/mp4' };
      },
    }
  );

  const resolved = await reader.readOwnedAsset({
    assetId: 'legacy-video-artifact',
    workspaceId: 'workspace-product-video',
  });

  assert.deepEqual(resolved.bytes, bytes);
  assert.equal(resolved.asset.sha256, sha256);
  assert.equal(resolved.asset.sizeBytes, bytes.byteLength);
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

it('builds a video full delivery ZIP with manifest/v1 and deterministic replay', async () => {
  const storage = new MemoryModelAssetStorage();
  const videoBytes = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112]);
  const coverBytes = new Uint8Array(
    await sharp({
      create: {
        background: '#112233',
        channels: 3,
        height: 8,
        width: 8,
      },
    })
      .jpeg()
      .toBuffer(),
  );
  const video = await storage.persistGeneratedAsset({
    bytes: videoBytes,
    contentType: 'video/mp4',
    workspaceId: 'workspace-video-full',
  });
  const cover = await storage.persistOwnedAsset!({
    bytes: coverBytes,
    contentType: 'image/jpeg',
    workspaceId: 'workspace-video-full',
  });
  const adapter = new ContentPackageZipExportAdapter(
    storage,
    {
      async readOwnedAsset({ assetId }) {
        if (assetId === video.id) {
          return {
            asset: { ...video, contentType: 'video/mp4' as const },
            bytes: videoBytes,
          };
        }
        if (assetId === cover.id) {
          return {
            asset: { ...cover, contentType: 'image/jpeg' as const },
            bytes: coverBytes,
          };
        }
        throw new Error(`unknown asset ${assetId}`);
      },
    },
    { contentPackageRevision: 3, storeName: '清风美学' },
  );

  const input = {
    compliance: { aigcLabelEnabled: false, watermarkEnabled: false },
    contentPackageRevision: 3,
    coverAssetId: cover.id,
    kind: 'video' as const,
    packageId: 'package-video-full',
    platform: 'douyin' as const,
    storeName: '清风美学',
    subtitles: {
      format: 'srt' as const,
      text: '1\n00:00:00,000 --> 00:00:01,000\n你好\n',
    },
    version: {
      body: '视频正文',
      conversionHook: '私信预约',
      createdAt: '2026-07-15T09:00:00.000Z',
      id: 'version-video-full',
      orderedAssetIds: [video.id],
      title: '视频标题',
      topics: ['美业'],
    },
    workspaceId: 'workspace-video-full',
  };

  const first = await adapter.exportVideoFullPackage(input);
  const second = await adapter.exportVideoFullPackage(input);
  assert.equal(first.contentType, 'application/zip');
  assert.equal(first.fileName, '清风美学-视频-抖音-20260715-r3.zip');
  assert.equal(second.sha256, first.sha256);
  assert.equal(second.artifactObjectKey, first.artifactObjectKey);

  const archiveBytes = storage.read(first.artifactObjectKey);
  assert.ok(archiveBytes);
  const files = unzipSync(archiveBytes);
  assert.ok(files['video.mp4']);
  assert.ok(files['cover.jpg']);
  assert.ok(files['caption.txt']);
  assert.ok(files['subtitles.srt']);
  assert.ok(files['platform-checklist.md']);
  assert.ok(files['manifest.json']);
  assert.deepEqual(files['video.mp4'], videoBytes);
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  assert.equal(manifest.schema, 'beauty-delivery-manifest/v1');
  assert.equal(manifest.kind, 'video');
  assert.equal(manifest.contentPackageRevision, 3);
  assert.ok(
    !JSON.stringify(manifest).toLowerCase().includes('provider') ||
      !Object.keys(manifest).includes('provider'),
  );
  assert.equal('provider' in manifest, false);
  assert.equal('credential' in manifest, false);
  assert.equal('hiddenPrompt' in manifest, false);
});

it('image_text export embeds beauty-delivery-manifest/v1 and stable ZIP name', async () => {
  const storage = new MemoryModelAssetStorage();
  const image = await storage.persistGeneratedAsset({
    bytes: Uint8Array.from([137, 80, 78, 71]),
    contentType: 'image/png',
    workspaceId: 'workspace-manifest-v1',
  });
  const adapter = new ContentPackageZipExportAdapter(
    storage,
    {
      async readOwnedAsset() {
        const bytes = storage.read(image.objectKey);
        assert.ok(bytes);
        return {
          asset: { ...image, contentType: 'image/png' as const },
          bytes,
        };
      },
    },
    { contentPackageRevision: 7, storeName: '店名/非法*字符' },
  );

  const artifact = await adapter.export({
    compliance: { aigcLabelEnabled: false, watermarkEnabled: false },
    kind: 'image_text',
    packageId: 'package-manifest-v1',
    platform: 'xiaohongshu',
    version: {
      body: '正文',
      createdAt: '2026-07-18T10:00:00.000Z',
      id: 'version-manifest-v1',
      orderedAssetIds: [image.id],
      title: '标题',
      topics: ['话题'],
    },
    workspaceId: 'workspace-manifest-v1',
  });

  assert.equal(artifact.fileName, '店名非法字符-图文-小红书-20260718-r7.zip');
  const archiveBytes = storage.read(artifact.artifactObjectKey);
  assert.ok(archiveBytes);
  const files = unzipSync(archiveBytes);
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  assert.equal(manifest.schema, 'beauty-delivery-manifest/v1');
  assert.equal(manifest.contentPackageRevision, 7);
  assert.ok(Array.isArray(manifest.files));
  assert.ok(manifest.files.some((file: { role: string }) => file.role === 'image'));
  assert.ok(manifest.rightsSummary);
  assert.equal(typeof manifest.generatedAt, 'string');
});
