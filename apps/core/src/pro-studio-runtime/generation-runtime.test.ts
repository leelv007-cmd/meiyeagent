import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CanvasGenerationApplicationService,
  createInactiveAudioCatalogEntries,
  MemoryCanvasGenerationCatalog,
  MemoryCanvasGenerationRepository,
  type CanvasGeneratedAsset,
  type CanvasGenerationOperation,
  type CanvasGenerationProviderPort,
  type CanvasMediaDeliveryInput,
  type CanvasMediaPersistencePort,
} from './generation-runtime.js';

const owner = {
  userId: 'owner-1',
  workspaceId: 'workspace-1',
  correlationId: 'correlation-1',
};

class RecordedProvider implements CanvasGenerationProviderPort {
  readonly submissions: Array<{ jobId: string; operation: CanvasGenerationOperation }> = [];
  readonly cancellations: string[] = [];
  next: 'accepted' | 'rejected' = 'accepted';

  async submit(input: { jobId: string; operation: CanvasGenerationOperation }) {
    this.submissions.push(input);
    return this.next === 'accepted'
      ? {
          status: 'accepted' as const,
          providerTaskId: `provider-${input.jobId}`,
        }
      : { status: 'rejected' as const, reason: 'provider rejected before acceptance' };
  }

  async cancel(input: { jobId: string }) {
    this.cancellations.push(input.jobId);
    return { status: 'cancelled' as const };
  }
}

class RecordedAssets implements CanvasMediaPersistencePort {
  readonly inputs: CanvasMediaDeliveryInput[] = [];
  readonly quarantined: CanvasMediaDeliveryInput[] = [];
  failNext = false;
  persistBarrier?: Promise<void>;

  async persist(input: CanvasMediaDeliveryInput): Promise<CanvasGeneratedAsset> {
    this.inputs.push(input);
    await this.persistBarrier;
    if (this.failNext) {
      this.failNext = false;
      throw new Error('download unavailable');
    }
    return {
      id: `asset-${input.jobId}`,
      workspaceId: input.workspaceId,
      mediaType: input.mediaType,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      custody: 'owned',
    };
  }

  async persistQuarantined(input: CanvasMediaDeliveryInput) {
    this.quarantined.push(input);
    return this.persist(input);
  }
}

function runtime() {
  const repository = new MemoryCanvasGenerationRepository();
  const provider = new RecordedProvider();
  const assets = new RecordedAssets();
  const catalog = new MemoryCanvasGenerationCatalog(
    [
      {
      operation: 'image.generate',
      modelId: 'image-model-1',
      activation: 'active',
      usageResource: 'image',
      usageAmount: 1,
      estimatedDurationSeconds: [10, 30],
      allowedParameters: ['ratio', 'resolution'],
      output: 'image',
    },
    {
      operation: 'image.edit',
      modelId: 'image-model-1',
      activation: 'active',
      usageResource: 'image',
      usageAmount: 1,
      estimatedDurationSeconds: [10, 30],
      allowedParameters: [],
      output: 'image',
    },
    {
      operation: 'text.respond',
      modelId: 'llm-model-1',
      activation: 'active',
      usageResource: 'copy',
      usageAmount: 1,
      estimatedDurationSeconds: [2, 10],
      allowedParameters: [],
      output: 'text',
    },
    {
      operation: 'video.generate',
      modelId: 'video-model-1',
      activation: 'active',
      usageResource: 'video',
      usageAmount: 2,
      estimatedDurationSeconds: [60, 180],
      allowedParameters: [
        'ratio',
        'resolution',
        'referenceAssetIds',
        'generateAudio',
        'watermark',
      ],
      output: 'video',
    },
      ...createInactiveAudioCatalogEntries(),
    ],
    {
      verify: async (input) =>
        input.operation === 'audio.speech' &&
        input.modelId === 'test-speech-model' &&
        input.activationEvidence.evidenceId ===
          `activation-probe-${'b'.repeat(28)}`,
    },
  );
  const service = new CanvasGenerationApplicationService(repository, {
    catalog,
    provider,
    assets,
    projectAccess: {
      assertRevision: async ({ workspaceId, projectId, revisionId }) => {
        if (
          workspaceId !== owner.workspaceId ||
          projectId !== 'project-1' ||
          revisionId !== 'revision-1'
        ) {
          throw new Error('project not found');
        }
      },
    },
    assetAccess: {
      assertOwned: async ({ workspaceId, assetId }) => {
        if (workspaceId !== owner.workspaceId || assetId.startsWith('foreign-')) {
          throw new Error('asset not found');
        }
      },
    },
    entitlement: { assertCanGenerate: async () => undefined },
    clock: () => new Date('2026-07-16T10:00:00.000Z'),
  });
  return { service, repository, provider, assets, catalog };
}

