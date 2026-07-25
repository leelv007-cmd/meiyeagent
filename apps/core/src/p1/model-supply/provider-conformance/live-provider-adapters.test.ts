import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  probeLiveProviderChannel,
  resolveLiveProviderChannels,
} from './live-provider-adapters.js';

const configuredEnv = {
  ARK_API_KEY: 'ark-key',
  ARK_PROVIDER_ACCOUNT_IDENTITY: 'ark-account',
  ARK_TEXT_MODEL: 'ark-text',
  ARK_TEXT_CATALOG_MODEL_ID: 'shared-text',
  ARK_TEXT_MAX_PROBE_COST_CNY: '0.02',
  ARK_TEXT_INPUT_COST_PER_MILLION: '1',
  ARK_TEXT_OUTPUT_COST_PER_MILLION: '2',
  MODEL_DIRECT_API_KEY: 'direct-key',
  MODEL_DIRECT_BASE_URL: 'https://direct.example.com/v1',
  MODEL_DIRECT_MODEL: 'direct-text',
  MODEL_DIRECT_CATALOG_MODEL_ID: 'shared-text',
  MODEL_DIRECT_PROVIDER_ACCOUNT_IDENTITY: 'direct-account',
  MODEL_DIRECT_MAX_PROBE_COST_CNY: '0.02',
  MODEL_DIRECT_INPUT_COST_PER_MILLION: '1',
  MODEL_DIRECT_OUTPUT_COST_PER_MILLION: '2',
  ARK_MEDIA_ASSET_SOURCE_HOSTS: 'ark.example.com',
  ARK_SEEDREAM_MODEL: 'ark-image',
  ARK_IMAGE_CATALOG_MODEL_ID: 'shared-image',
  ARK_IMAGE_MAX_PROBE_COST_CNY: '0.02',
  ARK_SEEDREAM_COST_PER_IMAGE_CNY: '0.2',
  ARK_SEEDANCE_MODEL: 'ark-video',
  ARK_VIDEO_CATALOG_MODEL_ID: 'shared-video',
  ARK_VIDEO_MAX_PROBE_COST_CNY: '0.02',
  ARK_SEEDANCE_COST_PER_MILLION_TOKENS_CNY: '1',
  ARK_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND: '100',
  TUZI_API_KEY: 'tuzi-key',
  TUZI_BASE_URL: 'https://tuzi.example.com/v1',
  TUZI_PROVIDER_ACCOUNT_IDENTITY: 'tuzi-account',
  TUZI_MEDIA_ASSET_SOURCE_HOSTS: 'tuzi.example.com',
  TUZI_GPT_IMAGE_2_MODEL: 'tuzi-image',
  TUZI_IMAGE_CATALOG_MODEL_ID: 'shared-image',
  TUZI_IMAGE_MAX_PROBE_COST_CNY: '0.02',
  TUZI_IMAGE_COST_PER_IMAGE_USD: '0.03',
  TUZI_SEEDANCE_MODEL: 'tuzi-video',
  TUZI_VIDEO_CATALOG_MODEL_ID: 'shared-video',
  TUZI_VIDEO_MAX_PROBE_COST_CNY: '0.02',
  TUZI_SEEDANCE_COST_PER_MILLION_TOKENS_USD: '1',
  TUZI_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND: '100',
} as const;

test('resolver reports missing credentials instead of creating configured channels', () => {
  const resolution = resolveLiveProviderChannels({});
  assert.equal(resolution.channels.length, 0);
  assert.equal(resolution.missingByChannel.length, 6);
});

test('resolver requires positive prices and does not infer catalog alignment from env ids', () => {
  const resolution = resolveLiveProviderChannels(configuredEnv);
  assert.equal(resolution.missingByChannel.length, 0);
  assert.equal(resolution.channels.length, 6);
  assert.equal(
    resolution.channels.filter(
      (channel) =>
        channel.model.catalogAlignment === 'channel_matrix_misaligned',
    ).length,
    4,
  );

  const missingPrice = resolveLiveProviderChannels({
    ...configuredEnv,
    ARK_TEXT_INPUT_COST_PER_MILLION: '0',
  });
  assert.ok(
    missingPrice.missingByChannel.some((entry) =>
      entry.missing.includes('ARK_TEXT_INPUT_COST_PER_MILLION'),
    ),
  );
});

test('resolver can require only the three official release channels', () => {
  const officialOnly = resolveLiveProviderChannels(configuredEnv, {
    channelKinds: ['official_direct'],
  });

  assert.deepEqual(officialOnly.missingByChannel, []);
  assert.equal(officialOnly.channels.length, 3);
  assert.ok(
    officialOnly.channels.every(
      (channel) => channel.model.channelKind === 'official_direct',
    ),
  );
});

test('real adapter evidence preserves an explicit deployment id', async () => {
  const channel = {
    ...resolveLiveProviderChannels(configuredEnv).channels[0]!,
    deploymentId: 'live-llm-official_direct-alt',
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response('{"error":{"message":"fixture rejection"}}', {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  try {
    const evidence = await probeLiveProviderChannel(channel);
    assert.equal(evidence.deploymentId, channel.deploymentId);
    assert.equal(
      evidence.providerModelSha256,
      createHash('sha256').update(channel.providerModel).digest('hex'),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('official text probe records a non-empty result hash without raw copy', async () => {
  const channel = resolveLiveProviderChannels(configuredEnv, {
    channelKinds: ['official_direct'],
  }).channels.find((candidate) => candidate.model.modality === 'llm');
  assert.ok(channel);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'provider-text-task-1',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: JSON.stringify({
                candidates: [
                  { title: 'A', body: 'A body', conversionHook: 'A hook' },
                ],
              }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 30 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  try {
    const evidence = await probeLiveProviderChannel(channel);
    assert.equal(evidence.providerCallSucceeded, true);
    assert.ok((evidence.lifecycle.resultBytes ?? 0) > 0);
    assert.match(evidence.lifecycle.resultSha256 ?? '', /^[a-f0-9]{64}$/u);
    assert.doesNotMatch(JSON.stringify(evidence), /A body/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
