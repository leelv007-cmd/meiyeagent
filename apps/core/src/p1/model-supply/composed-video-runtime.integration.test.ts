import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateVideoLabels } from '../../video/validation.js';
import { P1ApplicationService } from '../foundation/application-service.js';
import { MemoryJobPort } from '../foundation/memory-job-port.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import { makeDurableJobEnvelope } from '../job-runtime/job-contracts.js';
import {
  DurableTracerWorker,
  MemoryTracerJobRepository,
  TracerJobApplicationService,
} from '../job-runtime/tracer-worker.js';
import {
  MemoryOperationsRepository,
  OperationsApplicationService,
  OperationsVideoContentPackageAdapter,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
} from '../operations/index.js';
import type {
  VideoContentPackageConfirmation,
  VideoContentPackageOutcome,
  VideoContentPackagePort,
} from '../video-content-package-port.js';
import { recordedRequest, RecordedAdapterRouter } from './adapters.js';
import { ArkMediaExecutionPort } from './ark-media-adapter.js';
import {
  createDefaultCapabilityRevisions,
  createDefaultCatalogModels,
  createDefaultDeployments,
  createDefaultPriceRevisions,
  createDefaultRouteRevisions,
} from './catalog.js';
import {
  COMPOSED_VIDEO_JOB_KIND,
  ComposedVideoJobEffect,
  DurableComposedVideoApplicationService,
} from './composed-video-workflow.js';
import { videoCompositionRuntimeFromEnv } from './composition-runtime.js';
import { FileSystemAssetStorage } from './filesystem-asset-storage.js';
import { FoundationModelSupplyLedger } from './foundation-ledger.js';
import {
  MemoryModelSupplyControlPlaneRepository,
  ModelSupplyControlPlaneService,
} from './foundation-module.js';
import {
  ContentWorkflowRunner,
  InMemoryDurableVideoWorkflowStore,
  ModelSupplyApplicationService,
  type VideoQualityScoringPort,
} from './index.js';
import {
  DurableMediaGenerationApplicationService,
  ModelMediaGenerationEffect,
} from './media-generation-workflow.js';

class RecordingContentPackages implements VideoContentPackagePort {
  readonly confirmations: VideoContentPackageConfirmation[] = [];
  readonly outcomes: VideoContentPackageOutcome[] = [];

  constructor(private readonly delegate: VideoContentPackagePort) {}

  async confirm(input: VideoContentPackageConfirmation) {
    this.confirmations.push(structuredClone(input));
    await this.delegate.confirm(input);
  }

  async reconcile(input: VideoContentPackageOutcome) {
    this.outcomes.push(structuredClone(input));
    await this.delegate.reconcile(input);
  }
}

const calibratedScorer: VideoQualityScoringPort = {
  async score(input) {
    return {
      score: 0.9,
      dimensions: {
        humanAnatomy: 0.9,
        sourceConsistency: 0.9,
        crossShotContinuity: 0.9,
        subtitleOcclusion: 0.9,
        publishRisk: 0.9,
      },
      publishWarnings: [],
      scorerRevision: 'runtime-integration-human-calibration-v1',
      calibration: 'recorded_human_fixture',
      calibrationEvidence: {
        datasetRevision: 'runtime-integration-dataset-v1',
        sampleId: 'runtime-integration-video-001',
        raterCount: 2,
        annotatedAt: '2026-07-18T00:00:00.000Z',
        assetFingerprint: input.asset.sha256.slice(0, 16),
        priorAssetFingerprints: input.priorSelectedAssets.map((asset) =>
          asset.sha256.slice(0, 16),
        ),
        peerCandidateFingerprints: input.peerCandidateAssets.map((asset) =>
          asset.sha256.slice(0, 16),
        ),
      },
    };
  },
};

