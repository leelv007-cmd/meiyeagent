import assert from 'node:assert/strict';
import test from 'node:test';
import {
  creativeExecutionContractSchema,
  productAssetMediaTypes,
  productCommandSchema,
} from '@meiye/contracts';
import { USAGE_RESOURCES } from '../foundation/domain.js';
import {
  AUDIO_ASSET_FORMATS,
  MODEL_MODALITIES,
  MODEL_OPERATIONS,
  MemoryModelAssetStorage,
  ModelSupplyApplicationService,
  OWNED_ASSET_CONTENT_TYPES,
  RecordedAdapterRouter,
  recordedRequest,
} from './index.js';
import {
  createDefaultCatalogModels,
  createDefaultDeployments,
} from './catalog.js';
import { MediaActivationProbeExecutor } from './activation-probe-executor.js';

test('audio is reserved across model, operation, usage, asset, and MIME contracts', () => {
  assert.ok(MODEL_MODALITIES.includes('audio'));
  assert.ok(MODEL_OPERATIONS.includes('audio.speech'));
  assert.ok(MODEL_OPERATIONS.includes('audio.sfx'));
  assert.ok(USAGE_RESOURCES.includes('audio'));
  assert.ok(productAssetMediaTypes.includes('audio'));
  const addAudioAsset = productCommandSchema.parse({
    asset: {
      authorizationStatus: 'authorized',
      consentScope: 'public_marketing',
      containsPerson: false,
      containsSensitiveData: false,
      id: 'audio-asset-a',
      mediaType: 'audio',
      minorStatus: 'none',
      objectKey: 'workspace-a/audio/audio-asset-a.mp3',
      rightsOwner: 'workspace-a',
      sourceType: 'ai_generated',
      tags: ['tts'],
    },
    type: 'add_asset',
  });
  assert.ok(addAudioAsset.type === 'add_asset');
  assert.equal(addAudioAsset.asset.mediaType, 'audio');
  assert.equal(
    creativeExecutionContractSchema.shape.operation.parse('audio.speech'),
    'audio.speech'
  );
  assert.equal(
    creativeExecutionContractSchema.shape.operation.parse('audio.sfx'),
    'audio.sfx'
  );
  assert.deepEqual(
    AUDIO_ASSET_FORMATS.map(({ codec, container, contentType }) => ({
      codec,
      container,
      contentType,
    })),
    [
      { codec: 'mp3', container: 'mp3', contentType: 'audio/mpeg' },
      { codec: 'pcm_s16le', container: 'wav', contentType: 'audio/wav' },
      { codec: 'opus', container: 'ogg', contentType: 'audio/ogg' },
      { codec: 'aac', container: 'mp4', contentType: 'audio/mp4' },
    ]
  );
  for (const { contentType } of AUDIO_ASSET_FORMATS) {
    assert.ok(OWNED_ASSET_CONTENT_TYPES.includes(contentType));
  }
});

test('audio fixture catalog is inactive by default and exposes independent speech and SFX capabilities', () => {
  const models = createDefaultCatalogModels();
  const documented = createDefaultDeployments();
  const speech = models.find((model) => model.id === 'audio-speech-fixture');
  const sfx = models.find((model) => model.id === 'audio-sfx-fixture');
  assert.deepEqual(speech?.operations, ['audio.speech']);
  assert.deepEqual(sfx?.operations, ['audio.sfx']);
  assert.equal(
    documented.find(
      (deployment) => deployment.id === 'audio-speech-fixture-recorded',
    )?.status,
    'inactive',
  );
  assert.equal(
    documented.find(
      (deployment) => deployment.id === 'audio-sfx-fixture-recorded',
    )?.status,
    'inactive',
  );

  // Recorded-only activation must not open audio fixtures.
  const recordedOnly = createDefaultDeployments({
    activatedDeploymentIds: [
      'audio-speech-fixture-recorded',
      'audio-sfx-fixture-recorded',
    ],
    activationEvidenceStatus: 'recorded',
  });
  assert.ok(
    recordedOnly
      .filter((deployment) => deployment.catalogModelId.startsWith('audio-'))
      .every((deployment) => deployment.status === 'inactive'),
  );

  const fixtures = createDefaultDeployments({
    activatedDeploymentIds: [
      'audio-speech-fixture-recorded',
      'audio-sfx-fixture-recorded',
    ],
    activationEvidenceByDeploymentId: {
      'audio-speech-fixture-recorded': {
        configurationRevision: 'c'.repeat(64),
        evidenceRef: `activation-probe-${'c'.repeat(24)}`,
        status: 'live_verified',
        verifiedAt: '2026-07-16T08:00:00.000Z',
      },
      'audio-sfx-fixture-recorded': {
        configurationRevision: 'd'.repeat(64),
        evidenceRef: `activation-probe-${'d'.repeat(24)}`,
        status: 'live_verified',
        verifiedAt: '2026-07-16T08:00:00.000Z',
      },
    },
  });
  assert.deepEqual(
    fixtures
      .filter((deployment) => deployment.catalogModelId.startsWith('audio-'))
      .flatMap((deployment) =>
        deployment.canvasGenerationCapabilities ?? [],
      )
      .map((capability) => capability.operation)
      .sort(),
    ['audio.sfx', 'audio.speech'],
  );
  assert.ok(
    fixtures
      .filter((deployment) => deployment.catalogModelId.startsWith('audio-'))
      .every((deployment) => deployment.status === 'active'),
  );
});

