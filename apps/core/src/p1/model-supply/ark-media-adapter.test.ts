import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ArkMediaExecutionPort,
  type ProviderAssetFetchPort,
} from './ark-media-adapter.js';
import { recordedRequest } from './adapters.js';
import type { MediaProviderEffectRequest } from './index.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function effectRequest(
  catalogModelId: 'seedream-5-pro' | 'seedance-2',
): MediaProviderEffectRequest {
  return {
    ...recordedRequest(
      catalogModelId,
      catalogModelId === 'seedream-5-pro'
        ? 'image.generate'
        : 'video.generate',
      catalogModelId === 'seedream-5-pro'
        ? { width: 1024, height: 1024 }
        : { durationSeconds: 5, height: 864, width: 486 },
    ),
    effectIdempotencyKey: `effect-${catalogModelId}`,
  };
}

function assetFetchFrom(fetch: typeof globalThis.fetch): ProviderAssetFetchPort {
  return {
    async get(target) {
      const response = await fetch(target);
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        finalUrl: target,
        mimeType: response.headers.get('content-type') ?? '',
      };
    },
  };
}

function adapter(
  fetch: typeof globalThis.fetch,
  assetFetch: ProviderAssetFetchPort = assetFetchFrom(fetch),
  videoModel = 'doubao-seedance-2-0-test',
) {
  return new ArkMediaExecutionPort({
    apiKey: 'ark-test-secret',
    assetFetch,
    assetSourceHosts: ['media.example.test'],
    baseUrl: 'https://ark.example.test/api/v3',
    credentialVersion: 'ark-key-v3',
    endpointRevision: 'ark-media-v1',
    fetch,
    image: {
      catalogModelId: 'seedream-5-pro',
      costPerImage: 0.22,
      model: 'doubao-seedream-5-0-test',
    },
    sourceUrlTtlSeconds: 3_600,
    video: {
      catalogModelId: 'seedance-2',
      costPerMillionTokens: 28,
      estimatedTokensPerSecond: 10_000,
      model: videoModel,
    },
  });
}

test('Ark downloads provider output only through the provider-safe-fetch port', async () => {
  let safeFetchCalls = 0;
  const fetchMock: typeof globalThis.fetch = async (input) => {
    if (String(input).endsWith('/images/generations')) {
      return Response.json({
        created: 1_786_400_000,
        data: [{ url: 'https://media.example.test/safe-fetch-only.png' }],
        usage: { generated_images: 1 },
      });
    }
    throw new Error('provider output bypassed safe fetch');
  };
  const safeFetch: ProviderAssetFetchPort = {
    async get(target, constraints) {
      safeFetchCalls += 1;
      assert.equal(target, 'https://media.example.test/safe-fetch-only.png');
      assert.deepEqual(constraints.allowedMimeTypes, [
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/webp',
      ]);
      assert.equal(constraints.maxBytes, 25 * 1024 * 1024);
      return {
        bytes: PNG_1X1,
        finalUrl: target,
        mimeType: 'image/png',
      };
    },
  };
  const provider = adapter(fetchMock, safeFetch);
  const request = effectRequest('seedream-5-pro');
  const receipt = await provider.submit(request);

  const downloaded = await provider.download({
    ...request,
    taskRef: receipt.taskRef!,
  });

  assert.equal(downloaded.contentType, 'image/png');
  assert.equal(safeFetchCalls, 1);
});

