import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { VideoLabelValidationError } from '../../video/validation.js';
import { MemoryJobPort } from '../foundation/memory-job-port.js';
import { P1ApplicationService } from '../foundation/application-service.js';
import { MemoryGrantLotLedger } from '../foundation/grant-lot.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import { makeDurableJobEnvelope } from '../job-runtime/job-contracts.js';
import type {
  VideoContentPackageConfirmation,
  VideoContentPackageOutcome,
} from '../video-content-package-port.js';
import {
  DurableTracerWorker,
  MemoryTracerJobRepository,
  TracerJobApplicationService,
} from '../job-runtime/tracer-worker.js';
import { createDefaultCatalogModels, createDefaultDeployments } from './catalog.js';
import {
  ComposedVideoJobEffect,
  COMPOSED_VIDEO_JOB_KIND,
  DurableComposedVideoApplicationService,
  createComposedVideoJobHandler,
} from './composed-video-workflow.js';
import {
  MemoryModelSupplyControlPlaneRepository,
  ModelSupplyControlPlaneService,
  ModelSupplyFoundationModule,
} from './foundation-module.js';
import {
  PersistentContentWorkflowRunner,
  type AsyncDurableVideoWorkflowStore,
} from './postgres-repository.js';
import {
  ContentWorkflowRunner,
  FoundationModelSupplyLedger,
  InMemoryDurableVideoWorkflowStore,
  MemoryModelAssetStorage,
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
  runDurableVideoWorkflow,
  VersionedHumanCalibratedVideoQualityScorer,
  RECORDED_BEAUTY_VIDEO_CALIBRATION_SET_V1,
  RecordedVideoCompositionPort,
  type VideoCompositionPort,
  type VideoExecutionContract,
  type VideoQualityScoringPort,
  type DurableVideoWorkflow,
  type DurableVideoWorkflowSaveOptions,
  type DurableVideoWorkflowStore,
  type DurableMediaGenerationJobView,
  type ModelSupplyLedgerPort,
} from './index.js';

function frozenVideoContract(
  overrides: Partial<VideoExecutionContract> = {}
): VideoExecutionContract {
  return {
    aigcLabelEnabled: false,
    aspectRatio: '9:16',
    catalogModelId: 'seedance-2',
    catalogRevision: 'catalog-video-v1',
    currency: 'CNY',
    dataClass: [],
    durationSeconds: 15,
    estimatedAmount: 12,
    operation: 'video.generate',
    outputCount: 1,
    outputLabel: '15 second composed video',
    quoteAcceptedAt: '2026-07-18T00:00:00.000Z',
    quoteRevision: 'quote-video-v1',
    watermarkEnabled: false,
    ...overrides,
  };
}

it('uses exact human-rated fingerprints and sends unknown assets to review', async () => {
  const scorer = new VersionedHumanCalibratedVideoQualityScorer();
  const score = (sha256: string) =>
    scorer.score({
      workflowId: 'quality-workflow',
      workspaceId: 'workspace-a',
      storyboardRevision: 'storyboard-v1',
      shotId: 'shot-a',
      prompt: '门店项目细节',
      candidateIndex: 0,
      asset: {
        id: `asset-${sha256.slice(0, 8)}`,
        objectKey: `workspace-a/generated/${sha256}.mp4`,
        sha256,
        sizeBytes: 10,
        contentType: 'video/mp4',
        sourceTaskRef: `recorded-task-${sha256.slice(0, 12)}`,
      },
      priorSelectedAssets: [],
      peerCandidateAssets: [],
    });

  const first = await score('00000000'.padEnd(64, '0'));
  const second = await score('00000001'.padEnd(64, '0'));
  assert.equal(
    first.calibrationEvidence?.datasetRevision,
    RECORDED_BEAUTY_VIDEO_CALIBRATION_SET_V1.revision
  );
  assert.equal(first.calibrationEvidence?.raterCount, 4);
  assert.match(first.calibrationEvidence?.assetFingerprint ?? '', /^[a-f0-9]{16}$/);
  assert.equal(
    'subtitleEvidenceHash' in (first.calibrationEvidence ?? {}),
    false,
  );
  assert.equal(second.calibration, 'unscored_requires_human_review');
  assert.ok(
    second.publishWarnings.includes(
      'human_quality_review_required_before_publish'
    )
  );
});

class CandidateAwareScorer implements VideoQualityScoringPort {
  readonly calls: Array<Parameters<VideoQualityScoringPort['score']>[0]> = [];

  async score(input: Parameters<VideoQualityScoringPort['score']>[0]) {
    this.calls.push(structuredClone(input));
    const score = input.candidateIndex === 1 ? 0.91 : 0.62;
    return {
      score,
      dimensions: {
        humanAnatomy: score,
        sourceConsistency: score - 0.01,
        crossShotContinuity: score - 0.02,
        subtitleOcclusion: score - 0.03,
        publishRisk: score - 0.04,
      },
      publishWarnings: input.candidateIndex === 0 ? ['recorded_publish_review'] : [],
      scorerRevision: 'human-calibrated-test-v1',
      calibration: 'recorded_human_fixture' as const,
      calibrationEvidence: {
        datasetRevision: 'human-calibrated-test-set-v1',
        sampleId: `candidate-${input.candidateIndex}`,
        raterCount: 2,
        annotatedAt: '2026-07-01T00:00:00.000Z',
        assetFingerprint: input.asset.sha256.slice(0, 16),
        priorAssetFingerprints: input.priorSelectedAssets.map((asset) =>
          asset.sha256.slice(0, 16)
        ),
        peerCandidateFingerprints: input.peerCandidateAssets.map((asset) =>
          asset.sha256.slice(0, 16)
        ),
      },
    };
  }
}

class HumanReviewRequiredScorer implements VideoQualityScoringPort {
  async score() {
    return {
      score: 0.5,
      dimensions: {
        humanAnatomy: 0.5,
        sourceConsistency: 0.5,
        crossShotContinuity: 0.5,
        subtitleOcclusion: 0.5,
        publishRisk: 0.5,
      },
      publishWarnings: ['human_quality_review_required_before_publish'],
      scorerRevision: 'unscored-video-quality-v1',
      calibration: 'unscored_requires_human_review' as const,
    };
  }
}

class RecordingVideoContentPackagePort {
  readonly confirmations: VideoContentPackageConfirmation[] = [];
  readonly outcomes: VideoContentPackageOutcome[] = [];

  async confirm(input: VideoContentPackageConfirmation) {
    this.confirmations.push(structuredClone(input));
  }

  async reconcile(input: VideoContentPackageOutcome) {
    this.outcomes.push(structuredClone(input));
  }
}

class CrashAfterProviderWorkflowStore implements DurableVideoWorkflowStore {
  private readonly store = new InMemoryDurableVideoWorkflowStore();
  private crashed = false;

  get(id: string) {
    return this.store.get(id);
  }

  list(workspaceId: string, actorId: string) {
    return this.store.list(workspaceId, actorId);
  }

  findLatest(workspaceId: string, actorId: string) {
    return this.store.findLatest(workspaceId, actorId);
  }

  save(
    workflow: DurableVideoWorkflow,
    options?: DurableVideoWorkflowSaveOptions,
  ) {
    if (
      workflow.shots.some((shot) => shot.candidates.length > 0) &&
      !this.crashed
    ) {
      this.crashed = true;
      throw new Error('simulated workflow checkpoint loss');
    }
    return this.store.save(workflow, options);
  }

  claimRun(id: string, workspaceId: string, leaseToken: string) {
    return this.store.claimRun(id, workspaceId, leaseToken);
  }

  requestCancel(id: string, workspaceId: string, requestedAt: string) {
    return this.store.requestCancel(id, workspaceId, requestedAt);
  }

  assertRunnable(
    id: string,
    workspaceId: string,
    revision: number,
    leaseToken: string,
  ) {
    this.store.assertRunnable(id, workspaceId, revision, leaseToken);
  }
}

class CrashAfterCompositionWorkflowStore implements DurableVideoWorkflowStore {
  private readonly store = new InMemoryDurableVideoWorkflowStore();
  private crashed = false;

  get(id: string) {
    return this.store.get(id);
  }

  list(workspaceId: string, actorId: string) {
    return this.store.list(workspaceId, actorId);
  }

  findLatest(workspaceId: string, actorId: string) {
    return this.store.findLatest(workspaceId, actorId);
  }

  save(
    workflow: DurableVideoWorkflow,
    options?: DurableVideoWorkflowSaveOptions,
  ) {
    if (workflow.composedAsset && !this.crashed) {
      this.crashed = true;
      throw new Error('simulated composition checkpoint loss');
    }
    return this.store.save(workflow, options);
  }

  claimRun(id: string, workspaceId: string, leaseToken: string) {
    return this.store.claimRun(id, workspaceId, leaseToken);
  }

  requestCancel(id: string, workspaceId: string, requestedAt: string) {
    return this.store.requestCancel(id, workspaceId, requestedAt);
  }

  assertRunnable(
    id: string,
    workspaceId: string,
    revision: number,
    leaseToken: string,
  ) {
    this.store.assertRunnable(id, workspaceId, revision, leaseToken);
  }
}

function asyncMemoryWorkflowStore(): AsyncDurableVideoWorkflowStore {
  const store = new InMemoryDurableVideoWorkflowStore();
  return {
    async get(id) {
      return store.get(id);
    },
    async list(workspaceId, actorId) {
      return store.list(workspaceId, actorId);
    },
    async findLatest(workspaceId, actorId, workId) {
      return store.findLatest(workspaceId, actorId, workId);
    },
    async save(workflow, options) {
      return store.save(workflow, options);
    },
    async claimRun(id, workspaceId, leaseToken) {
      return store.claimRun(id, workspaceId, leaseToken);
    },
    async requestCancel(id, workspaceId, requestedAt) {
      return store.requestCancel(id, workspaceId, requestedAt);
    },
    async assertRunnable(id, workspaceId, revision, leaseToken) {
      store.assertRunnable(id, workspaceId, revision, leaseToken);
    },
  };
}

