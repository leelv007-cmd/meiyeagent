import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ProductState } from '@meiye/contracts';
import { FileSystemAssetStorage } from './filesystem-asset-storage.js';
import {
  CompositeReferenceAssetResolver,
  OwnedAssetReferenceResolver,
  ProductReferenceAssetResolver,
} from './reference-asset-resolver.js';

function createCanvasOwnedAssetExportPolicy(input: {
  ownerId: string;
  updatedAt: string;
  workspaceId: string;
}) {
  return {
    exportAllowed: true,
    expiresAt: null as string | null,
    ownerId: input.ownerId,
    privateRetrievalAllowed: true,
    revokedAt: null as string | null,
    updatedAt: input.updatedAt,
    version: 1,
    workspaceId: input.workspaceId,
  };
}

const referenceSha256 =
  '52367a6622b19f08825e915fad80c542ad4f4c34dbcebad9f5007994b3e39208';
const authorizedAsset = {
  id: 'asset-store-a',
  objectKey: 'workspace-a/assets/asset-golden-journey.png',
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

function exportPolicy(
  overrides: Partial<
    ReturnType<typeof createCanvasOwnedAssetExportPolicy>
  > = {},
) {
  return {
    ...createCanvasOwnedAssetExportPolicy({
      ownerId: 'user-a',
      updatedAt: '2026-07-19T00:00:00.000Z',
      workspaceId: 'workspace-a',
    }),
    ...overrides,
  };
}

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
          exportPolicy: exportPolicy(),
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
    {
      productPolicyResolver: {
        async resolve() {
          return { dataClass: [], rightsRevision: 'product-rights-r1' };
        },
      },
    },
  );

  const [result] = await resolver.resolve('workspace-a', ['owned-a']);
  assert.equal(result?.kind, 'resolved');
  if (!result || result.kind !== 'resolved') return;
  assert.equal(result.sha256, sha256);
  assert.equal(Buffer.from(result.bytes).toString(), 'owned-reference');
});

test('owned reference assets fail closed for every mutable export-policy field', async () => {
  const bytes = Uint8Array.from(Buffer.from('owned-reference'));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const policies = [
    exportPolicy({ exportAllowed: false }),
    exportPolicy({ privateRetrievalAllowed: false }),
    exportPolicy({ revokedAt: '2026-07-19T01:00:00.000Z' }),
    exportPolicy({ expiresAt: '2026-07-18T23:59:59.000Z' }),
  ];
  const resolver = new OwnedAssetReferenceResolver(
    {
      async get(workspaceId, assetId) {
        const index = Number(assetId.slice(-1));
        return {
          contentType: 'image/png',
          createdAt: '2026-07-19T00:00:00.000Z',
          exportPolicy: policies[index],
          fileName: 'owned.png',
          id: assetId,
          objectKey: `${workspaceId}/canvas/assets/${assetId}.png`,
          sha256,
          sizeBytes: bytes.byteLength,
          source: { kind: 'local_import' as const },
          workspaceId,
        };
      },
    },
    { async read() { return bytes; } },
    { clock: () => new Date('2026-07-19T02:00:00.000Z') },
  );

  const results = await resolver.resolve('workspace-a', [
    'owned-0',
    'owned-1',
    'owned-2',
    'owned-3',
  ]);
  assert.deepEqual(
    results.map((result) =>
      result.kind === 'failure' ? result.reason : 'unexpected-success',
    ),
    [
      'rights_incomplete',
      'rights_incomplete',
      'authorization_withdrawn',
      'rights_incomplete',
    ],
  );
});

test('owned reference resolution rechecks the current policy after reading bytes', async () => {
  const bytes = Uint8Array.from(Buffer.from('owned-reference'));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  let policy = exportPolicy();
  const resolver = new OwnedAssetReferenceResolver(
    {
      async get(workspaceId, assetId) {
        return {
          contentType: 'image/png',
          createdAt: '2026-07-19T00:00:00.000Z',
          exportPolicy: policy,
          fileName: 'owned.png',
          id: assetId,
          objectKey: `${workspaceId}/canvas/assets/${assetId}.png`,
          sha256,
          sizeBytes: bytes.byteLength,
          source: { kind: 'local_import' as const },
          workspaceId,
        };
      },
    },
    {
      async read() {
        policy = exportPolicy({
          revokedAt: '2026-07-19T01:00:00.000Z',
          version: 2,
        });
        return bytes;
      },
    },
  );

  assert.deepEqual(await resolver.resolve('workspace-a', ['owned-a']), [
    {
      assetId: 'owned-a',
      kind: 'failure',
      reason: 'authorization_withdrawn',
    },
  ]);
});

