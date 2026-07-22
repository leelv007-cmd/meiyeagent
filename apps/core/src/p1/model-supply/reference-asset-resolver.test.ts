import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ProductState } from '@meiye/contracts';
import type { Pool } from 'pg';
import {
  CanvasAssetFacade,
  MemoryCanvasAssetRepository,
  MemoryCanvasObjectStorage,
} from '../../pro-studio/canvas-asset-facade.js';
import { PostgresCanvasAssetRepository } from '../../pro-studio/postgres-canvas-asset-repository.js';
import { FileSystemAssetStorage } from './filesystem-asset-storage.js';
import {
  CompositeReferenceAssetResolver,
  OwnedAssetReferenceResolver,
  ProductReferenceAssetResolver,
} from './reference-asset-resolver.js';

const authorizedAsset = {
  id: 'asset-store-a',
  objectKey: 'workspace-a/assets/store-a.png',
  mediaType: 'image' as const,
  sourceType: 'real' as const,
  tags: ['门店'],
  rightsOwner: 'owner-a',
  rightsEvidence: 'merchant-owned',
  consentScope: 'public_marketing' as const,
  containsPerson: false,
  containsSensitiveData: false,
  minorStatus: 'none' as const,
  aigcStatus: 'not_ai' as const,
  authorizationStatus: 'authorized' as const,
  replacementRequired: false,
  createdAt: '2026-07-15T02:00:00.000Z',
};

function repository(assets: ProductState['assets']) {
  return {
    async load() {
      return { assets } as ProductState;
    },
  };
}

test('owned reference assets are resolved from workspace-scoped durable storage', async () => {
  const bytes = Uint8Array.from(Buffer.from('owned-reference'));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const resolver = new OwnedAssetReferenceResolver(
    {
      async get(workspaceId, assetId) {
        assert.equal(workspaceId, 'workspace-a');
        return {
          contentType: 'image/png',
          createdAt: '2026-07-19T00:00:00.000Z',
          fileName: 'owned.png',
          id: assetId,
          objectKey: 'workspace-a/canvas/assets/owned.png',
          sha256,
          sizeBytes: bytes.byteLength,
          source: { kind: 'product_asset', sourceAssetId: assetId },
          workspaceId,
        };
      },
    },
    {
      async read(objectKey) {
        assert.equal(objectKey, 'workspace-a/canvas/assets/owned.png');
        return bytes;
      },
    },
  );

  const [result] = await resolver.resolve('workspace-a', ['owned-a']);
  assert.equal(result?.kind, 'resolved');
  if (!result || result.kind !== 'resolved') return;
  assert.equal(result.sha256, sha256);
  assert.equal(Buffer.from(result.bytes).toString(), 'owned-reference');
});

test('composite reference resolver falls through not-found results in input order', async () => {
  const resolver = new CompositeReferenceAssetResolver([
    {
      async inspect(_workspaceId, assetIds) {
        return assetIds.map((assetId) => ({
          assetId,
          kind: 'failure' as const,
          reason: 'not_found' as const,
        }));
      },
      async resolve(_workspaceId, assetIds) {
        return assetIds.map((assetId) => ({
          assetId,
          kind: 'failure' as const,
          reason: 'not_found' as const,
        }));
      },
    },
    {
      async inspect(_workspaceId, assetIds) {
        return assetIds.map((assetId) => ({
          assetId,
          contentType: 'image/png',
          kind: 'resolved' as const,
        }));
      },
      async resolve(_workspaceId, assetIds) {
        return assetIds.map((assetId) => ({
          assetId,
          bytes: Uint8Array.of(1),
          contentType: 'image/png',
          kind: 'resolved' as const,
          providerReadableUrl: 'data:image/png;base64,AQ==',
          sha256: 'sha-a',
        }));
      },
    },
  ]);

  assert.deepEqual(
    (await resolver.inspect('workspace-a', ['asset-b', 'asset-a'])).map(
      ({ assetId }) => assetId,
    ),
    ['asset-b', 'asset-a'],
  );
});

test('reference asset inspection verifies the private BFF channel without reading bytes', async () => {
  let method = '';
  const resolver = new ProductReferenceAssetResolver(
    repository([authorizedAsset]),
    {
      appBaseUrl: 'http://app.example.test/',
      serviceToken: 'service-token-a',
      fetch: async (input, init) => {
        method = init?.method ?? '';
        assert.equal(
          String(input),
          'http://app.example.test/api/core/p1/assets?objectKey=workspace-a%2Fassets%2Fstore-a.png',
        );
        assert.equal(
          new Headers(init?.headers).get('x-service-token'),
          'service-token-a',
        );
        assert.equal(
          new Headers(init?.headers).get('x-workspace-id'),
          'workspace-a',
        );
        return new Response(null, {
          headers: {
            'content-length': '128',
            'content-type': 'image/png',
          },
        });
      },
    },
  );

  assert.deepEqual(await resolver.inspect('workspace-a', ['asset-store-a']), [
    {
      assetId: 'asset-store-a',
      contentType: 'image/png',
      kind: 'resolved',
      objectKey: 'workspace-a/assets/store-a.png',
    },
  ]);
  assert.equal(method, 'HEAD');
});

