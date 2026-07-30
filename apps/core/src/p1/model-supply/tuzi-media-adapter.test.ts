import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { recordedRequest } from './adapters.js';
import type { ProviderAssetFetchPort } from './ark-media-adapter.js';
import type { MediaProviderEffectRequest } from './index.js';
import {
  normalizeTuziEditReferencePng,
  tuziEditOutputSize,
  tuziGenerationOutputSize,
  TuziMediaExecutionPort,
} from './tuzi-media-adapter.js';

async function sampleImageDataUrl(options: {
  format: 'jpeg' | 'png';
  height: number;
  width: number;
}) {
  const pipeline = sharp({
    create: {
      background: { b: 40, g: 80, r: 200 },
      channels: 3,
      height: options.height,
      width: options.width,
    },
  });
  const bytes =
    options.format === 'jpeg'
      ? await pipeline.jpeg().toBuffer()
      : await pipeline.png().toBuffer();
  const contentType = options.format === 'jpeg' ? 'image/jpeg' : 'image/png';
  return {
    bytes,
    contentType,
    providerReadableUrl: `data:${contentType};base64,${bytes.toString('base64')}`,
  };
}

function request(
  catalogModelId: 'seedream-5-pro' | 'seedance-2',
  reference?: {
    bytes: Uint8Array;
    contentType: string;
    providerReadableUrl: string;
  }
): MediaProviderEffectRequest {
  const fallback = {
    bytes: Uint8Array.from([1, 2, 3]),
    contentType: 'image/png',
    providerReadableUrl: 'data:image/png;base64,AQID',
  };
  const asset = reference ?? fallback;
  return {
    ...recordedRequest(
      catalogModelId,
      catalogModelId === 'seedream-5-pro' ? 'image.edit' : 'video.generate',
      {
        referenceAssetIds: ['store-image'],
        ...(catalogModelId === 'seedance-2' ? { durationSeconds: 5 } : {}),
      }
    ),
    effectIdempotencyKey: `tuzi-${catalogModelId}`,
    resolvedReferenceAssets: [
      {
        assetId: 'store-image',
        bytes: asset.bytes,
        contentType: asset.contentType,
        kind: 'resolved',
        providerReadableUrl: asset.providerReadableUrl,
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

test('Tuzi image edits upload square PNG references as multipart form data', async () => {
  const store = await sampleImageDataUrl({
    format: 'jpeg',
    height: 615,
    width: 525,
  });
  const style = await sampleImageDataUrl({
    format: 'png',
    height: 400,
    width: 700,
  });
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
    assert.equal(init.body.get('size'), '2048x2048');
    assert.equal(init.body.get('response_format'), 'url');
    const images = init.body.getAll('image');
    assert.equal(images.length, 2);
    for (const image of images) {
      assert.ok(image instanceof Blob);
      assert.equal(image.type, 'image/png');
      const bytes = Buffer.from(await image.arrayBuffer());
      assert.ok(bytes.byteLength > 0);
      assert.ok(bytes.byteLength <= 4 * 1024 * 1024);
      const meta = await sharp(bytes).metadata();
      assert.equal(meta.format, 'png');
      assert.equal(meta.width, meta.height);
      assert.equal(meta.hasAlpha, true);
    }
    assert.equal(new Headers(init.headers).has('content-type'), false);
    return Response.json({
      created: 1_786_400_000,
      data: [{ url: 'https://media.example.test/generated.png' }],
      usage: { generated_images: 1 },
    });
  };

  const effect = request('seedream-5-pro', store);
  effect.submission.input = {
    ...effect.submission.input,
    referenceAssetIds: ['store-image', 'style-image'],
  };
  effect.resolvedReferenceAssets = [
    ...(effect.resolvedReferenceAssets ?? []),
    {
      assetId: 'style-image',
      bytes: style.bytes,
      contentType: style.contentType,
      kind: 'resolved',
      providerReadableUrl: style.providerReadableUrl,
      sha256: 'sha256-style-image',
    },
  ];

  const receipt = await provider(fetchMock).submit(effect);

  assert.equal(receipt.acceptance, 'accepted', receipt.error);
  assert.doesNotMatch(receipt.error ?? '', /tuzi-test-secret/);
});

test('Tuzi image edits map non-square size hints to allowed square outputs', async () => {
  const store = await sampleImageDataUrl({
    format: 'png',
    height: 512,
    width: 512,
  });
  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.tu-zi.example/v1/images/edits');
    assert.ok(init?.body instanceof FormData);
    // Seedream requires ≥3.68MP; edits always use 2048x2048 (probe-proven).
    assert.equal(init.body.get('size'), '2048x2048');
    return Response.json({
      created: 1_786_400_000,
      data: [{ url: 'https://media.example.test/generated.png' }],
      usage: { generated_images: 1 },
    });
  };
  const effect = request('seedream-5-pro', store);
  effect.submission.input = {
    ...effect.submission.input,
    height: 1536,
    width: 1024,
  };

  const receipt = await provider(fetchMock).submit(effect);

  assert.equal(receipt.acceptance, 'accepted');
});

test('normalizeTuziEditReferencePng converts merchant JPEG to square PNG under 4MB', async () => {
  const jpeg = await sharp({
    create: {
      background: { b: 30, g: 60, r: 90 },
      channels: 3,
      height: 615,
      width: 525,
    },
  })
    .jpeg()
    .toBuffer();
  const png = await normalizeTuziEditReferencePng(jpeg);
  const meta = await sharp(png).metadata();
  assert.equal(meta.format, 'png');
  assert.equal(meta.width, meta.height);
  assert.equal(meta.hasAlpha, true);
  assert.ok(png.byteLength <= 4 * 1024 * 1024);
});

test('tuziEditOutputSize always emits Seedream-safe 2048 square', () => {
  assert.equal(tuziEditOutputSize(undefined), '2048x2048');
  assert.equal(tuziEditOutputSize('2K'), '2048x2048');
  assert.equal(tuziEditOutputSize('1024x1024'), '2048x2048');
  assert.equal(tuziEditOutputSize('1024x1536'), '2048x2048');
});

test('tuziGenerationOutputSize meets the strictest documented Seedream constraints', () => {
  assert.equal(tuziGenerationOutputSize(undefined), '2048x2048');
  assert.equal(tuziGenerationOutputSize('2K'), '2048x2048');
  assert.equal(tuziGenerationOutputSize('auto'), '2048x2048');

  for (const input of [
    '1024x1024',
    '1024x1536',
    '1536x1024',
    '1024x1365',
    '1365x1024',
    '720x1280',
    '1280x720',
    '1024x1792',
    '1792x1024',
    '4000x1200',
    '1200x4000',
    '7680x4320',
  ]) {
    const [width = 0, height = 0] = tuziGenerationOutputSize(input)
      .split('x')
      .map(Number);
    const pixels = width * height;
    assert.equal(width % 16, 0, `${input}: width must be a 16px multiple`);
    assert.equal(height % 16, 0, `${input}: height must be a 16px multiple`);
    assert.ok(width <= 3840, `${input}: width exceeds 3840px`);
    assert.ok(height <= 3840, `${input}: height exceeds 3840px`);
    assert.ok(pixels >= 3_686_400, `${input}: below live Seedream minimum`);
    assert.ok(pixels <= 8_294_400, `${input}: above local OpenAPI maximum`);
    assert.ok(
      Math.max(width, height) / Math.min(width, height) <= 3,
      `${input}: aspect ratio exceeds 3:1`
    );
    assert.equal(
      Math.sign(width - height),
      Math.sign(Number(input.split('x')[0]) - Number(input.split('x')[1])),
      `${input}: orientation changed`
    );
  }

  for (const input of ['1024x1536', '1536x1024', '720x1280', '1280x720']) {
    const [requestedWidth = 0, requestedHeight = 0] = input
      .split('x')
      .map(Number);
    const [outputWidth = 0, outputHeight = 0] = tuziGenerationOutputSize(input)
      .split('x')
      .map(Number);
    assert.ok(
      Math.abs(outputWidth / outputHeight - requestedWidth / requestedHeight) <
        0.02,
      `${input}: common aspect ratio was not preserved closely`
    );
  }
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
  assert.equal(receipt.errorCode, 'video_reference_limit');
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
    assert.equal(init.body.get('seconds'), '5');
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
