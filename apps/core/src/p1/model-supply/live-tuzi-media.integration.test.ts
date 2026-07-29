import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { assertIssue255LiveModesMutuallyExclusive } from '../harness/issue-255-live-collector-cli.js';
import { ProviderSafeFetch } from './reference-asset-delivery.js';
import { MediaActivationProbeExecutor } from './activation-probe-executor.js';
import { recordedRequest } from './adapters.js';
import {
  createDefaultCatalogModels,
  createDefaultDeployments,
} from './catalog.js';
import { TuziMediaExecutionPort } from './tuzi-media-adapter.js';

assertIssue255LiveModesMutuallyExclusive(process.env);
const enabled = process.env.RUN_LIVE_TUZI_MEDIA_TEST === '1';
const cancellationEnabled =
  process.env.RUN_LIVE_TUZI_CANCELLATION_TEST === '1';
const requiredNames = [
  'TUZI_MEDIA_API_KEY',
  'TUZI_MEDIA_BASE_URL',
  'TUZI_MEDIA_ASSET_SOURCE_HOSTS',
  'TUZI_GPT_IMAGE_2_MODEL',
  'TUZI_SEEDANCE_MODEL',
] as const;
const missing = requiredNames.filter((name) => !process.env[name]?.trim());

function required(name: (typeof requiredNames)[number]) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live Tuzi test.`);
  return value;
}

async function resolveThroughPublicDoh(hostname: string) {
  const url = new URL('https://cloudflare-dns.com/dns-query');
  url.searchParams.set('name', hostname);
  url.searchParams.set('type', 'A');
  const response = await fetch(url, {
    headers: { accept: 'application/dns-json' },
  });
  if (!response.ok)
    throw new Error(`Public DNS returned HTTP ${response.status}.`);
  const body = (await response.json()) as {
    Answer?: Array<{ data?: unknown; type?: unknown }>;
    Status?: unknown;
  };
  if (body.Status !== 0)
    throw new Error('Public DNS did not resolve the provider host.');
  return (body.Answer ?? []).flatMap((answer) =>
    answer.type === 1 && typeof answer.data === 'string' ? [answer.data] : []
  );
}

function createLiveTuziAdapter() {
  const baseUrl = required('TUZI_MEDIA_BASE_URL');
  const videoModel = required('TUZI_SEEDANCE_MODEL');
  assert.match(
    videoModel,
    /(?:^|[^a-z0-9])seedance[-_.]?1[-_.]?5(?:[-_.]|$)/i,
    'The live Tuzi test only accepts the verified Seedance 1.5 provider model.',
  );
  const assetSourceHosts = required('TUZI_MEDIA_ASSET_SOURCE_HOSTS')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  return new TuziMediaExecutionPort({
    apiKey: required('TUZI_MEDIA_API_KEY'),
    assetFetch: new ProviderSafeFetch({
      allowedHosts: [new URL(baseUrl).hostname, ...assetSourceHosts],
      resolver: { resolve: resolveThroughPublicDoh },
    }),
    assetSourceHosts,
    baseUrl,
    credentialVersion: 'live-tuzi-key',
    endpointRevision: 'tuzi-openai-media-v1',
    image: {
      catalogModelId: 'gpt-image-2',
      costPerImage: 0,
      model: required('TUZI_GPT_IMAGE_2_MODEL'),
    },
    sourceUrlTtlSeconds: 3600,
    video: {
      catalogModelId: 'seedance-1-5-pro',
      costPerMillionTokens: 0,
      estimatedTokensPerSecond: 0,
      model: videoModel,
    },
  });
}

test(
  'live Tuzi adapter generates and downloads a real image and video',
  {
    skip: !enabled
      ? 'Set RUN_LIVE_TUZI_MEDIA_TEST=1 to opt in.'
      : missing.length > 0
        ? `Missing live Tuzi variables: ${missing.join(', ')}`
        : false,
    timeout: 15 * 60_000,
  },
  async () => {
    const adapter = createLiveTuziAdapter();
    const imageRequest = {
      ...recordedRequest('gpt-image-2', 'image.generate'),
      effectIdempotencyKey: `live-tuzi-image-${Date.now()}`,
    };
    imageRequest.submission.prompt =
      'A clean editorial still life of a white skincare bottle on warm beige stone, soft daylight, no text, no logo.';
    const imageReceipt = await adapter.submit(imageRequest);
    assert.equal(imageReceipt.acceptance, 'accepted');
    assert.ok(imageReceipt.taskRef);
    const image = await adapter.download({
      ...imageRequest,
      taskRef: imageReceipt.taskRef,
    });
    assert.equal(image.contentType, 'image/png');
    assert.ok(image.bytes.byteLength > 0);

    const videoRequest = {
      ...recordedRequest('seedance-1-5-pro', 'video.generate', {
        durationSeconds: 5,
      }),
      effectIdempotencyKey: `live-tuzi-video-${Date.now()}`,
    };
    videoRequest.submission.prompt =
      'A cinematic product shot of a white skincare bottle on beige stone, slow camera push in, soft daylight, no text.';
    const videoReceipt = await adapter.submit(videoRequest);
    assert.equal(videoReceipt.acceptance, 'accepted');
    assert.ok(videoReceipt.taskRef);
    let videoStatus = await adapter.poll({
      ...videoRequest,
      taskRef: videoReceipt.taskRef,
    });
    for (
      let attempt = 0;
      attempt < 90 && videoStatus.status !== 'completed';
      attempt += 1
    ) {
      assert.notEqual(videoStatus.status, 'failed');
      await delay(10_000);
      videoStatus = await adapter.poll({
        ...videoRequest,
        taskRef: videoReceipt.taskRef,
      });
    }
    assert.equal(videoStatus.status, 'completed');
    const video = await adapter.download({
      ...videoRequest,
      taskRef: videoReceipt.taskRef,
    });
    assert.equal(video.contentType, 'video/mp4');
    assert.ok(video.bytes.byteLength > 0);
    const evidenceDir = process.env.TUZI_LIVE_EVIDENCE_DIR?.trim();
    if (evidenceDir) {
      await mkdir(evidenceDir, { recursive: true });
      await Promise.all([
        writeFile(join(evidenceDir, 'tuzi-image.png'), image.bytes),
        writeFile(join(evidenceDir, 'tuzi-video.mp4'), video.bytes),
      ]);
    }
    console.log(
      JSON.stringify({
        imageBytes: image.bytes.byteLength,
        imageSha256: createHash('sha256').update(image.bytes).digest('hex'),
        videoBytes: video.bytes.byteLength,
        videoSha256: createHash('sha256').update(video.bytes).digest('hex'),
      })
    );
  }
);

test(
  'live Tuzi cancellation reaches a confirmed provider terminal',
  {
    skip: !cancellationEnabled
      ? 'Set RUN_LIVE_TUZI_CANCELLATION_TEST=1 to opt in.'
      : missing.length > 0
        ? `Missing live Tuzi variables: ${missing.join(', ')}`
        : false,
    timeout: 5 * 60_000,
  },
  async () => {
    const cancellationId = `ticket-21-cancel-${Date.now()}`;
    const cancellation = await new MediaActivationProbeExecutor(
      createLiveTuziAdapter(),
      {
        deployments: createDefaultDeployments(),
        models: createDefaultCatalogModels(),
      }
    ).executeCancellation({
      actorId: 'ticket-21-live-canary',
      catalogModelId: 'seedance-1-5-pro',
      correlationId: cancellationId,
      deploymentId: 'seedance-1-5-pro-tuzi-relay',
      idempotencyKey: cancellationId,
      operation: 'video.generate',
      workspaceId: 'ticket-21-live-canary',
    });
    assert.equal(cancellation.status, 'cancelled');
    assert.equal(cancellation.providerCost.status, 'observed');
  }
);