test('Ark Seedream submit normalizes the synchronous image API into a restart-safe task receipt', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/images/generations')) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(init?.method, 'POST');
      assert.equal(body.model, 'doubao-seedream-5-0-test');
      assert.equal(body.prompt, 'seedream-5-pro recorded request');
      assert.equal(body.size, '1024x1024');
      assert.equal(body.response_format, 'url');
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer ark-test-secret',
      );
      assert.equal(
        new Headers(init?.headers).get('x-client-request-id'),
        'effect-seedream-5-pro',
      );
      return Response.json({
        created: 1_786_400_000,
        data: [{ url: 'https://media.example.test/generated.jpg' }],
        model: 'doubao-seedream-5-0-test',
        usage: { generated_images: 1, output_tokens: 16_280 },
      });
    }
    if (url === 'https://media.example.test/generated.jpg') {
      return new Response(PNG_1X1, {
        headers: { 'content-type': 'image/png' },
      });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const provider = adapter(fetchMock);
  const request = effectRequest('seedream-5-pro');

  const receipt = await provider.submit(request);
  assert.equal(receipt.acceptance, 'accepted');
  assert.match(receipt.taskRef ?? '', /^ark-media-v1\./);
  assert.doesNotMatch(receipt.taskRef ?? '', /media\.example/);
  assert.equal(receipt.providerCost.amount, 0.22);
  assert.equal(receipt.providerCost.currency, 'CNY');
  assert.equal(receipt.providerCost.usage.mediaUnits, 1);
  assert.equal(receipt.providerCost.usage.outputTokens, 16_280);

  assert.deepEqual(await provider.recover(request), receipt);
  const restarted = adapter(fetchMock);
  const state = await restarted.poll({ ...request, taskRef: receipt.taskRef! });
  assert.equal(state.status, 'completed');
  const downloaded = await restarted.download({
    ...request,
    taskRef: receipt.taskRef!,
  });
  assert.equal(downloaded.contentType, 'image/png');
  assert.deepEqual(
    [...downloaded.bytes.subarray(0, 8)],
    [...PNG_1X1.subarray(0, 8)],
  );

  const cancellation = await restarted.cancel({
    ...request,
    taskRef: receipt.taskRef!,
  });
  assert.equal(cancellation?.status, 'pending');
  assert.equal(cancellation?.errorCode, 'already_completed');
  assert.equal(calls.length, 2);
});

test('Ark Seedream derives per-image usage from the returned response when usage is omitted', async () => {
  let requests = 0;
  const fetchMock: typeof globalThis.fetch = async (_input, init) => {
    requests += 1;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.n, 2);
    return Response.json({
      created: 1_786_400_000,
      data: [
        { url: 'https://media.example.test/generated-a.jpg' },
        { url: 'https://media.example.test/generated-b.jpg' },
      ],
    });
  };
  const provider = adapter(fetchMock);
  const request = effectRequest('seedream-5-pro');
  request.submission.outputCount = 2;

  const receipt = await provider.submit(request);

  assert.equal(receipt.usageEvidenceKind, 'response_derived');
  assert.equal(receipt.providerCost.usage.mediaUnits, 2);
  assert.equal(receipt.providerCost.amount, 0.44);
  assert.equal(requests, 1);

  const terminal = await provider.poll({
    ...request,
    taskRef: receipt.taskRef!,
  });
  assert.equal(terminal.status, 'completed');
  assert.equal(terminal.usageEvidenceKind, 'response_derived');
  assert.equal(terminal.providerCost.usage.mediaUnits, 2);
  assert.equal(terminal.providerCost.amount, 0.44);
  assert.equal(requests, 1);
});

test('Ark preserves every requested image through receipt recovery and execution', async () => {
  const fetched: string[] = [];
  const fetchMock: typeof globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.n, 2);
    return Response.json({
      created: 1_786_400_000,
      data: [
        { url: 'https://media.example.test/generated-a.png' },
        { url: 'https://media.example.test/generated-b.png' },
      ],
      usage: { generated_images: 2 },
    });
  };
  const provider = adapter(fetchMock, {
    async get(target) {
      fetched.push(target);
      return {
        bytes: PNG_1X1,
        finalUrl: target,
        mimeType: 'image/png',
      };
    },
  });
  const request = effectRequest('seedream-5-pro');
  request.submission.outputCount = 2;

  const receipt = await provider.submit(request);
  const recovered = await provider.recover(request);
  assert.deepEqual(recovered, receipt);
  const result = await provider.execute(request);

  assert.equal(result.kind, 'completed');
  if (result.kind !== 'completed') return;
  assert.equal(result.assets?.length, 2);
  assert.deepEqual(fetched, [
    'https://media.example.test/generated-a.png',
    'https://media.example.test/generated-b.png',
  ]);
});

