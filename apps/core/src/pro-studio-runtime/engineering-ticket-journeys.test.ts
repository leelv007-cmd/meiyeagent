/**
 * End-to-end domain journeys for engineering-pushable tickets 08 / 10 / 13.
 * These exercise application seams (not provider SDKs): quote → submit →
 * dispatch → deliver/recover → adopt / listAdoptions.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AdvancedCanvasAdoptionApplicationService,
  MemoryAdvancedCanvasAdoptionRepository,
  type AdvancedCanvasAdoptionSeed,
} from './adoption.js';
import {
  CanvasGenerationApplicationService,
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
  readonly submissions: Array<{ jobId: string; operation: CanvasGenerationOperation }> =
    [];
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

  async persist(input: CanvasMediaDeliveryInput): Promise<CanvasGeneratedAsset> {
    this.inputs.push(input);
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
    return this.persist(input);
  }
}

function generationRuntime() {
  const repository = new MemoryCanvasGenerationRepository();
  const provider = new RecordedProvider();
  const assets = new RecordedAssets();
  const catalog = new MemoryCanvasGenerationCatalog([
    {
      operation: 'text.respond',
      modelId: 'llm-model-1',
      activation: 'active',
      usageResource: 'copy',
      usageAmount: 1,
      estimatedDurationSeconds: [2, 10],
      allowedParameters: ['maxOutputTokens', 'temperature'],
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
  ]);
  const service = new CanvasGenerationApplicationService(repository, {
    catalog,
    provider,
    assets,
    projectAccess: {
      async assertRevision() {},
    },
    assetAccess: {
      async assertOwned() {},
    },
    entitlement: { async assertCanGenerate() {} },
    clock: () => new Date('2026-07-16T10:00:00.000Z'),
  });
  return { service, repository, provider, assets };
}

test('ticket 08: reverse-prompt text.respond recovers as text node and fails with release', async () => {
  const { service, repository, provider } = generationRuntime();
  const input = {
    projectId: 'project-1',
    revisionId: 'revision-1',
    operation: 'text.respond' as const,
    prompt: '根据参考图反推可复用的美业提示词，不要改写门店事实',
    parameters: { maxOutputTokens: 1200, temperature: 0.4 },
    inputAssetIds: ['asset-reference-image'],
    idempotencyKey: 'ticket08-reverse-1',
  };

  const quote = await service.quote(owner, input);
  const job = await service.submit(owner, { ...input, quoteId: quote.id });
  assert.equal(job.status, 'queued');
  assert.equal(provider.submissions.length, 0);

  await service.dispatch(owner, job.id);
  assert.equal(provider.submissions[0]?.operation, 'text.respond');
  assert.equal((await service.getJob(owner, job.id)).status, 'accepted');

  // Project recovery after refresh / device switch (no client-held job id required).
  const listed = await service.listProjectGenerations(owner, 'project-1');
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, job.id);

  await service.deliverText(
    owner,
    job.id,
    '奶油白猫眼美甲，柔和窗光，浅景深，产品棚拍',
  );
  const completed = await service.getJob(owner, job.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.text, '奶油白猫眼美甲，柔和窗光，浅景深，产品棚拍');
  assert.equal(repository.snapshot(owner.workspaceId).assets.length, 0);
  assert.equal(repository.snapshot(owner.workspaceId).textDeliverables.length, 1);
  assert.equal((await service.getUsageProjection(owner)).committed.copy, 1);

  // Failure path releases product usage (billing matrix).
  const failInput = {
    ...input,
    idempotencyKey: 'ticket08-reverse-fail',
    prompt: '反推失败路径',
  };
  const failQuote = await service.quote(owner, failInput);
  const failJob = await service.submit(owner, {
    ...failInput,
    quoteId: failQuote.id,
  });
  await service.dispatch(owner, failJob.id);
  await service.fail(owner, failJob.id, {
    code: 'PROVIDER_ASYNC_FAILED',
    providerCostMicros: 12_000,
  });
  const usage = await service.getUsageProjection(owner);
  assert.equal(usage.released.copy, 1);
  assert.equal(usage.committed.copy, 1);
  assert.equal(repository.snapshot(owner.workspaceId).providerCosts.length, 1);
});

test('ticket 10: video submit → list recovery → OwnedAsset delivery', async () => {
  const { service, repository, provider, assets } = generationRuntime();
  const input = {
    projectId: 'project-video',
    revisionId: 'revision-video',
    operation: 'video.generate' as const,
    prompt: '门店环境慢推镜头，自然光',
    parameters: {
      ratio: '9:16',
      resolution: '1080x1920',
      generateAudio: false,
      watermark: false,
    },
    inputAssetIds: ['asset-ref-image'],
    idempotencyKey: 'ticket10-video-1',
  };

  const quote = await service.quote(owner, input);
  assert.deepEqual(quote.usage, { resource: 'video', amount: 2 });
  const job = await service.submit(owner, { ...input, quoteId: quote.id });
  assert.deepEqual(job.origin, {
    kind: 'advanced_canvas',
    id: 'project-video',
    revisionId: 'revision-video',
  });

  await service.dispatch(owner, job.id);
  assert.equal(provider.submissions[0]?.operation, 'video.generate');

  // Device refresh recovers by project, not by client job id.
  const recovered = await service.listProjectGenerations(owner, 'project-video');
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.status, 'accepted');

  await service.deliverMedia(owner, job.id, {
    bytes: new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]),
    mimeType: 'video/mp4',
    fileName: 'store.mp4',
  });
  const completed = await service.getJob(owner, job.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.outputAssetId, `asset-${job.id}`);
  assert.equal(assets.inputs[0]?.mediaType, 'video');
  assert.equal(repository.snapshot(owner.workspaceId).assets[0]?.custody, 'owned');
  assert.equal((await service.getUsageProjection(owner)).committed.video, 2);

  // Capability probing remains forbidden on the billing path.
  await assert.rejects(
    service.quote(owner, {
      ...input,
      idempotencyKey: 'ticket10-probe',
      parameters: { ...input.parameters, serverUrl: 'http://127.0.0.1' },
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'GENERATION_PARAMETER_FORBIDDEN',
  );
});

test('ticket 13: adopt projects badge list and package identity for library lifecycle', async () => {
  const seed: AdvancedCanvasAdoptionSeed = {
    projects: [
      {
        id: 'project-1',
        workspaceId: owner.workspaceId,
        draftVersion: 3,
        draftNodes: [
          { id: 'text-1', kind: 'text', text: '今日猫眼美甲' },
          {
            id: 'image-1',
            kind: 'image',
            assetId: 'asset-1',
            jobId: 'job-1',
            sourceAssetIds: ['source-1'],
            custody: 'owned',
            deliveryStatus: 'completed',
          },
        ],
        revisions: [
          {
            id: 'revision-1',
            createdAt: '2026-07-16T09:00:00.000Z',
            nodes: [
              { id: 'text-1', kind: 'text', text: '今日猫眼美甲' },
              {
                id: 'image-1',
                kind: 'image',
                assetId: 'asset-1',
                jobId: 'job-1',
                sourceAssetIds: ['source-1'],
                custody: 'owned',
                deliveryStatus: 'completed',
              },
            ],
          },
        ],
      },
    ],
    packages: [],
  };
  const repository = new MemoryAdvancedCanvasAdoptionRepository(seed);
  const service = new AdvancedCanvasAdoptionApplicationService(repository, {
    clock: () => new Date('2026-07-16T10:00:00.000Z'),
  });

  const adopted = await service.adopt(owner, {
    projectId: 'project-1',
    revisionRef: { kind: 'frozen', revisionId: 'revision-1' },
    selection: {
      textNodeId: 'text-1',
      orderedMediaNodeIds: ['image-1'],
    },
    target: { kind: 'new_package' },
    idempotencyKey: 'ticket13-adopt-1',
  });

  assert.ok(adopted.packageId);
  assert.ok(adopted.versionId);
  assert.deepEqual(adopted.selectedNodeIds, ['text-1', 'image-1']);

  // Badge projection: listAdoptions is the only source for “已采用” UI.
  const adoptions = await service.listAdoptions(owner, 'project-1');
  assert.equal(adoptions.length, 1);
  assert.equal(adoptions[0]?.packageId, adopted.packageId);
  assert.deepEqual(adoptions[0]?.selectedNodeIds, ['text-1', 'image-1']);

  const pkg = repository
    .snapshot(owner.workspaceId)
    .packages.find((item) => item.id === adopted.packageId);
  assert.ok(pkg);
  assert.equal(pkg.kind, 'image_text');
  assert.deepEqual(pkg.versions[0]?.orderedAssetIds, ['asset-1']);
  assert.equal(pkg.versions[0]?.sourceRef.advancedCanvas?.schemaVersion, 1);
  assert.deepEqual(pkg.versions[0]?.sourceRef.advancedCanvas?.selectedNodeIds, [
    'text-1',
    'image-1',
  ]);
});