function setup(options: {
  beforeProviderExecute?: () => Promise<void>;
  candidatePlayable?: boolean;
  composer?: VideoCompositionPort;
  providerFailureCode?: string;
  qualityScorer?: VideoQualityScoringPort;
} = {}) {
  const execution = new RecordedProviderExecutionPort();
  const recordedComposition = new RecordedVideoCompositionPort();
  const assetStorage = new MemoryModelAssetStorage();
  let executions = 0;
  const submissions: Array<{
    actorId: string;
    dataClass: string[];
    input: {
      durationSeconds?: number;
      height?: number;
      referenceAssetIds?: string[];
      width?: number;
    };
    productUsageQuantity?: 0 | 1;
    referenceAssetIds: string[];
  }> = [];
  const compositions: Array<{
    aigcLabelEnabled: boolean;
    compositionKey: string;
  }> = [];
  const models = new ModelSupplyApplicationService({
    models: createDefaultCatalogModels(),
    deployments: createDefaultDeployments({
      activatedDeploymentIds: ['seedance-2-direct'],
    }),
    execution: {
      async execute(request) {
        executions += 1;
        submissions.push({
          actorId: request.submission.actorId,
          dataClass: [...request.submission.dataClass],
          input: structuredClone(request.submission.input ?? {}),
          productUsageQuantity: request.submission.productUsageQuantity,
          referenceAssetIds: [
            ...(request.submission.input?.referenceAssetIds ?? []),
          ],
        });
        await options.beforeProviderExecute?.();
        if (options.providerFailureCode) {
          return {
            acceptance: 'rejected_before_accept' as const,
            errorCode: options.providerFailureCode,
            kind: 'failure' as const,
            message: options.providerFailureCode,
            providerCost: {
              amount: 0,
              currency: 'USD' as const,
              usage: {},
            },
            retryable: false,
          };
        }
        return execution.execute(request);
      },
    },
    ...(options.candidatePlayable === undefined
      ? {}
      : {
          assetStorage: {
            async persistGeneratedAsset(input) {
              const asset = await assetStorage.persistGeneratedAsset(input);
              return asset.technicalValidation
                ? {
                    ...asset,
                    technicalValidation: {
                      ...asset.technicalValidation,
                      playable: options.candidatePlayable ?? true,
                    },
                  }
                : asset;
            },
          },
        }),
  });
  const store = new InMemoryDurableVideoWorkflowStore();
  const runner = new ContentWorkflowRunner(
    models,
    {
      async compose(input) {
        compositions.push({
          aigcLabelEnabled: input.aigcLabelEnabled,
          compositionKey: input.compositionKey,
        });
        return (options.composer ?? recordedComposition).compose(input);
      },
    },
    store,
    options.qualityScorer ?? new CandidateAwareScorer(),
  );
  const queue = new MemoryJobPort();
  const tracerRepository = new MemoryTracerJobRepository(queue);
  const tracer = new TracerJobApplicationService(tracerRepository);
  const contentPackages = new RecordingVideoContentPackagePort();
  const application = new DurableComposedVideoApplicationService({
    contentPackages,
    jobs: tracer,
    runnerForWorkspace: () => runner,
  });
  const effect = new ComposedVideoJobEffect(() => runner, contentPackages);
  const worker = new DurableTracerWorker(tracerRepository, effect);
  return {
    application,
    compositions,
    contentPackages,
    executions: () => executions,
    models,
    queue,
    runner,
    submissions,
    tracer,
    worker,
  };
}

function setupWithFailedPackageConfirmation() {
  const setupResult = setup();
  let failNextConfirmation = true;
  let jobSubmissions = 0;
  const application = new DurableComposedVideoApplicationService({
    contentPackages: {
      async confirm(input) {
        if (failNextConfirmation) {
          failNextConfirmation = false;
          throw new Error('simulated ContentPackage confirmation loss');
        }
        return setupResult.contentPackages.confirm(input);
      },
      reconcile(input) {
        return setupResult.contentPackages.reconcile(input);
      },
    },
    jobs: {
      async submit(input) {
        jobSubmissions += 1;
        return setupResult.tracer.submit(input);
      },
      get(workspaceId, jobId) {
        return setupResult.tracer.get(workspaceId, jobId);
      },
      cancel(workspaceId, jobId) {
        return setupResult.tracer.cancel(workspaceId, jobId);
      },
    },
    runnerForWorkspace: () => setupResult.runner,
  });
  return { ...setupResult, application, jobSubmissions: () => jobSubmissions };
}

async function setupOuterVideoFailure(input: {
  composer: VideoCompositionPort;
  id: string;
  ledger?: (
    foundationLedger: FoundationModelSupplyLedger,
  ) => ModelSupplyLedgerPort;
}) {
  const workspaceId = `workspace-${input.id}`;
  const actorId = 'owner-outer-video-failure';
  const context = {
    workspaceId,
    userId: actorId,
    correlationId: `correlation-${input.id}`,
  };
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(workspaceId, actorId);
  const foundation = new P1ApplicationService(repository);
  await foundation.appendUsageEvent(
    context,
    {
      id: `video-entitlement-${input.id}`,
      resource: 'video',
      action: 'adjust',
      amount: 1,
      reason: 'video plan',
    },
    `video-entitlement-${input.id}`,
  );
  const grantLots = new MemoryGrantLotLedger();
  grantLots.grant({
    id: `video-grant-${input.id}`,
    workspaceId,
    resource: 'video',
    amount: 1,
    expirationDate: null,
    transactionType: 'PURCHASE_PACKAGE',
    createdAt: '2026-07-18T00:00:00.000Z',
  });
  const foundationLedger = new FoundationModelSupplyLedger(
    foundation,
    undefined,
    grantLots,
  );
  const recorded = new RecordedProviderExecutionPort();
  let executions = 0;
  const models = new ModelSupplyApplicationService({
    models: createDefaultCatalogModels(),
    deployments: createDefaultDeployments({
      activatedDeploymentIds: ['seedance-2-direct'],
    }),
    execution: {
      async execute(request) {
        executions += 1;
        return recorded.execute(request);
      },
    },
    ledger: input.ledger?.(foundationLedger) ?? foundationLedger,
  });
  let persisted: DurableVideoWorkflow = {
    id: `outer-video-failure-${input.id}`,
    workspaceId,
    actorId,
    storyboardVersion: 1,
    dataClass: [],
    aigcLabelEnabled: input.id.includes('label'),
    storyboardRevision: `storyboard-${input.id}`,
    confirmed: true,
    catalogModelId: 'seedance-2',
    shots: [
      {
        id: 'opening',
        prompt: '门店开场',
        candidatesPerShot: 1,
        candidates: [],
      },
    ],
    attempts: [],
    clipAssets: [],
    status: 'running',
    revision: 0,
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
  };
  const run = () =>
    runDurableVideoWorkflow({
      workflow: structuredClone(persisted),
      models,
      composer: input.composer,
      qualityScorer: new CandidateAwareScorer(),
      checkpoint: async (workflow) => {
        persisted = {
          ...structuredClone(workflow),
          revision: persisted.revision + 1,
        };
        return structuredClone(persisted);
      },
      clock: () => Date.parse('2026-07-19T00:00:00.000Z'),
    });
  return {
    executions: () => executions,
    foundation,
    grantLots,
    persisted: () => structuredClone(persisted),
    repository,
    run,
  };
}