test('audio catalog entries stay providerless and cannot self-activate before a live probe', async () => {
  assert.deepEqual(createInactiveAudioCatalogEntries(), [
    {
      activation: 'inactive',
      allowedParameters: [
        'voice',
        'language',
        'speed',
        'tone',
        'format',
        'maxDurationSeconds',
      ],
      estimatedDurationSeconds: [5, 20],
      modelId: null,
      operation: 'audio.speech',
      output: 'audio',
      usageAmount: 0,
      usageResource: 'audio',
    },
    {
      activation: 'inactive',
      allowedParameters: ['durationSeconds', 'format'],
      estimatedDurationSeconds: [5, 20],
      modelId: null,
      operation: 'audio.sfx',
      output: 'audio',
      usageAmount: 0,
      usageResource: 'audio',
    },
  ]);
  const catalog = new MemoryCanvasGenerationCatalog(
    createInactiveAudioCatalogEntries(),
  );
  await assert.rejects(
    catalog.activate('audio.speech', {
      activationEvidence: {
        configurationRevision: 'a'.repeat(64),
        evidenceId: `activation-probe-${'b'.repeat(28)}`,
        probedAt: '2026-07-16T09:00:00.000Z',
        status: 'live_verified',
      },
      modelId: 'untrusted-model-claim',
      usageAmount: 1,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'ACTIVATION_AUTHORIZER_UNAVAILABLE',
  );
  assert.equal((await catalog.resolve('audio.speech'))?.activation, 'inactive');
});

test('submit persists job, reservation, attempt and outbox before provider dispatch', async () => {
  const { service, repository, provider } = runtime();
  const input = {
    projectId: 'project-1',
    revisionId: 'revision-1',
    operation: 'image.generate' as const,
    prompt: '生成一张奶油白猫眼美甲图',
    parameters: { ratio: '3:4', resolution: '1024x1365' },
    inputAssetIds: [],
    idempotencyKey: 'generation-1',
  };

  const quote = await service.quote(owner, input);
  assert.deepEqual(quote.usage, { resource: 'image', amount: 1 });
  const job = await service.submit(owner, { ...input, quoteId: quote.id });
  assert.equal(provider.submissions.length, 0);
  assert.equal(job.status, 'queued');
  assert.deepEqual(job.origin, {
    kind: 'advanced_canvas',
    projectId: 'project-1',
    revisionId: 'revision-1',
  });
  const state = repository.snapshot(owner.workspaceId);
  assert.equal(state.jobs.length, 1);
  assert.deepEqual(state.jobs[0]?.origin, {
    kind: 'advanced_canvas',
    projectId: 'project-1',
    revisionId: 'revision-1',
  });
  assert.equal(state.reservations[0]?.status, 'reserved');
  assert.equal(state.attempts.length, 1);
  assert.equal(state.outbox.length, 1);

  const replay = await service.submit(owner, { ...input, quoteId: quote.id });
  assert.equal(replay.id, job.id);
  assert.equal(repository.snapshot(owner.workspaceId).jobs.length, 1);
  assert.equal((await service.listProjectGenerations(owner, 'project-1')).length, 1);

  await service.dispatch(owner, job.id);
  assert.equal(provider.submissions.length, 1);
  assert.equal((await service.getJob(owner, job.id)).status, 'accepted');
  assert.equal(
    (await service.getUsageProjection(owner)).reserved.image,
    1,
  );
});

test('legacy advanced-canvas origins are normalized only when read', async () => {
  const { service, repository } = runtime();
  await repository.transact(owner.workspaceId, (state) => {
    state.jobs.push({
      id: 'legacy-generation-1',
      workspaceId: owner.workspaceId,
      origin: {
        kind: 'advanced_canvas',
        id: 'legacy-project-1',
        revisionId: 'legacy-revision-1',
      },
      operation: 'image.generate',
      modelId: 'image-model-1',
      prompt: 'legacy',
      parameters: {},
      inputAssetIds: [],
      idempotencyKey: 'legacy-generation-key',
      quoteId: 'legacy-quote-1',
      status: 'completed',
      outputAssetId: 'legacy-asset-1',
      createdAt: '2026-07-16T10:00:00.000Z',
      updatedAt: '2026-07-16T10:00:00.000Z',
    });
  });

  assert.deepEqual(await service.getJob(owner, 'legacy-generation-1'), {
    id: 'legacy-generation-1',
    workspaceId: owner.workspaceId,
    origin: {
      kind: 'advanced_canvas',
      projectId: 'legacy-project-1',
      revisionId: 'legacy-revision-1',
    },
    operation: 'image.generate',
    modelId: 'image-model-1',
    prompt: 'legacy',
    parameters: {},
    inputAssetIds: [],
    idempotencyKey: 'legacy-generation-key',
    quoteId: 'legacy-quote-1',
    status: 'completed',
    outputAssetId: 'legacy-asset-1',
    createdAt: '2026-07-16T10:00:00.000Z',
    updatedAt: '2026-07-16T10:00:00.000Z',
  });
  assert.equal((await service.listProjectGenerations(owner, 'legacy-project-1')).length, 1);
  assert.deepEqual(repository.snapshot(owner.workspaceId).jobs[0]?.origin, {
    kind: 'advanced_canvas',
    id: 'legacy-project-1',
    revisionId: 'legacy-revision-1',
  });
});

test('submit rejects when the workspace concurrency slot is full', async () => {
  const repository = new MemoryCanvasGenerationRepository();
  const provider = new RecordedProvider();
  const assets = new RecordedAssets();
  const catalog = new MemoryCanvasGenerationCatalog([
    {
      activation: 'active',
      allowedParameters: ['ratio', 'resolution'],
      estimatedDurationSeconds: [5, 20],
      modelId: 'image-model-1',
      operation: 'image.generate',
      output: 'image',
      usageAmount: 1,
      usageResource: 'image',
    },
  ]);
  const service = new CanvasGenerationApplicationService(repository, {
    catalog,
    provider,
    assets,
    concurrencyLimit: 1,
    projectAccess: {
      async assertRevision() {},
    },
    assetAccess: {
      async assertOwned() {},
    },
    entitlement: {
      async assertCanGenerate() {},
    },
  });

  const first = {
    projectId: 'project-1',
    revisionId: 'revision-1',
    operation: 'image.generate' as const,
    prompt: '第一张',
    parameters: {},
    inputAssetIds: [],
    idempotencyKey: 'slot-1',
  };
  const second = {
    ...first,
    prompt: '第二张',
    idempotencyKey: 'slot-2',
  };
  const quote1 = await service.quote(owner, first);
  await service.submit(owner, { ...first, quoteId: quote1.id });
  const quote2 = await service.quote(owner, second);
  await assert.rejects(
    service.submit(owner, { ...second, quoteId: quote2.id }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'CONCURRENCY_LIMIT_EXCEEDED',
  );
  assert.equal(repository.snapshot(owner.workspaceId).jobs.length, 1);
});

test('strict capability validation rejects forbidden provider fields and video probing', async () => {
  const { service } = runtime();
  await assert.rejects(
    service.quote(owner, {
      projectId: 'project-1',
      revisionId: 'revision-1',
      operation: 'video.generate',
      prompt: '生成门店短视频',
      parameters: { ratio: '9:16', serverUrl: 'http://127.0.0.1' },
      inputAssetIds: [],
      idempotencyKey: 'video-1',
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'GENERATION_PARAMETER_FORBIDDEN',
  );
});

test('media commits only after an OwnedAsset exists and download retry does not regenerate', async () => {
  const { service, provider, assets } = runtime();
  const input = {
    projectId: 'project-1',
    revisionId: 'revision-1',
    operation: 'image.edit' as const,
    prompt: '只重绘指甲区域',
    parameters: {},
    inputAssetIds: ['asset-input'],
    maskAssetId: 'asset-mask',
    idempotencyKey: 'image-edit-1',
  };
  const quote = await service.quote(owner, input);
  const job = await service.submit(owner, { ...input, quoteId: quote.id });
  await service.dispatch(owner, job.id);
  assets.failNext = true;
  await service.deliverMedia(owner, job.id, {
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mimeType: 'image/png',
    fileName: 'result.png',
  });
  assert.equal((await service.getJob(owner, job.id)).status, 'delivery_pending');
  assert.equal((await service.getUsageProjection(owner)).reserved.image, 1);

  await service.deliverMedia(owner, job.id, {
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mimeType: 'image/png',
    fileName: 'result.png',
  });
  assert.equal(provider.submissions.length, 1);
  assert.equal((await service.getJob(owner, job.id)).status, 'completed');
  assert.equal((await service.getUsageProjection(owner)).committed.image, 1);
  assert.equal(assets.inputs.length, 2);
});

test('durable text delivery commits without pretending to be an Asset', async () => {
  const { service, repository } = runtime();
  const input = {
    projectId: 'project-1',
    revisionId: 'revision-1',
    operation: 'text.respond' as const,
    prompt: '根据图片反推可复用提示词',
    parameters: {},
    inputAssetIds: ['asset-input'],
    idempotencyKey: 'text-1',
  };
  const quote = await service.quote(owner, input);
  const job = await service.submit(owner, { ...input, quoteId: quote.id });
  await service.dispatch(owner, job.id);
  await service.deliverText(owner, job.id, '奶油白猫眼美甲，柔和窗光');

  const projection = await service.getJob(owner, job.id);
  assert.equal(projection.status, 'completed');
  assert.equal(projection.text, '奶油白猫眼美甲，柔和窗光');
  assert.equal(
    (await service.listProjectGenerations(owner, 'project-1'))[0]?.text,
    '奶油白猫眼美甲，柔和窗光',
  );
  const state = repository.snapshot(owner.workspaceId);
  assert.equal(state.textDeliverables.length, 1);
  assert.equal(state.assets.length, 0);
  assert.equal((await service.getUsageProjection(owner)).committed.copy, 1);
});

test('failure releases product usage while provider cost remains independent', async () => {
  const { service, repository } = runtime();
  const input = {
    projectId: 'project-1',
    revisionId: 'revision-1',
    operation: 'video.generate' as const,
    prompt: '生成门店短视频',
    parameters: { ratio: '9:16', generateAudio: true },
    inputAssetIds: [],
    idempotencyKey: 'video-1',
  };
  const quote = await service.quote(owner, input);
  const job = await service.submit(owner, { ...input, quoteId: quote.id });
  await service.dispatch(owner, job.id);
  await service.fail(owner, job.id, {
    code: 'PROVIDER_ASYNC_FAILED',
    providerCostMicros: 880_000,
  });

  const usage = await service.getUsageProjection(owner);
  assert.equal(usage.released.video, 2);
  assert.equal(usage.committed.video, 0);
  assert.equal(repository.snapshot(owner.workspaceId).providerCosts.length, 1);
});

test('cancel stays reserved until confirmed and late success is quarantined', async () => {
  const { service, assets } = runtime();
  const input = {
    projectId: 'project-1',
    revisionId: 'revision-1',
    operation: 'image.generate' as const,
    prompt: '生成门店图',
    parameters: {},
    inputAssetIds: [],
    idempotencyKey: 'cancel-1',
  };
  const quote = await service.quote(owner, input);
  const job = await service.submit(owner, { ...input, quoteId: quote.id });
  await service.dispatch(owner, job.id);
  await service.requestCancel(owner, job.id);
  assert.equal((await service.getUsageProjection(owner)).reserved.image, 1);
  await service.confirmCancel(owner, job.id);
  assert.equal((await service.getUsageProjection(owner)).released.image, 1);

  await service.deliverMedia(owner, job.id, {
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mimeType: 'image/png',
    fileName: 'late.png',
  });
  assert.equal((await service.getJob(owner, job.id)).status, 'cancelled');
  assert.equal(assets.quarantined.length, 1);
  assert.equal((await service.getUsageProjection(owner)).committed.image, 0);
});

test('a cancellation that wins during media persistence quarantines the raced delivery', async () => {
  const { service, assets } = runtime();
  const input = {
    projectId: 'project-1',
    revisionId: 'revision-1',
    operation: 'image.generate' as const,
    prompt: '生成竞态测试图',
    parameters: {},
    inputAssetIds: [],
    idempotencyKey: 'cancel-delivery-race-1',
  };
  const quote = await service.quote(owner, input);
  const job = await service.submit(owner, { ...input, quoteId: quote.id });
  await service.dispatch(owner, job.id);
  let releasePersistence!: () => void;
  assets.persistBarrier = new Promise<void>((resolve) => {
    releasePersistence = resolve;
  });

  const delivery = service.deliverMedia(owner, job.id, {
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mimeType: 'image/png',
    fileName: 'raced.png',
  });
  while (assets.inputs.length === 0) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await service.requestCancel(owner, job.id);
  await service.confirmCancel(owner, job.id);
  releasePersistence();

  assert.equal((await delivery).status, 'cancelled');
  assert.equal(assets.quarantined.length, 1);
  assert.equal((await service.getUsageProjection(owner)).released.image, 1);
  assert.equal((await service.getUsageProjection(owner)).committed.image, 0);
});

test('audio operations stay closed until activation and validated audio delivery', async () => {
  const { service, catalog } = runtime();
  const speech = {
    projectId: 'project-1',
    revisionId: 'revision-1',
    operation: 'audio.speech' as const,
    prompt: '欢迎来到本店',
    parameters: {
      voice: 'warm-female',
      language: 'zh-CN',
      speed: 1,
      tone: 'warm',
      format: 'mp3',
      maxDurationSeconds: 15,
    },
    inputAssetIds: [],
    idempotencyKey: 'speech-1',
  };
  await assert.rejects(
    service.quote(owner, speech),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'OPERATION_NOT_ACTIVE',
  );
  await assert.rejects(
    () =>
      catalog.activate('audio.speech', {
        activationEvidence: {
          configurationRevision: 'not-a-revision',
          evidenceId: 'not-a-probe',
          probedAt: 'not-a-date',
          status: 'live_verified',
        },
        modelId: 'test-speech-model',
        usageAmount: 3,
      }),
    /live activation evidence/u,
  );
  await catalog.activate('audio.speech', {
    activationEvidence: {
      configurationRevision: 'a'.repeat(64),
      evidenceId: `activation-probe-${'b'.repeat(28)}`,
      probedAt: '2026-07-16T09:00:00.000Z',
      status: 'live_verified',
    },
    modelId: 'test-speech-model',
    usageAmount: 3,
  });
  await assert.rejects(
    service.quote(owner, {
      ...speech,
      idempotencyKey: 'speech-invalid-contract',
      parameters: { ...speech.parameters, speed: 3 },
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'GENERATION_PARAMETER_INVALID',
  );
  const quote = await service.quote(owner, speech);
  const job = await service.submit(owner, { ...speech, quoteId: quote.id });
  await service.dispatch(owner, job.id);
  await assert.rejects(
    service.deliverMedia(owner, job.id, {
      bytes: new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]),
      mimeType: 'audio/mpeg',
      fileName: 'voice.mp3',
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'AUDIO_CONTENT_INVALID',
  );
  await assert.rejects(
    service.deliverMedia(owner, job.id, {
      bytes: new Uint8Array([
        0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41,
        0x20,
      ]),
      mimeType: 'audio/mp4',
      fileName: 'voice.m4a',
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'AUDIO_CONTENT_INVALID',
  );
  assert.equal((await service.getUsageProjection(owner)).reserved.audio, 3);
});
