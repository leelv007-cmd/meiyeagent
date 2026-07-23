import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { ContentPackage } from '@meiye/contracts';
import type { CanvasOwnedAsset } from '../../pro-studio/canvas-asset-facade.js';
import { OperationsCanvasExportAssetAccessService } from './canvas-export-asset-access.js';

const workspaceId = 'workspace-1';
const bytes = new TextEncoder().encode('authoritative canvas asset');
const sha256 = createHash('sha256').update(bytes).digest('hex');

test('reads a workspace-owned Canvas receipt through Core storage only after verification', async () => {
  const service = accessService({
    canvasAsset: canvasAsset(),
    stored: { bytes, contentType: 'image/png' },
  });

  const result = await service.resolve({
    assetId: 'asset-1',
    contentPackages: [],
    workspaceId,
  });

  assert.equal(result.kind, 'available');
  if (result.kind !== 'available') throw new Error('Expected an available asset.');
  assert.equal(result.asset.workspaceId, workspaceId);
  assert.equal(result.asset.receipt.id, 'asset-1');
  assert.equal(result.asset.sha256, sha256);
  assert.deepEqual(Buffer.from(result.asset.bytesBase64, 'base64'), Buffer.from(bytes));
});

test('authorizes current local imports, generation outputs, and safe derivatives through Core', async () => {
  let storageReads = 0;
  const localImport = governedCanvasAsset({
    id: 'local-import',
    source: { kind: 'local_import' },
  });
  const generation = governedCanvasAsset({
    id: 'generation-output',
    source: { jobId: 'job-1', kind: 'generation_job' },
  });
  const derivative = governedCanvasAsset({
    id: 'local-crop',
    source: {
      derivation: 'crop',
      kind: 'local_canvas_derivative',
      parentAssetId: localImport.id,
    },
  });
  const service = accessService({
    canvasAsset: null,
    canvasAssets: {
      [derivative.id]: derivative,
      [generation.id]: generation,
      [localImport.id]: localImport,
    },
    onStorageRead() {
      storageReads += 1;
    },
    stored: { bytes, contentType: 'image/png' },
  });

  for (const assetId of [localImport.id, generation.id, derivative.id]) {
    const result = await service.resolve({
      assetId,
      contentPackages: [],
      workspaceId,
    });
    assert.equal(result.kind, 'available');
  }
  assert.equal(storageReads, 3);

  // The Canvas-owned generation policy is media-type agnostic, so image,
  // video, and audio outputs all have to pass the same current policy check.
  for (const [contentType, extension] of [
    ['image/png', 'png'],
    ['video/mp4', 'mp4'],
    ['audio/mpeg', 'mp3'],
  ] as const) {
    const generated = {
      ...governedCanvasAsset({
        id: `generated-${extension}`,
        source: { jobId: `job-${extension}`, kind: 'generation_job' },
      }),
      contentType,
      fileName: `generated.${extension}`,
      objectKey: `${workspaceId}/canvas/assets/generated-${extension}.${extension}`,
    };
    const result = await accessService({
      canvasAsset: generated,
      stored: { bytes, contentType },
    }).resolve({
      assetId: generated.id,
      contentPackages: [],
      workspaceId,
    });
    assert.equal(result.kind, 'available');
  }
});

test('fails closed for cross-workspace, invalid receipts, and missing storage', async () => {
  const cases = [
    {
      code: 'ASSET_ACCESS_DENIED',
      service: accessService({
        canvasAsset: { ...canvasAsset(), workspaceId: 'workspace-2' },
        stored: { bytes, contentType: 'image/png' },
      }),
    },
    {
      code: 'ASSET_RECEIPT_INVALID',
      service: accessService({
        canvasAsset: { ...canvasAsset(), sha256: '0'.repeat(64) },
        stored: { bytes, contentType: 'image/png' },
      }),
    },
    {
      code: 'ASSET_STORAGE_UNAVAILABLE',
      service: accessService({
        canvasAsset: canvasAsset(),
        stored: new Error('object store unavailable'),
      }),
    },
  ] as const;

  for (const entry of cases) {
    const result = await entry.service.resolve({
      assetId: 'asset-1',
      contentPackages: [],
      workspaceId,
    });
    assert.deepEqual(result, { code: entry.code, kind: 'unavailable' });
  }
});