test('owned product-derived assets keep the current server data classification', async () => {
  const bytes = Uint8Array.from(Buffer.from('owned-reference'));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const resolver = new OwnedAssetReferenceResolver(
    {
      async get(workspaceId, assetId) {
        return {
          contentType: 'image/png',
          createdAt: '2026-07-19T00:00:00.000Z',
          exportPolicy: exportPolicy(),
          fileName: 'owned.png',
          id: assetId,
          objectKey: `${workspaceId}/canvas/assets/${assetId}.png`,
          sha256,
          sizeBytes: bytes.byteLength,
          source: {
            kind: 'product_asset' as const,
            sourceAssetId: 'product-sensitive',
          },
          workspaceId,
        };
      },
    },
    { async read() { return bytes; } },
    {
      productPolicyResolver: {
        async resolve(workspaceId, assetId) {
          assert.equal(workspaceId, 'workspace-a');
          assert.equal(assetId, 'product-sensitive');
          return {
            dataClass: ['contains_face', 'pii'],
            rightsRevision: 'product-rights-r1',
          };
        },
      },
    },
  );

  const [inspection] = await resolver.inspect('workspace-a', ['owned-a']);
  assert.equal(inspection?.kind, 'resolved');
  if (!inspection || inspection.kind !== 'resolved') return;
  assert.deepEqual(inspection.dataClass, ['contains_face', 'pii']);
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
          dataClass: [],
          kind: 'resolved' as const,
          rightsRevision: 'rights-a',
          sha256: 'a'.repeat(64),
        }));
      },
      async resolve(_workspaceId, assetIds) {
        return assetIds.map((assetId) => ({
          assetId,
          bytes: Uint8Array.of(1),
          contentType: 'image/png',
          dataClass: [],
          kind: 'resolved' as const,
          providerReadableUrl: 'data:image/png;base64,AQ==',
          rightsRevision: 'rights-a',
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
          'http://app.example.test/api/storage/file?key=workspace-a%2Fassets%2Fasset-golden-journey.png',
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
            'x-content-sha256': referenceSha256,
          },
        });
      },
    },
  );

  const [inspection] = await resolver.inspect('workspace-a', ['asset-store-a']);
  assert.equal(inspection?.kind, 'resolved');
  if (!inspection || inspection.kind !== 'resolved') return;
  assert.deepEqual(inspection.dataClass, []);
  assert.equal(inspection.sha256, referenceSha256);
  assert.equal(
    inspection.objectKey,
    'workspace-a/assets/asset-golden-journey.png',
  );
  assert.match(inspection.rightsRevision ?? '', /^[a-f0-9]{64}$/u);
  assert.equal(method, 'HEAD');
});

