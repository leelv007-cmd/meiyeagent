import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryJobPort } from '../foundation/memory-job-port.js';
import {
  DurableTracerWorker,
  MemoryTracerJobRepository,
  TracerJobApplicationService,
} from '../job-runtime/tracer-worker.js';
import {
  MemoryModelAssetStorage,
  ModelSupplyApplicationService,
  RecordedAdapterRouter,
  createDefaultCatalogModels,
  createDefaultDeployments,
  type MediaProviderLifecyclePort,
  type ModelSupplyLedgerCheckpointInput,
  type ModelSupplyLedgerPort,
  type ModelSupplyPlanningControlPlanePort,
  type ModelSupplyProviderAdmissionPort,
  type ModelSupplyResult,
} from './index.js';
import {
  DurableMediaGenerationApplicationService,
  ModelMediaGenerationEffect,
} from './media-generation-workflow.js';
import { ProviderReferencePolicyError } from './reference-asset-delivery.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zp3sAAAAASUVORK5CYII=',
  'base64',
);

class RecoveringLedger implements ModelSupplyLedgerPort {
  result?: ModelSupplyResult;
  lateTerminalCalls = 0;
  freezeCalls = 0;
  checkpointCalls = 0;
  readonly frozenAttempts: Array<{
    attemptId: string;
    ordinal: number;
    deploymentId: string;
  }> = [];

  async checkpointAttempt() {
    this.checkpointCalls += 1;
    return this.result
      ? { replayed: true, recoveredResult: structuredClone(this.result) }
      : { replayed: false };
  }

  async settleAttempt(input: { result: ModelSupplyResult }) {
    this.result = structuredClone(input.result);
  }

  async freezeAttempt(input: ModelSupplyLedgerCheckpointInput) {
    this.freezeCalls += 1;
    this.frozenAttempts.push({
      attemptId: input.attemptId,
      ordinal: input.ordinal,
      deploymentId: input.deployment.id,
    });
    return { persisted: true };
  }

  async recordCancelledProviderTerminal(input: { result: ModelSupplyResult }) {
    this.lateTerminalCalls += 1;
    this.result = structuredClone(input.result);
  }
}

class RecoveringProvider implements MediaProviderLifecyclePort {
  submitCalls = 0;
  recoverCalls = 0;
  pollCalls = 0;
  cancelCalls = 0;
  private readonly receipts = new Map<
    string,
    Awaited<ReturnType<MediaProviderLifecyclePort['submit']>>
  >();

  constructor(
    private readonly firstAcceptance:
      | 'accepted'
      | 'acceptance_unknown' = 'acceptance_unknown',
  ) {}

  async submit(request: Parameters<MediaProviderLifecyclePort['submit']>[0]) {
    this.submitCalls += 1;
    const effectIdempotencyKey = Reflect.get(
      request,
      'effectIdempotencyKey',
    );
    assert.equal(typeof effectIdempotencyKey, 'string');
    const receipt = {
      acceptance: this.firstAcceptance,
      taskRef: 'provider-task-stable',
      providerCost: {
        amount: 0.1,
        currency: 'USD' as const,
        usage: { mediaUnits: 1 },
      },
    };
    this.receipts.set(effectIdempotencyKey, receipt);
    return receipt;
  }

  async recover(request: Parameters<MediaProviderLifecyclePort['submit']>[0]) {
    this.recoverCalls += 1;
    const effectIdempotencyKey = Reflect.get(
      request,
      'effectIdempotencyKey',
    );
    assert.equal(typeof effectIdempotencyKey, 'string');
    return this.receipts.get(effectIdempotencyKey) ?? null;
  }

  async poll() {
    this.pollCalls += 1;
    return {
      status: 'completed' as const,
      providerCost: {
        amount: 0.1,
        currency: 'USD' as const,
        usage: { mediaUnits: 1 },
      },
    };
  }

  async download() {
    return {
      bytes: png,
      contentType: 'image/png' as const,
      sourceExpiresAt: '2026-07-11T02:00:00.000Z',
    };
  }

  async cancel() {
    this.cancelCalls += 1;
  }
}

function createModels(
  ledger: ModelSupplyLedgerPort,
  assets: MemoryModelAssetStorage,
  providerAdmission?: ModelSupplyProviderAdmissionPort,
  planningControlPlane?: ModelSupplyPlanningControlPlanePort,
  referenceAssets?: ConstructorParameters<
    typeof ModelSupplyApplicationService
  >[0]['referenceAssets'],
) {
  return new ModelSupplyApplicationService({
    assetStorage: assets,
    deployments: createDefaultDeployments({
      activatedDeploymentIds: ['gpt-image-2-managed'],
      activationEvidenceStatus: 'recorded',
    }),
    execution: new RecordedAdapterRouter(),
    ledger,
    models: createDefaultCatalogModels(),
    ...(providerAdmission ? { providerAdmission } : {}),
    ...(planningControlPlane ? { planningControlPlane } : {}),
    ...(referenceAssets ? { referenceAssets } : {}),
  });
}

const authorizedSubmissionReferences = {
  async inspect(_workspaceId: string, assetIds: string[]) {
    return assetIds.map((assetId) => ({
      assetId,
      classificationSource: 'server_fact' as const,
      contentType: 'image/png',
      dataClass: [],
      kind: 'resolved' as const,
      rightsRevision: 'rights-r1',
      sha256: 'a'.repeat(64),
    }));
  },
  async resolve(_workspaceId: string, assetIds: string[]) {
    return assetIds.map((assetId) => ({
      assetId,
      bytes: Uint8Array.from(Buffer.from('reference')),
      classificationSource: 'server_fact' as const,
      contentType: 'image/png',
      dataClass: [],
      kind: 'resolved' as const,
      providerReadableUrl: 'data:image/png;base64,cmVmZXJlbmNl',
      rightsRevision: 'rights-r1',
      sha256: 'a'.repeat(64),
    }));
  },
};

function envelope(record: Awaited<ReturnType<TracerJobApplicationService['get']>>) {
  return {
    jobId: record.jobId,
    workspaceId: record.workspaceId,
    kind: record.kind,
    payload: record.payload,
    fingerprint: record.payloadHash,
    enqueuedAt: record.createdAt,
  };
}