test('reference asset resolution returns bytes, digest and a provider-readable data URL', async () => {
  const resolver = new ProductReferenceAssetResolver(
    repository([authorizedAsset]),
    {
      appBaseUrl: 'http://app.example.test',
      serviceToken: 'service-token-a',
      fetch: async (_input, init) => {
        assert.equal(init?.method, 'GET');
        return new Response(Buffer.from('reference'), {
          headers: { 'content-type': 'image/png' },
        });
      },
    },
  );

  const [result] = await resolver.resolve('workspace-a', ['asset-store-a']);
  assert.equal(result?.kind, 'resolved');
  if (!result || result.kind !== 'resolved') return;
  assert.equal(result.providerReadableUrl, 'data:image/png;base64,cmVmZXJlbmNl');
  assert.equal(
    result.sha256,
    '52367a6622b19f08825e915fad80c542ad4f4c34dbcebad9f5007994b3e39208',
  );
  assert.equal(Buffer.from(result.bytes).toString(), 'reference');
});

test('reference asset resolution rejects missing, withdrawn, incomplete-rights and oversized assets before provider access', async () => {
  let fetchCalls = 0;
  const resolver = new ProductReferenceAssetResolver(
    repository([
      {
        ...authorizedAsset,
        id: 'asset-withdrawn',
        authorizationStatus: 'withdrawn',
      },
      {
        ...authorizedAsset,
        id: 'asset-internal',
        consentScope: 'internal_only',
      },
      {
        ...authorizedAsset,
        id: 'asset-ai',
        sourceType: 'ai_generated',
      },
      {
        ...authorizedAsset,
        id: 'asset-no-evidence',
        rightsEvidence: undefined,
      },
      {
        ...authorizedAsset,
        category: 'customer_case',
        containsPerson: true,
        id: 'asset-expired-rights',
        rightsNoFixedExpiry: false,
        rightsPlatforms: ['xiaohongshu'],
        rightsValidUntil: '2026-07-17T23:59:59.999Z',
      },
      { ...authorizedAsset, id: 'asset-large' },
    ]),
    {
      appBaseUrl: 'http://app.example.test',
      maxBytes: 4,
      serviceToken: 'service-token-a',
      clock: () => new Date('2026-07-18T00:00:00.000Z'),
      fetch: async () => {
        fetchCalls += 1;
        return new Response(null, {
          headers: {
            'content-length': '5',
            'content-type': 'image/png',
          },
        });
      },
    },
  );

  assert.deepEqual(
    await resolver.inspect('workspace-a', [
      'asset-missing',
      'asset-withdrawn',
      'asset-internal',
      'asset-ai',
      'asset-no-evidence',
      'asset-expired-rights',
      'asset-large',
    ]),
    [
      { assetId: 'asset-missing', kind: 'failure', reason: 'not_found' },
      {
        assetId: 'asset-withdrawn',
        kind: 'failure',
        reason: 'authorization_withdrawn',
      },
      {
        assetId: 'asset-internal',
        kind: 'failure',
        reason: 'rights_incomplete',
      },
      {
        assetId: 'asset-ai',
        kind: 'failure',
        reason: 'rights_incomplete',
      },
      {
        assetId: 'asset-no-evidence',
        kind: 'failure',
        reason: 'rights_incomplete',
      },
      {
        assetId: 'asset-expired-rights',
        kind: 'failure',
        reason: 'rights_incomplete',
      },
      { assetId: 'asset-large', kind: 'failure', reason: 'oversized' },
    ],
  );
  assert.equal(fetchCalls, 1);
});

