import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { detectMediaTools } from '../../video/media-tools.js';
import { probeVideoFile } from '../../video/validation.js';
import { recordedRequest } from './adapters.js';
import { ArkMediaExecutionPort } from './ark-media-adapter.js';

const requiredEnvironment = [
  'ARK_MEDIA_API_KEY',
  'ARK_MEDIA_ASSET_SOURCE_HOSTS',
  'ARK_MEDIA_CREDENTIAL_VERSION',
  'ARK_MEDIA_ENDPOINT_REVISION',
  'ARK_MEDIA_SOURCE_URL_TTL_SECONDS',
  'ARK_SEEDANCE_COST_PER_MILLION_TOKENS_CNY',
  'ARK_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND',
  'ARK_SEEDANCE_MODEL',
] as const;
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
const tools = await detectMediaTools();
const liveSkip = process.env.RUN_LIVE_ARK_MEDIA_TEST !== '1'
  ? 'RUN_LIVE_ARK_MEDIA_TEST=1 is required because this test spends provider quota'
  : missingEnvironment.length > 0
    ? `missing live Ark environment: ${missingEnvironment.join(', ')}`
    : tools.available
      ? false
      : tools.reason;

function required(name: (typeof requiredEnvironment)[number]) {
  return process.env[name] ?? '';
}

function nonNegative(name: (typeof requiredEnvironment)[number]) {
  const value = Number(required(name));
  assert.ok(Number.isFinite(value) && value >= 0, `${name} must be non-negative`);
  return value;
}

test('live Ark lifecycle generates and downloads a playable Seedance clip', {
  skip: liveSkip,
  timeout: 20 * 60 * 1_000,
}, async (t) => {
  assert.ok(tools.available);
  const directory = await mkdtemp(join(tmpdir(), 'ark-media-live-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const provider = new ArkMediaExecutionPort({
    apiKey: required('ARK_MEDIA_API_KEY'),
    assetSourceHosts: required('ARK_MEDIA_ASSET_SOURCE_HOSTS')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
    baseUrl: process.env.ARK_MEDIA_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3',
    credentialVersion: required('ARK_MEDIA_CREDENTIAL_VERSION'),
    endpointRevision: required('ARK_MEDIA_ENDPOINT_REVISION'),
    image: {
      catalogModelId: 'seedream-5-pro',
      costPerImage: 0,
      model: 'unused-by-video-live-test',
    },
    sourceUrlTtlSeconds: Number(required('ARK_MEDIA_SOURCE_URL_TTL_SECONDS')),
    video: {
      catalogModelId: 'seedance-2',
      costPerMillionTokens: nonNegative('ARK_SEEDANCE_COST_PER_MILLION_TOKENS_CNY'),
      estimatedTokensPerSecond: nonNegative('ARK_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND'),
      model: required('ARK_SEEDANCE_MODEL'),
    },
  });
  const request = {
    ...recordedRequest('seedance-2', 'video.generate', {
      durationSeconds: 3,
      height: 1280,
      width: 720,
    }),
    effectIdempotencyKey: `live-ark-seedance-${Date.now()}`,
  };
  request.submission.prompt =
    'A calm close-up of neutral nail polish bottles on a clean studio table, no people, no text';

  const receipt = await provider.submit(request);
  assert.equal(receipt.acceptance, 'accepted');
  assert.ok(receipt.taskRef);

  let state = await provider.poll({ ...request, taskRef: receipt.taskRef });
  const deadline = Date.now() + 18 * 60 * 1_000;
  while ((state.status === 'queued' || state.status === 'running') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    state = await provider.poll({ ...request, taskRef: receipt.taskRef });
  }
  assert.equal(state.status, 'completed');
  assert.equal(state.providerCost.currency, 'CNY');
  assert.ok(state.providerCost.amount >= 0);

  const downloaded = await provider.download({
    ...request,
    taskRef: receipt.taskRef,
  });
  const outputPath = join(directory, 'live.mp4');
  await writeFile(outputPath, downloaded.bytes);
  const file = await stat(outputPath);
  const probe = await probeVideoFile(outputPath, tools.ffprobePath);

  assert.equal(downloaded.contentType, 'video/mp4');
  assert.ok(file.size > 0);
  assert.ok(probe.durationSeconds > 0);
  assert.ok(probe.streams.some((stream) => stream.codecType === 'video'));
});
