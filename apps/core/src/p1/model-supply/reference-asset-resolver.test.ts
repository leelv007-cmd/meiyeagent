import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProductState } from '@meiye/contracts';
import { ProductReferenceAssetResolver } from './reference-asset-resolver.js';

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
          'http://app.example.test/api/storage/file?key=workspace-a%2Fassets%2Fstore-a.png',
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
      { ...authorizedAsset, id: 'asset-large' },
    ]),
    {
      appBaseUrl: 'http://app.example.test',
      maxBytes: 4,
      serviceToken: 'service-token-a',
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
      { assetId: 'asset-large', kind: 'failure', reason: 'oversized' },
    ],
  );
  assert.equal(fetchCalls, 1);
});