test('a Canvas-owned import resolves at the provider seam only inside its workspace', async () => {
  const assets = new MemoryCanvasAssetRepository();
  const storage = new MemoryCanvasObjectStorage();
  const facade = new CanvasAssetFacade({
    nextId: () => 'canvas-owned-1',
    repository: assets,
    storage,
  });
  const bytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
  ]);
  const owned = await facade.persistLocalCanvasArtifact(
    { userId: 'user-a', workspaceId: 'workspace-a' },
    {
      bytes,
      contentType: 'image/png',
      derivation: 'retouch',
      fileName: 'reference.png',
    },
  );
  const resolver = new OwnedAssetReferenceResolver(assets, storage);

  const [resolved] = await resolver.resolve('workspace-a', [owned.id]);
  assert.equal(resolved?.kind, 'resolved');
  if (!resolved || resolved.kind !== 'resolved') return;
  assert.equal(resolved.objectKey, owned.objectKey);
  assert.equal(
    resolved.providerReadableUrl,
    `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
  );
  assert.deepEqual(await resolver.resolve('workspace-b', [owned.id]), [
    { assetId: owned.id, kind: 'failure', reason: 'not_found' },
  ]);
});

test('owned asset inspection uses metadata head without reading or materializing provider data', async () => {
  const assets = new MemoryCanvasAssetRepository();
  const sizeBytes = 10 * 1024 * 1024;
  const sha256 =
    '4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a';
  for (let index = 0; index < 20; index += 1) {
    await assets.insert({
      contentType: 'image/png',
      createdAt: '2026-07-19T00:00:00.000Z',
      fileName: `asset-${index}.png`,
      id: `asset-${index}`,
      objectKey: `workspace-a/canvas/assets/asset-${index}.png`,
      sha256,
      sizeBytes,
      source: { kind: 'local_import' },
      workspaceId: 'workspace-a',
    });
  }
  let headCalls = 0;
  let readCalls = 0;
  const storage = {
    async head() {
      headCalls += 1;
      return { contentType: 'image/png', sizeBytes };
    },
    async read() {
      readCalls += 1;
      return Uint8Array.from([1]);
    },
  };
  const resolver = new OwnedAssetReferenceResolver(assets, storage);

  const inspections = await resolver.inspect(
    'workspace-a',
    Array.from({ length: 20 }, (_, index) => `asset-${index}`),
  );

  assert.equal(inspections.every((result) => result.kind === 'resolved'), true);
  assert.equal(
    inspections.some((result) => 'providerReadableUrl' in result),
    false,
  );
  assert.equal(headCalls, 20);
  assert.equal(readCalls, 0);
});

test('composite resolution falls back only for unknown assets', async () => {
  const fallback = {
    async inspect(_workspaceId: string, assetIds: string[]) {
      return assetIds.map((assetId) => ({
        assetId,
        contentType: 'image/png',
        kind: 'resolved' as const,
      }));
    },
    async resolve(_workspaceId: string, assetIds: string[]) {
      return assetIds.map((assetId) => ({
        assetId,
        bytes: Uint8Array.from([1]),
        contentType: 'image/png',
        kind: 'resolved' as const,
        providerReadableUrl: 'data:image/png;base64,AQ==',
        sha256: 'a'.repeat(64),
      }));
    },
  };
  const resolver = new CompositeReferenceAssetResolver([
    new OwnedAssetReferenceResolver(
      new MemoryCanvasAssetRepository(),
      new MemoryCanvasObjectStorage(),
    ),
    fallback,
  ]);

  assert.equal(
    (await resolver.resolve('workspace-a', ['product-asset']))[0]?.kind,
    'resolved',
  );
});

test('production repository and shared filesystem storage resolve the same owned receipt', async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'owned-resolver-test-'));
  try {
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
    ]);
    const objectKey = 'workspace-a/canvas/assets/asset-pg-1.png';
    const sha256 =
      '7f47b756761a46e6d4a4d96f0d8a4448f8449235009d1f3ad1493f5c773c19e8';
    const storage = new FileSystemAssetStorage({ rootDirectory });
    await storage.putCanvasAsset({
      bytes,
      objectKey,
      workspaceId: 'workspace-a',
    });
    const pool = {
      async query(_sql: string, parameters: unknown[]) {
        return {
          rows:
            parameters[0] === 'workspace-a' && parameters[1] === 'asset-pg-1'
              ? [
                  {
                    contentType: 'image/png',
                    createdAt: '2026-07-19T00:00:00.000Z',
                    fileName: 'asset.png',
                    id: 'asset-pg-1',
                    legacyStorageKey: null,
                    objectKey,
                    sha256,
                    sizeBytes: bytes.byteLength,
                    source: { kind: 'local_import' },
                    workspaceId: 'workspace-a',
                  },
                ]
              : [],
        };
      },
    } as unknown as Pool;
    const resolver = new OwnedAssetReferenceResolver(
      new PostgresCanvasAssetRepository(pool),
      {
        async read(key) {
          return (await storage.read(key)).bytes;
        },
      },
    );

    assert.equal(
      (await resolver.resolve('workspace-a', ['asset-pg-1']))[0]?.kind,
      'resolved',
    );
    assert.deepEqual(await resolver.resolve('workspace-b', ['asset-pg-1']), [
      { assetId: 'asset-pg-1', kind: 'failure', reason: 'not_found' },
    ]);
  } finally {
    await rm(rootDirectory, { force: true, recursive: true });
  }
});