test('Ark Seedream still rejects an image response without a usable source URL', async () => {
  const provider = adapter(async () =>
    Response.json({
      data: [{ url: '' }],
    }),
  );

  const receipt = await provider.submit(effectRequest('seedream-5-pro'));

  assert.equal(receipt.acceptance, 'acceptance_unknown');
  assert.match(
    receipt.error ?? '',
    /returned no source URL/u,
  );
});

test('Ark Seedream still rejects an image response without returned images', async () => {
  const provider = adapter(async () => Response.json({ data: [] }));

  const receipt = await provider.submit(effectRequest('seedream-5-pro'));

  assert.equal(receipt.acceptance, 'acceptance_unknown');
  assert.match(receipt.error ?? '', /returned no source URL/u);
});

test('Ark Seedream sends resolved reference images through the official image field', async () => {
  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/images\/generations$/);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.deepEqual(body.image, [
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
    ]);
    return Response.json({
      created: 1_786_400_000,
      data: [{ url: 'https://media.example.test/edited.jpg' }],
      usage: { generated_images: 1 },
    });
  };
  const request = effectRequest('seedream-5-pro') as MediaProviderEffectRequest & {
    resolvedReferenceAssets: Array<{
      assetId: string;
      bytes: Uint8Array;
      contentType: string;
      providerReadableUrl: string;
      sha256: string;
    }>;
  };
  request.submission.operation = 'image.edit';
  request.submission.input = {
    inputAssets: [
      {
        assetId: 'asset-store-a',
        imageSlot: 'store_scene',
        nativeField: 'image',
        role: 'reference_image',
      },
    ],
  };
  request.resolvedInputAssets = [
    {
      assetId: 'asset-store-a',
      bytes: PNG_1X1,
      contentType: 'image/png',
      kind: 'resolved',
      providerReadableUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
      role: 'reference_image',
      sha256: 'sha256-store-a',
    },
  ];

  const receipt = await adapter(fetchMock).submit(request);
  assert.equal(receipt.acceptance, 'accepted');
});

test('Ark Seedance maps each authorized input role to its explicit provider field', async () => {
  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    assert.match(String(input), /\/contents\/generations\/tasks$/);
    const body = JSON.parse(String(init?.body)) as {
      content: Array<Record<string, unknown>>;
    };
    assert.deepEqual(body.content.slice(1), [
      {
        type: 'image_url',
        image_url: { url: 'https://media.example.test/reference.png' },
        role: 'reference_image',
      },
      {
        type: 'video_url',
        video_url: { url: 'https://media.example.test/reference.mp4' },
        role: 'reference_video',
      },
    ]);
    return Response.json({ id: 'cgt-role-mapping-1' });
  };
  const request = effectRequest('seedance-2');
  request.submission.input = {
    durationSeconds: 5,
    inputAssets: [
      { assetId: 'asset-image-a', role: 'reference_image' },
      { assetId: 'asset-video-a', role: 'reference_video' },
    ],
  };
  request.resolvedInputAssets = [
    {
      assetId: 'asset-image-a',
      bytes: PNG_1X1,
      contentType: 'image/png',
      kind: 'resolved',
      providerReadableUrl: 'https://media.example.test/reference.png',
      role: 'reference_image',
      sha256: 'sha256-image-a',
    },
    {
      assetId: 'asset-video-a',
      bytes: Buffer.from('video'),
      contentType: 'video/mp4',
      kind: 'resolved',
      providerReadableUrl: 'https://media.example.test/reference.mp4',
      role: 'reference_video',
      sha256: 'sha256-video-a',
    },
  ];

  const receipt = await adapter(fetchMock).submit(request);
  assert.equal(receipt.acceptance, 'accepted');
});