test('uses current ContentPackage policy and Product rights instead of Canvas graph facts', async () => {
  const revoked = await accessService({
    canvasAsset: null,
    stored: { bytes, contentType: 'image/png' },
  }).resolve({
    assetId: 'asset-1',
    contentPackages: [contentPackage('revoked')],
    workspaceId,
  });
  assert.deepEqual(revoked, { code: 'ASSET_REVOKED', kind: 'unavailable' });

  for (const [reason, code] of [
    ['expired', 'ASSET_EXPIRED'],
    ['private_retrieval_denied', 'ASSET_PRIVATE_RETRIEVAL_DENIED'],
    ['revoked', 'ASSET_REVOKED'],
  ] as const) {
    let storageReads = 0;
    const service = accessService({
      canvasAsset: canvasAsset(),
      onStorageRead() {
        storageReads += 1;
      },
      productPolicy: async () => ({ kind: 'unavailable', reason }),
      stored: { bytes, contentType: 'image/png' },
    });
    const result = await service.resolve({
      assetId: 'asset-1',
      contentPackages: [],
      workspaceId,
    });
    assert.deepEqual(result, { code, kind: 'unavailable' });
    assert.equal(storageReads, 0);
  }

  for (const source of [
    { kind: 'local_import' as const },
    { jobId: 'job-1', kind: 'generation_job' as const },
  ]) {
    let storageReads = 0;
    const ungoverned = await accessService({
      canvasAsset: { ...canvasAsset(), source },
      onStorageRead() {
        storageReads += 1;
      },
      stored: { bytes, contentType: 'image/png' },
    }).resolve({
      assetId: 'asset-1',
      contentPackages: [],
      workspaceId,
    });
    assert.deepEqual(ungoverned, {
      code: 'ASSET_ACCESS_DENIED',
      kind: 'unavailable',
    });
    assert.equal(storageReads, 0);
  }
});

test('denies revoked, expired, private, and tampered owned assets before storage reads', async () => {
  const root = governedCanvasAsset({
    id: 'root',
    source: { jobId: 'job-1', kind: 'generation_job' },
  });
  const child = governedCanvasAsset({
    id: 'child',
    source: {
      derivation: 'upscale',
      kind: 'local_canvas_derivative',
      parentAssetId: root.id,
    },
  });
  const cases: Array<{
    assets: Record<string, CanvasOwnedAsset>;
    code:
      | 'ASSET_EXPIRED'
      | 'ASSET_PRIVATE_RETRIEVAL_DENIED'
      | 'ASSET_RECEIPT_INVALID'
      | 'ASSET_REVOKED';
    id: string;
    receiptValid?: boolean;
  }> = [
    {
      assets: {
        [root.id]: {
          ...root,
          exportPolicy: { ...currentPolicy(), revokedAt: '2026-07-23T00:00:00.000Z' },
        },
      },
      code: 'ASSET_REVOKED',
      id: root.id,
    },
    {
      assets: {
        [root.id]: {
          ...root,
          exportPolicy: { ...currentPolicy(), expiresAt: '2026-07-22T23:59:59.000Z' },
        },
      },
      code: 'ASSET_EXPIRED',
      id: root.id,
    },
    {
      assets: {
        [root.id]: {
          ...root,
          exportPolicy: { ...currentPolicy(), privateRetrievalAllowed: false },
        },
      },
      code: 'ASSET_PRIVATE_RETRIEVAL_DENIED',
      id: root.id,
    },
    {
      assets: {
        [child.id]: child,
        [root.id]: {
          ...root,
          exportPolicy: { ...currentPolicy(), revokedAt: '2026-07-23T00:00:00.000Z' },
        },
      },
      code: 'ASSET_REVOKED',
      id: child.id,
    },
    {
      assets: {
        [root.id]: root,
      },
      code: 'ASSET_RECEIPT_INVALID',
      id: root.id,
      receiptValid: false,
    },
  ];

  for (const entry of cases) {
    let storageReads = 0;
    const service = accessService({
      canvasAsset: null,
      canvasAssets: entry.assets,
      onStorageRead() {
        storageReads += 1;
      },
      ...(entry.receiptValid === undefined
        ? {}
        : { receiptValid: entry.receiptValid }),
      stored: { bytes, contentType: 'image/png' },
    });
    const result = await service.resolve({
      assetId: entry.id,
      contentPackages: [],
      workspaceId,
    });
    assert.deepEqual(result, { code: entry.code, kind: 'unavailable' });
    assert.equal(storageReads, 0);
  }
});

test('denies a derivative whose historical parent has no governance fact before storage reads', async () => {
  let storageReads = 0;
  const historical = {
    ...governedCanvasAsset({ id: 'historical', source: { kind: 'local_import' } }),
  };
  delete historical.exportPolicy;
  const derivative = governedCanvasAsset({
    id: 'derivative',
    source: {
      derivation: 'mask',
      kind: 'local_canvas_derivative',
      parentAssetId: historical.id,
    },
  });
  const result = await accessService({
    canvasAsset: null,
    canvasAssets: { [derivative.id]: derivative, [historical.id]: historical },
    onStorageRead() {
      storageReads += 1;
    },
    stored: { bytes, contentType: 'image/png' },
  }).resolve({
    assetId: derivative.id,
    contentPackages: [],
    workspaceId,
  });
  assert.deepEqual(result, { code: 'ASSET_ACCESS_DENIED', kind: 'unavailable' });
  assert.equal(storageReads, 0);
});

