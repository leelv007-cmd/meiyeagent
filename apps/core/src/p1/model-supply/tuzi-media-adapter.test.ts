import assert from 'node:assert/strict';
import test from 'node:test';
import { recordedRequest } from './adapters.js';
import type { ProviderAssetFetchPort } from './ark-media-adapter.js';
import type { MediaProviderEffectRequest } from './index.js';
import { TuziMediaExecutionPort } from './tuzi-media-adapter.js';

function request(
  catalogModelId: 'seedream-5-pro' | 'seedance-2'
): MediaProviderEffectRequest {
  return {
    ...recordedRequest(
      catalogModelId,
      catalogModelId === 'seedream-5-pro' ? 'image.edit' : 'video.generate',
      { referenceAssetIds: ['store-image'] }
    ),
    effectIdempotencyKey: `tuzi-${catalogModelId}`,
    resolvedReferenceAssets: [
      {
        assetId: 'store-image',
        bytes: Uint8Array.from([1, 2, 3]),
        contentType: 'image/png',
        kind: 'resolved',
        providerReadableUrl: 'data:image/png;base64,AQID',
        sha256: 'sha256-store-image',
      },
    ],
  };
}

function provider(fetch: typeof globalThis.fetch) {
  const assetFetch: ProviderAssetFetchPort = {
    async get(target, constraints) {
      const response = await fetch(target, {
        headers: constraints.authorization
          ? { authorization: constraints.authorization.value }
          : {},
      });
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        finalUrl: target,
        mimeType: response.headers.get('content-type') ?? '',
      };
    },
  };
  return new TuziMediaExecutionPort({
    apiKey: 'tuzi-test-secret',
    assetFetch,
    baseUrl: 'https://api.tu-zi.example/v1',
    credentialVersion: 'tuzi-key-v1',
    endpointRevision: 'tuzi-media-v1',
    fetch,
    image: {
      catalogModelId: 'seedream-5-pro',
      costPerImage: 0.2,
      model: 'tuzi-image-model',
    },
    sourceUrlTtlSeconds: 3_600,
    video: {
      catalogModelId: 'seedance-2',
      costPerMillionTokens: 20,
      estimatedTokensPerSecond: 10_000,
      model: 'tuzi-video-model',
    },
  });
}

test('Tuzi image edits upload the resolved reference as multipart form data', async () => {
  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.tu-zi.example/v1/images/edits');
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      'Bearer tuzi-test-secret'
    );
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get('n'), '1');
    assert.equal(init.body.get('model'), 'tuzi-image-model');
    assert.match(
      String(init.body.get('prompt')),
      /seedream-5-pro recorded request/
    );
    assert.equal(init.body.get('size'), '2K');
    assert.equal(init.body.get('response_format'), 'url');
    const images = init.body.getAll('image');
    assert.equal(images.length, 2);
    assert.ok(images[0] instanceof Blob);
    assert.ok(images[1] instanceof Blob);
    assert.deepEqual(
      new Uint8Array(await images[0].arrayBuffer()),
      Uint8Array.from([1, 2, 3])
    );
    assert.deepEqual(
      new Uint8Array(await images[1].arrayBuffer()),
      Uint8Array.from([4, 5, 6])
    );
    assert.equal(new Headers(init.headers).has('content-type'), false);
    return Response.json({
      created: 1_786_400_000,
      data: [{ url: 'https://media.example.test/generated.png' }],
      usage: { generated_images: 1 },
    });
  };

  const effect = request('seedream-5-pro');
  effect.submission.input = {
    ...effect.submission.input,
    referenceAssetIds: ['store-image', 'style-image'],
  };
  effect.resolvedReferenceAssets = [
    ...(effect.resolvedReferenceAssets ?? []),
    {
      assetId: 'style-image',
      bytes: Uint8Array.from([4, 5, 6]),
      contentType: 'image/png',
      kind: 'resolved',
      providerReadableUrl: 'data:image/png;base64,BAUG',
      sha256: 'sha256-style-image',
    },
  ];

  const receipt = await provider(fetchMock).submit(effect);

  assert.equal(receipt.acceptance, 'accepted', receipt.error);
  assert.doesNotMatch(receipt.error ?? '', /tuzi-test-secret/);
});

test('Tuzi image edits raise undersized exact dimensions to the provider minimum', async () => {
  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.tu-zi.example/v1/images/edits');
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get('size'), '1728x2304');
    return Response.json({
      created: 1_786_400_000,
      data: [{ url: 'https://media.example.test/generated.png' }],
      usage: { generated_images: 1 },
    });
  };
  const effect = request('seedream-5-pro');
  effect.submission.input = {
    ...effect.submission.input,
    height: 2048,
    width: 1536,
  };

  const receipt = await provider(fetchMock).submit(effect);

  assert.equal(receipt.acceptance, 'accepted');
});