describe('durable media generation', () => {
  it('guards submit, poll, and download with durable admission and releases every lease', async () => {
    const ledger = new RecoveringLedger();
    let activeLeases = 0;
    const admittedAttempts: string[] = [];
    let renewCalls = 0;
    const released: string[] = [];
    const providerAdmission: ModelSupplyProviderAdmissionPort = {
      async admit(input) {
        admittedAttempts.push(input.attemptId);
        activeLeases += 1;
        return {
          status: 'admitted',
          leaseId: `capacity:${input.attemptId}`,
          supplyPoolId: 'pool-shared-default',
          entitlementPolicyRevision: 'entitlement:growth:r1',
          appliedAllocationIds: [],
        };
      },
      async renew() {
        renewCalls += 1;
        return true;
      },
      async release(leaseId) {
        assert.equal(activeLeases, 1);
        activeLeases -= 1;
        released.push(leaseId);
      },
    };
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        assert.equal(activeLeases, 1);
        assert.equal(ledger.freezeCalls, 1);
        assert.equal(ledger.checkpointCalls, 1);
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-governed',
          providerCost: {
            amount: 0.1,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async recover() {
        throw new Error('accepted task must not recover');
      },
      async poll() {
        assert.equal(activeLeases, 1);
        return {
          status: 'completed',
          providerCost: {
            amount: 0.1,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async download() {
        assert.equal(activeLeases, 1);
        return { bytes: png, contentType: 'image/png' };
      },
      async cancel() {
        throw new Error('completed task must not cancel');
      },
    };
    const models = createModels(
      ledger,
      new MemoryModelAssetStorage(),
      providerAdmission,
    );
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'governed-media-effects',
      operation: 'image.generate',
      prompt: '受治理媒体任务',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );

    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    const terminal = await worker.handle(envelope(record));
    assert.equal(terminal.status, 'completed');
    assert.equal(admittedAttempts.length, 1);
    assert.equal(renewCalls, 2);
    assert.deepEqual(released, [`capacity:${admittedAttempts[0]}`]);
    assert.equal(activeLeases, 0);
    assert.equal(ledger.freezeCalls, 1);
  });

  it('does not call the provider when an expired lease cannot re-enter the fair queue', async () => {
    const ledger = new RecoveringLedger();
    let reacquireCalls = 0;
    const models = createModels(
      ledger,
      new MemoryModelAssetStorage(),
      {
        async admit(input) {
          return {
            status: 'admitted',
            leaseId: `capacity:${input.attemptId}`,
            supplyPoolId: 'pool-shared-default',
            entitlementPolicyRevision: 'entitlement:growth:r1',
            appliedAllocationIds: [],
          };
        },
        async renew() {
          return false;
        },
        async reacquire() {
          reacquireCalls += 1;
          return false;
        },
        async release() {},
      },
    );
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const provider = new RecoveringProvider('accepted');
    const queued = await models.submit({
      actorId: 'owner-expired',
      dataClass: [],
      idempotencyKey: 'expired-lease-does-not-overcommit',
      operation: 'image.generate',
      prompt: '过期容量租约',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-expired',
    });
    const record = await jobs.get('workspace-expired', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );

    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    assert.deepEqual(await worker.handle(envelope(record)), {
      status: 'deferred',
      output: { acceptance: 'acceptance_unknown' },
    });
    assert.equal(reacquireCalls, 1);
    assert.equal(provider.pollCalls, 0);
  });

  it('preserves the frozen planning explanation through the observed media terminal', async () => {
    const ledger = new RecoveringLedger();
    const planningControlPlane: ModelSupplyPlanningControlPlanePort = {
      async readPlanningState() {
        return {
          routePolicyRevisionId: 'route-policy:image.generate:quality:r5',
          routePolicy: {
            operation: 'image.generate',
            qualityTier: 'quality',
            hardConstraints: ['deployment_active', 'data_class'],
            candidateDeploymentIds: ['gpt-image-2-managed'],
            maxAttempts: 1,
            fallbackAuthorized: false,
          },
          dataPolicyByDeploymentId: new Map([
            [
              'gpt-image-2-managed',
              {
                deploymentId: 'gpt-image-2-managed',
                dataPolicyRevisionId: 'data-policy:gpt-image:r3',
                dataPolicy: {
                  sourceTrustLevel: 'contract_attested',
                  processingRegion: 'overseas',
                  allowedDataClasses: ['public'],
                },
              },
            ],
          ]),
        };
      },
    };
    const models = createModels(
      ledger,
      new MemoryModelAssetStorage(),
      undefined,
      planningControlPlane,
    );
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const workspaceId = 'workspace-media-planning-audit';
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'media-planning-audit',
      operation: 'image.generate',
      prompt: '异步媒体规划审计',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId,
    });
    const record = await jobs.get(workspaceId, queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({
        models,
        provider: new RecoveringProvider('accepted'),
      }),
    );

    assert.deepEqual(
      queued.snapshot.decisionExplanation?.acceptanceBranch,
      {
        acceptance: 'not_attempted',
        decision: 'complete',
        reason: 'planned_execution',
        primaryDeploymentId: 'gpt-image-2-managed',
      },
    );
    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    assert.equal((await worker.handle(envelope(record))).status, 'completed');
    const completed = await runtime.get(workspaceId, queued.jobId);

    assert.equal(
      completed.result.snapshot.routePolicyRevisionId,
      'route-policy:image.generate:quality:r5',
    );
    assert.equal(
      completed.result.snapshot.dataPolicyRevisionId,
      'data-policy:gpt-image:r3',
    );
    assert.deepEqual(
      completed.result.snapshot.decisionExplanation?.acceptanceBranch,
      {
        acceptance: 'accepted',
        decision: 'complete',
        reason: 'provider_completed',
        primaryDeploymentId: 'gpt-image-2-managed',
      },
    );
  });

  it('runs the production media chain across independent frozen channels only after pre-accept rejection', async () => {
    const primaryId = 'gpt-image-2-managed';
    const fallbackId = 'gpt-image-2-tuzi-relay';
    const deployments = createDefaultDeployments({
      activatedDeploymentIds: [primaryId, fallbackId],
      activationEvidenceStatus: 'recorded',
    }).map((deployment) =>
      deployment.id === primaryId
        ? {
            ...deployment,
            accountIdentity: 'account-openai-image',
            endpointFingerprint: 'endpoint-openai-image',
          }
        : deployment.id === fallbackId
          ? {
              ...deployment,
              accountIdentity: 'account-tuzi-image',
              endpointFingerprint: 'endpoint-tuzi-image',
            }
          : deployment,
    );
    const planningControlPlane: ModelSupplyPlanningControlPlanePort = {
      async readPlanningState() {
        return {
          routePolicyRevisionId: 'route-policy:image.generate:quality:r12',
          routePolicy: {
            operation: 'image.generate',
            qualityTier: 'quality',
            hardConstraints: ['deployment_active', 'data_class'],
            candidateDeploymentIds: [primaryId, fallbackId],
            maxAttempts: 2,
            fallbackAuthorized: true,
          },
          dataPolicyByDeploymentId: new Map(
            [primaryId, fallbackId].map((deploymentId) => [
              deploymentId,
              {
                deploymentId,
                dataPolicyRevisionId: `data-policy:${deploymentId}:r1`,
                dataPolicy: {
                  sourceTrustLevel: 'contract_attested' as const,
                  processingRegion: 'overseas' as const,
                  allowedDataClasses: ['public' as const],
                },
              },
            ]),
          ),
        };
      },
    };
    const ledger = new RecoveringLedger();
    const admitted: Array<{ attemptId: string; deploymentId: string }> = [];
    const released: string[] = [];
    const providerAdmission: ModelSupplyProviderAdmissionPort = {
      async admit(input) {
        admitted.push({
          attemptId: input.attemptId,
          deploymentId: input.deployment.id,
        });
        return {
          status: 'admitted',
          leaseId: `capacity:${input.attemptId}`,
          supplyPoolId: `pool:${input.deployment.id}`,
          entitlementPolicyRevision: 'entitlement:growth:r7',
          appliedAllocationIds: [],
        };
      },
      async renew() {
        return true;
      },
      async release(leaseId) {
        released.push(leaseId);
      },
    };
    const models = new ModelSupplyApplicationService({
      assetStorage: new MemoryModelAssetStorage(),
      deployments,
      execution: new RecordedAdapterRouter(),
      ledger,
      models: createDefaultCatalogModels(),
      planningControlPlane,
      providerAdmission,
    });
    const submitted: Array<{
      deploymentId: string;
      effectIdempotencyKey: string;
    }> = [];
    const provider: MediaProviderLifecyclePort = {
      async submit(request) {
        submitted.push({
          deploymentId: request.deployment.id,
          effectIdempotencyKey: request.effectIdempotencyKey,
        });
        if (request.deployment.id === primaryId) {
          return {
            acceptance: 'rejected_before_accept',
            errorCode: 'primary_pre_accept_failure',
            retryable: true,
            error: 'primary rejected before acceptance',
            providerCost: { amount: 0, currency: 'USD', usage: {} },
          };
        }
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-fallback',
          providerCost: {
            amount: 0.02,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async recover() {
        throw new Error('accepted fallback already has a durable task ref');
      },
      async poll(request) {
        assert.equal(request.deployment.id, fallbackId);
        return {
          status: 'completed',
          providerCost: {
            amount: 0.02,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async download(request) {
        assert.equal(request.deployment.id, fallbackId);
        return { bytes: png, contentType: 'image/png' };
      },
      async cancel() {},
    };
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const workspaceId = 'workspace-media-safe-fallback';
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'media-safe-fallback',
      operation: 'image.generate',
      prompt: '主渠道接单前失败后安全切换',
      selection: {
        catalogModelId: 'gpt-image-2',
        fallbackConsent: true,
        mode: 'fixed',
      },
      workspaceId,
    });
    const record = await jobs.get(workspaceId, queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );

    assert.equal(queued.snapshot.maxAttempts, 2);
    assert.equal(queued.snapshot.fallbackAuthorized, true);
    assert.deepEqual(
      queued.snapshot.allowedCandidates?.map((candidate) => ({
        deploymentId: candidate.deploymentId,
        accountIdentity: candidate.accountIdentity,
        endpointFingerprint: candidate.endpointFingerprint,
      })),
      [
        {
          deploymentId: primaryId,
          accountIdentity: 'account-openai-image',
          endpointFingerprint: 'endpoint-openai-image',
        },
        {
          deploymentId: fallbackId,
          accountIdentity: 'account-tuzi-image',
          endpointFingerprint: 'endpoint-tuzi-image',
        },
      ],
    );
    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    assert.equal((await worker.handle(envelope(record))).status, 'completed');
    const completed = await runtime.get(workspaceId, queued.jobId);

    assert.deepEqual(
      submitted.map((entry) => entry.deploymentId),
      [primaryId, fallbackId],
    );
    assert.equal(new Set(submitted.map((entry) => entry.effectIdempotencyKey)).size, 2);
    assert.deepEqual(
      admitted.map((entry) => entry.deploymentId),
      [primaryId, fallbackId],
    );
    assert.equal(new Set(admitted.map((entry) => entry.attemptId)).size, 2);
    assert.ok(admitted.every((entry) => !entry.attemptId.includes(':lease:')));
    assert.deepEqual(
      ledger.frozenAttempts.map((entry) => ({
        ordinal: entry.ordinal,
        deploymentId: entry.deploymentId,
      })),
      [
        { ordinal: 1, deploymentId: primaryId },
        { ordinal: 2, deploymentId: fallbackId },
      ],
    );
    assert.deepEqual(
      completed.result.attempts.map((attempt) => ({
        deploymentId: attempt.deploymentId,
        acceptance: attempt.acceptance,
      })),
      [
        { deploymentId: primaryId, acceptance: 'rejected_before_accept' },
        { deploymentId: fallbackId, acceptance: 'accepted' },
      ],
    );
    assert.equal(completed.result.snapshot.deploymentId, fallbackId);
    assert.deepEqual(
      completed.result.snapshot.decisionExplanation?.acceptanceBranch,
      {
        acceptance: 'accepted',
        decision: 'safe_auto_fallback',
        reason: 'provider_completed_after_safe_auto_fallback',
        primaryDeploymentId: primaryId,
        fallbackDeploymentId: fallbackId,
      },
    );
    assert.deepEqual(released.sort(), admitted
      .map((entry) => `capacity:${entry.attemptId}`)
      .sort());
  });

  it('never crosses to a frozen media fallback after accepted or acceptance_unknown', async () => {
    const primaryId = 'gpt-image-2-managed';
    const fallbackId = 'gpt-image-2-tuzi-relay';
    const deployments = createDefaultDeployments({
      activatedDeploymentIds: [primaryId, fallbackId],
      activationEvidenceStatus: 'recorded',
    }).map((deployment) =>
      deployment.id === primaryId
        ? {
            ...deployment,
            accountIdentity: 'account-openai-image',
            endpointFingerprint: 'endpoint-openai-image',
          }
        : deployment.id === fallbackId
          ? {
              ...deployment,
              accountIdentity: 'account-tuzi-image',
              endpointFingerprint: 'endpoint-tuzi-image',
            }
          : deployment,
    );
    for (const acceptance of ['accepted', 'acceptance_unknown'] as const) {
      const models = new ModelSupplyApplicationService({
        assetStorage: new MemoryModelAssetStorage(),
        deployments,
        execution: new RecordedAdapterRouter(),
        ledger: new RecoveringLedger(),
        models: createDefaultCatalogModels(),
        planningControlPlane: {
          async readPlanningState() {
            return {
              routePolicyRevisionId: 'route-policy:image.generate:quality:r13',
              routePolicy: {
                operation: 'image.generate',
                qualityTier: 'quality',
                hardConstraints: ['deployment_active', 'data_class'],
                candidateDeploymentIds: [primaryId, fallbackId],
                maxAttempts: 2,
                fallbackAuthorized: true,
              },
            };
          },
        },
      });
      const submission = {
        actorId: 'owner-a',
        dataClass: [],
        idempotencyKey: `media-no-resubmit-${acceptance}`,
        operation: 'image.generate' as const,
        prompt: '已接单或接单未知不重投',
        selection: {
          catalogModelId: 'gpt-image-2',
          fallbackConsent: true,
          mode: 'fixed' as const,
        },
        workspaceId: 'workspace-media-no-resubmit',
      };
      const preview = await models.prepareMediaSubmission(submission);
      const frozenSubmission = {
        ...submission,
        frozenRouteSnapshot: preview.snapshot,
      };
      const deploymentsCalled: string[] = [];
      const result = await models.executeMediaProviderSubmission(
        frozenSubmission,
        {
          async execute(request) {
            deploymentsCalled.push(request.deployment.id);
            return {
              kind: 'failure',
              acceptance,
              providerTaskRef: 'provider-task-primary',
              message: 'provider owns reconciliation',
              providerCost: { amount: 0.01, currency: 'USD', usage: {} },
            };
          },
        },
        { useFrozenMediaCandidateSequence: true },
      );

      assert.deepEqual(deploymentsCalled, [primaryId]);
      assert.equal(result.attempts.length, 1);
      assert.equal(result.attempt.acceptance, acceptance);
      assert.equal(
        result.snapshot.decisionExplanation?.acceptanceBranch.decision,
        'query_reconcile_manual',
      );
    }
  });

  it('refuses a frozen media fallback that shares the primary fault domain', async () => {
    const primaryId = 'gpt-image-2-managed';
    const fallbackId = 'gpt-image-2-tuzi-relay';
    const deployments = createDefaultDeployments({
      activatedDeploymentIds: [primaryId, fallbackId],
      activationEvidenceStatus: 'recorded',
    }).map((deployment) =>
      [primaryId, fallbackId].includes(deployment.id)
        ? {
            ...deployment,
            accountIdentity: 'shared-image-account',
            endpointFingerprint: 'shared-image-endpoint',
          }
        : deployment,
    );
    const models = new ModelSupplyApplicationService({
      assetStorage: new MemoryModelAssetStorage(),
      deployments,
      execution: new RecordedAdapterRouter(),
      ledger: new RecoveringLedger(),
      models: createDefaultCatalogModels(),
      planningControlPlane: {
        async readPlanningState() {
          return {
            routePolicyRevisionId: 'route-policy:image.generate:quality:r14',
            routePolicy: {
              operation: 'image.generate',
              qualityTier: 'quality',
              hardConstraints: ['deployment_active', 'data_class'],
              candidateDeploymentIds: [primaryId, fallbackId],
              maxAttempts: 2,
              fallbackAuthorized: true,
            },
          };
        },
      },
    });
    const submission = {
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'media-shared-domain-no-fallback',
      operation: 'image.generate' as const,
      prompt: '同故障域不切换',
      selection: {
        catalogModelId: 'gpt-image-2',
        fallbackConsent: true,
        mode: 'fixed' as const,
      },
      workspaceId: 'workspace-media-shared-domain',
    };
    const preview = await models.prepareMediaSubmission(submission);
    const deploymentsCalled: string[] = [];
    const result = await models.executeMediaProviderSubmission(
      { ...submission, frozenRouteSnapshot: preview.snapshot },
      {
        async execute(request) {
          deploymentsCalled.push(request.deployment.id);
          return {
            kind: 'failure',
            acceptance: 'rejected_before_accept',
            message: 'primary rejected before acceptance',
            providerCost: { amount: 0, currency: 'USD', usage: {} },
          };
        },
      },
      { useFrozenMediaCandidateSequence: true },
    );

    assert.deepEqual(deploymentsCalled, [primaryId]);
    assert.equal(result.status, 'failed');
    assert.equal(result.attempts.length, 1);
  });

  it('recovers a provider receipt by stable effect key after response loss without resubmitting', async () => {
    let now = new Date('2026-07-11T01:00:00.000Z');
    class ResponseLossRepository extends MemoryTracerJobRepository {
      private loseFirstAcceptedRecord = true;

      override recordAccepted(
        ...args: Parameters<MemoryTracerJobRepository['recordAccepted']>
      ) {
        if (this.loseFirstAcceptedRecord) {
          this.loseFirstAcceptedRecord = false;
          throw new Error('simulated tracer response loss');
        }
        return super.recordAccepted(...args);
      }
    }

    const ledger = new RecoveringLedger();
    const assets = new MemoryModelAssetStorage();
    const admittedAttempts: string[] = [];
    let renewCalls = 0;
    const models = createModels(ledger, assets, {
      async admit(input) {
        admittedAttempts.push(input.attemptId);
        return {
          status: 'admitted',
          leaseId: `capacity:${input.attemptId}`,
          supplyPoolId: 'pool-shared-default',
          entitlementPolicyRevision: 'entitlement:growth:r1',
          appliedAllocationIds: [],
        };
      },
      async renew() {
        renewCalls += 1;
        return true;
      },
      async release() {},
    });
    const repository = new ResponseLossRepository(
      new MemoryJobPort(),
      () => new Date(now),
      { leaseDurationMs: 60_000 },
    );
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const provider = new RecoveringProvider('accepted');
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'response-loss-image-a',
      operation: 'image.generate',
      prompt: '响应丢失后恢复',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );

    await assert.rejects(
      worker.handle(envelope(record)),
      /simulated tracer response loss/,
    );
    const responseLost = await jobs.get('workspace-a', queued.jobId);
    assert.equal(responseLost.status, 'running');
    assert.equal(responseLost.providerTaskRef, null);
    assert.equal(provider.submitCalls, 1);

    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    assert.equal(provider.recoverCalls, 0);
    now = new Date('2026-07-11T01:01:01.000Z');

    assert.equal((await worker.handle(envelope(record))).status, 'completed');
    assert.equal(provider.submitCalls, 1);
    assert.equal(provider.recoverCalls, 1);
    assert.equal(provider.pollCalls, 1);
    assert.equal(admittedAttempts.length, 1);
    assert.equal(renewCalls, 3);
    assert.equal(
      (await jobs.get('workspace-a', queued.jobId)).providerTaskRef,
      'provider-task-stable',
    );
    assert.equal(
      (await runtime.get('workspace-a', queued.jobId))
        .providerLifecycleLatencyMs,
      61_000,
    );
  });

  it('recovers the same provider task after restart and completes only after storage receipt', async () => {
    const ledger = new RecoveringLedger();
    const assets = new MemoryModelAssetStorage();
    const firstModels = createModels(ledger, assets);
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({
      jobs,
      models: firstModels,
    });
    firstModels.attachDurableMediaRuntime(runtime);
    const provider = new RecoveringProvider();

    const queued = await firstModels.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'durable-image-a',
      operation: 'image.generate',
      prompt: '门店项目图',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const firstWorker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models: firstModels, provider }),
    );
    assert.equal((await firstWorker.handle(envelope(record))).status, 'deferred');
    assert.equal(provider.submitCalls, 1);
    assert.equal(
      (await jobs.get('workspace-a', queued.jobId)).providerTaskRef,
      'provider-task-stable',
    );

    const restartedModels = createModels(ledger, assets);
    const restartedWorker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models: restartedModels, provider }),
    );
    assert.equal((await restartedWorker.handle(envelope(record))).status, 'completed');
    assert.equal(provider.submitCalls, 1);
    assert.equal(provider.pollCalls, 1);
    const completed = await runtime.get('workspace-a', queued.jobId);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.result.asset?.sourceTaskRef, 'provider-task-stable');
    assert.equal(
      completed.result.asset?.sourceTtlEvidence?.expiresAt,
      '2026-07-11T02:00:00.000Z',
    );
    assert.equal(
      completed.result.asset?.sourceTtlEvidence?.providerTaskRef,
      'provider-task-stable',
    );
    assert.ok(completed.result.asset?.sourceTtlEvidence?.recordedAt);
    assert.deepEqual(
      Buffer.from(assets.read(completed.result.asset?.objectKey ?? '') ?? []),
      png,
    );
  });

  it('applies cancel to the durable provider task instead of a local projection', async () => {
    const ledger = new RecoveringLedger();
    const admittedAttempts: string[] = [];
    let renewCalls = 0;
    const released: string[] = [];
    const models = createModels(
      ledger,
      new MemoryModelAssetStorage(),
      {
        async admit(input) {
          admittedAttempts.push(input.attemptId);
          return {
            status: 'admitted',
            leaseId: `capacity:${input.attemptId}`,
            supplyPoolId: 'pool-shared-default',
            entitlementPolicyRevision: 'entitlement:growth:r1',
            appliedAllocationIds: [],
          };
        },
        async renew() {
          renewCalls += 1;
          return true;
        },
        async release(leaseId) {
          released.push(leaseId);
        },
      },
    );
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const provider = new RecoveringProvider('accepted');
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'cancel-image-a',
      operation: 'image.generate',
      prompt: '取消我',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );
    await worker.handle(envelope(record));
    assert.equal(ledger.result?.attempt.acceptance, 'accepted');
    assert.equal(ledger.result?.attempt.providerTaskRef, 'provider-task-stable');
    assert.equal((await runtime.cancel({
      actorId: 'owner-a',
      jobId: queued.jobId,
      workspaceId: 'workspace-a',
    })).status, 'cancel_requested');
    await worker.handle(envelope(record));
    const cancelled = await runtime.get('workspace-a', queued.jobId);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.result.status, 'failed');
    assert.equal(cancelled.result.usage.status, 'refunded');
    assert.equal(ledger.result?.status, 'failed');
    assert.equal(ledger.result?.usage.status, 'refunded');
    assert.equal(provider.cancelCalls, 1);
    assert.equal(admittedAttempts.length, 1);
    assert.equal(renewCalls, 1);
    assert.deepEqual(released, [`capacity:${admittedAttempts[0]}`]);
  });

  it('keeps an in-flight submit fenced until its task reference is durable, then cancels and refunds it', async () => {
    let releaseSubmit!: () => void;
    let markSubmitEntered!: () => void;
    const submitEntered = new Promise<void>((resolve) => {
      markSubmitEntered = resolve;
    });
    const submitGate = new Promise<void>((resolve) => {
      releaseSubmit = resolve;
    });
    const cancelledTaskRefs: string[] = [];
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        markSubmitEntered();
        await submitGate;
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-accepted-during-cancel',
          providerCost: {
            amount: 0.1,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async recover() {
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-accepted-during-cancel',
          providerCost: {
            amount: 0.1,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async poll() {
        throw new Error('a cancelled task must not be polled');
      },
      async download() {
        throw new Error('a cancelled task must not be downloaded');
      },
      async cancel(request) {
        cancelledTaskRefs.push(request.taskRef);
      },
    };
    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'cancel-during-submit-image-a',
      operation: 'image.generate',
      prompt: '提交中取消',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );

    const submitting = worker.handle(envelope(record));
    await submitEntered;
    await runtime.cancel({
      actorId: 'owner-a',
      jobId: queued.jobId,
      workspaceId: 'workspace-a',
    });
    assert.equal(
      (await worker.handle(envelope(record))).status,
      'deferred',
      'cancellation must wait for the active submit lease'
    );

    releaseSubmit();
    assert.equal((await submitting).status, 'deferred');
    const accepted = await jobs.get('workspace-a', queued.jobId);
    assert.equal(accepted.status, 'cancel_requested');
    assert.equal(
      accepted.providerTaskRef,
      'provider-task-accepted-during-cancel'
    );

    assert.equal((await worker.handle(envelope(record))).status, 'completed');
    const cancelled = await runtime.get('workspace-a', queued.jobId);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.result.usage.status, 'refunded');
    assert.equal(ledger.result?.usage.status, 'refunded');
    assert.deepEqual(cancelledTaskRefs, [
      'provider-task-accepted-during-cancel',
    ]);
  });

  it('recovers a lost accepted task reference before cancelling and refunding', async () => {
    let now = new Date('2026-07-11T02:00:00.000Z');
    class LostAcceptanceRepository extends MemoryTracerJobRepository {
      private loseReceipt = true;

      override recordAccepted(
        ...args: Parameters<MemoryTracerJobRepository['recordAccepted']>
      ) {
        if (this.loseReceipt) {
          this.loseReceipt = false;
          throw new Error('acceptance receipt lost before tracer commit');
        }
        return super.recordAccepted(...args);
      }
    }

    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new LostAcceptanceRepository(
      new MemoryJobPort(),
      () => new Date(now),
      { leaseDurationMs: 60_000 },
    );
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const provider = new RecoveringProvider('accepted');
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'cancel-after-lost-task-ref',
      operation: 'image.generate',
      prompt: '恢复后取消',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );

    await assert.rejects(
      worker.handle(envelope(record)),
      /acceptance receipt lost before tracer commit/,
    );
    await runtime.cancel({
      actorId: 'owner-a',
      jobId: queued.jobId,
      workspaceId: 'workspace-a',
    });
    now = new Date('2026-07-11T02:01:01.000Z');

    assert.equal((await worker.handle(envelope(record))).status, 'completed');
    const cancelled = await runtime.get('workspace-a', queued.jobId);
    assert.equal(cancelled.providerTaskRef, 'provider-task-stable');
    assert.equal(cancelled.result.usage.status, 'refunded');
    assert.equal(ledger.result?.usage.status, 'refunded');
    assert.equal(provider.submitCalls, 1);
    assert.equal(provider.recoverCalls, 1);
    assert.equal(provider.cancelCalls, 1);
  });

  it('settles a reserved unknown attempt when cancellation recovery confirms pre-acceptance rejection', async () => {
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        return {
          acceptance: 'acceptance_unknown',
          providerCost: {
            amount: 0,
            currency: 'USD',
            usage: {},
          },
        };
      },
      async recover() {
        return {
          acceptance: 'rejected_before_accept',
          providerCost: {
            amount: 0,
            currency: 'USD',
            usage: {},
          },
        };
      },
      async poll() {
        throw new Error('a rejected task must not be polled');
      },
      async download() {
        throw new Error('a rejected task must not be downloaded');
      },
      async cancel() {
        throw new Error('a task rejected before acceptance must not be cancelled');
      },
    };
    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'cancel-recovered-rejection',
      operation: 'image.generate',
      prompt: '恢复确认未接单',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );

    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    assert.equal(ledger.result?.usage.status, 'reserved');
    await runtime.cancel({
      actorId: 'owner-a',
      jobId: queued.jobId,
      workspaceId: 'workspace-a',
    });
    assert.equal((await worker.handle(envelope(record))).status, 'completed');

    assert.equal(
      (await runtime.get('workspace-a', queued.jobId)).result.usage.status,
      'refunded'
    );
    assert.equal(ledger.result?.usage.status, 'refunded');
    assert.equal(ledger.result?.attempt.acceptance, 'rejected_before_accept');
  });

  it('does not automatically resubmit fixed media after provider rejection', async () => {
    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    let submitCalls = 0;
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        submitCalls += 1;
        return {
          acceptance: 'rejected_before_accept',
          providerCost: {
            amount: 0,
            currency: 'USD',
            usage: {},
          },
          errorCode: 'content_rejected',
          retryable: false,
          error: 'capacity rejected',
        };
      },
      async recover() {
        return null;
      },
      async poll() {
        throw new Error('rejected media must not poll');
      },
      async download() {
        throw new Error('rejected media must not download');
      },
      async cancel() {},
    };
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'rejected-image-a',
      operation: 'image.generate',
      prompt: '不自动重试',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );
    assert.equal((await worker.handle(envelope(record))).status, 'dead_letter');
    assert.equal((await worker.handle(envelope(record))).status, 'dead_letter');
    const failed = await jobs.get('workspace-a', queued.jobId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.acceptance, 'rejected_before_accept');
    assert.match(
      failed.error ?? '',
      /phase=submit code=content_rejected retryable=false/,
    );
    const failedView = await runtime.get('workspace-a', queued.jobId);
    assert.equal(failedView.result.status, 'failed');
    assert.equal(failedView.result.usage.status, 'refunded');
    assert.equal(failedView.result.providerCost.amount, 0);
    assert.equal(submitCalls, 1);
  });

  it('keeps provider poll error code and retryability in terminal tracer evidence', async () => {
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-poll-failed',
          providerCost: {
            amount: 0.12,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async recover() {
        return null;
      },
      async poll() {
        return {
          status: 'failed',
          providerCost: {
            amount: 0.12,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
          errorCode: 'logical_timeout',
          retryable: true,
          error: 'provider task exceeded its logical timeout',
        };
      },
      async download() {
        throw new Error('a failed task must not download');
      },
      async cancel() {},
    };
    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({
      jobs,
      models,
      provider,
    });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'poll-failure-image-a',
      operation: 'image.generate',
      prompt: '轮询失败证据',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );

    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    assert.equal((await worker.handle(envelope(record))).status, 'dead_letter');
    const failed = await jobs.get('workspace-a', queued.jobId);
    assert.match(
      failed.error ?? '',
      /phase=poll code=logical_timeout retryable=true/,
    );
  });

  it('keeps provider cancellation pending without refunding until the provider confirms cancellation', async () => {
    let cancelCalls = 0;
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-cancel-pending',
          providerCost: {
            amount: 0.45,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async recover() {
        return null;
      },
      async poll() {
        throw new Error('a cancellation request must not enter normal polling');
      },
      async download() {
        throw new Error('a cancellation request must not download');
      },
      async cancel() {
        cancelCalls += 1;
        return cancelCalls === 1
          ? {
              status: 'pending',
              errorCode: 'cancel_pending',
              retryable: true,
              error: 'provider cancellation is still pending',
            }
          : { status: 'cancelled' };
      },
    };
    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({
      jobs,
      models,
      provider,
    });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'cancel-pending-image-a',
      operation: 'image.generate',
      prompt: '等待供应方确认取消',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );

    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    await runtime.cancel({
      actorId: 'owner-a',
      jobId: queued.jobId,
      workspaceId: 'workspace-a',
    });
    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    const pending = await runtime.get('workspace-a', queued.jobId);
    assert.equal(pending.status, 'cancel_requested');
    assert.equal(pending.result.usage.status, 'reserved');
    assert.match(
      (await jobs.get('workspace-a', queued.jobId)).error ?? '',
      /phase=cancel code=cancel_pending retryable=true/,
    );

    assert.equal((await worker.handle(envelope(record))).status, 'completed');
    const cancelled = await runtime.get('workspace-a', queued.jobId);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.result.usage.status, 'refunded');
    assert.equal(cancelCalls, 2);
  });

  it('retries download and owned storage for the same accepted task without resubmitting generation', async () => {
    let submitCalls = 0;
    let pollCalls = 0;
    let downloadCalls = 0;
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        submitCalls += 1;
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-download-retry',
          providerCost: {
            amount: 0.12,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async recover() {
        return null;
      },
      async poll() {
        pollCalls += 1;
        return {
          status: 'completed',
          providerCost: {
            amount: 0.12,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async download() {
        downloadCalls += 1;
        if (downloadCalls === 1) {
          throw Object.assign(new Error('recorded provider download failed'), {
            code: 'download_failed',
            retryable: true,
          });
        }
        return {
          bytes: png,
          contentType: 'image/png',
        };
      },
      async cancel() {},
    };
    const ledger = new RecoveringLedger();
    const assets = new MemoryModelAssetStorage();
    const models = createModels(ledger, assets);
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({
      jobs,
      models,
      provider,
    });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'download-retry-image-a',
      operation: 'image.generate',
      prompt: '下载失败后恢复',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );

    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    const failedDownload = await jobs.get('workspace-a', queued.jobId);
    assert.equal(failedDownload.acceptance, 'accepted');
    assert.equal(failedDownload.providerTaskRef, 'provider-task-download-retry');
    assert.match(
      failedDownload.error ?? '',
      /phase=download code=download_failed retryable=true/,
    );

    assert.equal((await worker.handle(envelope(record))).status, 'completed');
    const completed = await runtime.get('workspace-a', queued.jobId);
    assert.equal(completed.result.asset?.sourceTaskRef, 'provider-task-download-retry');
    assert.equal(submitCalls, 1);
    assert.equal(pollCalls, 2);
    assert.equal(downloadCalls, 2);
  });

  it('reconciles a late provider success into an isolated owned asset and observed cost idempotently', async () => {
    let pollCalls = 0;
    let downloadCalls = 0;
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-late-success',
          providerCost: {
            amount: 0.2,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async recover() {
        return null;
      },
      async poll() {
        pollCalls += 1;
        return {
          status: 'completed',
          providerCost: {
            amount: 0.37,
            currency: 'USD',
            usage: { mediaUnits: 2 },
          },
          sourceExpiresAt: '2026-07-11T06:00:00.000Z',
        };
      },
      async download() {
        downloadCalls += 1;
        return {
          bytes: png,
          contentType: 'image/png',
          sourceExpiresAt: '2026-07-11T06:00:00.000Z',
        };
      },
      async cancel() {
        return { status: 'cancelled' };
      },
    };
    const ledger = new RecoveringLedger();
    const assets = new MemoryModelAssetStorage();
    const models = createModels(ledger, assets);
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({
      jobs,
      models,
      provider,
    });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'late-success-image-a',
      operation: 'image.generate',
      prompt: '取消后供应方仍成功',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );
    await worker.handle(envelope(record));
    await runtime.cancel({
      actorId: 'owner-a',
      jobId: queued.jobId,
      workspaceId: 'workspace-a',
    });
    await worker.handle(envelope(record));

    const first = await runtime.reconcileCancelledProviderTerminal({
      jobId: queued.jobId,
      providerTaskRef: 'provider-task-late-success',
      workspaceId: 'workspace-a',
    });
    assert.equal(first.status, 'completed');
    assert.equal(first.reconciliation?.isolatedFromCancelledWorkflow, true);
    assert.equal(first.reconciliation?.asset?.sourceTaskRef, 'provider-task-late-success');
    assert.equal(first.result.status, 'failed');
    assert.equal(first.result.usage.status, 'refunded');
    assert.equal(first.result.providerCost.status, 'observed');
    assert.equal(first.result.providerCost.amount, 0.37);
    assert.deepEqual(first.result.providerCost.usage, { mediaUnits: 2 });
    assert.equal(ledger.lateTerminalCalls, 1);

    const replay = await runtime.reconcileCancelledProviderTerminal({
      jobId: queued.jobId,
      providerTaskRef: 'provider-task-late-success',
      workspaceId: 'workspace-a',
    });
    assert.deepEqual(replay, first);
    assert.equal(pollCalls, 1);
    assert.equal(downloadCalls, 1);
    assert.equal(ledger.lateTerminalCalls, 1);
    await assert.rejects(
      runtime.reconcileCancelledProviderTerminal({
        jobId: queued.jobId,
        providerTaskRef: 'provider-task-late-success',
        workspaceId: 'workspace-b',
      }),
      /not found/i,
    );
    await assert.rejects(
      runtime.reconcileCancelledProviderTerminal({
        jobId: queued.jobId,
        providerTaskRef: 'another-provider-task',
        workspaceId: 'workspace-a',
      }),
      /task reference/i,
    );
  });

  it('reconciles a late provider failure without reopening the cancelled workflow', async () => {
    let pollCalls = 0;
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-late-failure',
          providerCost: {
            amount: 0.2,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async recover() {
        return null;
      },
      async poll() {
        pollCalls += 1;
        return {
          status: 'failed',
          providerCost: {
            amount: 0.29,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
          errorCode: 'provider_render_failed',
          retryable: false,
          error: 'provider render failed after cancellation',
        };
      },
      async download() {
        throw new Error('a late failed task must not download');
      },
      async cancel() {
        return { status: 'cancelled' };
      },
    };
    const ledger = new RecoveringLedger();
    const models = createModels(ledger, new MemoryModelAssetStorage());
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({
      jobs,
      models,
      provider,
    });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'late-failure-image-a',
      operation: 'image.generate',
      prompt: '取消后供应方失败',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({ models, provider }),
    );
    await worker.handle(envelope(record));
    await runtime.cancel({
      actorId: 'owner-a',
      jobId: queued.jobId,
      workspaceId: 'workspace-a',
    });
    await worker.handle(envelope(record));

    const reconciled = await runtime.reconcileCancelledProviderTerminal({
      jobId: queued.jobId,
      providerTaskRef: 'provider-task-late-failure',
      workspaceId: 'workspace-a',
    });
    assert.equal(reconciled.status, 'failed');
    assert.equal(reconciled.reconciliation?.errorCode, 'provider_render_failed');
    assert.equal(reconciled.reconciliation?.retryable, false);
    assert.equal(reconciled.result.status, 'failed');
    assert.equal(reconciled.result.usage.status, 'refunded');
    assert.equal(reconciled.result.providerCost.amount, 0.29);
    assert.equal(
      (await runtime.get('workspace-a', queued.jobId)).status,
      'cancelled',
    );
    assert.equal(pollCalls, 1);
  });

  it('preserves authorized reference roles before provider submission and still archives the result', async () => {
    let providerReferenceUrl: string | undefined;
    let providerReferenceRole: string | undefined;
    const provider: MediaProviderLifecyclePort = {
      async submit(request) {
        providerReferenceUrl = request.resolvedReferenceAssets?.[0]
          ?.providerReadableUrl;
        providerReferenceRole = request.resolvedInputAssets?.[0]?.role;
        assert.equal(
          providerReferenceUrl,
          'data:image/png;base64,cmVmZXJlbmNl',
        );
        assert.equal(providerReferenceRole, 'reference_image');
        return {
          acceptance: 'accepted',
          taskRef: 'provider-task-reference-success',
          providerCost: {
            amount: 0.1,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async recover() {
        return null;
      },
      async poll() {
        return {
          status: 'completed',
          providerCost: {
            amount: 0.1,
            currency: 'USD',
            usage: { mediaUnits: 1 },
          },
        };
      },
      async download() {
        return { bytes: png, contentType: 'image/png' };
      },
      async cancel() {},
    };
    const ledger = new RecoveringLedger();
    const models = createModels(
      ledger,
      new MemoryModelAssetStorage(),
      undefined,
      undefined,
      authorizedSubmissionReferences,
    );
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'reference-success-image-a',
      input: {
        inputAssets: [
          { assetId: 'asset-store-a', role: 'reference_image' },
        ],
      },
      operation: 'image.generate',
      prompt: '基于门店照片生成',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({
        models,
        provider,
        referencePolicy: {
          assertCanDispatch() {},
        },
        referenceAssets: {
          async inspect() {
            throw new Error('submission inspection belongs to operations');
          },
          async resolve() {
            return [
              {
                assetId: 'asset-store-a',
                bytes: Buffer.from('reference'),
                contentType: 'image/png',
                kind: 'resolved',
                providerReadableUrl: 'data:image/png;base64,cmVmZXJlbmNl',
                sha256: 'reference-sha256',
              },
            ];
          },
        },
      }),
    );

    assert.equal((await worker.handle(envelope(record))).status, 'deferred');
    assert.equal((await worker.handle(envelope(record))).status, 'completed');
    const completed = await runtime.get('workspace-a', queued.jobId);
    assert.equal(completed.result.status, 'completed');
    assert.equal(completed.result.usage.status, 'committed');
    assert.match(completed.result.asset?.objectKey ?? '', /\/generated\//);
    assert.equal(providerReferenceUrl, 'data:image/png;base64,cmVmZXJlbmNl');
    assert.equal(providerReferenceRole, 'reference_image');
  });

  it('fails closed and refunds before provider dispatch when an injected reference policy rejects it', async () => {
    let providerCalls = 0;
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        providerCalls += 1;
        throw new Error('must not submit');
      },
      async recover() {
        return null;
      },
      async poll() {
        throw new Error('must not poll');
      },
      async download() {
        throw new Error('must not download');
      },
      async cancel() {},
    };
    const ledger = new RecoveringLedger();
    const models = createModels(
      ledger,
      new MemoryModelAssetStorage(),
      undefined,
      undefined,
      authorizedSubmissionReferences,
    );
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({
      jobs,
      models,
    });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'reference-policy-failed-image-a',
      input: { referenceAssetIds: ['asset-store-a'] },
      operation: 'image.generate',
      prompt: '基于门店照片生成',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({
        models,
        provider,
        referencePolicy: {
          assertCanDispatch() {
            throw new ProviderReferencePolicyError(
              'PROVIDER_REFERENCE_PROBE_REQUIRED',
              'Provider reference transport is unavailable.',
            );
          },
        },
        referenceAssets: {
          async inspect() {
            throw new Error('submission inspection belongs to operations');
          },
          async resolve() {
            return [
              {
                assetId: 'asset-store-a',
                bytes: Buffer.from('reference'),
                contentType: 'image/png',
                kind: 'resolved',
                providerReadableUrl: 'data:image/png;base64,cmVmZXJlbmNl',
                sha256: 'reference-sha256',
              },
            ];
          },
        },
      }),
    );

    assert.equal((await worker.handle(envelope(record))).status, 'dead_letter');
    const failed = await runtime.get('workspace-a', queued.jobId);
    assert.equal(failed.result.status, 'failed');
    assert.equal(
      failed.result.failureCode,
      'PROVIDER_REFERENCE_PROBE_REQUIRED',
    );
    assert.equal(failed.result.usage.status, 'refunded');
    assert.equal(providerCalls, 0);
  });

  it('fails and refunds without provider effect when execution-time reference resolution is lost', async () => {
    let providerCalls = 0;
    const provider: MediaProviderLifecyclePort = {
      async submit() {
        providerCalls += 1;
        throw new Error('must not submit');
      },
      async recover() {
        return null;
      },
      async poll() {
        throw new Error('must not poll');
      },
      async download() {
        throw new Error('must not download');
      },
      async cancel() {},
    };
    const ledger = new RecoveringLedger();
    const models = createModels(
      ledger,
      new MemoryModelAssetStorage(),
      undefined,
      undefined,
      authorizedSubmissionReferences,
    );
    const repository = new MemoryTracerJobRepository(new MemoryJobPort());
    const jobs = new TracerJobApplicationService(repository);
    const runtime = new DurableMediaGenerationApplicationService({ jobs, models });
    models.attachDurableMediaRuntime(runtime);
    const queued = await models.submit({
      actorId: 'owner-a',
      dataClass: [],
      idempotencyKey: 'reference-failed-image-a',
      input: { referenceAssetIds: ['asset-store-a'] },
      operation: 'image.generate',
      prompt: '基于门店照片生成',
      selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
      workspaceId: 'workspace-a',
    });
    const record = await jobs.get('workspace-a', queued.jobId);
    const worker = new DurableTracerWorker(
      repository,
      new ModelMediaGenerationEffect({
        models,
        provider,
        referenceAssets: {
          async inspect() {
            throw new Error('submission inspection belongs to operations');
          },
          async resolve() {
            return [
              {
                assetId: 'asset-store-a',
                kind: 'failure',
                reason: 'authorization_withdrawn',
              },
            ];
          },
        },
      }),
    );

    assert.equal((await worker.handle(envelope(record))).status, 'dead_letter');
    const failed = await runtime.get('workspace-a', queued.jobId);
    assert.equal(failed.result.status, 'failed');
    assert.equal(
      failed.result.failureCode,
      'reference_asset_resolution_required',
    );
    assert.equal(failed.result.usage.status, 'refunded');
    assert.equal(providerCalls, 0);
    assert.equal((await worker.handle(envelope(record))).status, 'dead_letter');
    assert.equal(providerCalls, 0);
  });
});