/* Existing Package/Product behavior stays on the Product policy path. */
test('keeps Product and ContentPackage policy decisions authoritative', async () => {
  const result = await accessService({
    canvasAsset: canvasAsset(),
    productPolicy: async () => ({ kind: 'unavailable', reason: 'revoked' }),
    stored: { bytes, contentType: 'image/png' },
  }).resolve({
    assetId: 'asset-1',
    contentPackages: [contentPackage('authorized')],
    workspaceId,
  });
  assert.deepEqual(result, { code: 'ASSET_REVOKED', kind: 'unavailable' });

  // Image/video/audio produced by Core already enter the Product/
  // ContentPackage OwnedAsset chain; keep that governed path intact rather
  // than copying them into Canvas-owned storage.
  for (const [contentType, extension] of [
    ['image/png', 'png'],
    ['video/mp4', 'mp4'],
    ['audio/mpeg', 'mp3'],
  ] as const) {
    const asset = {
      ...canvasAsset(),
      contentType,
      fileName: `core-generated.${extension}`,
      objectKey: `${workspaceId}/canvas/assets/core-generated.${extension}`,
    };
    const authorized = await accessService({
      canvasAsset: asset,
      stored: { bytes, contentType },
    }).resolve({
      assetId: asset.id,
      contentPackages: [contentPackage('authorized')],
      workspaceId,
    });
    assert.equal(authorized.kind, 'available');
  }
});

function accessService(input: {
  canvasAsset: CanvasOwnedAsset | null;
  canvasAssets?: Record<string, CanvasOwnedAsset>;
  now?: string;
  onStorageRead?: () => void;
  receiptValid?: boolean;
  productPolicy?: () => Promise<
    | { kind: 'authorized' }
    | { kind: 'unknown' }
    | {
        kind: 'unavailable';
        reason:
          | 'access_denied'
          | 'expired'
          | 'private_retrieval_denied'
          | 'revoked';
      }
  >;
  stored: { bytes: Uint8Array; contentType: string } | Error;
}) {
  return new OperationsCanvasExportAssetAccessService({
    canvasAssets: {
      async get(_workspaceId, assetId) {
        return input.canvasAssets
          ? (input.canvasAssets[assetId] ?? null)
          : input.canvasAsset;
      },
    },
    clock: () => new Date(input.now ?? '2026-07-23T00:00:00.000Z'),
    contentPackageAssets: {
      async readOwnedAsset() {
        return {
          asset: {
            contentType: 'image/png' as const,
            id: 'asset-1',
            sha256,
            sizeBytes: bytes.byteLength,
          },
          bytes,
        };
      },
    },
    contentPackageRights: {
      async resolve() {
        return { knownAssetIds: [], unauthorizedAssetIds: [] };
      },
    },
    ownedAssetStorage: {
      async read() {
        input.onStorageRead?.();
        if (input.stored instanceof Error) throw input.stored;
        return input.stored;
      },
      async verifyCanvasAssetReceipt() {
        return input.receiptValid ?? true;
      },
    },
    productAssets: {
      async resolve() {
        return [{ assetId: 'asset-1', kind: 'failure' as const, reason: 'not_found' as const }];
      },
    },
    productPolicy: {
      async resolveExportPolicy() {
        return input.productPolicy?.() ?? { kind: 'authorized' as const };
      },
    },
  });
}

function canvasAsset(): CanvasOwnedAsset {
  return {
    contentType: 'image/png',
    createdAt: '2026-07-23T00:00:00.000Z',
    fileName: 'canvas.png',
    id: 'asset-1',
    objectKey: `${workspaceId}/canvas/asset-1.png`,
    sha256,
    sizeBytes: bytes.byteLength,
    source: { kind: 'product_asset', sourceAssetId: 'product-asset-1' },
    workspaceId,
  };
}

function governedCanvasAsset(input: {
  id: string;
  source: CanvasOwnedAsset['source'];
}): CanvasOwnedAsset {
  return {
    ...canvasAsset(),
    exportPolicy: currentPolicy(),
    id: input.id,
    objectKey: `${workspaceId}/canvas/assets/${input.id}.png`,
    source: input.source,
  };
}

function currentPolicy() {
  return {
    exportAllowed: true,
    expiresAt: null,
    ownerId: 'owner-1',
    privateRetrievalAllowed: true,
    revokedAt: null,
    updatedAt: '2026-07-23T00:00:00.000Z',
    version: 1,
    workspaceId,
  };
}

function contentPackage(rightsState: 'authorized' | 'revoked'): ContentPackage {
  return {
    exportReceipts: [],
    generated: { assetIds: [] },
    id: 'package-1',
    rights: { state: rightsState },
    source: { assetIds: ['asset-1'] },
    status: rightsState === 'revoked' ? 'needs_replacement' : 'accepted',
    variants: [],
    versions: [],
    workspaceId,
  } as unknown as ContentPackage;
}
