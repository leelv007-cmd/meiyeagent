import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { unzipSync } from 'fflate';
import {
  MemoryOperationsRepository,
  OperationsApplicationService,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
} from './index.js';
import { MemoryModelAssetStorage } from '../model-supply/index.js';
import {
  ContentPackageZipExportAdapter,
  OperationsContentPackageExportAssetReader,
} from './content-package-export-adapter.js';
import { OperationsVideoContentPackageAdapter } from './video-content-package-adapter.js';

const confirmation = {
  actorId: 'owner-video',
  aigcLabelEnabled: true,
  catalogModelId: 'seedance-2',
  dataClass: ['contains_face'],
  executionContract: {
    aigcLabelEnabled: true,
    aspectRatio: '9:16' as const,
    catalogModelId: 'seedance-2',
    catalogRevision: 'catalog-video-v1',
    currency: 'CNY',
    dataClass: ['contains_face'] as Array<'contains_face'>,
    durationSeconds: 15,
    estimatedAmount: 12,
    operation: 'video.generate' as const,
    outputCount: 1,
    outputLabel: '15 second composed video',
    quoteAcceptedAt: '2026-07-18T00:00:00.000Z',
    quoteRevision: 'quote-video-v1',
    watermarkEnabled: false,
  },
  referenceAssetIds: ['asset-storefront', 'asset-treatment-room'],
  shots: [{ id: 'opening', prompt: '门店开场' }],
  storyboardRevision: 'storyboard-v1',
  storyboardVersion: 1,
  workflowId: 'workflow-video-1',
  workspaceId: 'workspace-video',
  workId: 'work-video-1',
};

const recordedCompositionEvidence = {
  aigc: {
    requested: false,
    visibleLabel: { actual: false, validated: true },
    implicitMetadata: { actual: false, validated: true },
    validationMethod: 'recorded_synthetic' as const,
  },
  brandWatermark: {
    actual: false,
    requested: false,
    validated: true,
    validationMethod: 'recorded_synthetic' as const,
  },
  clipCount: 1,
  durationSeconds: 15,
  outputSha256: 'recorded-composition-sha',
  outputSizeBytes: 8,
  rendererRevision: 'recorded-video-composition-v1',
  sourceAssetIds: ['owned-clip-opening'],
};

const recordedCompletionProvenance = {
  providerAttempts: [],
  providerCosts: [],
  routeSnapshot: {
    actualCatalogModelId: 'seedance-2',
    candidateCatalogModelIds: ['seedance-2'],
    catalogRevisionId: 'catalog-video-v1',
    createdAt: '2026-07-18T00:00:00.000Z',
    dataClass: ['contains_face'] as Array<'contains_face'>,
    deploymentId: 'seedance-2-direct',
    id: 'route-video-recorded',
    reason: 'fixed_selection' as const,
    requestedSelection: {
      catalogModelId: 'seedance-2',
      mode: 'fixed' as const,
    },
  },
};

const coverBytes = Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 255, 217]);

async function persistedDeliveryEvidence(
  storage: MemoryModelAssetStorage,
  input: { durationSeconds: number; outputVideoSha256: string; storyboardRevision: string; workflowId: string },
) {
  const cover = await storage.persistOwnedAsset!({
    bytes: coverBytes,
    contentType: 'image/jpeg',
    workspaceId: confirmation.workspaceId,
  });
  return {
    compositionRevision: `composition-${input.storyboardRevision}`,
    storyboardRevision: input.storyboardRevision,
    workflowId: input.workflowId,
    outputVideoSha256: input.outputVideoSha256,
    cover: { ...cover, contentType: 'image/jpeg' as const, validationMethod: 'recorded_synthetic' as const },
    subtitles: {
      durationSeconds: input.durationSeconds,
      format: 'srt' as const,
      text: `1\n00:00:00,000 --> 00:00:${String(input.durationSeconds).padStart(2, '0')},000\n门店开场\n`,
      validationMethod: 'recorded_synthetic' as const,
    },
  };
}

function setup() {
  const repository = new MemoryOperationsRepository();
  const storage = new MemoryModelAssetStorage();
  repository.grantMembership(confirmation.actorId, confirmation.workspaceId);
  const service = new OperationsApplicationService(repository, {
    canvasExporter: new RecordedCanvasExportAdapter(),
    contentPackageExporter: new ContentPackageZipExportAdapter(
      storage,
      new OperationsContentPackageExportAssetReader(repository, storage),
      {
        allowRecordedSyntheticVideoCompliance: true,
        appEnv: 'e2e',
      },
    ),
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
    clock: () => new Date('2026-07-15T10:00:00.000Z'),
  });
  return {
    adapter: new OperationsVideoContentPackageAdapter(() => service),
    context: {
      actor: 'owner' as const,
      correlationId: 'video-package-test',
      userId: confirmation.actorId,
      workspaceId: confirmation.workspaceId,
    },
    repository,
    service,
    storage,
  };
}