test('real Volcengine speech catalog remains unavailable without approved pricing and activation evidence', () => {
  const models = createDefaultCatalogModels();
  const deployments = createDefaultDeployments();
  const speech = models.find((model) => model.id === 'seed-tts-2');
  const deployment = deployments.find(
    (candidate) => candidate.id === 'seed-tts-2-volcengine-direct',
  );

  assert.deepEqual(speech, {
    capabilities: ['audio.speech'],
    creditPricing: {
      'audio.speech': {
        creditCost: 2,
        failureRefundsCredits: true,
      },
    },
    displayName: 'Doubao Speech Synthesis 2.0',
    id: 'seed-tts-2',
    manufacturer: 'ByteDance',
    modality: 'audio',
    operations: ['audio.speech'],
    qualityRank: 90,
    stableModelName: 'seed-tts-2.0-standard',
    version: 'bidirectional-v3',
  });
  assert.equal(deployment?.status, 'inactive');
  assert.equal(deployment?.priceRevision, 'seed-tts-2:price-unavailable');
  assert.equal(deployment?.unitPrice, undefined);
  assert.deepEqual(deployment?.canvasGenerationCapabilities, [
    {
      inputAssetRoles: ['reference_audio'],
      operation: 'audio.speech',
      parameters: [
        'format',
        'language',
        'maxDurationSeconds',
        'speed',
        'tone',
        'voice',
      ],
    },
  ]);
});

test('recorded audio lifecycle downloads valid audio through the production activation seam', async () => {
  const models = createDefaultCatalogModels();
  const deployments = createDefaultDeployments();
  const provider = new RecordedAdapterRouter();
  const probe = new MediaActivationProbeExecutor(
    provider,
    { deployments, models },
    { pollIntervalMs: 0, sleep: async () => {} },
  );

  for (const input of [
    {
      catalogModelId: 'audio-speech-fixture',
      deploymentId: 'audio-speech-fixture-recorded',
      operation: 'audio.speech' as const,
    },
    {
      catalogModelId: 'audio-sfx-fixture',
      deploymentId: 'audio-sfx-fixture-recorded',
      operation: 'audio.sfx' as const,
    },
  ]) {
    const result = await probe.execute({
      actorId: 'admin-a',
      correlationId: `probe-${input.operation}`,
      idempotencyKey: `probe-${input.operation}`,
      workspaceId: 'workspace-a',
      ...input,
    });
    assert.equal(result.outputDigestSource.contentType, 'audio/wav');
    assert.ok(result.outputDigestSource.sizeBytes > 44);
    assert.equal(result.providerCost.status, 'observed');
  }

  const routedSpeech = recordedRequest(
    'audio-speech-fixture',
    'audio.speech',
    {
      format: 'wav',
      inputAssets: [],
      language: 'zh-CN',
      maxDurationSeconds: 30,
      referenceAssetIds: [],
      speed: 1,
      tone: 'natural',
      voice: 'default',
    },
  );
  assert.equal(routedSpeech.model.modality, 'audio');
  assert.equal(routedSpeech.deployment.apiFamily, 'audio');
  assert.equal(
    (
      await provider.submit({
        ...routedSpeech,
        effectIdempotencyKey: 'audio-routing-metadata',
      })
    ).acceptance,
    'accepted',
  );
});

test('audio submissions enter the durable media runtime instead of one-shot execution', async () => {
  const models = new ModelSupplyApplicationService({
    assetStorage: new MemoryModelAssetStorage(),
    deployments: createDefaultDeployments({
      activatedDeploymentIds: [
        'audio-speech-fixture-recorded',
        'audio-sfx-fixture-recorded',
      ],
      activationEvidenceByDeploymentId: {
        'audio-speech-fixture-recorded': {
          configurationRevision: 'c'.repeat(64),
          evidenceRef: `activation-probe-${'c'.repeat(24)}`,
          status: 'live_verified',
          verifiedAt: '2026-07-16T08:00:00.000Z',
        },
        'audio-sfx-fixture-recorded': {
          configurationRevision: 'd'.repeat(64),
          evidenceRef: `activation-probe-${'d'.repeat(24)}`,
          status: 'live_verified',
          verifiedAt: '2026-07-16T08:00:00.000Z',
        },
      },
    }),
    execution: new RecordedAdapterRouter(),
    models: createDefaultCatalogModels(),
  });
  const routed: string[] = [];
  models.attachDurableMediaRuntime({
    async submit(submission) {
      routed.push(submission.operation);
      return models.previewMediaSubmission(submission);
    },
    async get() {
      throw new Error('not used');
    },
    async cancel() {
      throw new Error('not used');
    },
    async reconcileCancelledProviderTerminal() {
      throw new Error('not used');
    },
  });

  await models.submit({
    actorId: 'owner-a',
    dataClass: [],
    idempotencyKey: 'speech-durable-a',
    input: {
      format: 'wav',
      language: 'zh-CN',
      maxDurationSeconds: 30,
      speed: 1,
      tone: 'natural',
      voice: 'default',
    },
    operation: 'audio.speech',
    prompt: '欢迎体验。',
    selection: { catalogModelId: 'audio-speech-fixture', mode: 'fixed' },
    workspaceId: 'workspace-a',
  });
  await models.submit({
    actorId: 'owner-a',
    dataClass: [],
    idempotencyKey: 'sfx-durable-a',
    input: { durationSeconds: 3, format: 'wav' },
    operation: 'audio.sfx',
    prompt: 'A soft spa chime.',
    selection: { catalogModelId: 'audio-sfx-fixture', mode: 'fixed' },
    workspaceId: 'workspace-a',
  });
  assert.deepEqual(routed, ['audio.speech', 'audio.sfx']);
});