test('published Ark video runs once through durable ledger, ffmpeg, labels, and ContentPackage provenance', async (t) => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'meiye-video-runtime-'));
  t.after(() => rm(rootDirectory, { force: true, recursive: true }));

  const fixtureProvider = new RecordedAdapterRouter();
  const fixtureRequest = {
    ...recordedRequest('seedance-2', 'video.generate', {
      durationSeconds: 1,
      height: 1280,
      width: 720,
    }),
    effectIdempotencyKey: 'video-runtime-fixture-source',
  };
  const fixtureReceipt = await fixtureProvider.submit(fixtureRequest);
  assert.ok(fixtureReceipt.taskRef);
  const fixtureVideo = await fixtureProvider.download({
    ...fixtureRequest,
    taskRef: fixtureReceipt.taskRef,
  });

  const providerCalls = { submit: 0, poll: 0, download: 0 };
  const ark = new ArkMediaExecutionPort({
    apiKey: 'ark-runtime-secret',
    assetFetch: {
      async get(target, constraints) {
        providerCalls.download += 1;
        assert.equal(target, 'https://media.example.test/runtime-video.mp4');
        assert.deepEqual(constraints.allowedMimeTypes, ['video/mp4']);
        return {
          bytes: fixtureVideo.bytes,
          finalUrl: target,
          mimeType: 'video/mp4',
        };
      },
    },
    baseUrl: 'https://ark.example.test/api/v3',
    credentialVersion: 'ark-key-v3',
    endpointRevision: 'ark-media-v1',
    fetch: async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST' && url.endsWith('/contents/generations/tasks')) {
        providerCalls.submit += 1;
        const body = JSON.parse(String(init.body)) as {
          duration?: number;
          content?: Array<{ text?: string }>;
        };
        assert.equal(body.duration, 15);
        assert.match(body.content?.[0]?.text ?? '', /9:16/);
        return Response.json({ id: 'ark-runtime-task-1' });
      }
      if (init?.method === 'GET' && url.endsWith('/ark-runtime-task-1')) {
        providerCalls.poll += 1;
        return Response.json({
          id: 'ark-runtime-task-1',
          status: 'succeeded',
          content: { video_url: 'https://media.example.test/runtime-video.mp4' },
          usage: { output_tokens: 150_000 },
          updated_at: '2026-07-18T00:00:10.000Z',
        });
      }
      throw new Error(`Unexpected Ark request ${init?.method ?? 'GET'} ${url}`);
    },
    image: {
      catalogModelId: 'seedream-5-pro',
      costPerImage: 0.22,
      model: 'unused-seedream-model',
    },
    sourceUrlTtlSeconds: 3_600,
    video: {
      catalogModelId: 'seedance-2',
      costPerMillionTokens: 28,
      estimatedTokensPerSecond: 10_000,
      model: 'doubao-seedance-2-0-test',
    },
  });

  const foundationRepository = new MemoryFoundationRepository();
  foundationRepository.grantOwner('workspace-video-runtime', 'owner-video-runtime');
  const foundation = new P1ApplicationService(foundationRepository);
  const ledger = new FoundationModelSupplyLedger(foundation, {
    async resolve() {
      return {
        revision: 'video-runtime-plan-v1',
        tier: 'pro',
        allowance: { audio: 0, copy: 0, image: 0, video: 10 },
        concurrencyLimit: 2,
        queuePriority: 100,
        supportLabel: 'priority',
        addOns: [],
        autoTopUp: {
          enabled: false,
          monthlyCapMicros: 0,
          spentThisMonthMicros: 0,
        },
      };
    },
  });
  const storage = new FileSystemAssetStorage({ rootDirectory });
  const models = createDefaultCatalogModels();
  const deployments = createDefaultDeployments({
    activatedDeploymentIds: ['seedance-2-direct'],
    activationEvidenceStatus: 'recorded',
  });
  const modelSupply = new ModelSupplyApplicationService({
    assetStorage: storage,
    deployments,
    execution: ark,
    ledger,
    models,
  });
  const catalogRepository = new MemoryModelSupplyControlPlaneRepository();
  const controlPlane = new ModelSupplyControlPlaneService({
    application: modelSupply,
    repository: catalogRepository,
  });
  const draftRevision = await controlPlane.createCatalogDraft(
    'workspace-video-runtime',
    {
      models,
      deployments,
      capabilities: createDefaultCapabilityRevisions(),
      prices: createDefaultPriceRevisions(),
      routes: createDefaultRouteRevisions(),
    },
  );
  const enabledRevision = await controlPlane.enableCatalog(
    'workspace-video-runtime',
    draftRevision.id,
  );
  const publishedRevision = await controlPlane.publishCatalog(
    'workspace-video-runtime',
    enabledRevision.id,
    null,
  );
  assert.equal(publishedRevision.stage, 'published');

  const mediaRepository = new MemoryTracerJobRepository(new MemoryJobPort());
  const mediaJobs = new TracerJobApplicationService(mediaRepository);
  const mediaRuntime = new DurableMediaGenerationApplicationService({
    jobs: mediaJobs,
    models: modelSupply,
    provider: ark,
  });
  modelSupply.attachDurableMediaRuntime(mediaRuntime);
  const mediaWorker = new DurableTracerWorker(
    mediaRepository,
    new ModelMediaGenerationEffect({ models: modelSupply, provider: ark }),
  );

  let freezeCalls = 0;
  const freezeRoute = modelSupply.freezeFixedRoute.bind(modelSupply);
  modelSupply.freezeFixedRoute = (input) => {
    freezeCalls += 1;
    return freezeRoute(input);
  };
  const runner = new ContentWorkflowRunner(
    modelSupply,
    videoCompositionRuntimeFromEnv({}, storage),
    new InMemoryDurableVideoWorkflowStore(),
    calibratedScorer,
  );
  const operationsRepository = new MemoryOperationsRepository();
  operationsRepository.grantMembership(
    'owner-video-runtime',
    'workspace-video-runtime',
  );
  const operations = new OperationsApplicationService(operationsRepository, {
    canvasExporter: new RecordedCanvasExportAdapter(),
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
    clock: () => new Date('2026-07-18T00:00:00.000Z'),
  });
  const contentPackages = new RecordingContentPackages(
    new OperationsVideoContentPackageAdapter(() => operations),
  );
  const parentRepository = new MemoryTracerJobRepository(new MemoryJobPort());
  const parentJobs = new TracerJobApplicationService(parentRepository);
  const application = new DurableComposedVideoApplicationService({
    contentPackages,
    jobs: parentJobs,
    runnerForWorkspace: () => runner,
  });
  const parentWorker = new DurableTracerWorker(
    parentRepository,
    new ComposedVideoJobEffect(() => runner, contentPackages),
  );

  await application.createDraft({
    workspaceId: 'workspace-video-runtime',
    actorId: 'owner-video-runtime',
    workflowId: 'published-ark-video-runtime',
    storyboardRevision: 'storyboard-runtime-v1',
    catalogModelId: 'seedance-2',
    dataClass: [],
    executionContract: {
      aigcLabelEnabled: true,
      aspectRatio: '9:16',
      catalogModelId: 'seedance-2',
      catalogRevision: publishedRevision.id,
      currency: 'CNY',
      dataClass: [],
      durationSeconds: 15,
      estimatedAmount: 12,
      operation: 'video.generate',
      outputCount: 1,
      outputLabel: '15 second composed video',
      quoteAcceptedAt: '2026-07-18T00:00:00.000Z',
      quoteRevision: 'quote-video-runtime-v1',
      watermarkEnabled: false,
    },
    aigcLabelEnabled: true,
    shots: [
      {
        id: 'opening',
        prompt: '干净的美业门店开场',
        candidatesPerShot: 1,
        durationSeconds: 15,
        height: 1280,
        width: 720,
      },
    ],
  });
  const confirmed = await application.confirmAndSubmit({
    workspaceId: 'workspace-video-runtime',
    workflowId: 'published-ark-video-runtime',
  });
  const replayedConfirmation = await application.confirmAndSubmit({
    workspaceId: 'workspace-video-runtime',
    workflowId: 'published-ark-video-runtime',
  });
  assert.equal(replayedConfirmation.job.jobId, confirmed.job.jobId);
  assert.equal(freezeCalls, 1);
  assert.equal(confirmed.workflow.routeSnapshot?.catalogRevisionId, publishedRevision.id);

  const parentEnvelope = makeDurableJobEnvelope(
    {
      jobId: confirmed.job.jobId,
      workspaceId: confirmed.job.workspaceId,
      kind: COMPOSED_VIDEO_JOB_KIND,
      payload: { workflowId: 'published-ark-video-runtime' },
    },
    new Date('2026-07-18T00:01:00.000Z'),
  );
  assert.equal((await parentWorker.handle(parentEnvelope)).status, 'deferred');
  const pending = runner.getVideoWorkflow(
    'published-ark-video-runtime',
    'workspace-video-runtime',
  );
  const childJobId = pending.shots[0]?.candidates[0]?.attempt.jobId;
  assert.ok(childJobId);
  const childRecord = await mediaJobs.get('workspace-video-runtime', childJobId);
  const childEnvelope = makeDurableJobEnvelope(
    {
      jobId: childRecord.jobId,
      workspaceId: childRecord.workspaceId,
      kind: childRecord.kind,
      payload: childRecord.payload,
    },
    new Date(childRecord.createdAt),
  );
  assert.equal((await mediaWorker.handle(childEnvelope)).status, 'deferred');
  assert.equal((await mediaWorker.handle(childEnvelope)).status, 'completed');
  assert.equal((await parentWorker.handle(parentEnvelope)).status, 'completed');

  const completed = (
    await application.query({
      workspaceId: 'workspace-video-runtime',
      workflowId: 'published-ark-video-runtime',
    })
  ).workflow;
  assert.equal(completed.status, 'completed');
  assert.equal(completed.routeSnapshot?.catalogRevisionId, publishedRevision.id);
  assert.equal(completed.shots[0]?.candidates[0]?.routeSnapshot.id, completed.routeSnapshot?.id);
  const composedAsset = completed.composedAsset;
  assert.ok(composedAsset);
  assert.equal(composedAsset.technicalValidation?.playable, true);
  assert.equal(composedAsset.technicalValidation?.evidenceKind, 'measured');
  assert.equal(composedAsset.compositionEvidence?.aigc.requested, true);
  const persistedLabels = await validateVideoLabels({
    filePath: join(rootDirectory, composedAsset.objectKey),
    expectedVisibleLabel: '内容由 AI 生成',
    expectedImplicitLabel: {
      contentId: 'published-ark-video-runtime',
      serviceCode: 'ffmpeg-compose-v1',
      serviceProvider: 'meiye-content-workflow',
    },
  });
  assert.equal(persistedLabels.visibleLabel, '内容由 AI 生成');
  assert.deepEqual(persistedLabels.implicitLabel, {
    contentId: 'published-ark-video-runtime',
    contentType: 'ai_generated',
    serviceCode: 'ffmpeg-compose-v1',
    serviceProvider: 'meiye-content-workflow',
  });
  await assert.rejects(
    validateVideoLabels({
      filePath: join(rootDirectory, composedAsset.objectKey),
      expectedVisibleLabel: '内容由 AI 生成',
      expectedImplicitLabel: {
        contentId: 'wrong-workflow',
        serviceCode: 'ffmpeg-compose-v1',
        serviceProvider: 'meiye-content-workflow',
      },
    }),
    /did not match the requested output evidence/u,
  );

  const attempts = await foundationRepository.listProviderAttempts(
    'workspace-video-runtime',
    childJobId,
  );
  assert.equal(attempts.length, 1);
  const costs = await foundationRepository.listProviderCosts(
    'workspace-video-runtime',
    attempts[0]!.id,
  );
  assert.deepEqual(
    costs.map((cost) => cost.stage).sort(),
    ['estimated', 'observed'],
  );
  assert.deepEqual(
    await foundation.getUsageProjection(
      {
        workspaceId: 'workspace-video-runtime',
        userId: 'owner-video-runtime',
        correlationId: 'video-runtime-assertion',
      },
      'video',
    ),
    { allowance: 10, reserved: 0, committed: 1, released: 0, available: 9 },
  );
  assert.deepEqual(providerCalls, { submit: 1, poll: 2, download: 1 });

  const outcome = contentPackages.outcomes.at(-1);
  assert.equal(outcome?.status, 'completed');
  if (outcome?.status === 'completed') {
    assert.equal(outcome.routeSnapshot.id, completed.routeSnapshot?.id);
    assert.equal(outcome.providerAttempts.length, 1);
    assert.equal(outcome.providerCosts.length, 2);
    assert.deepEqual(
      outcome.composedAsset.compositionEvidence,
      completed.composedAsset?.compositionEvidence,
    );
  }
  const persistedPackage = (
    await operations.listContentPackages({
      actor: 'owner',
      correlationId: 'video-runtime-content-package',
      userId: 'owner-video-runtime',
      workspaceId: 'workspace-video-runtime',
    })
  ).find(
    (contentPackage) =>
      contentPackage.source.workflowId === 'published-ark-video-runtime',
  );
  assert.ok(persistedPackage);
  assert.equal(persistedPackage.status, 'accepted');
  assert.equal(
    persistedPackage.source.executionContract?.quoteRevision,
    'quote-video-runtime-v1',
  );
  assert.equal(
    persistedPackage.generated.childRuns[0]?.routeSnapshot?.id,
    completed.routeSnapshot?.id,
  );
  assert.deepEqual(
    persistedPackage.generated.childRuns[0]?.providerAttempts,
    outcome?.status === 'completed' ? outcome.providerAttempts : undefined,
  );
  assert.deepEqual(
    persistedPackage.generated.childRuns[0]?.providerCosts,
    outcome?.status === 'completed' ? outcome.providerCosts : undefined,
  );
  assert.deepEqual(
    persistedPackage.generated.ownedAssets?.[0]?.compositionEvidence,
    completed.composedAsset?.compositionEvidence,
  );

  const beforeReplay = {
    calls: structuredClone(providerCalls),
    costs: structuredClone(costs),
    usage: await foundation.getUsageProjection(
      {
        workspaceId: 'workspace-video-runtime',
        userId: 'owner-video-runtime',
        correlationId: 'video-runtime-replay',
      },
      'video',
    ),
  };
  assert.equal((await parentWorker.handle(parentEnvelope)).status, 'completed');
  assert.deepEqual(providerCalls, beforeReplay.calls);
  assert.deepEqual(
    await foundationRepository.listProviderCosts(
      'workspace-video-runtime',
      attempts[0]!.id,
    ),
    beforeReplay.costs,
  );
  assert.deepEqual(
    await foundation.getUsageProjection(
      {
        workspaceId: 'workspace-video-runtime',
        userId: 'owner-video-runtime',
        correlationId: 'video-runtime-replay-after',
      },
      'video',
    ),
    beforeReplay.usage,
  );
});

test('the composed-video outer service does not own route planning or ledger settlement', async () => {
  const source = await readFile(
    new URL('./composed-video-workflow.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /FoundationModelSupplyLedger/);
  assert.doesNotMatch(source, /checkpointAttempt|settleAttempt/);
  assert.doesNotMatch(source, /planModel|planCandidates/);
});