describe('video ContentPackage lifecycle adapter', () => {
  it('adopts a completed Operations video Result by its CreativeAsset id', async () => {
    const { context, repository, service, storage } = setup();
    const work = await service.createCreativeWork(context, {
      autoConfirmBrief: true,
      intent: '采用已完成的视频结果',
      mode: 'direct',
      operation: 'video.generate',
      sessionId: 'video-first-adopt-session',
      sourceReferences: [],
    });
    const otherWork = await service.createCreativeWork(context, {
      autoConfirmBrief: true,
      intent: '其他视频工作',
      mode: 'direct',
      operation: 'video.generate',
      sessionId: 'video-first-adopt-session',
      sourceReferences: [],
    });
    const state = await repository.loadWorkspace(context.workspaceId);
    assert.ok(state);
    const job = {
      contract: {
        ...confirmation.executionContract,
        aigcLabelEnabled: false,
        watermarkEnabled: true,
      },
      createdAt: confirmation.executionContract.quoteAcceptedAt,
      id: 'creative-video-job-completed',
      outputAssetIds: ['creative-video-result'],
      outputContentIds: [],
      providerJobId: 'workflow-first-adopt',
      status: 'completed' as const,
      submissionKey: 'creative-video-job-completed',
      updatedAt: confirmation.executionContract.quoteAcceptedAt,
      workId: work.id,
      workspaceId: context.workspaceId,
    };
    state.creativeJobs.push(
      job,
      {
        ...job,
        id: 'creative-video-job-running',
        outputAssetIds: ['creative-video-running'],
        status: 'running',
        submissionKey: 'creative-video-job-running',
      },
      {
        ...job,
        id: 'creative-video-job-non-output',
        outputAssetIds: [],
        submissionKey: 'creative-video-job-non-output',
      },
      {
        ...job,
        id: 'creative-video-job-other-work',
        outputAssetIds: ['creative-video-other-work'],
        submissionKey: 'creative-video-job-other-work',
        workId: otherWork.id,
      },
      {
        ...job,
        id: 'creative-video-job-other-workspace',
        outputAssetIds: ['creative-video-other-workspace'],
        submissionKey: 'creative-video-job-other-workspace',
        workspaceId: 'workspace-other',
      },
    );
    const persistedVideo = await storage.persistGeneratedAsset({
      bytes: Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112]),
      contentType: 'video/mp4',
      workspaceId: context.workspaceId,
    });
    const delivery = await persistedDeliveryEvidence(storage, {
      durationSeconds: 15,
      outputVideoSha256: persistedVideo.sha256,
      storyboardRevision: 'story-first-adopt',
      workflowId: 'workflow-first-adopt',
    });
    const asset = {
      compositionEvidence: {
        ...recordedCompositionEvidence,
        delivery,
        brandWatermark: {
          actual: true,
          requested: true,
          text: '清风美学',
          validated: true,
          validationMethod: 'recorded_synthetic' as const,
        },
        outputSha256: persistedVideo.sha256,
        outputSizeBytes: persistedVideo.sizeBytes,
      },
      contentType: 'video/mp4' as const,
      createdAt: confirmation.executionContract.quoteAcceptedAt,
      id: 'creative-video-result',
      jobId: job.id,
      kind: 'video' as const,
      objectKey: persistedVideo.objectKey,
      ownedAssetId: persistedVideo.id,
      sha256: persistedVideo.sha256,
      sizeBytes: persistedVideo.sizeBytes,
      title: '视频成片',
      workId: work.id,
      workspaceId: context.workspaceId,
    };
    state.creativeAssets.push(
      asset,
      {
        ...asset,
        id: 'creative-video-running',
        jobId: 'creative-video-job-running',
        ownedAssetId: 'owned-video-running',
      },
      {
        ...asset,
        id: 'creative-video-non-output',
        jobId: 'creative-video-job-non-output',
        ownedAssetId: 'owned-video-non-output',
      },
      {
        ...asset,
        id: 'creative-video-other-work',
        jobId: 'creative-video-job-other-work',
        ownedAssetId: 'owned-video-other-work',
        workId: otherWork.id,
      },
      {
        ...asset,
        id: 'creative-video-other-workspace',
        jobId: 'creative-video-job-other-workspace',
        ownedAssetId: 'owned-video-other-workspace',
        workspaceId: 'workspace-other',
      },
    );
    const invalidFirstAssets = [
      {
        id: 'creative-video-unsafe-key',
        patch: { objectKey: `${context.workspaceId}/composed/../unsafe.mp4` },
      },
      {
        id: 'creative-video-bad-sha',
        patch: { sha256: 'not-a-sha' },
      },
      {
        id: 'creative-video-zero-size',
        patch: { sizeBytes: 0 },
      },
      {
        id: 'creative-video-evidence-hash-mismatch',
        patch: {
          compositionEvidence: {
            ...asset.compositionEvidence,
            outputSha256: 'f'.repeat(64),
          },
        },
      },
      {
        id: 'creative-video-evidence-flags-mismatch',
        patch: {
          compositionEvidence: {
            ...asset.compositionEvidence,
            aigc: {
              ...asset.compositionEvidence.aigc,
              requested: true,
              visibleLabel: { actual: true, validated: true },
              implicitMetadata: { actual: true, validated: true },
            },
          },
        },
      },
      {
        id: 'creative-video-delivery-workflow-mismatch',
        patch: {
          compositionEvidence: {
            ...asset.compositionEvidence,
            delivery: { ...delivery, workflowId: 'workflow-other' },
          },
        },
      },
      {
        id: 'creative-video-delivery-storyboard-missing',
        patch: {
          compositionEvidence: {
            ...asset.compositionEvidence,
            delivery: { ...delivery, storyboardRevision: '' },
          },
        },
      },
      {
        id: 'creative-video-delivery-duration-mismatch',
        patch: {
          compositionEvidence: {
            ...asset.compositionEvidence,
            delivery: {
              ...delivery,
              subtitles: { ...delivery.subtitles, durationSeconds: 14 },
            },
          },
        },
      },
      {
        id: 'creative-video-delivery-cover-unsafe',
        patch: {
          compositionEvidence: {
            ...asset.compositionEvidence,
            delivery: {
              ...delivery,
              cover: { ...delivery.cover, objectKey: '../cover.jpg' },
            },
          },
        },
      },
    ];
    for (const { id, patch } of invalidFirstAssets) {
      const invalidJobId = `${id}-job`;
      state.creativeJobs.push({
        ...job,
        id: invalidJobId,
        outputAssetIds: [id],
        submissionKey: invalidJobId,
      });
      state.creativeAssets.push({
        ...asset,
        ...patch,
        id,
        jobId: invalidJobId,
      });
    }
    await repository.saveWorkspace(state);

    for (const videoAssetId of [
      'creative-video-running',
      'creative-video-non-output',
      'creative-video-other-work',
      'creative-video-other-workspace',
      ...invalidFirstAssets.map(({ id }) => id),
    ]) {
      await assert.rejects(
        service.adoptResult(context, {
          expectedRevision: 0,
          selection: { kind: 'video', videoAssetId },
          workId: work.id,
        }),
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'INVALID_VIDEO_RESULT_ASSET',
      );
    }

    const adopted = await service.adoptResult(context, {
      expectedRevision: 0,
      selection: { kind: 'video', videoAssetId: asset.id },
      workId: work.id,
    });
    assert.equal(adopted.status, 'accepted');
    assert.deepEqual(adopted.generated.assetIds, [asset.id]);
    assert.deepEqual(adopted.generated.ownedAssets?.map(({ id }) => id), [
      asset.id,
      delivery.cover.id,
    ]);
    assert.deepEqual(adopted.versions[0]?.orderedAssetIds, [asset.id]);
    assert.deepEqual(adopted.compliance, {
      aigcLabelEnabled: false,
      watermarkEnabled: true,
      watermarkText: '清风美学',
    });
    assert.deepEqual(
      adopted.variants.map(({ platform }) => platform),
      ['xiaohongshu', 'douyin', 'video_account'],
    );

    const nextState = await repository.loadWorkspace(context.workspaceId);
    assert.ok(nextState);
    nextState.creativeJobs.push({
      ...job,
      id: 'creative-video-job-new-result',
      outputAssetIds: ['creative-video-new-result'],
      submissionKey: 'creative-video-job-new-result',
    });
    nextState.creativeAssets.push({
      ...asset,
      id: 'creative-video-new-result',
      jobId: 'creative-video-job-new-result',
      ownedAssetId: 'owned-video-new-result',
    });
    await repository.saveWorkspace(nextState);
    await assert.rejects(
      service.adoptResult(context, {
        expectedRevision: adopted.revision,
        selection: {
          kind: 'video',
          videoAssetId: 'creative-video-new-result',
        },
        workId: work.id,
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'INVALID_VIDEO_RESULT_ASSET',
    );

    const exported = await service.exportContentPackage(context, {
      expectedRevision: adopted.revision,
      packageId: adopted.id,
      platform: 'douyin',
    });
    assert.equal(exported.exportReceipts.at(-1)?.status, 'succeeded');
  });

  it('moves a failed video workflow to needs input without creating an empty version', async () => {
    const { adapter, context, service } = setup();
    await adapter.confirm({
      ...confirmation,
      workflowId: 'workflow-reference-failed',
    });
    const failure = {
      actorId: confirmation.actorId,
      failureCode: 'reference_asset_resolution_required',
      status: 'failed' as const,
      workflowId: 'workflow-reference-failed',
      workspaceId: confirmation.workspaceId,
    };

    await adapter.reconcile(failure);
    await adapter.reconcile(failure);

    const contentPackage = (await service.listContentPackages(context)).find(
      (item) => item.source.workflowId === failure.workflowId
    );
    assert.ok(contentPackage);
    assert.equal(contentPackage.status, 'needs_input');
    assert.equal(contentPackage.statusGroup, 'needs_attention');
    assert.equal(contentPackage.generated.childRuns[0]?.status, 'failed');
    assert.equal(
      contentPackage.generated.childRuns[0]?.failureCode,
      failure.failureCode,
    );
    assert.deepEqual(contentPackage.generated.ownedAssets, undefined);
    assert.deepEqual(contentPackage.versions, []);
  });

  it('records a terminal failure after quality review without duplicating the child run', async () => {
    const { adapter, context, service } = setup();
    await adapter.confirm({
      ...confirmation,
      workflowId: 'workflow-review-then-failed',
    });
    await adapter.reconcile({
      actorId: confirmation.actorId,
      status: 'awaiting_quality_review',
      workflowId: 'workflow-review-then-failed',
      workspaceId: confirmation.workspaceId,
    });
    const failure = {
      actorId: confirmation.actorId,
      failureCode: 'COMPOSED_VIDEO_TECHNICAL_VALIDATION_FAILED',
      status: 'failed' as const,
      workflowId: 'workflow-review-then-failed',
      workspaceId: confirmation.workspaceId,
    };

    await adapter.reconcile(failure);
    await adapter.reconcile(failure);

    const contentPackage = (await service.listContentPackages(context)).find(
      (item) => item.source.workflowId === failure.workflowId,
    );
    assert.ok(contentPackage);
    assert.equal(contentPackage.status, 'needs_input');
    assert.deepEqual(contentPackage.generated.childRuns, [
      {
        failureCode: failure.failureCode,
        runId: failure.workflowId,
        runType: 'durable_video_workflow',
        status: 'failed',
      },
    ]);
  });

  it('creates one package on confirm and advances review to one owned first version', async () => {
    const { adapter, context, repository, service, storage } = setup();
    await service.createContentPackage(context, {
      kind: 'image_text',
      source: { assetIds: ['image-source'] },
    });

    await adapter.confirm(confirmation);
    await adapter.confirm(confirmation);

    let packages = await service.listContentPackages(context);
    assert.equal(packages.length, 2);
    const creating = packages.find((item) => item.kind === 'video');
    assert.ok(creating);
    assert.equal(creating.status, 'generating');
    assert.equal(creating.statusGroup, 'creating');
    assert.equal(creating.source.workflowId, confirmation.workflowId);
    assert.equal(creating.source.storyboardRevision, 'storyboard-v1');
    assert.equal(
      creating.source.executionContract?.quoteRevision,
      'quote-video-v1'
    );
    assert.deepEqual(creating.source.dataClass, ['contains_face']);
    assert.deepEqual(creating.source.assetIds, confirmation.referenceAssetIds);
    assert.equal(creating.generated.childRuns[0]?.runId, confirmation.workflowId);

    await adapter.reconcile({
      actorId: confirmation.actorId,
      status: 'awaiting_quality_review',
      workflowId: confirmation.workflowId,
      workspaceId: confirmation.workspaceId,
    });
    const needsReview = await service.getContentPackage(context, creating.id);
    assert.equal(needsReview.status, 'needs_input');
    assert.equal(needsReview.statusGroup, 'needs_attention');

    const completedSha = 'a'.repeat(64);
    const delivery = await persistedDeliveryEvidence(storage, {
      durationSeconds: confirmation.executionContract.durationSeconds,
      outputVideoSha256: completedSha,
      storyboardRevision: confirmation.storyboardRevision,
      workflowId: confirmation.workflowId,
    });
    const completed = {
      actorId: confirmation.actorId,
      clipAssetIds: ['owned-clip-opening'],
      composedAsset: {
        contentType: 'video/mp4' as const,
        id: 'owned-composed-video',
        objectKey: 'workspace-video/composed/final.mp4',
        sha256: completedSha,
        sizeBytes: 1_024,
        compositionEvidence: {
          aigc: {
            requested: true,
            visibleLabel: {
              actual: true,
              value: '内容由 AI 生成',
              validated: true,
            },
            implicitMetadata: {
              actual: true,
              contentId: confirmation.workflowId,
              contentType: 'ai_generated' as const,
              serviceCode: 'ffmpeg-compose-v1',
              serviceProvider: 'meiye-content-workflow',
              validated: true,
            },
            validationMethod: 'ffprobe_metadata' as const,
          },
          brandWatermark: {
            actual: false,
            requested: false,
            validated: true,
            validationMethod: 'composition_manifest' as const,
          },
          clipCount: 1,
          delivery,
          durationSeconds: 15,
          height: 1280,
          outputSha256: completedSha,
          outputSizeBytes: 1_024,
          rendererRevision: 'product-renderer-validation-v1',
          sourceAssetIds: ['owned-clip-opening'],
          width: 720,
        },
      },
      providerAttempts: [
        {
          acceptance: 'accepted' as const,
          catalogModelId: 'seedance-2',
          createdAt: '2026-07-18T00:00:00.000Z',
          deploymentId: 'seedance-2-direct',
          id: 'attempt-video-1',
          jobId: 'model-video-1',
          status: 'completed' as const,
        },
      ],
      providerCosts: [
        {
          amount: 1.4,
          currency: 'CNY' as const,
          id: 'cost-video-1',
          status: 'estimated' as const,
          usage: { mediaUnits: 1, outputTokens: 50_000 },
        },
      ],
      routeSnapshot: {
        actualCatalogModelId: 'seedance-2',
        candidateCatalogModelIds: ['seedance-2'],
        catalogRevisionId: 'catalog-video-v1',
        createdAt: '2026-07-18T00:00:00.000Z',
        dataClass: ['contains_face'] as Array<'contains_face'>,
        deploymentId: 'seedance-2-direct',
        id: 'route-video-1',
        reason: 'fixed_selection' as const,
        requestedSelection: {
          catalogModelId: 'seedance-2',
          mode: 'fixed' as const,
        },
      },
      shots: confirmation.shots,
      status: 'completed' as const,
      storyboardRevision: confirmation.storyboardRevision,
      workflowId: confirmation.workflowId,
      workspaceId: confirmation.workspaceId,
    };
    await adapter.reconcile(completed);
    await adapter.reconcile(completed);

    const invalidDeliveries = [
      { ...delivery, workflowId: 'workflow-other' },
      { ...delivery, storyboardRevision: 'storyboard-other' },
      { ...delivery, compositionRevision: 'composition-other' },
      { ...delivery, outputVideoSha256: 'b'.repeat(64) },
      {
        ...delivery,
        cover: { ...delivery.cover, objectKey: '../cover.jpg' },
      },
      {
        ...delivery,
        subtitles: { ...delivery.subtitles, durationSeconds: 14 },
      },
    ];
    for (const invalidDelivery of invalidDeliveries) {
      await assert.rejects(
        adapter.reconcile({
          ...completed,
          composedAsset: {
            ...completed.composedAsset,
            compositionEvidence: {
              ...completed.composedAsset.compositionEvidence,
              delivery: invalidDelivery,
            },
          },
        }),
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'VIDEO_CONTENT_PACKAGE_DELIVERY_EVIDENCE_INVALID',
      );
    }

    packages = await service.listContentPackages(context);
    const usable = packages.find((item) => item.kind === 'video');
    assert.ok(usable);
    assert.equal(usable.status, 'accepted');
    assert.equal(usable.statusGroup, 'usable');
    assert.equal(usable.versions.length, 1);
    assert.deepEqual(usable.versions[0]?.orderedAssetIds, [
      'owned-composed-video',
    ]);
    assert.deepEqual(
      usable.generated.ownedAssets?.map(({ id }) => id),
      [completed.composedAsset.id, delivery.cover.id],
    );
    assert.equal(
      usable.source.compositionRevision,
      delivery.compositionRevision,
    );
    assert.equal(
      usable.generated.ownedAssets?.[0]?.compositionEvidence?.aigc
        .implicitMetadata.validated,
      true
    );
    assert.equal(
      usable.generated.childRuns[0]?.routeSnapshot?.deploymentId,
      'seedance-2-direct'
    );
    assert.deepEqual(
      usable.generated.childRuns[0]?.providerCosts,
      completed.providerCosts
    );
    assert.deepEqual(
      usable.generated.childRuns[0]?.providerAttempts,
      completed.providerAttempts
    );
    assert.deepEqual(usable.generated.childRuns[0]?.assetIds, [
      'owned-clip-opening',
    ]);

    const state = await repository.loadWorkspace(confirmation.workspaceId);
    assert.ok(state);
    assert.equal(state.creativeContents.length, 0);
  });

  it('lands a completed composed receipt and exports its full ZIP through the public seam', async () => {
    const repository = new MemoryOperationsRepository();
    repository.grantMembership(confirmation.actorId, confirmation.workspaceId);
    const storage = new MemoryModelAssetStorage();
    const sourceBytes = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112]);
    const composedAsset = await storage.persistGeneratedAsset({
      bytes: sourceBytes,
      contentType: 'video/mp4',
      workspaceId: confirmation.workspaceId,
    });
    const delivery = await persistedDeliveryEvidence(storage, {
      durationSeconds: confirmation.executionContract.durationSeconds,
      outputVideoSha256: composedAsset.sha256,
      storyboardRevision: confirmation.storyboardRevision,
      workflowId: confirmation.workflowId,
    });
    const service = new OperationsApplicationService(repository, {
      canvasExporter: new RecordedCanvasExportAdapter(),
      contentPackageExporter: new ContentPackageZipExportAdapter(
        storage,
        new OperationsContentPackageExportAssetReader(repository, storage),
        {
          allowRecordedSyntheticVideoCompliance: true,
          appEnv: 'e2e',
        },
      ),
      imageGenerator: new RecordedImageGenerationAdapter(),
      notifier: { async send() {} },
      clock: () => new Date('2026-07-15T10:00:00.000Z'),
    });
    const adapter = new OperationsVideoContentPackageAdapter(() => service);
    const context = {
      actor: 'owner' as const,
      correlationId: 'video-package-export-test',
      userId: confirmation.actorId,
      workspaceId: confirmation.workspaceId,
    };

    await adapter.confirm({
      ...confirmation,
      aigcLabelEnabled: false,
    });
    await adapter.reconcile({
      actorId: confirmation.actorId,
      clipAssetIds: ['owned-clip-opening'],
      composedAsset: {
        contentType: 'video/mp4',
        id: composedAsset.id,
        objectKey: composedAsset.objectKey,
        sha256: composedAsset.sha256,
        sizeBytes: composedAsset.sizeBytes,
        compositionEvidence: {
          ...recordedCompositionEvidence,
          delivery,
          outputSha256: composedAsset.sha256,
          outputSizeBytes: composedAsset.sizeBytes,
        },
      },
      ...recordedCompletionProvenance,
      shots: confirmation.shots,
      status: 'completed',
      storyboardRevision: confirmation.storyboardRevision,
      workflowId: confirmation.workflowId,
      workspaceId: confirmation.workspaceId,
    });

    const state = await repository.loadWorkspace(confirmation.workspaceId);
    assert.ok(state);
    const contentPackage = state.contentPackages.find(
      (item) => item.source.workflowId === confirmation.workflowId
    );
    assert.ok(contentPackage);
    assert.equal(contentPackage.compliance.aigcLabelEnabled, false);
    assert.equal(
      contentPackage.generated.ownedAssets?.[0]?.sizeBytes,
      sourceBytes.byteLength
    );
    const version = contentPackage.versions[0];
    assert.ok(version);
    contentPackage.variants = (
      ['xiaohongshu', 'douyin', 'video_account'] as const
    ).map((platform) => ({
      currentVersionId: version.id,
      id: `${contentPackage.id}-${platform}`,
      platform,
      versions: [structuredClone(version)],
    }));
    await repository.saveWorkspace(state);

    const exported = await service.exportContentPackage(context, {
      expectedRevision: contentPackage.revision,
      packageId: contentPackage.id,
      platform: 'douyin',
    });
    const receipt = exported.exportReceipts.at(-1);
    assert.equal(receipt?.status, 'succeeded');
    assert.equal(receipt?.contentType, 'application/zip');
    assert.ok(receipt?.sha256);
    assert.ok(receipt?.sizeBytes && receipt.sizeBytes > 0);
    const archiveBytes = receipt?.artifactObjectKey
      ? storage.read(receipt.artifactObjectKey)
      : undefined;
    assert.ok(archiveBytes);
    const files = unzipSync(archiveBytes);
    assert.ok(files['video.mp4']);
    assert.deepEqual(files['video.mp4'], sourceBytes);
    assert.ok(files['cover.jpg']);
    assert.ok(files['subtitles.srt']);
    assert.ok(files['manifest.json']);
    const manifest = JSON.parse(
      new TextDecoder().decode(files['manifest.json']),
    );
    assert.equal(manifest.schema, 'beauty-delivery-manifest/v1');
    assert.equal(manifest.kind, 'video');
    assert.equal(manifest.contentPackageRevision, contentPackage.revision);
  });

  it('keeps a canonical Work video review-ready until result_adopt writes its first version', async () => {
    const { adapter, context, service, storage } = setup();
    const work = await service.createCreativeWork(context, {
      autoConfirmBrief: true,
      intent: '生成一支门店介绍视频',
      mode: 'direct',
      operation: 'video.generate',
      sessionId: 'video-result-adopt-session',
      sourceReferences: [],
    });
    const workflowId = 'workflow-video-result-adopt';
    const workVideoContract = {
      ...confirmation.executionContract,
      contentModules: work.contentModules,
      dataClass: [] as Array<'contains_face'>,
    };
    const firstApproval = await service.approveCreativeGeneration(context, {
      approvalKey: 'approve-video-result-adopt-v1',
      contract: workVideoContract,
      workId: work.id,
    });
    await adapter.confirm({
      ...confirmation,
      approvalReceiptId: firstApproval.id,
      dataClass: [],
      executionContract: workVideoContract,
      workflowId,
      workId: work.id,
    });
    const firstDelivery = await persistedDeliveryEvidence(storage, {
      durationSeconds: confirmation.executionContract.durationSeconds,
      outputVideoSha256: 'a'.repeat(64),
      storyboardRevision: confirmation.storyboardRevision,
      workflowId,
    });
    await adapter.reconcile({
      actorId: confirmation.actorId,
      clipAssetIds: ['owned-clip-opening'],
      composedAsset: {
        contentType: 'video/mp4',
        id: 'owned-result-video',
        objectKey: `${confirmation.workspaceId}/generated/${'a'.repeat(64)}.mp4`,
        sha256: 'a'.repeat(64),
        sizeBytes: 1_024,
        compositionEvidence: {
          ...recordedCompositionEvidence,
          delivery: firstDelivery,
          outputSha256: 'a'.repeat(64),
          outputSizeBytes: 1_024,
        },
      },
      ...recordedCompletionProvenance,
      shots: confirmation.shots,
      status: 'completed',
      storyboardRevision: confirmation.storyboardRevision,
      workflowId,
      workspaceId: confirmation.workspaceId,
    });

    const reviewReady = (await service.listContentPackages(context)).find(
      (item) => item.source.workflowId === workflowId,
    );
    assert.ok(reviewReady);
    assert.equal(reviewReady.status, 'review_ready');
    assert.equal(reviewReady.versions.length, 0);

    const adopted = await service.adoptResult(context, {
      expectedRevision: reviewReady.revision,
      selection: { kind: 'video', videoAssetId: 'owned-result-video' },
      workId: work.id,
    });
    assert.equal(adopted.status, 'accepted');
    assert.equal(adopted.revision, reviewReady.revision + 1);
    assert.deepEqual(adopted.versions[0]?.orderedAssetIds, [
      'owned-result-video',
    ]);

    const derivedWorkflowId = 'workflow-video-result-adopt-derived';
    const derivedApproval = await service.approveCreativeGeneration(context, {
      approvalKey: 'approve-video-result-adopt-v2',
      contract: workVideoContract,
      workId: work.id,
    });
    await adapter.confirm({
      ...confirmation,
      approvalReceiptId: derivedApproval.id,
      dataClass: [],
      executionContract: workVideoContract,
      storyboardRevision: 'storyboard-v2',
      workflowId: derivedWorkflowId,
      workId: work.id,
    });
    const derivedDelivery = await persistedDeliveryEvidence(storage, {
      durationSeconds: confirmation.executionContract.durationSeconds,
      outputVideoSha256: 'b'.repeat(64),
      storyboardRevision: 'storyboard-v2',
      workflowId: derivedWorkflowId,
    });
    await adapter.reconcile({
      actorId: confirmation.actorId,
      clipAssetIds: ['owned-clip-derived'],
      composedAsset: {
        contentType: 'video/mp4',
        id: 'owned-result-video-derived',
        objectKey: `${confirmation.workspaceId}/generated/${'b'.repeat(64)}.mp4`,
        sha256: 'b'.repeat(64),
        sizeBytes: 2_048,
        compositionEvidence: {
          ...recordedCompositionEvidence,
          delivery: derivedDelivery,
          outputSha256: 'b'.repeat(64),
          outputSizeBytes: 2_048,
          sourceAssetIds: ['owned-clip-derived'],
        },
      },
      ...recordedCompletionProvenance,
      shots: confirmation.shots,
      status: 'completed',
      storyboardRevision: 'storyboard-v2',
      workflowId: derivedWorkflowId,
      workspaceId: confirmation.workspaceId,
    });

    const packagesAfterDerived = await service.listContentPackages(context);
    const derivedReviewReady = packagesAfterDerived.find(
      (item) => item.source.workflowId === derivedWorkflowId,
    );
    assert.ok(derivedReviewReady);
    assert.equal(derivedReviewReady.status, 'review_ready');
    assert.notEqual(derivedReviewReady.id, adopted.id);

    await assert.rejects(
      service.adoptResult(context, {
        expectedRevision: derivedReviewReady.revision,
        selection: { kind: 'video', videoAssetId: 'owned-result-video' },
        workId: work.id,
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'CONTENT_PACKAGE_REVISION_CONFLICT',
    );
    const replayedOld = await service.adoptResult(context, {
      expectedRevision: adopted.revision,
      selection: { kind: 'video', videoAssetId: 'owned-result-video' },
      workId: work.id,
    });
    assert.equal(replayedOld.id, adopted.id);
    assert.equal(replayedOld.currentVersionId, adopted.currentVersionId);
    await assert.rejects(
      service.adoptResult(context, {
        expectedRevision: adopted.revision,
        selection: {
          kind: 'video',
          videoAssetId: 'owned-result-video-derived',
        },
        workId: work.id,
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'CONTENT_PACKAGE_REVISION_CONFLICT',
    );
    await assert.rejects(
      service.adoptResult(context, {
        expectedRevision: 0,
        selection: {
          kind: 'video',
          videoAssetId: 'owned-result-video-from-no-package',
        },
        workId: work.id,
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'INVALID_VIDEO_RESULT_ASSET',
    );

    const adoptedDerived = await service.adoptResult(context, {
      expectedRevision: derivedReviewReady.revision,
      selection: {
        kind: 'video',
        videoAssetId: 'owned-result-video-derived',
      },
      workId: work.id,
    });
    assert.equal(adoptedDerived.id, derivedReviewReady.id);
    assert.equal(adoptedDerived.source.workflowId, derivedWorkflowId);
    assert.equal(adoptedDerived.revision, derivedReviewReady.revision + 1);
    assert.deepEqual(adoptedDerived.versions[0]?.orderedAssetIds, [
      'owned-result-video-derived',
    ]);
    const oldPackage = (await service.listContentPackages(context)).find(
      (item) => item.id === adopted.id,
    );
    assert.equal(oldPackage?.currentVersionId, adopted.currentVersionId);
    assert.deepEqual(oldPackage?.versions.at(-1)?.orderedAssetIds, [
      'owned-result-video',
    ]);
  });

  it('cancels without creating a playable version and rejects temporary provider URLs', async () => {
    const { adapter, context, service } = setup();
    await adapter.confirm({ ...confirmation, workflowId: 'workflow-cancelled' });
    await adapter.reconcile({
      actorId: confirmation.actorId,
      status: 'cancelled',
      workflowId: 'workflow-cancelled',
      workspaceId: confirmation.workspaceId,
    });
    const cancelled = (await service.listContentPackages(context)).find(
      (item) => item.source.workflowId === 'workflow-cancelled',
    );
    assert.ok(cancelled);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.statusGroup, 'needs_attention');
    assert.equal(cancelled.versions.length, 0);

    await adapter.confirm({ ...confirmation, workflowId: 'workflow-temp-url' });
    await assert.rejects(
      adapter.reconcile({
        actorId: confirmation.actorId,
        clipAssetIds: [],
        composedAsset: {
          contentType: 'video/mp4',
          id: 'provider-video',
          objectKey: 'https://provider.example/video.mp4',
          sha256: 'provider-sha',
          sizeBytes: 1_024,
          compositionEvidence: recordedCompositionEvidence,
        },
        ...recordedCompletionProvenance,
        shots: confirmation.shots,
        status: 'completed',
        storyboardRevision: confirmation.storyboardRevision,
        workflowId: 'workflow-temp-url',
        workspaceId: confirmation.workspaceId,
      }),
      /owned object key/i,
    );
  });
});