test('product inspection derives sensitive data classes from current server facts', async () => {
  const resolver = new ProductReferenceAssetResolver(
    {
      async load() {
        return {
          assets: [
            {
              ...authorizedAsset,
              containsPerson: true,
              containsSensitiveData: true,
              rightsNoFixedExpiry: true,
              rightsPlatforms: ['xiaohongshu'],
            },
          ],
          store: { regulated: true },
        } as ProductState;
      },
    },
    {
      appBaseUrl: 'http://app.example.test',
      serviceToken: 'service-token-a',
      fetch: async () =>
        new Response(null, {
          headers: {
            'content-length': '128',
            'content-type': 'image/png',
            'x-content-sha256': referenceSha256,
          },
        }),
    },
  );

  const [inspection] = await resolver.inspect('workspace-a', ['asset-store-a']);
  assert.equal(inspection?.kind, 'resolved');
  if (!inspection || inspection.kind !== 'resolved') return;
  assert.deepEqual(inspection.dataClass, ['contains_face', 'medical', 'pii']);
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

function memoryOwnedAssets(
  rows: Array<{
    contentType: string;
    exportPolicy?: ReturnType<typeof exportPolicy>;
    id: string;
    objectKey: string;
    sha256: string;
    sizeBytes: number;
    source?: { kind: 'local_import' } | { kind: 'product_asset'; sourceAssetId: string };
    workspaceId: string;
  }>,
) {
  const byKey = new Map(
    rows.map((row) => [`${row.workspaceId}:${row.id}`, row] as const),
  );
  return {
    async get(workspaceId: string, assetId: string) {
      const row = byKey.get(`${workspaceId}:${assetId}`);
      if (!row) return null;
      return {
        contentType: row.contentType,
        exportPolicy: row.exportPolicy ?? exportPolicy(),
        objectKey: row.objectKey,
        sha256: row.sha256,
        sizeBytes: row.sizeBytes,
        source: row.source ?? { kind: 'local_import' as const },
      };
    },
  };
}

test('a workspace-owned import resolves at the provider seam only inside its workspace', async () => {
  const bytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
  ]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const objectKey = 'workspace-a/owned/reference.png';
  const assets = memoryOwnedAssets([
    {
      contentType: 'image/png',
      id: 'owned-1',
      objectKey,
      sha256,
      sizeBytes: bytes.byteLength,
      workspaceId: 'workspace-a',
    },
  ]);
  const storage = {
    async read(key: string) {
      return key === objectKey ? bytes : null;
    },
  };
  const resolver = new OwnedAssetReferenceResolver(assets, storage);

  const [resolved] = await resolver.resolve('workspace-a', ['owned-1']);
  assert.equal(resolved?.kind, 'resolved');
  if (!resolved || resolved.kind !== 'resolved') return;
  assert.equal(resolved.objectKey, objectKey);
  assert.equal(
    resolved.providerReadableUrl,
    `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
  );
  assert.deepEqual(await resolver.resolve('workspace-b', ['owned-1']), [
    { assetId: 'owned-1', kind: 'failure', reason: 'not_found' },
  ]);
});

test('owned asset inspection uses metadata head without reading or materializing provider data', async () => {
  const sizeBytes = 10 * 1024 * 1024;
  const sha256 =
    '4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a';
  const assets = memoryOwnedAssets(
    Array.from({ length: 20 }, (_, index) => ({
      contentType: 'image/png',
      id: `asset-${index}`,
      objectKey: `workspace-a/owned/asset-${index}.png`,
      sha256,
      sizeBytes,
      workspaceId: 'workspace-a',
    })),
  );
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
        dataClass: [],
        kind: 'resolved' as const,
        rightsRevision: 'rights-a',
        sha256: 'a'.repeat(64),
      }));
    },
    async resolve(_workspaceId: string, assetIds: string[]) {
      return assetIds.map((assetId) => ({
        assetId,
        bytes: Uint8Array.from([1]),
        contentType: 'image/png',
        dataClass: [],
        kind: 'resolved' as const,
        providerReadableUrl: 'data:image/png;base64,AQ==',
        rightsRevision: 'rights-a',
        sha256: 'a'.repeat(64),
      }));
    },
  };
  const resolver = new CompositeReferenceAssetResolver([
    new OwnedAssetReferenceResolver(memoryOwnedAssets([]), {
      async read() {
        return null;
      },
    }),
    fallback,
  ]);

  assert.equal(
    (await resolver.resolve('workspace-a', ['product-asset']))[0]?.kind,
    'resolved',
  );
});

test('shared filesystem storage resolves an owned receipt from an inline repository', async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'owned-resolver-test-'));
  try {
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
    ]);
    const objectKey = 'workspace-a/canvas/assets/asset-pg-1.png';
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const storage = new FileSystemAssetStorage({ rootDirectory });
    await storage.putCanvasAsset({
      bytes,
      objectKey,
      workspaceId: 'workspace-a',
    });
    const assets = memoryOwnedAssets([
      {
        contentType: 'image/png',
        id: 'asset-pg-1',
        objectKey,
        sha256,
        sizeBytes: bytes.byteLength,
        workspaceId: 'workspace-a',
      },
    ]);
    const resolver = new OwnedAssetReferenceResolver(assets, {
      async read(key) {
        return (await storage.read(key)).bytes;
      },
    });

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