test('Ark Seedance supports async submit, poll, download and cancel with observed token cost', async () => {
  const requests: Array<{ method: string; url: string }> = [];
  let taskReads = 0;
  let taskCreates = 0;
  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ method, url });
    if (method === 'POST' && url.endsWith('/contents/generations/tasks')) {
      taskCreates += 1;
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        content: Array<{ type: string; text?: string }>;
        duration: number;
        resolution: string;
      };
      assert.equal(body.model, 'doubao-seedance-2-0-test');
      assert.equal(body.content[0]?.type, 'text');
      assert.equal(
        body.content[0]?.text,
        'seedance-2 recorded request --ratio 9:16'
      );
      assert.equal(body.duration, 5);
      assert.equal(body.resolution, '480p');
      return Response.json({
        id: taskCreates === 1 ? 'cgt-video-1' : 'cgt-cancel-1',
      });
    }
    if (
      method === 'GET' &&
      url.endsWith('/contents/generations/tasks/cgt-video-1')
    ) {
      taskReads += 1;
      return Response.json({
        content: { video_url: 'https://media.example.test/generated.mp4' },
        id: 'cgt-video-1',
        status: 'succeeded',
        updated_at: 1_786_400_000,
        usage: { completion_tokens: 200_000 },
      });
    }
    if (url === 'https://media.example.test/generated.mp4') {
      return new Response(Uint8Array.from([0, 0, 0, 20, 102, 116, 121, 112]), {
        headers: { 'content-type': 'video/mp4' },
      });
    }
    if (
      method === 'DELETE' &&
      url.endsWith('/contents/generations/tasks/cgt-cancel-1')
    ) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected ${method} ${url}`);
  };
  const provider = adapter(fetchMock);
  const request = effectRequest('seedance-2');
  const receipt = await provider.submit(request);
  assert.equal(receipt.acceptance, 'accepted');
  assert.equal(receipt.providerCost.amount, 1.4);
  assert.equal(receipt.providerCost.usage.outputTokens, 50_000);

  const restarted = adapter(fetchMock);
  const state = await restarted.poll({ ...request, taskRef: receipt.taskRef! });
  assert.equal(state.status, 'completed');
  assert.equal(state.providerCost.amount, 5.6);
  assert.equal(state.providerCost.usage.outputTokens, 200_000);
  const downloaded = await restarted.download({
    ...request,
    taskRef: receipt.taskRef!,
  });
  assert.equal(downloaded.contentType, 'video/mp4');
  assert.equal(downloaded.bytes.byteLength, 8);
  assert.equal(taskReads, 2, 'download re-reads task state after a process restart');

  const cancelRequest = effectRequest('seedance-2');
  cancelRequest.effectIdempotencyKey = 'effect-cancel';
  const cancelReceipt = await provider.submit(cancelRequest);
  const cancelled = await provider.cancel({
    ...cancelRequest,
    taskRef: cancelReceipt.taskRef!,
  });
  assert.equal(cancelled?.status, 'cancelled');
  assert.ok(
    requests.some(
      (candidate) =>
        candidate.method === 'DELETE' && candidate.url.includes('cgt-cancel-1'),
    ),
  );
});

test('Ark Seedance 1.5 Pro omits the duration rejected by the recorded Ark response', async () => {
  let requests = 0;
  const provider = adapter(
    async (_input, init) => {
      requests += 1;
      const body = JSON.parse(String(init?.body)) as { duration?: number };
      if (body.duration !== undefined) {
        return Response.json(
          {
            message:
              '{"error":{"code":"InvalidParameter","message":"The parameter `contents[0].***.duration` specified in the request is not valid: the specified duration is not supported for model doubao-seedance-1-5-pro.","param":"contents[0].***.duration","type":"BadRequest"}}',
            data: { code: 400 },
          },
          { status: 451 },
        );
      }
      return Response.json({ id: 'cgt-seedance-1-5-pro-1' });
    },
    undefined,
    'doubao-seedance-1-5-pro',
  );

  const receipt = await provider.submit(effectRequest('seedance-2'));

  assert.equal(receipt.acceptance, 'accepted', receipt.error);
  assert.equal(receipt.providerTaskId, 'cgt-seedance-1-5-pro-1');
  assert.equal(requests, 1);
});

test('Ark Seedance maps only model-supported resolution tiers before provider access', async () => {
  async function submittedResolution(
    width: number,
    height: number,
    videoModel = 'doubao-seedance-2-0-test',
  ) {
    let resolution: string | undefined;
    let fetchCalls = 0;
    const fetchMock: typeof globalThis.fetch = async (_input, init) => {
      fetchCalls += 1;
      const body = JSON.parse(String(init?.body)) as { resolution?: string };
      resolution = body.resolution;
      return Response.json({ id: `task-${width}-${height}` });
    };
    const request = effectRequest('seedance-2');
    request.submission.input = { durationSeconds: 4, width, height };
    const receipt = await adapter(
      fetchMock,
      assetFetchFrom(fetchMock),
      videoModel,
    ).submit(request);
    return { fetchCalls, receipt, resolution };
  }

  assert.equal((await submittedResolution(486, 864)).resolution, '480p');
  assert.equal((await submittedResolution(720, 1280)).resolution, '720p');
  assert.equal((await submittedResolution(1080, 1920)).resolution, '1080p');

  const unsupportedMini = await submittedResolution(
    1080,
    1920,
    'doubao-seedance-2-0-mini-260615',
  );
  assert.equal(unsupportedMini.fetchCalls, 0);
  assert.equal(unsupportedMini.receipt.acceptance, 'rejected_before_accept');
  assert.equal(unsupportedMini.receipt.errorCode, 'unsupported_resolution');

  const unsupported4k = await submittedResolution(2160, 3840);
  assert.equal(unsupported4k.fetchCalls, 0);
  assert.equal(unsupported4k.receipt.acceptance, 'rejected_before_accept');
  assert.equal(unsupported4k.receipt.errorCode, 'unsupported_resolution');
});

test('Ark lifecycle classifies explicit rejection, uncertain acceptance, provider failure and cold recovery safely', async () => {
  let scenario: 'http' | 'network' | 'failed' = 'http';
  const fetchMock: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (scenario === 'http') {
      return Response.json(
        { error: { code: 'QuotaExceeded', message: 'queue is full' } },
        { status: 429 },
      );
    }
    if (scenario === 'network') throw new Error('socket reset ark-test-secret');
    if (init?.method === 'POST') {
      return Response.json({ id: 'cgt-failed-1' });
    }
    if (init?.method === 'GET' && url.includes('/contents/generations/tasks/')) {
      return Response.json({
        error: {
          code: 'OutputVideoSensitiveContentDetected',
          message: 'blocked',
        },
        id: 'cgt-failed-1',
        status: 'failed',
        usage: { completion_tokens: 12_000 },
      });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const provider = adapter(fetchMock);
  const request = effectRequest('seedance-2');

  const rejected = await provider.submit(request);
  assert.equal(rejected.acceptance, 'rejected_before_accept');
  assert.equal(rejected.errorCode, 'rate_limit');
  assert.equal(rejected.retryable, true);

  scenario = 'network';
  const unknown = await provider.submit({
    ...request,
    effectIdempotencyKey: 'network-uncertain',
  });
  assert.equal(unknown.acceptance, 'acceptance_unknown');
  assert.equal(unknown.errorCode, 'network');
  assert.doesNotMatch(unknown.error ?? '', /ark-test-secret/);

  const coldProvider = adapter(fetchMock);
  const recovered = await coldProvider.recover({
    ...request,
    effectIdempotencyKey: 'lost-before-receipt',
  });
  assert.equal(recovered?.acceptance, 'acceptance_unknown');
  assert.equal(recovered?.taskRef, undefined);

  scenario = 'failed';
  const failedRequest = {
    ...request,
    effectIdempotencyKey: 'effect-failed',
  };
  const failedReceipt = await provider.submit(failedRequest);
  const failed = await provider.poll({
    ...failedRequest,
    taskRef: failedReceipt.taskRef!,
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCode, 'content_policy');
  assert.equal(failed.retryable, false);
});