test('Tuzi rejects image edits before provider acceptance when a reference URL is not an owned data URL', async () => {
  let providerCalled = false;
  const fetchMock: typeof globalThis.fetch = async () => {
    providerCalled = true;
    return Response.json({ data: [] });
  };
  const effect = request('seedream-5-pro');
  effect.resolvedReferenceAssets![0]!.providerReadableUrl =
    'https://assets.example.test/store.png';

  const receipt = await provider(fetchMock).submit(effect);

  assert.equal(receipt.acceptance, 'rejected_before_accept');
  assert.equal(receipt.errorCode, 'invalid_request');
  assert.equal(providerCalled, false);
});

test('Tuzi rejects image edits whose decoded reference exceeds the resolver limit', async () => {
  let providerCalled = false;
  const fetchMock: typeof globalThis.fetch = async () => {
    providerCalled = true;
    return Response.json({ data: [] });
  };
  const effect = request('seedream-5-pro');
  effect.resolvedReferenceAssets![0]!.providerReadableUrl =
    `data:image/png;base64,${Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64')}`;

  const receipt = await provider(fetchMock).submit(effect);

  assert.equal(receipt.acceptance, 'rejected_before_accept');
  assert.equal(receipt.errorCode, 'invalid_request');
  assert.equal(providerCalled, false);
});

test('Tuzi image generation without references uses the JSON generation endpoint', async () => {
  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    assert.equal(
      String(input),
      'https://api.tu-zi.example/v1/images/generations'
    );
    assert.equal(
      new Headers(init?.headers).get('content-type'),
      'application/json'
    );
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      prompt: string;
      response_format: string;
    };
    assert.equal(body.model, 'tuzi-image-model');
    assert.match(body.prompt, /seedream-5-pro recorded request/);
    assert.equal(body.response_format, 'url');
    assert.equal('messages' in body, false);
    return Response.json({
      created: 1_786_400_000,
      data: [{ url: 'https://media.example.test/generated.png' }],
      usage: { generated_images: 1 },
    });
  };
  const effect = {
    ...recordedRequest('seedream-5-pro', 'image.generate'),
    effectIdempotencyKey: 'tuzi-seedream-generation',
  };

  const receipt = await provider(fetchMock).submit(effect);

  assert.equal(receipt.acceptance, 'accepted');
});

test('Tuzi rejects video submissions with multiple references before provider acceptance', async () => {
  let providerCalled = false;
  const fetchMock: typeof globalThis.fetch = async () => {
    providerCalled = true;
    return Response.json({ id: 'unexpected-task', status: 'queued' });
  };
  const effect = request('seedance-2');
  effect.submission.input = {
    ...effect.submission.input,
    referenceAssetIds: ['store-image', 'style-image'],
  };
  effect.resolvedReferenceAssets = [
    ...(effect.resolvedReferenceAssets ?? []),
    {
      assetId: 'style-image',
      bytes: Uint8Array.from([4, 5, 6]),
      contentType: 'image/png',
      kind: 'resolved',
      providerReadableUrl: 'data:image/png;base64,BAUG',
      sha256: 'sha256-style-image',
    },
  ];

  const receipt = await provider(fetchMock).submit(effect);

  assert.equal(receipt.acceptance, 'rejected_before_accept');
  assert.equal(receipt.errorCode, 'invalid_request');
  assert.match(receipt.error ?? '', /supports only one reference/i);
  assert.equal(receipt.retryable, false);
  assert.equal(providerCalled, false);
});

test('Tuzi videos use multipart input_reference and normalize poll and download', async () => {
  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === 'https://api.tu-zi.example/v1/videos/tuzi-video-task-1') {
      return Response.json({
        id: 'tuzi-video-task-1',
        object: 'video',
        progress: 100,
        status: 'completed',
      });
    }
    if (
      url === 'https://api.tu-zi.example/v1/videos/tuzi-video-task-1/content'
    ) {
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer tuzi-test-secret'
      );
      return new Response(Uint8Array.from([4, 5, 6]), {
        headers: { 'content-type': 'video/mp4' },
      });
    }
    assert.equal(url, 'https://api.tu-zi.example/v1/videos');
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get('model'), 'tuzi-video-model');
    assert.match(
      String(init.body.get('prompt')),
      /seedance-2 recorded request/
    );
    assert.ok(init.body.get('input_reference') instanceof Blob);
    assert.equal(new Headers(init.headers).has('content-type'), false);
    return Response.json({
      id: 'tuzi-video-task-1',
      object: 'video',
      status: 'queued',
    });
  };

  const adapter = provider(fetchMock);
  const videoRequest = request('seedance-2');
  const receipt = await adapter.submit(videoRequest);

  assert.equal(receipt.acceptance, 'accepted');
  assert.ok(receipt.taskRef);
  const taskRef = receipt.taskRef!;
  const polled = await adapter.poll({ ...videoRequest, taskRef });
  assert.equal(polled.status, 'completed');
  const downloaded = await adapter.download({ ...videoRequest, taskRef });
  assert.equal(downloaded.contentType, 'video/mp4');
  assert.deepEqual(downloaded.bytes, Uint8Array.from([4, 5, 6]));
});
