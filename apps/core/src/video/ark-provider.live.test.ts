import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ArkDirectVideoProvider } from './ark-provider.js';
import { detectMediaTools } from './media-tools.js';
import { probeVideoFile } from './validation.js';

const requiredEnvironment = [
  'VIDEO_PROVIDER_API_KEY',
  'VIDEO_PROVIDER_MODEL',
  'VIDEO_PROVIDER_COST_PER_SECOND_CNY',
] as const;
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
const tools = await detectMediaTools();
const liveSkip = process.env.RUN_LIVE_VIDEO_PROVIDER_TEST !== '1'
  ? 'RUN_LIVE_VIDEO_PROVIDER_TEST=1 is required because this test spends provider quota'
  : missingEnvironment.length > 0
    ? `missing live provider environment: ${missingEnvironment.join(', ')}`
    : tools.available
      ? false
      : tools.reason;

test('live Ark provider generates a playable Seedance clip', {
  skip: liveSkip,
  timeout: 20 * 60 * 1_000,
}, async (t) => {
  assert.ok(tools.available);
  const directory = await mkdtemp(join(tmpdir(), 'video-provider-live-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const costPerSecond = Number(process.env.VIDEO_PROVIDER_COST_PER_SECOND_CNY);
  assert.ok(Number.isFinite(costPerSecond));
  const provider = new ArkDirectVideoProvider({
    apiKey: process.env.VIDEO_PROVIDER_API_KEY ?? '',
    baseUrl: process.env.VIDEO_PROVIDER_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3',
    model: process.env.VIDEO_PROVIDER_MODEL ?? '',
    pollIntervalMs: 10_000,
    timeoutMs: 18 * 60 * 1_000,
    estimateCost: (request) => ({
      amount: request.durationSeconds * costPerSecond,
      currency: 'CNY',
      estimated: true,
    }),
  });
  const outputPath = join(directory, 'live.mp4');

  const result = await provider.generateClip({
    prompt: 'A calm close-up of neutral nail polish bottles on a clean studio table, no people, no text',
    durationSeconds: 3,
    aspectRatio: '9:16',
    correlationId: `live-${Date.now()}`,
    outputPath,
  });
  const file = await stat(outputPath);
  const probe = await probeVideoFile(outputPath, tools.ffprobePath);

  assert.ok(file.size > 0);
  assert.ok(probe.durationSeconds > 0);
  assert.ok(probe.streams.some((stream) => stream.codecType === 'video'));
  assert.equal(result.provider, 'volcengine-ark');
  assert.equal(result.model, process.env.VIDEO_PROVIDER_MODEL);
});