describe('durable composed-video application seam', () => {
  const internalFailureDetail = 'sensitive-internal-video-stage-detail';
  const recordedComposition = new RecordedVideoCompositionPort();
  const deterministicStageFailures = [
    {
      code: 'COMPOSED_VIDEO_AIGC_VALIDATION_FAILED',
      name: 'requested AIGC label validation failure',
      setup: () =>
        setup({
          composer: {
            async compose() {
              throw new VideoLabelValidationError(
                'implicit_label_missing',
                internalFailureDetail
              );
            },
          },
        }),
    },
    {
      code: 'VIDEO_QUALITY_SCORING_FAILED',
      name: 'invalid quality assessment',
      setup: () =>
        setup({
          qualityScorer: {
            async score(input) {
              const assessment = await new CandidateAwareScorer().score(input);
              return { ...assessment, score: 2 };
            },
          },
        }),
    },
    {
      code: 'NO_PLAYABLE_VIDEO_CANDIDATE',
      name: 'no playable candidate',
      setup: () => setup({ candidatePlayable: false }),
    },
    {
      code: 'COMPOSED_VIDEO_TECHNICAL_VALIDATION_FAILED',
      name: 'composed asset technical validation failure',
      setup: () =>
        setup({
          composer: {
            async compose(input) {
              const asset = await recordedComposition.compose(input);
              return {
                ...asset,
                technicalValidation: {
                  ...asset.technicalValidation!,
                  playable: false,
                },
              };
            },
          },
        }),
    },
  ] as const;

  for (const failure of deterministicStageFailures) {
    it(`settles ${failure.name} as a normalized terminal failure`, async () => {
      const setupResult = failure.setup();
      const workflowId = `video-${failure.code.toLowerCase()}`;
      await setupResult.application.createDraft({
        actorId: 'owner-a',
        aigcLabelEnabled:
          failure.code === 'COMPOSED_VIDEO_AIGC_VALIDATION_FAILED',
        catalogModelId: 'seedance-2',
        dataClass: [],
        shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
        storyboardRevision: `story-${workflowId}`,
        workflowId,
        workspaceId: 'workspace-a',
      });
      await setupResult.application.confirmAndSubmit({
        workflowId,
        workspaceId: 'workspace-a',
      });

      const handled = await setupResult.worker.handle(
        makeDurableJobEnvelope(
          {
            jobId: `model.composed-video:${workflowId}`,
            kind: COMPOSED_VIDEO_JOB_KIND,
            payload: { workflowId },
            workspaceId: 'workspace-a',
          },
          new Date('2026-07-15T00:00:00.000Z'),
        ),
      );
      const workflow = setupResult.runner.getVideoWorkflow(
        workflowId,
        'workspace-a',
      );

      assert.equal(handled.status, 'dead_letter');
      assert.equal(workflow.status, 'failed');
      assert.equal(workflow.failureCode, failure.code);
      assert.equal(workflow.composedAsset, undefined);
      assert.deepEqual(setupResult.contentPackages.outcomes.at(-1), {
        actorId: 'owner-a',
        failureCode: failure.code,
        status: 'failed',
        workflowId,
        workspaceId: 'workspace-a',
      });
      assert.doesNotMatch(
        JSON.stringify({
          handled,
          workflow,
          outcome: setupResult.contentPackages.outcomes.at(-1),
        }),
        new RegExp(internalFailureDetail),
      );
    });
  }

  const outerCompositionFailures = [
    {
      code: 'COMPOSED_VIDEO_AIGC_VALIDATION_FAILED',
      id: 'label',
      composer: {
        async compose() {
          throw new VideoLabelValidationError(
            'implicit_label_missing',
            internalFailureDetail,
          );
        },
      },
    },
    {
      code: 'COMPOSED_VIDEO_TECHNICAL_VALIDATION_FAILED',
      id: 'technical',
      composer: {
        async compose(
          input: Parameters<VideoCompositionPort['compose']>[0],
        ) {
          const asset = await recordedComposition.compose(input);
          return {
            ...asset,
            technicalValidation: {
              ...asset.technicalValidation!,
              playable: false,
            },
          };
        },
      },
    },
    {
      code: 'COMPOSED_VIDEO_PROVENANCE_VALIDATION_FAILED',
      id: 'provenance',
      composer: {
        async compose(
          input: Parameters<VideoCompositionPort['compose']>[0],
        ) {
          const asset = await recordedComposition.compose(input);
          return {
            ...asset,
            compositionEvidence: {
              ...asset.compositionEvidence!,
              outputSha256: '0'.repeat(64),
            },
          };
        },
      },
    },
  ] as const;

  for (const failure of outerCompositionFailures) {
    it(`restores committed video usage after ${failure.id} composition failure`, async () => {
      const fixture = await setupOuterVideoFailure(failure);

      const failed = await fixture.run();

      assert.equal(failed.status, 'failed');
      assert.equal(failed.failureCode, failure.code);
      assert.equal(failed.shots[0]?.candidates[0]?.status, 'completed');
      assert.deepEqual(
        await fixture.foundation.getUsageProjection(
          {
            workspaceId: failed.workspaceId,
            userId: failed.actorId,
            correlationId: `projection-${failure.id}`,
          },
          'video',
        ),
        {
          allowance: 1,
          reserved: 0,
          committed: 0,
          released: 0,
          available: 1,
        },
      );
      assert.deepEqual(
        (await fixture.repository.listUsageEvents(failed.workspaceId, 'video'))
          .filter((event) => event.action !== 'adjust')
          .map((event) => event.action),
        ['reserve', 'commit', 'compensate'],
      );
      const grantTransactions = fixture.grantLots.listTransactions(
        failed.workspaceId,
      );
      const usage = grantTransactions.find(
        (transaction) => transaction.transactionType === 'USAGE',
      );
      const refund = grantTransactions.find(
        (transaction) => transaction.transactionType === 'REFUND',
      );
      assert.ok(usage);
      assert.equal(refund?.relatedTransactionId, usage.id);
      assert.equal(
        fixture.grantLots.listLots(failed.workspaceId, 'video')[0]
          ?.remainingAmount,
        1,
      );
    });
  }

  it('retries outer video compensation instead of durably swallowing a ledger outage', async () => {
    let compensationAttempts = 0;
    const fixture = await setupOuterVideoFailure({
      id: 'label-retry',
      composer: {
        async compose() {
          throw new VideoLabelValidationError(
            'implicit_label_missing',
            internalFailureDetail,
          );
        },
      },
      ledger: (ledger) => ({
        checkpointAttempt: (checkpoint) => ledger.checkpointAttempt(checkpoint),
        settleAttempt: (settlement) => ledger.settleAttempt(settlement),
        async compensateCommittedUsage(compensation) {
          compensationAttempts += 1;
          if (compensationAttempts === 1) {
            throw new Error('temporary compensation outage');
          }
          return ledger.compensateCommittedUsage(compensation);
        },
      }),
    });

    await assert.rejects(fixture.run(), /temporary compensation outage/);
    assert.equal(fixture.persisted().status, 'running');
    assert.equal(fixture.executions(), 1);

    const failed = await fixture.run();

    assert.equal(failed.status, 'failed');
    assert.equal(compensationAttempts, 2);
    assert.equal(fixture.executions(), 1);
  });

  it('retries a transient quality scorer error without regenerating its clip', async () => {
    const recordedScorer = new CandidateAwareScorer();
    let scorerAttempts = 0;
    const setupResult = setup({
      qualityScorer: {
        async score(input) {
          scorerAttempts += 1;
          if (scorerAttempts === 1) {
            throw new Error(internalFailureDetail);
          }
          return recordedScorer.score(input);
        },
      },
    });
    await setupResult.application.createDraft({
      actorId: 'owner-a',
      catalogModelId: 'seedance-2',
      dataClass: [],
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
      storyboardRevision: 'story-transient-scorer',
      workflowId: 'video-transient-scorer',
      workspaceId: 'workspace-a',
    });
    const confirmed = await setupResult.application.confirmAndSubmit({
      workflowId: 'video-transient-scorer',
      workspaceId: 'workspace-a',
    });
    const envelope = makeDurableJobEnvelope(
      {
        jobId: confirmed.job.jobId,
        kind: COMPOSED_VIDEO_JOB_KIND,
        payload: { workflowId: 'video-transient-scorer' },
        workspaceId: 'workspace-a',
      },
      new Date('2026-07-15T00:00:00.000Z'),
    );

    assert.equal((await setupResult.worker.handle(envelope)).status, 'deferred');
    const checkpoint = setupResult.runner.getVideoWorkflow(
      'video-transient-scorer',
      'workspace-a',
    );
    assert.equal(checkpoint.status, 'running');
    assert.equal(checkpoint.failureCode, undefined);
    assert.equal(checkpoint.shots[0]?.candidates.length, 1);
    assert.equal(checkpoint.shots[0]?.candidates[0]?.status, 'generated');
    assert.equal(setupResult.executions(), 1);
    assert.equal(setupResult.compositions.length, 0);
    assert.equal(setupResult.contentPackages.outcomes.length, 0);

    assert.equal((await setupResult.worker.handle(envelope)).status, 'completed');
    const completed = setupResult.runner.getVideoWorkflow(
      'video-transient-scorer',
      'workspace-a',
    );
    assert.equal(completed.status, 'completed');
    assert.equal(scorerAttempts, 2);
    assert.equal(setupResult.executions(), 1);
    assert.equal(setupResult.compositions.length, 1);
  });

  it('retries a transient composer error with the same clips and composition key', async () => {
    let composerAttempts = 0;
    const setupResult = setup({
      composer: {
        async compose(input) {
          composerAttempts += 1;
          if (composerAttempts === 1) {
            throw new Error(internalFailureDetail);
          }
          return recordedComposition.compose(input);
        },
      },
    });
    await setupResult.application.createDraft({
      actorId: 'owner-a',
      catalogModelId: 'seedance-2',
      dataClass: [],
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
      storyboardRevision: 'story-transient-composer',
      workflowId: 'video-transient-composer',
      workspaceId: 'workspace-a',
    });
    const confirmed = await setupResult.application.confirmAndSubmit({
      workflowId: 'video-transient-composer',
      workspaceId: 'workspace-a',
    });
    const envelope = makeDurableJobEnvelope(
      {
        jobId: confirmed.job.jobId,
        kind: COMPOSED_VIDEO_JOB_KIND,
        payload: { workflowId: 'video-transient-composer' },
        workspaceId: 'workspace-a',
      },
      new Date('2026-07-15T00:00:00.000Z'),
    );

    assert.equal((await setupResult.worker.handle(envelope)).status, 'deferred');
    const checkpoint = setupResult.runner.getVideoWorkflow(
      'video-transient-composer',
      'workspace-a',
    );
    assert.equal(checkpoint.status, 'running');
    assert.equal(checkpoint.failureCode, undefined);
    assert.equal(checkpoint.clipAssets.length, 1);
    assert.equal(setupResult.executions(), 1);
    assert.equal(setupResult.compositions.length, 1);

    assert.equal((await setupResult.worker.handle(envelope)).status, 'completed');
    const completed = setupResult.runner.getVideoWorkflow(
      'video-transient-composer',
      'workspace-a',
    );
    assert.equal(completed.status, 'completed');
    assert.equal(composerAttempts, 2);
    assert.equal(setupResult.executions(), 1);
    assert.equal(setupResult.compositions.length, 2);
    assert.equal(
      setupResult.compositions[0]?.compositionKey,
      setupResult.compositions[1]?.compositionKey,
    );
  });

  it('settles a failed child as a terminal workflow and failed ContentPackage outcome', async () => {
    const setupResult = setup({
      providerFailureCode: 'reference_asset_resolution_required',
    });
    await setupResult.application.createDraft({
      actorId: 'owner-a',
      catalogModelId: 'seedance-2',
      dataClass: [],
      referenceAssetIds: ['asset-rights-missing'],
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
      storyboardRevision: 'story-failed-reference',
      workflowId: 'video-failed-reference',
      workspaceId: 'workspace-a',
    });
    await setupResult.application.confirmAndSubmit({
      workspaceId: 'workspace-a',
      workflowId: 'video-failed-reference',
    });

    const handled = await setupResult.worker.handle(
      makeDurableJobEnvelope(
        {
          jobId: 'model.composed-video:video-failed-reference',
          kind: COMPOSED_VIDEO_JOB_KIND,
          payload: { workflowId: 'video-failed-reference' },
          workspaceId: 'workspace-a',
        },
        new Date('2026-07-15T00:00:00.000Z')
      )
    );
    const workflow = setupResult.runner.getVideoWorkflow(
      'video-failed-reference',
      'workspace-a'
    );

    assert.equal(handled.status, 'dead_letter');
    assert.equal(workflow.status, 'failed');
    assert.equal(
      workflow.failureCode,
      'reference_asset_resolution_required'
    );
    assert.equal(
      workflow.shots[0]?.candidates[0]?.failureCode,
      'reference_asset_resolution_required'
    );
    assert.equal(setupResult.compositions.length, 0);
    assert.deepEqual(setupResult.contentPackages.outcomes.at(-1), {
      actorId: 'owner-a',
      failureCode: 'reference_asset_resolution_required',
      status: 'failed',
      workflowId: 'video-failed-reference',
      workspaceId: 'workspace-a',
    });
  });

  it('creates one video ContentPackage only when the storyboard is confirmed', async () => {
    const setupResult = setup();
    await setupResult.application.createDraft({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workId: 'work-video-package',
      workflowId: 'video-package-confirm',
      storyboardRevision: 'storyboard-package-v1',
      catalogModelId: 'seedance-2',
      dataClass: [],
      referenceAssetIds: ['asset-real-storefront'],
      aigcLabelEnabled: true,
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });
    assert.equal(setupResult.contentPackages.confirmations.length, 0);

    await setupResult.application.confirmAndSubmit({
      workspaceId: 'workspace-a',
      workflowId: 'video-package-confirm',
    });
    await setupResult.application.confirmAndSubmit({
      workspaceId: 'workspace-a',
      workflowId: 'video-package-confirm',
    });

    assert.equal(setupResult.contentPackages.confirmations.length, 2);
    assert.equal(
      setupResult.contentPackages.confirmations[0]?.workspaceId,
      'workspace-a',
    );
    assert.equal(
      setupResult.contentPackages.confirmations[0]?.workflowId,
      'video-package-confirm',
    );
    assert.equal(
      setupResult.contentPackages.confirmations[0]?.workId,
      'work-video-package',
    );
    assert.deepEqual(
      setupResult.contentPackages.confirmations[0]?.referenceAssetIds,
      ['asset-real-storefront'],
    );
  });

  it('keeps selected real reference Assets on every provider submission', async () => {
    const setupResult = setup();
    const draft = setupResult.runner.createVideoWorkflow({
      actorId: 'owner-a',
      catalogModelId: 'seedance-2',
      dataClass: [],
      referenceAssetIds: ['asset-real-b', 'asset-real-a'],
      shots: [{ id: 'opening', prompt: '真实门店开场', candidatesPerShot: 1 }],
      storyboardRevision: 'story-reference-assets',
      workflowId: 'video-reference-assets',
      workspaceId: 'workspace-a',
    });
    setupResult.runner.confirmVideoWorkflow(draft.id, 'workspace-a');

    await setupResult.runner.runVideoWorkflow(draft.id, 'workspace-a');

    assert.ok(setupResult.submissions.length > 0);
    assert.ok(
      setupResult.submissions.every(
        (submission) =>
          JSON.stringify(submission.referenceAssetIds) ===
          JSON.stringify(['asset-real-a', 'asset-real-b']),
      ),
    );
  });
  it('keeps reads side-effect free after package confirmation fails and resumes through confirm once', async () => {
    const setupResult = setupWithFailedPackageConfirmation();
    await setupResult.application.createDraft({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workId: 'work-package-confirm-retry',
      workflowId: 'package-confirm-retry',
      storyboardRevision: 'story-package-confirm-retry',
      catalogModelId: 'seedance-2',
      dataClass: [],
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });
    await assert.rejects(
      setupResult.application.confirmAndSubmit({
        workspaceId: 'workspace-a',
        workflowId: 'package-confirm-retry',
      }),
      /simulated ContentPackage confirmation loss/
    );

    const queried = await setupResult.application.query({
      workspaceId: 'workspace-a',
      workflowId: 'package-confirm-retry',
    });
    const latest = await setupResult.application.latest({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workId: 'work-package-confirm-retry',
    });
    const listed = await setupResult.application.list({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
    });

    assert.equal(queried.workflow.confirmed, true);
    assert.equal(queried.job, null);
    assert.equal(latest?.job, null);
    assert.equal(listed[0]?.job, null);
    assert.equal(setupResult.jobSubmissions(), 0);
    assert.equal((await setupResult.queue.list('workspace-a')).length, 0);

    const recovered = await setupResult.application.confirmAndSubmit({
      workspaceId: 'workspace-a',
      workflowId: 'package-confirm-retry',
    });
    await setupResult.application.confirmAndSubmit({
      workspaceId: 'workspace-a',
      workflowId: 'package-confirm-retry',
    });
    assert.equal(
      recovered.job.jobId,
      'model.composed-video:package-confirm-retry'
    );
    assert.equal(setupResult.contentPackages.confirmations.length, 2);
    assert.equal(setupResult.jobSubmissions(), 1);
    assert.equal((await setupResult.queue.list('workspace-a')).length, 1);
  });

  it('releases a failed Foundation confirm claim so the same HTTP idempotency key retries immediately', async () => {
    const setupResult = setupWithFailedPackageConfirmation();
    const foundation = new MemoryFoundationRepository();
    foundation.grantOwner('workspace-a', 'owner-a');
    const module = new ModelSupplyFoundationModule(
      new ModelSupplyControlPlaneService({
        application: setupResult.models,
        repository: new MemoryModelSupplyControlPlaneRepository(),
      }),
      { composedVideo: setupResult.application }
    );
    const application = new P1ApplicationService(foundation, {
      operations: [module],
    });
    const context = {
      actor: 'owner' as const,
      correlationId: 'corr-package-confirm-retry',
      userId: 'owner-a',
      workspaceId: 'workspace-a',
    };
    await application.executeModule(
      context,
      'model-supply',
      {
        action: 'video_workflow_create_draft',
        payload: {
          catalogModelId: 'seedance-2',
          executionContract: frozenVideoContract(),
          shots: [
            {
              id: 'opening',
              prompt: '门店开场',
              candidatesPerShot: 1,
              durationSeconds: 15,
              height: 1280,
              width: 720,
            },
          ],
          storyboardRevision: 'story-foundation-confirm-retry',
          workId: 'work-foundation-confirm-retry',
          workflowId: 'foundation-confirm-retry',
        },
      },
      'create-foundation-confirm-retry'
    );
    const confirmation = {
      action: 'video_workflow_confirm',
      payload: { workflowId: 'foundation-confirm-retry' },
    };

    await assert.rejects(
      application.executeModule(
        context,
        'model-supply',
        confirmation,
        'confirm-foundation-retry'
      ),
      /simulated ContentPackage confirmation loss/
    );
    const pendingPublic = (await application.queryModule(
      context,
      'model-supply',
      {
        action: 'video_workflow',
        payload: { workflowId: 'foundation-confirm-retry' },
      }
    )) as {
      workflowId: string;
    };
    assert.equal(pendingPublic.workflowId, 'foundation-confirm-retry');
    assert.equal('job' in pendingPublic, false);
    assert.equal('attempts' in pendingPublic, false);
    assert.equal('routeSnapshot' in pendingPublic, false);
    const pendingInternal = await setupResult.application.query({
      workspaceId: 'workspace-a',
      workflowId: 'foundation-confirm-retry',
    });
    assert.equal(pendingInternal.job, null);
    assert.equal(setupResult.jobSubmissions(), 0);

    const recovered = (await application.executeModule(
      context,
      'model-supply',
      confirmation,
      'confirm-foundation-retry'
    )) as { job: { jobId: string } };
    const replayed = (await application.executeModule(
      context,
      'model-supply',
      confirmation,
      'confirm-foundation-retry'
    )) as { job: { jobId: string } };

    assert.equal(
      recovered.job.jobId,
      'model.composed-video:foundation-confirm-retry'
    );
    assert.equal(replayed.job.jobId, recovered.job.jobId);
    assert.equal(setupResult.contentPackages.confirmations.length, 1);
    assert.equal(setupResult.jobSubmissions(), 1);
  });

  it('rejects cancellation of an unconfirmed draft without changing it', async () => {
    const setupResult = setup();
    await setupResult.application.createDraft({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workId: 'work-draft-cancel',
      workflowId: 'draft-cancel',
      storyboardRevision: 'story-draft-cancel',
      catalogModelId: 'seedance-2',
      dataClass: [],
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });

    await assert.rejects(
      setupResult.application.cancel({
        workspaceId: 'workspace-a',
        workflowId: 'draft-cancel',
      }),
      /Only a confirmed video workflow can be cancelled/
    );
    assert.equal(
      setupResult.runner.getVideoWorkflow('draft-cancel', 'workspace-a').status,
      'draft'
    );
  });

  it('lists only the current actor workflows with their existing tracer Jobs', async () => {
    const setupResult = setup();
    const create = (input: {
      actorId: string;
      workflowId: string;
      workspaceId?: string;
    }) =>
      setupResult.application.createDraft({
        workspaceId: input.workspaceId ?? 'workspace-a',
        actorId: input.actorId,
        workId: `work-${input.workflowId}`,
        workflowId: input.workflowId,
        storyboardRevision: `story-${input.workflowId}`,
        catalogModelId: 'seedance-2',
        dataClass: [],
        shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
      });
    await create({ actorId: 'owner-a', workflowId: 'actor-a-confirmed' });
    await setupResult.application.confirmAndSubmit({
      workspaceId: 'workspace-a',
      workflowId: 'actor-a-confirmed',
    });
    await create({ actorId: 'owner-a', workflowId: 'actor-a-draft' });
    await create({ actorId: 'owner-b', workflowId: 'actor-b-draft' });
    await create({
      actorId: 'owner-a',
      workflowId: 'other-workspace-draft',
      workspaceId: 'workspace-b',
    });

    const listed = await setupResult.application.list({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
    });

    assert.deepEqual(
      new Set(listed.map((item) => item.workflow.id)),
      new Set(['actor-a-confirmed', 'actor-a-draft']),
    );
    assert.equal(
      listed.find((item) => item.workflow.id === 'actor-a-confirmed')?.job
        ?.kind,
      COMPOSED_VIDEO_JOB_KIND,
    );
    assert.equal(
      listed.find((item) => item.workflow.id === 'actor-a-draft')?.job,
      null,
    );
  });

  it('creates an immutable storyboard lineage when a merchant explicitly starts a new version', async () => {
    const setupResult = setup();
    const first = await setupResult.application.createDraft({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workId: 'creative-work-lineage',
      workflowId: 'lineage-video-v1',
      storyboardRevision: 'same-storyboard-content',
      catalogModelId: 'seedance-2',
      dataClass: [],
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });

    const second = await setupResult.application.createDraft({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workId: 'creative-work-lineage',
      workflowId: 'lineage-video-v2',
      derivedFromWorkflowId: first.id,
      storyboardRevision: 'same-storyboard-content',
      catalogModelId: 'seedance-2',
      dataClass: [],
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });

    assert.equal(first.storyboardVersion, 1);
    assert.equal(first.derivedFromWorkflowId, undefined);
    assert.equal(second.id, 'lineage-video-v2');
    assert.equal(second.derivedFromWorkflowId, first.id);
    assert.equal(second.storyboardVersion, 2);
    assert.equal(
      (
        await setupResult.application.query({
          workspaceId: 'workspace-a',
          workflowId: first.id,
        })
      ).workflow.id,
      first.id,
    );
    assert.equal(
      (
        await setupResult.application.latest({
          workspaceId: 'workspace-a',
          actorId: 'owner-a',
          workId: 'creative-work-lineage',
        })
      )?.workflow.id,
      second.id,
    );
  });

  it('restores the parent before persisting a derived storyboard version', async () => {
    const setupResult = setup();
    const runner = new PersistentContentWorkflowRunner(
      setupResult.models,
      new RecordedVideoCompositionPort(),
      asyncMemoryWorkflowStore(),
      new CandidateAwareScorer(),
    );
    const parent = await runner.createVideoWorkflow({
      workflowId: 'persistent-lineage-v1',
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workId: 'creative-work-persistent-lineage',
      dataClass: [],
      storyboardRevision: 'same-storyboard-content',
      catalogModelId: 'seedance-2',
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });

    const derived = await runner.createVideoWorkflow({
      workflowId: 'persistent-lineage-v2',
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workId: 'creative-work-persistent-lineage',
      derivedFromWorkflowId: parent.id,
      dataClass: [],
      storyboardRevision: 'same-storyboard-content',
      catalogModelId: 'seedance-2',
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });

    assert.equal(derived.derivedFromWorkflowId, parent.id);
    assert.equal(derived.storyboardVersion, 2);
    assert.equal((await runner.getVideoWorkflow(parent.id)).storyboardVersion, 1);
  });

  it('waits for an explicit candidate choice when quality evidence cannot rank peers', async () => {
    const setupResult = setup({
      qualityScorer: new HumanReviewRequiredScorer(),
    });
    await setupResult.application.createDraft({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workflowId: 'human-review-video',
      storyboardRevision: 'storyboard-review-v1',
      catalogModelId: 'seedance-2',
      dataClass: [],
      shots: [
        { id: 'opening', prompt: '门店开场', candidatesPerShot: 2 },
      ],
    });
    const confirmed = await setupResult.application.confirmAndSubmit({
      workspaceId: 'workspace-a',
      workflowId: 'human-review-video',
    });
    const envelope = makeDurableJobEnvelope(
      {
        jobId: confirmed.job.jobId,
        workspaceId: 'workspace-a',
        kind: COMPOSED_VIDEO_JOB_KIND,
        payload: { workflowId: 'human-review-video' },
      },
      new Date('2026-07-12T00:00:00.000Z'),
    );

    const waiting = await setupResult.worker.handle(envelope);
    assert.equal(waiting.status, 'deferred');
    const pending = await setupResult.application.query({
      workspaceId: 'workspace-a',
      workflowId: 'human-review-video',
    });
    assert.equal(pending.workflow.status, 'awaiting_quality_review');
    assert.equal(pending.workflow.shots[0]?.selectedCandidateIndex, undefined);
    assert.equal(pending.workflow.clipAssets.length, 0);
    assert.equal(setupResult.compositions.length, 0);
    assert.equal(
      setupResult.contentPackages.outcomes.at(-1)?.status,
      'awaiting_quality_review',
    );

    const resumed = await setupResult.application.selectCandidateAndResume({
      workspaceId: 'workspace-a',
      workflowId: 'human-review-video',
      shotId: 'opening',
      candidateIndex: 1,
      actorId: 'reviewer-a',
      correlationId: 'review-human-video-1',
    });
    assert.equal(resumed.workflow.shots[0]?.selectedCandidateIndex, 1);
    assert.match(
      resumed.workflow.shots[0]?.selectionReason ?? '',
      /explicitly selected/i,
    );
    assert.deepEqual(resumed.workflow.shots[0]?.selectionAudit, {
      selectedBy: 'reviewer-a',
      correlationId: 'review-human-video-1',
      selectedAt: resumed.workflow.updatedAt,
      source: 'human_quality_review',
    });
    assert.match(resumed.workflow.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

    assert.equal((await setupResult.worker.handle(envelope)).status, 'completed');
    const completed = await setupResult.application.query({
      workspaceId: 'workspace-a',
      workflowId: 'human-review-video',
    });
    assert.equal(completed.workflow.status, 'completed');
    assert.equal(completed.workflow.shots[0]?.selectedCandidateIndex, 1);
    assert.equal(completed.workflow.clipAssets.length, 1);
    assert.equal(setupResult.compositions.length, 1);
    assert.equal(setupResult.executions(), 2);
    assert.equal(
      setupResult.contentPackages.outcomes.at(-1)?.status,
      'completed',
    );
    const completedOutcome = setupResult.contentPackages.outcomes.at(-1);
    assert.equal(completedOutcome?.status, 'completed');
    if (completedOutcome?.status === 'completed') {
      assert.equal(
        completedOutcome.composedAsset.sizeBytes,
        completed.workflow.composedAsset?.sizeBytes,
      );
    }
  });

  it('requires explicit review for one technically valid but unscored candidate', async () => {
    const setupResult = setup({
      qualityScorer: new HumanReviewRequiredScorer(),
    });
    await setupResult.application.createDraft({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workflowId: 'single-unscored-video',
      storyboardRevision: 'storyboard-single-review-v1',
      catalogModelId: 'seedance-2',
      dataClass: [],
      shots: [
        { id: 'opening', prompt: '门店开场', candidatesPerShot: 1 },
      ],
    });
    const confirmed = await setupResult.application.confirmAndSubmit({
      workspaceId: 'workspace-a',
      workflowId: 'single-unscored-video',
    });
    const envelope = makeDurableJobEnvelope(
      {
        jobId: confirmed.job.jobId,
        workspaceId: 'workspace-a',
        kind: COMPOSED_VIDEO_JOB_KIND,
        payload: { workflowId: 'single-unscored-video' },
      },
      new Date('2026-07-12T00:00:00.000Z'),
    );

    assert.equal((await setupResult.worker.handle(envelope)).status, 'deferred');
    const pending = (
      await setupResult.application.query({
        workspaceId: 'workspace-a',
        workflowId: 'single-unscored-video',
      })
    ).workflow;
    assert.equal(pending.status, 'awaiting_quality_review');
    assert.equal(pending.shots[0]?.selectedCandidateIndex, undefined);
    assert.equal(pending.clipAssets.length, 0);

    await setupResult.application.selectCandidateAndResume({
      workspaceId: 'workspace-a',
      workflowId: 'single-unscored-video',
      shotId: 'opening',
      candidateIndex: 0,
      actorId: 'reviewer-a',
      correlationId: 'review-single-unscored-video',
    });
    assert.equal((await setupResult.worker.handle(envelope)).status, 'completed');
    const completed = (
      await setupResult.application.query({
        workspaceId: 'workspace-a',
        workflowId: 'single-unscored-video',
      })
    ).workflow;
    assert.equal(completed.status, 'completed');
    assert.equal(completed.shots[0]?.selectedCandidateIndex, 0);
    assert.equal(setupResult.executions(), 1);
  });

  it('recovers the current actor latest nonterminal workflow before terminal history', async () => {
    const setupResult = setup();
    await setupResult.application.createDraft({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workflowId: 'recover-pending-video',
      storyboardRevision: 'storyboard-pending-v1',
      catalogModelId: 'seedance-2',
      dataClass: [],
      shots: [{ id: 'pending', prompt: '待确认分镜', candidatesPerShot: 1 }],
    });
    await setupResult.application.createDraft({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workflowId: 'recover-completed-video',
      storyboardRevision: 'storyboard-completed-v1',
      catalogModelId: 'seedance-2',
      dataClass: [],
      shots: [{ id: 'done', prompt: '已完成分镜', candidatesPerShot: 1 }],
    });
    await setupResult.application.confirmAndSubmit({
      workspaceId: 'workspace-a',
      workflowId: 'recover-completed-video',
    });
    await setupResult.runner.runVideoWorkflow(
      'recover-completed-video',
      'workspace-a',
    );
    await setupResult.application.createDraft({
      workspaceId: 'workspace-a',
      actorId: 'owner-b',
      workflowId: 'other-actor-video',
      storyboardRevision: 'storyboard-other-v1',
      catalogModelId: 'seedance-2',
      dataClass: [],
      shots: [{ id: 'other', prompt: '其他用户分镜', candidatesPerShot: 1 }],
    });

    const latest = await setupResult.application.latest({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
    });
    assert.equal(latest?.workflow.id, 'recover-pending-video');
    assert.equal(latest?.workflow.confirmed, false);
    assert.equal(latest?.job, null);
    await setupResult.runner.cancelVideoWorkflow(
      'recover-pending-video',
      'workspace-a',
    );
    assert.equal(
      (
        await setupResult.application.latest({
          workspaceId: 'workspace-a',
          actorId: 'owner-a',
        })
      )?.workflow.id,
      'recover-pending-video',
    );
    assert.equal(
      (
        await setupResult.application.latest({
          workspaceId: 'workspace-a',
          actorId: 'owner-b',
        })
      )?.workflow.id,
      'other-actor-video',
    );
    assert.equal(
      await setupResult.application.latest({
        workspaceId: 'workspace-b',
        actorId: 'owner-a',
      }),
      null,
    );
  });

  it('keeps the newest storyboard version current after it completes', async () => {
    const setupResult = setup();
    const workId = 'creative-work-version-recovery';
    const parent = await setupResult.application.createDraft({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workId,
      workflowId: 'version-recovery-v1',
      storyboardRevision: 'storyboard-version-recovery-v1',
      catalogModelId: 'seedance-2',
      dataClass: [],
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });
    const derived = await setupResult.application.createDraft({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workId,
      workflowId: 'version-recovery-v2',
      derivedFromWorkflowId: parent.id,
      storyboardRevision: 'storyboard-version-recovery-v2',
      catalogModelId: 'seedance-2',
      dataClass: [],
      shots: [{ id: 'opening', prompt: '门店开场近景', candidatesPerShot: 1 }],
    });
    setupResult.runner.confirmVideoWorkflow(derived.id, 'workspace-a');
    await setupResult.runner.runVideoWorkflow(derived.id, 'workspace-a');

    assert.equal(
      (
        await setupResult.application.latest({
          workspaceId: 'workspace-a',
          actorId: 'owner-a',
          workId,
        })
      )?.workflow.id,
      derived.id,
    );
    assert.equal(
      (
        await setupResult.application.latest({
          workspaceId: 'workspace-a',
          actorId: 'owner-a',
        })
      )?.workflow.id,
      parent.id,
    );
  });

  it('persists parent cancel intent and lets the worker cancel the workflow', async () => {
    const setupResult = setup();
    await setupResult.application.createDraft({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workflowId: 'cancel-video',
      storyboardRevision: 'storyboard-cancel-v1',
      catalogModelId: 'seedance-2',
      dataClass: [],
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });
    const confirmed = await setupResult.application.confirmAndSubmit({
      workspaceId: 'workspace-a',
      workflowId: 'cancel-video',
    });
    const requested = await setupResult.application.cancel({
      workspaceId: 'workspace-a',
      workflowId: 'cancel-video',
    });
    assert.equal(requested.job.status, 'cancel_requested');
    const handled = await setupResult.worker.handle(
      makeDurableJobEnvelope(
        {
          jobId: confirmed.job.jobId,
          workspaceId: 'workspace-a',
          kind: COMPOSED_VIDEO_JOB_KIND,
          payload: { workflowId: 'cancel-video' },
        },
        new Date('2026-07-11T00:00:00.000Z'),
      ),
    );
    assert.equal(handled.status, 'completed');
    const cancelled = await setupResult.application.query({
      workspaceId: 'workspace-a',
      workflowId: 'cancel-video',
    });
    assert.equal(cancelled.job?.status, 'cancelled');
    assert.equal(cancelled.workflow.status, 'cancelled');
    assert.equal(
      setupResult.contentPackages.outcomes.at(-1)?.status,
      'cancelled',
    );
  });

  it('propagates cancellation to a durable child generation before finalizing', async () => {
    const models = new ModelSupplyApplicationService({
      models: createDefaultCatalogModels(),
      deployments: createDefaultDeployments({
        activatedDeploymentIds: ['seedance-2-direct'],
      }),
      execution: new RecordedProviderExecutionPort(),
    });
    const children = new Map<string, DurableMediaGenerationJobView>();
    const cancellationCalls: string[] = [];
    models.attachDurableMediaRuntime({
      async submit(submission) {
        const result = models.previewMediaSubmission(submission);
        children.set(result.jobId, {
          jobId: result.jobId,
          workspaceId: submission.workspaceId,
          status: 'running',
          providerLifecycleLatencyMs: 0,
          result,
        });
        return result;
      },
      async get(workspaceId, jobId) {
        const child = children.get(jobId);
        if (!child || child.workspaceId !== workspaceId) {
          throw Object.assign(new Error('child generation not found'), {
            code: 'NOT_FOUND',
          });
        }
        return structuredClone(child);
      },
      async cancel(input) {
        const child = children.get(input.jobId);
        if (!child || child.workspaceId !== input.workspaceId) {
          throw Object.assign(new Error('child generation not found'), {
            code: 'NOT_FOUND',
          });
        }
        cancellationCalls.push(input.jobId);
        child.status = 'cancelled';
        return structuredClone(child);
      },
      async reconcileCancelledProviderTerminal() {
        throw new Error('cancelled terminal reconciliation is not used here');
      },
    });
    const runner = new ContentWorkflowRunner(models);
    runner.createVideoWorkflow({
      workflowId: 'cancel-child-video',
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      dataClass: [],
      storyboardRevision: 'storyboard-cancel-child-v1',
      catalogModelId: 'seedance-2',
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });
    runner.confirmVideoWorkflow('cancel-child-video', 'workspace-a');
    await assert.rejects(
      runner.runVideoWorkflow('cancel-child-video', 'workspace-a'),
      /unknown provider acceptance/,
    );
    const pending = runner.getVideoWorkflow(
      'cancel-child-video',
      'workspace-a',
    );
    const childJobId = pending.shots[0]?.candidates[0]?.attempt.jobId;
    assert.ok(childJobId);

    const cancelled = await runner.cancelVideoWorkflow(
      'cancel-child-video',
      'workspace-a',
    );
    assert.equal(cancelled.status, 'cancelled');
    assert.deepEqual(cancellationCalls, [childJobId]);
    assert.equal(children.get(childJobId)?.status, 'cancelled');
  });

  it('replaces enqueue latency with the durable provider lifecycle latency when recovering a candidate', async () => {
    const deployments = createDefaultDeployments({
      activatedDeploymentIds: ['seedance-2-direct'],
    });
    const directModels = new ModelSupplyApplicationService({
      models: createDefaultCatalogModels(),
      deployments,
      execution: new RecordedProviderExecutionPort(),
    });
    const models = new ModelSupplyApplicationService({
      models: createDefaultCatalogModels(),
      deployments,
      execution: new RecordedProviderExecutionPort(),
    });
    const children = new Map<string, DurableMediaGenerationJobView>();
    models.attachDurableMediaRuntime({
      async submit(submission) {
        const pending = models.previewMediaSubmission(submission);
        const completed = await directModels.submit(submission);
        children.set(pending.jobId, {
          jobId: pending.jobId,
          workspaceId: submission.workspaceId,
          status: 'completed',
          providerLifecycleLatencyMs: 42_000,
          result: completed,
        });
        return pending;
      },
      async get(workspaceId, jobId) {
        const child = children.get(jobId);
        if (!child || child.workspaceId !== workspaceId) {
          throw Object.assign(new Error('child generation not found'), {
            code: 'NOT_FOUND',
          });
        }
        return structuredClone(child);
      },
      async cancel() {
        throw new Error('completed child must not be cancelled');
      },
      async reconcileCancelledProviderTerminal() {
        throw new Error('cancelled terminal reconciliation is not used here');
      },
    });
    const runner = new ContentWorkflowRunner(
      models,
      new RecordedVideoCompositionPort(),
      new InMemoryDurableVideoWorkflowStore(),
      new CandidateAwareScorer(),
    );
    runner.createVideoWorkflow({
      workflowId: 'provider-lifecycle-latency',
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      dataClass: [],
      storyboardRevision: 'storyboard-latency-v1',
      catalogModelId: 'seedance-2',
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });
    runner.confirmVideoWorkflow('provider-lifecycle-latency', 'workspace-a');

    const completed = await runner.runVideoWorkflow(
      'provider-lifecycle-latency',
      'workspace-a',
    );

    assert.equal(
      completed.shots[0]?.candidates[0]?.latencyMs,
      42_000,
    );
  });

  it('fences an active worker when cancellation races with provider execution', async () => {
    let providerStarted!: () => void;
    let releaseProvider!: () => void;
    const started = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const setupResult = setup({
      beforeProviderExecute: async () => {
        providerStarted();
        await released;
      },
    });
    await setupResult.application.createDraft({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workflowId: 'cancel-during-provider',
      storyboardRevision: 'storyboard-cancel-race-v1',
      catalogModelId: 'seedance-2',
      dataClass: [],
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });
    const confirmed = await setupResult.application.confirmAndSubmit({
      workspaceId: 'workspace-a',
      workflowId: 'cancel-during-provider',
    });
    const envelope = makeDurableJobEnvelope(
      {
        jobId: confirmed.job.jobId,
        workspaceId: 'workspace-a',
        kind: COMPOSED_VIDEO_JOB_KIND,
        payload: { workflowId: 'cancel-during-provider' },
      },
      new Date('2026-07-11T00:00:00.000Z'),
    );

    const activeWorker = setupResult.worker.handle(envelope);
    await started;
    const requested = await setupResult.application.cancel({
      workspaceId: 'workspace-a',
      workflowId: 'cancel-during-provider',
    });
    releaseProvider();
    assert.equal((await activeWorker).status, 'deferred');

    assert.equal(requested.workflow.status, 'cancel_requested');
    assert.notEqual(
      (
        await setupResult.application.query({
          workspaceId: 'workspace-a',
          workflowId: 'cancel-during-provider',
        })
      ).workflow.status,
      'completed',
    );
    assert.equal((await setupResult.worker.handle(envelope)).status, 'completed');
    const cancelled = await setupResult.application.query({
      workspaceId: 'workspace-a',
      workflowId: 'cancel-during-provider',
    });
    assert.equal(cancelled.workflow.status, 'cancelled');
    assert.equal(cancelled.job?.status, 'cancelled');
    assert.equal(setupResult.executions(), 1);
    assert.equal(setupResult.compositions.length, 0);
  });

  it('creates an explicit draft, gates attempts, submits one durable job, and records N-to-1 candidate facts', async () => {
    const qualityScorer = new CandidateAwareScorer();
    const setupResult = setup({ qualityScorer });
    const draft = await setupResult.application.createDraft({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workflowId: 'campaign-42-video',
      executionContract: {
        ...frozenVideoContract({
          aigcLabelEnabled: true,
          dataClass: ['contains_face', 'pii'],
        }),
      },
      storyboardRevision: 'storyboard-v7',
      catalogModelId: 'seedance-2',
      dataClass: ['pii', 'contains_face'],
      aigcLabelEnabled: true,
      shots: [
        {
          id: 'opening',
          prompt: '门店开场',
          candidatesPerShot: 2,
          durationSeconds: 7,
          width: 720,
          height: 1280,
        },
        {
          id: 'detail',
          prompt: '项目细节',
          candidatesPerShot: 3,
          durationSeconds: 8,
          width: 720,
          height: 1280,
        },
      ],
    });

    assert.equal(draft.id, 'campaign-42-video');
    assert.equal(draft.confirmed, false);
    assert.equal(draft.actorId, 'owner-a');
    assert.deepEqual(draft.dataClass, ['contains_face', 'pii']);
    assert.equal(draft.aigcLabelEnabled, true);
    assert.equal(draft.executionContract?.quoteRevision, 'quote-video-v1');
    assert.equal(draft.executionContract?.estimatedAmount, 12);
    assert.equal(setupResult.models.attempts().length, 0);
    assert.equal((await setupResult.queue.list('workspace-a')).length, 0);
    await assert.rejects(
      setupResult.runner.runVideoWorkflow('campaign-42-video', 'workspace-a'),
      /confirmed/,
    );
    assert.equal(setupResult.models.attempts().length, 0);

    const confirmed = await setupResult.application.confirmAndSubmit({
      workspaceId: 'workspace-a',
      workflowId: 'campaign-42-video',
    });
    assert.equal(confirmed.workflow.confirmed, true);
    assert.equal(confirmed.workflow.routeSnapshot?.promptRevision, 'storyboard-v7');
    assert.equal(confirmed.job.kind, COMPOSED_VIDEO_JOB_KIND);
    assert.equal(confirmed.job.jobId, 'model.composed-video:campaign-42-video');

    setupResult.models.applyCatalogRevision(
      'workspace-a',
      'catalog-after-confirmation',
      createDefaultCatalogModels(),
      createDefaultDeployments({
        activatedDeploymentIds: ['kling-latest-direct'],
      }),
    );

    const queued = await setupResult.queue.inspect(
      'workspace-a',
      'model.composed-video:campaign-42-video',
    );
    assert.deepEqual(queued?.payload, { workflowId: 'campaign-42-video' });
    const handled = await setupResult.worker.handle(
      makeDurableJobEnvelope(
        {
          jobId: confirmed.job.jobId,
          workspaceId: 'workspace-a',
          kind: COMPOSED_VIDEO_JOB_KIND,
          payload: { workflowId: 'campaign-42-video' },
        },
        new Date('2026-07-11T00:00:00.000Z'),
      ),
    );
    assert.equal(handled.status, 'completed');

    const completed = (await setupResult.application.query({
      workspaceId: 'workspace-a',
      workflowId: 'campaign-42-video',
    })).workflow;
    assert.equal(completed.status, 'completed');
    assert.equal(completed.shots[0]?.candidates.length, 2);
    assert.equal(completed.shots[1]?.candidates.length, 3);
    assert.equal(completed.attempts.length, 5);
    assert.deepEqual(
      setupResult.submissions.map(({ input }) => input),
      [
        { durationSeconds: 7, height: 1280, width: 720 },
        { durationSeconds: 7, height: 1280, width: 720 },
        { durationSeconds: 8, height: 1280, width: 720 },
        { durationSeconds: 8, height: 1280, width: 720 },
        { durationSeconds: 8, height: 1280, width: 720 },
      ]
    );
    assert.deepEqual(
      setupResult.submissions.map(({ productUsageQuantity }) =>
        productUsageQuantity
      ),
      [1, 0, 0, 0, 0]
    );
    assert.equal(completed.clipAssets.length, 2);
    assert.equal(completed.shots[0]?.selectedCandidateIndex, 1);
    assert.match(completed.shots[0]?.selectionReason ?? '', /highest human-calibrated quality/);
    assert.deepEqual(
      qualityScorer.calls.map((call) => ({
        candidateIndex: call.candidateIndex,
        peerCandidateCount: call.peerCandidateAssets.length,
        shotId: call.shotId,
      })),
      [
        { candidateIndex: 0, peerCandidateCount: 1, shotId: 'opening' },
        { candidateIndex: 1, peerCandidateCount: 1, shotId: 'opening' },
        { candidateIndex: 0, peerCandidateCount: 2, shotId: 'detail' },
        { candidateIndex: 1, peerCandidateCount: 2, shotId: 'detail' },
        { candidateIndex: 2, peerCandidateCount: 2, shotId: 'detail' },
      ],
    );
    assert.ok(
      qualityScorer.calls.every((call) =>
        call.peerCandidateAssets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256)),
      ),
    );
    for (const shot of completed.shots) {
      for (const candidate of shot.candidates) {
        assert.equal(candidate.status, 'completed');
        assert.ok(candidate.attempt);
        assert.ok(candidate.taskRef);
        assert.ok(candidate.providerCost);
        assert.equal(typeof candidate.latencyMs, 'number');
        assert.equal(candidate.technicalValidation?.playable, true);
        assert.equal(candidate.quality?.calibration, 'recorded_human_fixture');
        assert.equal(typeof candidate.quality?.dimensions.humanAnatomy, 'number');
        assert.ok(Array.isArray(candidate.quality?.publishWarnings));
        assert.equal(candidate.routeSnapshot.id, completed.routeSnapshot?.id);
      }
    }
    assert.equal(completed.composedAsset?.technicalValidation?.playable, true);
    assert.equal('qualityScore' in (completed.composedAsset ?? {}), false);
    assert.equal(completed.routeSnapshot?.catalogRevisionId, 'recorded-runtime');
    assert.equal(completed.routeSnapshot?.actualCatalogModelId, 'seedance-2');
    assert.deepEqual(completed.routeSnapshot?.dataClass, ['contains_face', 'pii']);
    assert.ok(
      setupResult.submissions.every(
        (submission) =>
          submission.actorId === 'owner-a' &&
          JSON.stringify(submission.dataClass) ===
            JSON.stringify(['contains_face', 'pii']),
      ),
    );
    assert.equal(setupResult.compositions.length, 1);
    assert.equal(setupResult.compositions[0]?.aigcLabelEnabled, true);
    assert.ok(setupResult.compositions[0]?.compositionKey);
    const outcome = setupResult.contentPackages.outcomes.at(-1);
    assert.equal(outcome?.status, 'completed');
    if (outcome?.status === 'completed') {
      assert.equal(outcome.routeSnapshot.id, completed.routeSnapshot?.id);
      assert.equal(outcome.providerAttempts.length, completed.attempts.length);
      assert.equal(outcome.providerCosts.length, 5);
      assert.equal(
        outcome.composedAsset.compositionEvidence.aigc.requested,
        true
      );
    }
  });

  it('rejects shot timing or framing that differs from the frozen contract', async () => {
    const setupResult = setup();
    const base = {
      actorId: 'owner-a',
      aigcLabelEnabled: false,
      catalogModelId: 'seedance-2',
      dataClass: [],
      executionContract: frozenVideoContract(),
      storyboardRevision: 'storyboard-contract-validation-v1',
      workspaceId: 'workspace-a',
    };

    await assert.rejects(
      setupResult.application.createDraft({
        ...base,
        workflowId: 'video-invalid-duration',
        shots: [
          {
            id: 'opening',
            prompt: '门店开场',
            candidatesPerShot: 1,
            durationSeconds: 14,
            height: 1280,
            width: 720,
          },
        ],
      }),
      /sum to the frozen contract duration/
    );
    await assert.rejects(
      setupResult.application.createDraft({
        ...base,
        workflowId: 'video-invalid-aspect',
        shots: [
          {
            id: 'opening',
            prompt: '门店开场',
            candidatesPerShot: 1,
            durationSeconds: 15,
            height: 720,
            width: 720,
          },
        ],
      }),
      /match the frozen contract aspect ratio/
    );
    assert.equal(setupResult.models.attempts().length, 0);
  });

  it('reuses persisted candidates after restart and rejects cross-workspace access', async () => {
    const setupResult = setup();
    await setupResult.application.createDraft({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      workflowId: 'restartable-video',
      storyboardRevision: 'storyboard-v1',
      catalogModelId: 'seedance-2',
      dataClass: [],
      shots: [{ id: 'one', prompt: '镜头一', candidatesPerShot: 2 }],
    });
    await setupResult.application.confirmAndSubmit({
      workspaceId: 'workspace-a',
      workflowId: 'restartable-video',
    });
    await setupResult.runner.runVideoWorkflow('restartable-video', 'workspace-a');
    const firstExecutionCount = setupResult.executions();

    const reconciled = await new ComposedVideoJobEffect(
      () => setupResult.runner,
      setupResult.contentPackages,
    ).reconcile({
      workspaceId: 'workspace-a',
      jobId: 'model.composed-video:restartable-video',
      kind: COMPOSED_VIDEO_JOB_KIND,
      payload: { workflowId: 'restartable-video' },
      idempotencyKey: 'workspace-a:model.composed-video:restartable-video',
      effectIdempotencyKey:
        'provider-effect:v1:11:workspace-a:model.composed-video:restartable-video',
    });
    assert.equal(reconciled.delivery, 'completed');
    assert.equal(setupResult.executions(), firstExecutionCount);
    await assert.rejects(
      setupResult.application.query({
        workspaceId: 'workspace-b',
        workflowId: 'restartable-video',
      }),
      /workspace|Unknown/i,
    );
  });

  it('does not regenerate a candidate when the worker crashes after provider settlement but before workflow checkpoint', async () => {
    const repository = new MemoryFoundationRepository();
    repository.grantOwner('workspace-a', 'workflow-worker');
    const foundation = new P1ApplicationService(repository);
    const ledger = new FoundationModelSupplyLedger(foundation, {
      async resolve() {
        return {
          revision: 'video-pro-v1',
          tier: 'pro',
          allowance: { audio: 0, copy: 10, image: 10, video: 10 },
          concurrencyLimit: 4,
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
    const recorded = new RecordedProviderExecutionPort();
    let executions = 0;
    const execution = {
      async execute(request: Parameters<typeof recorded.execute>[0]) {
        executions += 1;
        return recorded.execute(request);
      },
    };
    const createModels = () =>
      new ModelSupplyApplicationService({
        models: createDefaultCatalogModels(),
        deployments: createDefaultDeployments({
          activatedDeploymentIds: ['seedance-2-direct'],
        }),
        execution,
        ledger,
      });
    const store = new CrashAfterProviderWorkflowStore();
    const firstRunner = new ContentWorkflowRunner(
      createModels(),
      new RecordedVideoCompositionPort(),
      store,
      new CandidateAwareScorer(),
    );
    firstRunner.createVideoWorkflow({
      workflowId: 'crash-after-provider',
      workspaceId: 'workspace-a',
      actorId: 'workflow-worker',
      dataClass: [],
      storyboardRevision: 'storyboard-v8',
      catalogModelId: 'seedance-2',
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });
    firstRunner.confirmVideoWorkflow('crash-after-provider', 'workspace-a');
    await assert.rejects(
      firstRunner.runVideoWorkflow('crash-after-provider', 'workspace-a'),
      /workflow checkpoint loss/,
    );
    assert.equal(executions, 1);

    const restarted = new ContentWorkflowRunner(
      createModels(),
      new RecordedVideoCompositionPort(),
      store,
      new CandidateAwareScorer(),
    );
    const completed = await restarted.runVideoWorkflow(
      'crash-after-provider',
      'workspace-a',
    );

    assert.equal(completed.status, 'completed');
    assert.equal(completed.shots[0]?.candidates.length, 1);
    assert.equal(executions, 1);
  });

  it('reuses one deterministic composition identity after a crash before checkpoint', async () => {
    const setupResult = setup();
    const store = new CrashAfterCompositionWorkflowStore();
    const recorded = new RecordedVideoCompositionPort();
    const compositionKeys: string[] = [];
    const compositionIds: string[] = [];
    const composer = {
      async compose(input: Parameters<typeof recorded.compose>[0]) {
        compositionKeys.push(input.compositionKey);
        const asset = await recorded.compose(input);
        compositionIds.push(asset.id);
        return asset;
      },
    };
    const first = new ContentWorkflowRunner(
      setupResult.models,
      composer,
      store,
      new CandidateAwareScorer(),
    );
    first.createVideoWorkflow({
      workflowId: 'composition-retry',
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      dataClass: [],
      aigcLabelEnabled: false,
      storyboardRevision: 'storyboard-composition-v1',
      catalogModelId: 'seedance-2',
      shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
    });
    first.confirmVideoWorkflow('composition-retry', 'workspace-a');
    await assert.rejects(
      first.runVideoWorkflow('composition-retry', 'workspace-a'),
      /composition checkpoint loss/,
    );

    const completed = await new ContentWorkflowRunner(
      setupResult.models,
      composer,
      store,
      new CandidateAwareScorer(),
    ).runVideoWorkflow('composition-retry', 'workspace-a');

    assert.equal(compositionKeys.length, 2);
    assert.equal(compositionKeys[0], compositionKeys[1]);
    assert.equal(compositionIds[0], compositionIds[1]);
    assert.equal(completed.composedAsset?.id, compositionIds[0]);
  });

  it('exposes a kind-scoped worker handler for the existing runtime dispatcher', async () => {
    const setupResult = setup();
    const handler = createComposedVideoJobHandler(setupResult.worker);
    const result = await handler(
      makeDurableJobEnvelope(
        {
          jobId: 'other-job',
          workspaceId: 'workspace-a',
          kind: 'other.kind',
          payload: {},
        },
        new Date('2026-07-11T00:00:00.000Z'),
      ),
      {
        transportId: 'transport-1',
        attempt: 1,
        recovered: false,
        claimedAt: '2026-07-11T00:00:00.000Z',
        async renewLease() {},
      },
    );
    assert.equal(result.status, 'dead_letter');
    assert.equal(result.output?.code, 'UNSUPPORTED_JOB_KIND');
  });

  it('exposes create, confirm, and query actions through the shared P1 foundation module', async () => {
    const setupResult = setup();
    const controlPlane = new ModelSupplyControlPlaneService({
      application: setupResult.models,
      repository: new MemoryModelSupplyControlPlaneRepository(),
    });
    const module = new ModelSupplyFoundationModule(controlPlane, {
      composedVideo: setupResult.application,
    });
    const context = {
      workspaceId: 'workspace-a',
      userId: 'owner-a',
      correlationId: 'corr-video',
    };
    const draft = (await module.execute({
      context,
      idempotencyKey: 'create-video',
      input: {
        action: 'video_workflow_create_draft',
        payload: {
          workId: 'creative-work-video-a',
          workflowId: 'foundation-video',
          storyboardRevision: 'story-v4',
          catalogModelId: 'seedance-2',
          dataClass: ['pii', 'contains_face'],
          referenceAssetIds: ['asset-foundation-b', 'asset-foundation-a'],
          aigcLabelEnabled: false,
          executionContract: frozenVideoContract({
            dataClass: ['contains_face', 'pii'],
          }),
          shots: [
            {
              id: 'shot-a',
              prompt: '门店环境',
              candidatesPerShot: 2,
              durationSeconds: 15,
              height: 1280,
              width: 720,
            },
          ],
        },
      },
    })) as {
      confirmed: boolean;
      actorId: string;
      dataClass: string[];
      referenceAssetIds: string[];
      aigcLabelEnabled: boolean;
      workId: string;
    };
    assert.equal(draft.confirmed, false);
    assert.equal(draft.actorId, 'owner-a');
    assert.deepEqual(draft.dataClass, ['contains_face', 'pii']);
    assert.deepEqual(draft.referenceAssetIds, [
      'asset-foundation-a',
      'asset-foundation-b',
    ]);
    assert.equal(draft.aigcLabelEnabled, false);
    assert.equal(draft.workId, 'creative-work-video-a');

    await module.execute({
      context,
      idempotencyKey: 'confirm-video',
      input: {
        action: 'video_workflow_confirm',
        payload: { workflowId: 'foundation-video' },
      },
    });
    const queried = (await module.query({
      context,
      input: {
        action: 'video_workflow',
        payload: { workflowId: 'foundation-video' },
      },
    })) as {
      confirmed: boolean;
      workflowId: string;
    };
    assert.equal(queried.workflowId, 'foundation-video');
    assert.equal(queried.confirmed, true);
    assert.equal('job' in queried, false);
    assert.equal('attempts' in queried, false);
    assert.equal('routeSnapshot' in queried, false);
    const queriedInternal = await setupResult.application.query({
      workspaceId: 'workspace-a',
      workflowId: 'foundation-video',
    });
    assert.equal(queriedInternal.job?.kind, COMPOSED_VIDEO_JOB_KIND);

    const latest = (await module.query({
      context,
      input: {
        action: 'video_workflow_latest',
        payload: { workId: 'creative-work-video-a' },
      },
    })) as {
      confirmed: boolean;
      workflowId: string;
    };
    assert.equal(latest.workflowId, 'foundation-video');
    assert.equal(latest.confirmed, true);
    assert.equal('job' in latest, false);
    assert.equal('attempts' in latest, false);
    assert.equal('routeSnapshot' in latest, false);
    const publicLatest = (await module.query({
      context,
      input: {
        action: 'video_workflow_public_latest',
        payload: { workId: 'creative-work-video-a' },
      },
    })) as {
      workflowId: string;
      workId?: string;
      confirmed: boolean;
      shots: Array<{ shotId: string }>;
    };
    assert.equal(publicLatest.workflowId, 'foundation-video');
    assert.equal(publicLatest.workId, 'creative-work-video-a');
    assert.equal(publicLatest.confirmed, true);
    assert.deepEqual(publicLatest.shots.map(({ shotId }) => shotId), ['shot-a']);
    assert.equal('job' in publicLatest, false);
    assert.equal('attempts' in publicLatest, false);
    assert.equal('routeSnapshot' in publicLatest, false);
    assert.equal(
      await module.query({
        context,
        input: {
          action: 'video_workflow_public_latest',
          payload: { workId: 'creative-work-video-b' },
        },
      }),
      null,
    );
    assert.equal(
      await module.query({
        context,
        input: {
          action: 'video_workflow_latest',
          payload: { workId: 'creative-work-video-b' },
        },
      }),
      null,
    );
    assert.equal(
      await module.query({
        context: { ...context, userId: 'owner-b' },
        input: { action: 'video_workflow_latest', payload: {} },
      }),
      null,
    );
  });

  it('preserves storyboard lineage through the shared P1 command boundary', async () => {
    const setupResult = setup();
    const module = new ModelSupplyFoundationModule(
      new ModelSupplyControlPlaneService({
        application: setupResult.models,
        repository: new MemoryModelSupplyControlPlaneRepository(),
      }),
      { composedVideo: setupResult.application },
    );
    const context = {
      workspaceId: 'workspace-a',
      userId: 'owner-a',
      correlationId: 'corr-video-lineage',
    };
    const commonPayload = {
      workId: 'creative-work-foundation-lineage',
      storyboardRevision: 'same-storyboard-content',
      catalogModelId: 'seedance-2',
      executionContract: frozenVideoContract(),
      shots: [
        {
          id: 'opening',
          prompt: '门店开场',
          candidatesPerShot: 1,
          durationSeconds: 15,
          height: 1280,
          width: 720,
        },
      ],
    };
    const parent = (await module.execute({
      context,
      idempotencyKey: 'create-foundation-lineage-v1',
      input: {
        action: 'video_workflow_create_draft',
        payload: { ...commonPayload, workflowId: 'foundation-lineage-v1' },
      },
    })) as DurableVideoWorkflow;

    const derived = (await module.execute({
      context,
      idempotencyKey: 'create-foundation-lineage-v2',
      input: {
        action: 'video_workflow_create_draft',
        payload: {
          ...commonPayload,
          workflowId: 'foundation-lineage-v2',
          derivedFromWorkflowId: parent.id,
        },
      },
    })) as DurableVideoWorkflow;

    assert.equal(derived.derivedFromWorkflowId, parent.id);
    assert.equal(derived.storyboardVersion, 2);
  });

  it('exposes the current actor video workflow list through the shared P1 query', async () => {
    const setupResult = setup();
    const module = new ModelSupplyFoundationModule(
      new ModelSupplyControlPlaneService({
        application: setupResult.models,
        repository: new MemoryModelSupplyControlPlaneRepository(),
      }),
      { composedVideo: setupResult.application },
    );
    for (const actorId of ['owner-a', 'owner-b']) {
      await setupResult.application.createDraft({
        workspaceId: 'workspace-a',
        actorId,
        workId: `work-${actorId}`,
        workflowId: `workflow-${actorId}`,
        storyboardRevision: `story-${actorId}`,
        catalogModelId: 'seedance-2',
        dataClass: [],
        shots: [{ id: 'opening', prompt: '门店开场', candidatesPerShot: 1 }],
      });
    }

    const listed = (await module.query({
      context: {
        workspaceId: 'workspace-a',
        userId: 'owner-a',
        correlationId: 'corr-video-list',
      },
      input: { action: 'video_workflows', payload: {} },
    })) as Array<{ workflowId: string }>;

    assert.deepEqual(
      listed.map((item) => item.workflowId),
      ['workflow-owner-a'],
    );
    assert.ok(
      listed.every(
        (item) =>
          !('job' in item) &&
          !('attempts' in item) &&
          !('routeSnapshot' in item) &&
          !('actorId' in item),
      ),
    );
  });

  it('selects an unranked video candidate through the shared P1 foundation module', async () => {
    const setupResult = setup({
      qualityScorer: new HumanReviewRequiredScorer(),
    });
    const controlPlane = new ModelSupplyControlPlaneService({
      application: setupResult.models,
      repository: new MemoryModelSupplyControlPlaneRepository(),
    });
    const module = new ModelSupplyFoundationModule(controlPlane, {
      composedVideo: setupResult.application,
    });
    const context = {
      workspaceId: 'workspace-a',
      userId: 'owner-a',
      correlationId: 'corr-video-review',
    };

    await module.execute({
      context,
      idempotencyKey: 'create-review-video',
      input: {
        action: 'video_workflow_create_draft',
        payload: {
          workId: 'creative-work-review-video',
          workflowId: 'foundation-review-video',
          storyboardRevision: 'story-review-v1',
          catalogModelId: 'seedance-2',
          executionContract: frozenVideoContract(),
          shots: [
            {
              id: 'opening',
              prompt: '门店开场',
              candidatesPerShot: 2,
              durationSeconds: 15,
              height: 1280,
              width: 720,
            },
          ],
        },
      },
    });
    const confirmed = (await module.execute({
      context,
      idempotencyKey: 'confirm-review-video',
      input: {
        action: 'video_workflow_confirm',
        payload: { workflowId: 'foundation-review-video' },
      },
    })) as { job: { jobId: string } };
    const envelope = makeDurableJobEnvelope(
      {
        jobId: confirmed.job.jobId,
        workspaceId: 'workspace-a',
        kind: COMPOSED_VIDEO_JOB_KIND,
        payload: { workflowId: 'foundation-review-video' },
      },
      new Date('2026-07-12T00:00:00.000Z'),
    );
    assert.equal((await setupResult.worker.handle(envelope)).status, 'deferred');

    await assert.rejects(
      module.execute({
        context,
        idempotencyKey: 'invalid-review-choice',
        input: {
          action: 'video_workflow_select_candidate',
          payload: {
            workflowId: 'foundation-review-video',
            shotId: 'opening',
            candidateIndex: -1,
          },
        },
      }),
      /candidateIndex must be a non-negative integer/,
    );
    const selected = (await module.execute({
      context,
      idempotencyKey: 'select-review-choice',
      input: {
        action: 'video_workflow_select_candidate',
        payload: {
          workflowId: 'foundation-review-video',
          shotId: 'opening',
          candidateIndex: 1,
        },
      },
    })) as {
      workflow: DurableVideoWorkflow;
      job: { jobId: string };
    };
    assert.equal(selected.workflow.shots[0]?.selectedCandidateIndex, 1);
    assert.deepEqual(selected.workflow.shots[0]?.selectionAudit, {
      selectedBy: context.userId,
      correlationId: context.correlationId,
      selectedAt: selected.workflow.updatedAt,
      source: 'human_quality_review',
    });
    assert.match(selected.workflow.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(selected.job.jobId, confirmed.job.jobId);
    assert.equal((await setupResult.worker.handle(envelope)).status, 'completed');
    assert.equal(setupResult.executions(), 2);
  });

  it('edits a completed workflow through the public Foundation command with OCC and sanitized response', async () => {
    const setupResult = setup();
    const module = new ModelSupplyFoundationModule(
      new ModelSupplyControlPlaneService({
        application: setupResult.models,
        repository: new MemoryModelSupplyControlPlaneRepository(),
      }),
      { composedVideo: setupResult.application },
    );
    const context = {
      workspaceId: 'workspace-a',
      userId: 'owner-a',
      correlationId: 'corr-public-video-edit',
    };
    await module.execute({
      context,
      idempotencyKey: 'create-public-edit-video',
      input: {
        action: 'video_workflow_create_draft',
        payload: {
          workId: 'work-public-edit-video',
          workflowId: 'public-edit-video',
          storyboardRevision: 'story-public-edit-v1',
          catalogModelId: 'seedance-2',
          executionContract: frozenVideoContract(),
          shots: [
            {
              id: 'opening',
              prompt: '门店开场',
              candidatesPerShot: 1,
              durationSeconds: 15,
              height: 1280,
              width: 720,
            },
          ],
        },
      },
    });
    const confirmed = (await module.execute({
      context,
      idempotencyKey: 'confirm-public-edit-video',
      input: {
        action: 'video_workflow_confirm',
        payload: { workflowId: 'public-edit-video' },
      },
    })) as { job: { jobId: string } };
    const envelope = makeDurableJobEnvelope(
      {
        jobId: confirmed.job.jobId,
        workspaceId: context.workspaceId,
        kind: COMPOSED_VIDEO_JOB_KIND,
        payload: { workflowId: 'public-edit-video' },
      },
      new Date('2026-07-20T00:00:00.000Z'),
    );
    assert.equal((await setupResult.worker.handle(envelope)).status, 'completed');
    const before = (await module.query({
      context,
      input: {
        action: 'video_workflow_public_latest',
        payload: { workId: 'work-public-edit-video' },
      },
    })) as { revision: number };

    const edited = (await module.execute({
      context,
      idempotencyKey: 'edit-public-video-subtitle',
      input: {
        action: 'video_workflow_edit',
        payload: {
          workflowId: 'public-edit-video',
          expectedRevision: before.revision,
          edit: { kind: 'set_subtitle', text: '今天也要好好爱自己' },
        },
      },
    })) as {
      revision: number;
      subtitleText: string;
      workflowId: string;
    };
    assert.equal(edited.workflowId, 'public-edit-video');
    assert.equal(edited.revision, before.revision + 1);
    assert.equal(edited.subtitleText, '今天也要好好爱自己');
    assert.doesNotMatch(
      JSON.stringify(edited),
      /provider|credential|routeSnapshot|clipAssets|composedAsset/i,
    );

    const selected = (await module.execute({
      context,
      idempotencyKey: 'edit-public-video-selection',
      input: {
        action: 'video_workflow_edit',
        payload: {
          workflowId: 'public-edit-video',
          expectedRevision: edited.revision,
          edit: {
            kind: 'select_candidate',
            shotId: 'opening',
            candidateIndex: 0,
          },
        },
      },
    })) as { revision: number };
    const publicQueried = (await module.query({
      context,
      input: {
        action: 'video_workflow',
        payload: { workflowId: 'public-edit-video' },
      },
    })) as {
      revision: number;
      workflowId: string;
      shots: Array<{ selectedCandidateIndex?: number }>;
    };
    assert.equal(selected.revision, edited.revision + 1);
    assert.equal(publicQueried.workflowId, 'public-edit-video');
    assert.equal(publicQueried.revision, selected.revision);
    assert.equal(publicQueried.shots[0]?.selectedCandidateIndex, 0);
    assert.equal('job' in publicQueried, false);
    assert.equal('attempts' in publicQueried, false);
    assert.equal('routeSnapshot' in publicQueried, false);
    const internal = await setupResult.application.query({
      workspaceId: context.workspaceId,
      workflowId: 'public-edit-video',
    });
    assert.equal(
      internal.workflow.shots[0]?.selectionAudit?.selectedBy,
      context.userId,
    );
    assert.equal(
      internal.workflow.shots[0]?.selectionAudit?.correlationId,
      context.correlationId,
    );

    await assert.rejects(
      module.execute({
        context,
        idempotencyKey: 'edit-public-video-stale',
        input: {
          action: 'video_workflow_edit',
          payload: {
            workflowId: 'public-edit-video',
            expectedRevision: before.revision,
            edit: { kind: 'set_subtitle', text: '过期写入' },
          },
        },
      }),
      /revision is stale/,
    );
    await assert.rejects(
      module.execute({
        context: { ...context, workspaceId: 'workspace-b' },
        idempotencyKey: 'edit-public-video-cross-workspace',
        input: {
          action: 'video_workflow_edit',
          payload: {
            workflowId: 'public-edit-video',
            expectedRevision: selected.revision,
            edit: { kind: 'set_subtitle', text: '跨工作区' },
          },
        },
      }),
      /Unknown workflow|another workspace/,
    );
  });
});
