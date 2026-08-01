import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProductQuoteSnapshot, ProductUsageRecord } from '@meiye/contracts';
import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { MerchantExecutionBillingPort } from '../product-billing/durable-service.js';
import {
  CatalogRevisionRegistry,
  createDefaultCatalogModels,
  createDefaultDeployments,
  createDefaultExecutionChannels,
  createDefaultProviderProfiles,
  type PublishedDeployment,
} from './catalog.js';
import {
  MemoryModelSupplyControlPlaneRepository,
  CanvasTextGenerationOutboxWorker,
  ModelSupplyControlPlaneService,
  ModelSupplyFoundationModule,
  RECORDED_CATALOG_REVISION_ID,
  type ActivationProbeExecutionPort,
  type ModelSupplyPlanningControlPlanePort,
} from './foundation-module.js';
import {
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
  type MediaProviderLifecyclePort,
  type ProviderExecutionPort,
  type ReferenceAssetResolverPort,
} from './index.js';
import { FixtureAiStreamingRunner } from './ai-sdk-runner.js';
import { RecordedAdapterRouter } from './adapters.js';
import { MediaActivationProbeExecutor } from './activation-probe-executor.js';
import { modelRuntimeAssemblyFromEnv } from './runtime-config.js';
import {
  MemoryAdminConfigRepository,
  type AdminConfigRepository,
} from '../admin-config/foundation-module.js';
import { MemoryHealthOverlayPort } from '../supply-registry/health-overlay.js';
import { LOCAL_FIXTURE_COMMERCIAL_USE_TERMS_SUFFIX } from '../supply-registry/expand.js';
import type { RankingCandidateInput } from '../supply-registry/three-layer-ranking.js';
import type {
  AdminSupplyControlPlane,
  AdminSupplyGovernedActionDispatchRequest,
  AdminSupplyGovernedActionRequest,
} from '../supply-registry/admin-control-plane.js';
import type { ModelSupplyResult } from './ledger-contracts.js';

const owner: P1Context = {
  workspaceId: 'workspace-a',
  userId: 'owner-a',
  correlationId: 'corr-owner',
};
const admin: P1Context = {
  workspaceId: 'workspace-a',
  userId: 'admin-a',
  correlationId: 'corr-admin',
};

function setup(
  execution: ProviderExecutionPort = new RecordedProviderExecutionPort(),
  activationProbeLiveDeploymentIds: readonly string[] = [],
  activationProbeExecutor?: ActivationProbeExecutionPort,
  referenceAssets?: ReferenceAssetResolverPort,
  activationEvidenceConfig: Pick<AdminConfigRepository, 'apply' | 'get'> =
    new MemoryAdminConfigRepository(),
  planningControlPlane?: ModelSupplyPlanningControlPlanePort,
  merchantExecutionBilling?: MerchantExecutionBillingPort,
) {
  const repository = new MemoryModelSupplyControlPlaneRepository();
  const models = new ModelSupplyApplicationService({
    models: createDefaultCatalogModels(),
    deployments: createDefaultDeployments({
      activatedDeploymentIds: ['openai-direct-recorded'],
      activationEvidenceStatus: 'recorded',
    }),
    execution,
    ...(referenceAssets ? { referenceAssets } : {}),
    ...(merchantExecutionBilling ? { merchantExecutionBilling } : {}),
    resultSink: repository,
  });
  const controlPlane = new ModelSupplyControlPlaneService({
    activationEvidenceConfig,
    ...(activationProbeExecutor ? { activationProbeExecutor } : {}),
    activationProbeLiveDeploymentIds,
    application: models,
    configurationRevisions: {
      'openai-direct-recorded': 'f'.repeat(64),
      'seedream-5-pro-direct': 'e'.repeat(64),
      'seedance-2-direct': 'd'.repeat(64),
      'seed-tts-2-volcengine-direct': 'c'.repeat(64),
    },
    canvasProjects: canvasProjectAuthority(),
    ...(planningControlPlane ? { planningControlPlane } : {}),
    repository,
  });
  const module = new ModelSupplyFoundationModule(controlPlane, {
    adminActorIds: ['admin-a'],
  });
  return {
    activationEvidenceConfig,
    controlPlane,
    models,
    module,
    repository,
  };
}

async function command(
  module: ModelSupplyFoundationModule,
  context: P1Context,
  action: string,
  payload: Record<string, unknown>,
) {
  return module.execute({
    context,
    idempotencyKey: `${action}-${context.correlationId}`,
    input: { action, payload },
  });
}

function merchantExecutionBillingStub(input: {
  getQuote(taskId: string): ProductQuoteSnapshot | null;
  getUsage(taskId: string): ProductUsageRecord | null;
}) {
  const executions = new Map<
    string,
    {
      contract: string;
      idempotencyKey: string;
      inputSnapshot: { input: Record<string, unknown> | null; prompt: string };
      result?: unknown;
    }
  >();
  const contractFor = (claim: {
    catalogModelId: string;
    operation: string;
    outputCount: number;
    quoteRevision: string;
    submissionContractHash: string;
    targetSeconds?: number;
    inputAssetsHash: string;
    effectKey: string;
    inputSnapshot: { input: Record<string, unknown> | null; prompt: string };
    promptHash: string;
    providerCatalogModelId: string;
    providerOperation: string;
    referenceAssetsHash: string;
  }) => JSON.stringify({
    catalogModelId: claim.catalogModelId,
    operation: claim.operation,
    outputCount: claim.outputCount,
    quoteRevision: claim.quoteRevision,
    submissionContractHash: claim.submissionContractHash,
    targetSeconds: claim.targetSeconds ?? null,
    inputAssetsHash: claim.inputAssetsHash,
    effectKey: claim.effectKey,
    inputSnapshot: claim.inputSnapshot,
    promptHash: claim.promptHash,
    providerCatalogModelId: claim.providerCatalogModelId,
    providerOperation: claim.providerOperation,
    referenceAssetsHash: claim.referenceAssetsHash,
  });
  return {
    async readMerchantExecutionContract(inputValue: {
      taskId: string;
      workspaceId: string;
    }) {
      const quote = input.getQuote(inputValue.taskId);
      const outputCount = quote?.outputCount;
      if (
        !quote ||
        quote.workspaceId !== inputValue.workspaceId ||
        quote.taskId !== inputValue.taskId ||
        !quote.catalogModelId ||
        !quote.operation ||
        !quote.revision ||
        typeof outputCount !== 'number' ||
        !Number.isSafeInteger(outputCount) ||
        outputCount < 1
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          'The reserved credit quote contract is incomplete.',
        );
      }
      return {
        catalogModelId: quote.catalogModelId,
        operation: quote.operation,
        outputCount,
        quoteRevision: quote.revision,
        submissionContractHash:
          quote.submissionContractHash ?? `snapshot:${quote.taskId}`,
        ...(quote.targetSeconds === undefined
          ? {}
          : { targetSeconds: quote.targetSeconds }),
      };
    },
    async claimMerchantExecution<T>(claim: {
      catalogModelId: string;
      idempotencyKey: string;
      operation: string;
      outputCount: number;
      quoteRevision: string;
      submissionContractHash: string;
      targetSeconds?: number;
      inputAssetsHash: string;
      effectKey: string;
      promptHash: string;
      inputSnapshot: { input: Record<string, unknown> | null; prompt: string };
      providerCatalogModelId: string;
      providerOperation: string;
      referenceAssetsHash: string;
      taskId: string;
      workspaceId: string;
    }): Promise<
      | {
          decision: 'execute';
          inputSnapshot: { input: Record<string, unknown> | null; prompt: string };
        }
      | { decision: 'in_progress' }
      | { decision: 'replay'; result: T }
    > {
      const contract = contractFor(claim);
      const executionKey = `${claim.taskId}:${claim.effectKey}`;
      const existing = executions.get(executionKey);
      if (existing) {
        if (
          existing.contract !== contract ||
          existing.idempotencyKey !== claim.idempotencyKey
        ) {
          throw new P1DomainError(
            'IDEMPOTENCY_CONFLICT',
            'The billing task is already claimed.',
          );
        }
        return 'result' in existing
          ? { decision: 'replay', result: existing.result as T }
          : { decision: 'in_progress' };
      }
      const quote = input.getQuote(claim.taskId);
      const usage = input.getUsage(claim.taskId);
      if (
        !quote ||
        !usage ||
        quote.workspaceId !== claim.workspaceId ||
        quote.taskId !== claim.taskId ||
        quote.revision !== claim.quoteRevision ||
        quote.lifecycleStatus !== 'reserved' ||
        quote.operation !== claim.operation ||
        quote.catalogModelId !== claim.catalogModelId ||
        quote.outputCount !== claim.outputCount ||
        (quote.submissionContractHash ?? `snapshot:${quote.taskId}`) !==
          claim.submissionContractHash ||
        (quote.targetSeconds ?? null) !== (claim.targetSeconds ?? null) ||
        usage.workspaceId !== claim.workspaceId ||
        usage.taskId !== claim.taskId ||
        usage.quoteId !== quote.quoteId ||
        usage.status !== 'reserved'
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Merchant execution must match the reserved credit quote.',
        );
      }
      executions.set(executionKey, {
        contract,
        idempotencyKey: claim.idempotencyKey,
        inputSnapshot: structuredClone(claim.inputSnapshot),
      });
      return {
        decision: 'execute' as const,
        inputSnapshot: structuredClone(claim.inputSnapshot),
      };
    },
    async completeMerchantExecution<T>(claim: {
      catalogModelId: string;
      idempotencyKey: string;
      operation: string;
      outputCount: number;
      quoteRevision: string;
      result: T;
      submissionContractHash: string;
      targetSeconds?: number;
      inputAssetsHash: string;
      effectKey: string;
      promptHash: string;
      inputSnapshot: { input: Record<string, unknown> | null; prompt: string };
      providerCatalogModelId: string;
      providerOperation: string;
      referenceAssetsHash: string;
      taskId: string;
    }): Promise<T> {
      const executionKey = `${claim.taskId}:${claim.effectKey}`;
      const existing = executions.get(executionKey);
      const contract = contractFor(claim);
      if (
        !existing ||
        existing.contract !== contract ||
        existing.idempotencyKey !== claim.idempotencyKey
      ) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'The billing task claim no longer matches.',
        );
      }
      if ('result' in existing) return existing.result as T;
      executions.set(executionKey, {
        ...existing,
        result: structuredClone(claim.result),
      });
      return claim.result;
    },
  };
}

async function query(
  module: ModelSupplyFoundationModule,
  context: P1Context,
  action: string,
  payload: Record<string, unknown>,
) {
  return module.query({ context, input: { action, payload } });
}

describe('ModelSupplyFoundationModule', () => {
  it('exposes the governed admin supply snapshot, preview, and dispatch seams without rewriting their payloads', async () => {
    const setupResult = setup();
    const requests: Array<
      AdminSupplyGovernedActionRequest | AdminSupplyGovernedActionDispatchRequest
    > = [];
    const preview = {
      id: 'preview-isolate-channel-a',
      scope: 'channel:channel-a',
      changes: ['isolate channel-a'],
      warnings: [],
      reversible: true,
      expectedRevisionId: 'channel-revision-a',
      before: { lifecycle: 'active' },
      after: { lifecycle: 'isolated' },
    };
    const adminSupply = {
      async getSnapshot(context: P1Context) {
        return { workspaceId: context.workspaceId, source: 'durable' };
      },
      async previewAction(request: AdminSupplyGovernedActionRequest) {
        requests.push(request);
        return preview;
      },
      async dispatchAction(request: AdminSupplyGovernedActionDispatchRequest) {
        requests.push(request);
        return { action: request.action, previewId: request.approvedPreviewId };
      },
      async listPendingActions(context: P1Context) {
        return [
          {
            idempotencyKey: 'pending-action-1',
            payloadHash: 'payload-pending-1',
            outcome: 'recorded' as const,
            createdAt: '2026-07-20T00:00:00.000Z',
          },
        ].map((row) => ({ ...row, workspaceId: context.workspaceId }));
      },
      async reconcilePendingAction(
        context: P1Context,
        input: { idempotencyKey: string; payloadHash: string },
      ) {
        return { ...input, workspaceId: context.workspaceId, replayed: false };
      },
    } as unknown as Pick<
      AdminSupplyControlPlane,
      | 'getSnapshot'
      | 'previewAction'
      | 'dispatchAction'
      | 'listPendingActions'
      | 'reconcilePendingAction'
    >;
    const module = new ModelSupplyFoundationModule(setupResult.controlPlane, {
      adminActorIds: ['admin-a'],
      adminSupply,
    });
    const governedRequest = {
      action: 'isolate',
      context: admin,
      target: { resourceType: 'channel', resourceId: 'channel-a' },
      reason: 'provider error rate exceeded threshold',
      expectedRevisionId: 'channel-revision-a',
      idempotencyKey: 'isolate-channel-a',
    } as const;

    assert.deepEqual(
      await query(module, admin, 'admin_supply_control', {}),
      { workspaceId: admin.workspaceId, source: 'durable' },
    );
    assert.deepEqual(
      await query(module, admin, 'admin_supply_action_preview', governedRequest),
      preview,
    );
    assert.deepEqual(
      await command(module, admin, 'admin_supply_action', {
        ...governedRequest,
        approvedPreviewId: preview.id,
      }),
      { action: 'isolate', previewId: preview.id },
    );
    assert.deepEqual(
      await query(module, admin, 'admin_supply_pending_actions', {}),
      [
        {
          idempotencyKey: 'pending-action-1',
          payloadHash: 'payload-pending-1',
          outcome: 'recorded',
          createdAt: '2026-07-20T00:00:00.000Z',
          workspaceId: admin.workspaceId,
        },
      ],
    );
    assert.deepEqual(
      await command(module, admin, 'admin_supply_reconcile_pending', {
        idempotencyKey: 'pending-action-1',
        payloadHash: 'payload-pending-1',
      }),
      {
        idempotencyKey: 'pending-action-1',
        payloadHash: 'payload-pending-1',
        workspaceId: admin.workspaceId,
        replayed: false,
      },
    );
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], governedRequest);
    assert.deepEqual(requests[1], {
      ...governedRequest,
      approvedPreviewId: preview.id,
      idempotencyKey: 'admin_supply_action-corr-admin',
    });
  });

  it('replays each language probe and activates only after complete operation coverage', async () => {
    let providerCalls = 0;
    const setupResult = setup(
      {
        async execute(request) {
          providerCalls += 1;
          if (request.submission.operation === 'copy.adapt') {
            return {
              kind: 'completed' as const,
              platformVariants: {
                xiaohongshu: {
                  title: '小红书标题',
                  body: '小红书正文',
                  conversionHook: '私信预约',
                  topics: ['同城美业'],
                },
                douyin: {
                  title: '抖音标题',
                  body: '抖音正文',
                  conversionHook: '评论预约',
                  topics: ['到店体验'],
                },
                video_account: {
                  title: '视频号标题',
                  body: '视频号正文',
                  conversionHook: '转发收藏',
                  topics: ['熟客推荐'],
                },
              },
              providerCost: {
                amount: 0.02,
                currency: 'USD' as const,
                usage: { inputTokens: 32, outputTokens: 220 },
              },
            };
          }
          return new RecordedProviderExecutionPort().execute(request);
        },
      },
      ['openai-direct-recorded'],
    );

    await assert.rejects(
      command(setupResult.module, owner, 'activation_probe_run', {
        deploymentId: 'openai-direct-recorded',
        operation: 'copy.generate',
      }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'FORBIDDEN',
    );

    const run = (await command(
      setupResult.module,
      admin,
      'activation_probe_run',
      {
        deploymentId: 'openai-direct-recorded',
        operation: 'copy.generate',
      },
    )) as { id: string; outcome: string; providerCost?: { status: string } };
    assert.match(run.id, /^activation-probe-[a-f0-9]{28}$/);
    assert.equal(run.outcome, 'passed');
    assert.equal(run.providerCost?.status, 'observed');
    assert.equal(providerCalls, 1);

    const replay = await command(
      setupResult.module,
      admin,
      'activation_probe_run',
      {
        deploymentId: 'openai-direct-recorded',
        operation: 'copy.generate',
      },
    );
    assert.deepEqual(replay, run);
    assert.equal(providerCalls, 1);
    const storedEvidence = await setupResult.activationEvidenceConfig.get(
      'global',
      '__global__',
      'model.activation.evidence.openai-direct-recorded',
    );
    assert.equal(storedEvidence, null);
    const status = (await query(
      setupResult.module,
      admin,
      'activation_status',
      {},
    )) as Array<{
      deploymentId: string;
      evidence: unknown;
      stale: boolean;
    }>;
    assert.equal(
      status.find(
        (candidate) => candidate.deploymentId === 'openai-direct-recorded',
      )?.evidence,
      null,
    );
    assert.equal(
      status.find(
        (candidate) => candidate.deploymentId === 'openai-direct-recorded',
      )?.stale,
      false,
    );

    await command(setupResult.module, admin, 'activation_probe_run', {
      deploymentId: 'openai-direct-recorded',
      operation: 'copy.adapt',
    });
    const textRun = (await command(
      setupResult.module,
      admin,
      'activation_probe_run',
      {
        deploymentId: 'openai-direct-recorded',
        operation: 'text.respond',
      },
    )) as { id: string; outcome: string };

    assert.equal(textRun.outcome, 'passed');
    assert.equal(providerCalls, 3);
    const completedEvidence = await setupResult.activationEvidenceConfig.get(
      'global',
      '__global__',
      'model.activation.evidence.openai-direct-recorded',
    );
    assert.equal(
      (completedEvidence?.value as { evidenceRef?: string }).evidenceRef,
      textRun.id,
    );
    const catalogControl = (await query(
      setupResult.module,
      admin,
      'admin_catalog_control',
      {},
    )) as {
      catalog: {
        deployments: Array<{
          id: string;
          activationEvidence: { evidenceRef?: string; status: string };
        }>;
      };
    };
    assert.equal(
      catalogControl.catalog.deployments.find(
        (deployment) => deployment.id === 'openai-direct-recorded',
      )?.activationEvidence.evidenceRef,
      textRun.id,
    );

    const refreshedTextRun = (await command(
      setupResult.module,
      { ...admin, correlationId: 'corr-admin-refresh' },
      'activation_probe_run',
      {
        deploymentId: 'openai-direct-recorded',
        operation: 'text.respond',
      },
    )) as { id: string; outcome: string };
    const refreshedEvidence = await setupResult.activationEvidenceConfig.get(
      'global',
      '__global__',
      'model.activation.evidence.openai-direct-recorded',
    );
    assert.equal(refreshedTextRun.outcome, 'passed');
    assert.notEqual(refreshedTextRun.id, textRun.id);
    assert.equal(
      (refreshedEvidence?.value as { evidenceRef?: string }).evidenceRef,
      refreshedTextRun.id,
    );

    await setupResult.activationEvidenceConfig.apply({
      actorId: 'admin-a',
      correlationId: 'corr-stale-evidence',
      expectedRevision: refreshedEvidence?.revision ?? null,
      key: 'model.activation.evidence.openai-direct-recorded',
      reason: 'Simulate a stale runtime revision.',
      scope: 'global',
      value: {
        configurationRevision: 'e'.repeat(64),
        evidenceRef: 'activation-probe-stale',
        status: 'live_verified',
        verifiedAt: '2026-07-17T00:00:00.000Z',
      },
      workspaceId: '__global__',
    });
    const staleControl = (await query(
      setupResult.module,
      admin,
      'admin_catalog_control',
      {},
    )) as typeof catalogControl;
    assert.equal(
      staleControl.catalog.deployments.find(
        (deployment) => deployment.id === 'openai-direct-recorded',
      )?.activationEvidence.evidenceRef,
      undefined,
    );
    assert.equal(
      staleControl.catalog.deployments.find(
        (deployment) => deployment.id === 'openai-direct-recorded',
      )?.activationEvidence.status,
      'recorded',
    );
  });

  it('repairs activation evidence when a completed probe replay follows a transient config failure', async () => {
    const backingConfig = new MemoryAdminConfigRepository();
    let applyCalls = 0;
    let providerCalls = 0;
    const setupResult = setup(
      {
        async execute(request) {
          providerCalls += 1;
          if (request.submission.operation === 'copy.adapt') {
            return {
              kind: 'completed' as const,
              platformVariants: {
                xiaohongshu: {
                  body: '小红书正文',
                  conversionHook: '私信预约',
                  title: '小红书标题',
                  topics: ['护理'],
                },
                douyin: {
                  body: '抖音正文',
                  conversionHook: '评论预约',
                  title: '抖音标题',
                  topics: ['护理'],
                },
                video_account: {
                  body: '视频号正文',
                  conversionHook: '转发收藏',
                  title: '视频号标题',
                  topics: ['护理'],
                },
              },
              providerCost: {
                amount: 0.02,
                currency: 'USD' as const,
                usage: { inputTokens: 32, outputTokens: 220 },
              },
            };
          }
          return new RecordedProviderExecutionPort().execute(request);
        },
      },
      ['openai-direct-recorded'],
      undefined,
      undefined,
      {
        get: (...args) => backingConfig.get(...args),
        async apply(input) {
          applyCalls += 1;
          if (applyCalls === 1) throw new Error('config database unavailable');
          return backingConfig.apply(input);
        },
      },
    );

    await command(setupResult.module, admin, 'activation_probe_run', {
      deploymentId: 'openai-direct-recorded',
      operation: 'copy.generate',
    });
    await command(setupResult.module, admin, 'activation_probe_run', {
      deploymentId: 'openai-direct-recorded',
      operation: 'copy.adapt',
    });
    await assert.rejects(
      command(setupResult.module, admin, 'activation_probe_run', {
        deploymentId: 'openai-direct-recorded',
        operation: 'text.respond',
      }),
      /config database unavailable/,
    );
    assert.equal(
      await backingConfig.get(
        'global',
        '__global__',
        'model.activation.evidence.openai-direct-recorded',
      ),
      null,
    );

    const replay = (await command(
      setupResult.module,
      admin,
      'activation_probe_run',
      {
        deploymentId: 'openai-direct-recorded',
        operation: 'text.respond',
      },
    )) as { id: string; outcome: string };
    const evidence = await backingConfig.get(
      'global',
      '__global__',
      'model.activation.evidence.openai-direct-recorded',
    );

    assert.equal(replay.outcome, 'passed');
    assert.equal(
      (evidence?.value as { evidenceRef?: string }).evidenceRef,
      replay.id,
    );
    assert.equal(applyCalls, 2);
    assert.equal(providerCalls, 3);
  });

  it('downgrades stale live evidence embedded in a published catalog', async () => {
    const setupResult = setup();
    const registry = new CatalogRevisionRegistry();
    const payload = {
      capabilities: [],
      deployments: createDefaultDeployments({
        activatedDeploymentIds: ['openai-direct-recorded'],
        activationEvidenceByDeploymentId: {
          'openai-direct-recorded': {
            configurationRevision: 'e'.repeat(64),
            evidenceRef: 'activation-probe-old-run',
            status: 'live_verified' as const,
            verifiedAt: '2026-07-16T00:00:00.000Z',
          },
        },
      }),
      models: createDefaultCatalogModels(),
      prices: [],
      routes: [],
    };
    const draft = registry.createDraft(payload);
    const published = registry.publish(registry.enable(draft.id).id);
    await setupResult.repository.setCurrentPublishedCatalogRevision(
      owner.workspaceId,
      published,
      null,
    );
    await setupResult.activationEvidenceConfig.apply({
      actorId: admin.userId,
      correlationId: 'corr-published-stale',
      expectedRevision: null,
      key: 'model.activation.evidence.openai-direct-recorded',
      reason: 'Simulate configuration drift after publication.',
      scope: 'global',
      value: {
        configurationRevision: 'e'.repeat(64),
        evidenceRef: 'activation-probe-old-run',
        status: 'live_verified',
        verifiedAt: '2026-07-16T00:00:00.000Z',
      },
      workspaceId: '__global__',
    });

    const control = (await query(
      setupResult.module,
      admin,
      'admin_catalog_control',
      {},
    )) as {
      catalog: {
        deployments: Array<{
          activationEvidence: { evidenceRef?: string; status: string };
          id: string;
        }>;
      };
    };
    const deployment = control.catalog.deployments.find(
      (candidate) => candidate.id === 'openai-direct-recorded',
    );

    assert.equal(deployment?.activationEvidence.status, 'recorded');
    assert.equal(deployment?.activationEvidence.evidenceRef, undefined);
  });

  it('persists a failed probe without minting evidence for a recorded adapter', async () => {
    let providerCalls = 0;
    const setupResult = setup({
      async execute(request) {
        providerCalls += 1;
        return new RecordedProviderExecutionPort().execute(request);
      },
    });

    const run = (await command(
      setupResult.module,
      admin,
      'activation_probe_run',
      {
        deploymentId: 'openai-direct-recorded',
        operation: 'copy.generate',
      },
    )) as { outcome: string; failureCategory?: string };

    assert.equal(run.outcome, 'failed');
    assert.equal(run.failureCategory, 'provider_probe_failed');
    assert.equal(providerCalls, 0);
    assert.equal(
      await setupResult.activationEvidenceConfig.get(
        'global',
        '__global__',
        'model.activation.evidence.openai-direct-recorded',
      ),
      null,
    );
  });

  it('mints deployment evidence only after every selected model operation passes', async () => {
    const executorCalls: string[] = [];
    const provider: MediaProviderLifecyclePort = {
      async submit(request) {
        executorCalls.push(request.submission.operation);
        if (request.submission.operation === 'image.edit') {
          assert.equal(request.resolvedInputAssets?.[0]?.contentType, 'image/png');
          assert.equal(
            request.resolvedInputAssets?.[0]?.providerReadableUrl.startsWith(
              'data:image/png;base64,'
            ),
            true,
          );
        }
        return {
          acceptance: 'accepted',
          providerCost: {
            amount: 0.25,
            currency: 'CNY',
            usage: { mediaUnits: 1 },
          },
          taskRef: `task-${request.submission.operation}`,
        };
      },
      async poll() {
        return {
          providerCost: {
            amount: 0.25,
            currency: 'CNY',
            usage: { mediaUnits: 1 },
          },
          status: 'completed',
        };
      },
      async download() {
        return {
          bytes: Uint8Array.from([1, 2, 3]),
          contentType: 'image/png',
        };
      },
      async recover() {
        return null;
      },
      async cancel() {},
    };
    const catalog = {
      deployments: createDefaultDeployments(),
      models: createDefaultCatalogModels(),
    };
    const setupResult = setup(
      new RecordedProviderExecutionPort(),
      ['seedream-5-pro-direct'],
      new MediaActivationProbeExecutor(provider, catalog),
    );

    const generateRun = (await command(
      setupResult.module,
      admin,
      'activation_probe_run',
      {
        deploymentId: 'seedream-5-pro-direct',
        operation: 'image.generate',
      },
    )) as { outcome: string; providerCost?: { amount: number } };

    assert.equal(generateRun.outcome, 'passed');
    assert.equal(generateRun.providerCost?.amount, 0.25);
    assert.equal(
      await setupResult.activationEvidenceConfig.get(
        'global',
        '__global__',
        'model.activation.evidence.seedream-5-pro-direct',
      ),
      null,
    );

    const editRun = (await command(
      setupResult.module,
      admin,
      'activation_probe_run',
      {
        deploymentId: 'seedream-5-pro-direct',
        operation: 'image.edit',
      },
    )) as { id: string; outcome: string };

    assert.equal(editRun.outcome, 'passed');
    assert.deepEqual(executorCalls, ['image.generate', 'image.edit']);
    const evidence = await setupResult.activationEvidenceConfig.get(
      'global',
      '__global__',
      'model.activation.evidence.seedream-5-pro-direct',
    );
    assert.equal(
      (evidence?.value as { evidenceRef?: string }).evidenceRef,
      editRun.id,
    );
  });

  it('routes audio speech through the production activation probe seam', async () => {
    let executorCalls = 0;
    const setupResult = setup(
      new RecordedProviderExecutionPort(),
      ['seed-tts-2-volcengine-direct'],
      {
        async execute(input) {
          executorCalls += 1;
          assert.equal(input.catalogModelId, 'seed-tts-2');
          assert.equal(input.operation, 'audio.speech');
          return {
            outputDigestSource: {
              contentType: 'audio/wav',
              sha256: 'b'.repeat(64),
              sizeBytes: 4,
            },
            providerCost: {
              amount: 0.022,
              currency: 'CNY',
              status: 'observed',
              usage: { mediaUnits: 11 },
            },
          };
        },
      },
    );

    const run = (await command(
      setupResult.module,
      admin,
      'activation_probe_run',
      {
        deploymentId: 'seed-tts-2-volcengine-direct',
        operation: 'audio.speech',
      },
    )) as { outcome: string; providerCost?: { amount: number } };

    assert.equal(run.outcome, 'passed');
    assert.equal(run.providerCost?.amount, 0.022);
    assert.equal(executorCalls, 1);
    const evidence = await setupResult.activationEvidenceConfig.get(
      'global',
      '__global__',
      'model.activation.evidence.seed-tts-2-volcengine-direct',
    );
    assert.match(
      String((evidence?.value as { evidenceRef?: string }).evidenceRef),
      /^activation-probe-/,
    );
  });

  it('rejects hand-authored live catalog evidence without a current passed probe', async () => {
    const { module } = setup();
    await assert.rejects(
      command(module, admin, 'catalog_create_safe_draft', {
        models: [
          {
            activationEvidence: {
              configurationRevision: 'f'.repeat(64),
              evidenceRef: `activation-probe-${'a'.repeat(28)}`,
              status: 'live_verified',
              verifiedAt: '2026-07-15T00:00:00.000Z',
            },
            allowedDataClasses: ['public'],
            deniedDataClasses: ['contains_face', 'pii', 'medical'],
            id: 'llm-openai',
            lifecycle: 'available',
          },
        ],
      }),
      /passed, current activation probe run/,
    );
  });

  it('rejects hand-authored live evidence with partial operation coverage', async () => {
    const setupResult = setup(
      new RecordedProviderExecutionPort(),
      ['seedream-5-pro-direct'],
      {
        async execute() {
          return {
            outputDigestSource: { contentType: 'image/png', sizeBytes: 3 },
            providerCost: {
              amount: 0.25,
              currency: 'CNY',
              status: 'observed',
              usage: { mediaUnits: 1 },
            },
          };
        },
      },
    );
    const run = (await command(
      setupResult.module,
      admin,
      'activation_probe_run',
      {
        deploymentId: 'seedream-5-pro-direct',
        operation: 'image.generate',
      },
    )) as { createdAt: string; id: string; outcome: string };
    assert.equal(run.outcome, 'passed');

    await assert.rejects(
      command(setupResult.module, admin, 'catalog_create_safe_draft', {
        models: [
          {
            activationEvidence: {
              configurationRevision: 'e'.repeat(64),
              evidenceRef: run.id,
              status: 'live_verified',
              verifiedAt: run.createdAt,
            },
            allowedDataClasses: ['public'],
            deniedDataClasses: ['contains_face', 'pii', 'medical'],
            id: 'seedream-5-pro',
            lifecycle: 'available',
          },
        ],
      }),
      /covering every declared operation/,
    );
  });

  it('keeps route simulation admin-only, workspace-scoped, and free of provider effects', async () => {
    let providerCalls = 0;
    const planningControlPlane: ModelSupplyPlanningControlPlanePort = {
      async readPlanningState() {
        return {
          dataPolicyByDeploymentId: new Map([
            [
              'domestic-llm-direct-recorded',
              {
                deploymentId: 'domestic-llm-direct-recorded',
                dataPolicyRevisionId: 'data-policy:domestic-pii:r1',
                dataPolicy: {
                  sourceTrustLevel: 'platform_verified',
                  processingRegion: 'domestic',
                  allowedDataClasses: ['public', 'pii'],
                },
                dualApproval: {
                  contractApproved: true,
                  technicalApproved: true,
                },
              },
            ],
          ]),
        };
      },
    };
    const { module, models } = setup(
      {
        async execute() {
          providerCalls += 1;
          throw new Error('route simulation must not execute a provider');
        },
      },
      undefined,
      undefined,
      undefined,
      undefined,
      planningControlPlane,
    );

    await assert.rejects(
      query(module, owner, 'route_simulation', {
        operation: 'copy.generate',
        selection: { mode: 'auto', profile: 'quality' },
        dataClass: [],
        failureScenario: 'rejected_before_accept',
      }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'FORBIDDEN',
    );

    const simulation = (await query(module, admin, 'route_simulation', {
      operation: 'copy.generate',
      selection: {
        mode: 'auto',
        profile: 'quality',
        fallbackConsent: true,
      },
      dataClass: ['pii'],
      failureScenario: 'rejected_before_accept',
    })) as {
      catalogRevisionId: string;
      rankedCandidates: Array<{ catalogModelId: string }>;
      expectedOutcome: { action: string; expectedAttempts: number };
    };

    assert.equal(simulation.catalogRevisionId, 'recorded-default-v1');
    assert.deepEqual(
      simulation.rankedCandidates.map((candidate) => candidate.catalogModelId),
      ['llm-domestic'],
    );
    assert.deepEqual(simulation.expectedOutcome, {
      action: 'stop',
      attemptLimit: 2,
      expectedAttempts: 1,
      primaryDeploymentId: 'domestic-llm-direct-recorded',
      reason: 'no_safe_fallback_candidate',
    });
    assert.equal(providerCalls, 0);
    assert.equal(models.attempts().length, 0);
  });

  it('routes production simulation through published policy, health, data, and three-layer control-plane state', async () => {
    const deployments = createDefaultDeployments({
      activatedDeploymentIds: [
        'deepseek-v4-pro-direct',
        'anthropic-direct-recorded',
        'gemini-direct-recorded',
        'domestic-llm-direct-recorded',
      ],
    });
    const openAiDeployment = deployments.find(
      (deployment) => deployment.id === 'openai-direct-recorded',
    );
    assert.ok(openAiDeployment);
    deployments.push({
      ...structuredClone(openAiDeployment),
      id: 'policy-excluded-openai-relay',
      providerProfileId: 'provider-policy-excluded',
      executionChannelId: 'channel-policy-excluded',
    });
    const repository = new MemoryModelSupplyControlPlaneRepository();
    const application = new ModelSupplyApplicationService({
      deployments,
      execution: new RecordedProviderExecutionPort(),
      models: createDefaultCatalogModels(),
      resultSink: repository,
    });
    const overlay = new MemoryHealthOverlayPort();
    await overlay.reportFact({
      targetKind: 'deployment',
      targetId: 'anthropic-direct-recorded',
      kind: 'probe_unavailable',
      reason: 'live_probe_failed',
      source: 'probe',
    });
    const observedAt = new Date().toISOString();
    const rankingInput = (
      deploymentId: string,
      amountMicros: number,
    ): RankingCandidateInput => ({
      deploymentId,
      quality: {
        activationEvidence: {
          kind: 'activation_evidence',
          observedAt,
          sampleSize: 20,
          status: 'fresh',
        },
        acceptanceCompleteness: {
          kind: 'acceptance_completeness',
          observedAt,
          sampleSize: 20,
          status: 'fresh',
          value: 1,
        },
        conformance: {
          kind: 'conformance',
          observedAt,
          sampleSize: 20,
          status: 'fresh',
        },
        mappingTrust: {
          kind: 'mapping_trust',
          observedAt,
          sampleSize: 20,
          status: 'fresh',
        },
        p95: {
          kind: 'p95',
          observedAt,
          sampleSize: 20,
          status: 'fresh',
          value: 500,
        },
        successRate: {
          kind: 'success_rate',
          observedAt,
          sampleSize: 20,
          status: 'fresh',
          value: 0.99,
        },
        versionedQualityBaseline: {
          kind: 'versioned_quality_baseline',
          observedAt,
          sampleSize: 20,
          status: 'fresh',
        },
      },
      health: { capacityHeadroom: 1, healthState: 'healthy' },
      cost: {
        amountMicros,
        currency: 'USD',
        source: 'observed_usage',
      },
    });
    let reads = 0;
    const planningControlPlane: ModelSupplyPlanningControlPlanePort = {
      async readPlanningState(input) {
        reads += 1;
        assert.equal(input.workspaceId, admin.workspaceId);
        assert.equal(input.catalogRevisionId, RECORDED_CATALOG_REVISION_ID);
        assert.equal(input.operation, 'copy.generate');
        assert.equal(input.qualityTier, 'quality');
        return {
          routePolicyRevisionId: 'route-policy:copy.generate:quality:r3',
          routePolicy: {
            operation: 'copy.generate',
            qualityTier: 'quality',
            hardConstraints: ['deployment_active', 'data_class'],
            candidateDeploymentIds: [
              'deepseek-v4-pro-direct',
              'anthropic-direct-recorded',
              'gemini-direct-recorded',
              'domestic-llm-direct-recorded',
            ],
            maxAttempts: 2,
            fallbackAuthorized: true,
          },
          healthOverlay: overlay,
          dataPolicyByDeploymentId: new Map([
            [
              'gemini-direct-recorded',
              {
                deploymentId: 'gemini-direct-recorded',
                dataPolicyRevisionId: 'data-policy:r7',
                dataPolicy: {
                  sourceTrustLevel: 'contract_attested',
                  processingRegion: 'overseas',
                  allowedDataClasses: ['contains_face'],
                },
              },
            ],
          ]),
          rankingInputsByDeploymentId: new Map([
            [
              'deepseek-v4-pro-direct',
              rankingInput('deepseek-v4-pro-direct', 30_000),
            ],
            [
              'domestic-llm-direct-recorded',
              rankingInput('domestic-llm-direct-recorded', 10_000),
            ],
          ]),
        };
      },
    };
    const controlPlane = new ModelSupplyControlPlaneService({
      application,
      planningControlPlane,
      repository,
    });
    const module = new ModelSupplyFoundationModule(controlPlane, {
      adminActorIds: [admin.userId],
    });

    const simulation = (await query(module, admin, 'route_simulation', {
      operation: 'copy.generate',
      selection: {
        mode: 'auto',
        profile: 'quality',
        fallbackConsent: true,
      },
      dataClass: [],
      failureScenario: 'rejected_before_accept',
    })) as {
      routePolicyRevisionId: string | null;
      candidateEvaluations: Array<{
        deploymentId: string;
        exclusionReasons: string[];
      }>;
      rankedCandidates: Array<{ deploymentId: string }>;
      expectedOutcome: {
        action: string;
        primaryDeploymentId?: string;
        fallbackDeploymentId?: string;
      };
      decisionExplanation: {
        sort: { layerOrder: string[] };
        liveExclusions: Array<{ deploymentId: string }>;
      };
    };

    assert.equal(reads, 1);
    assert.equal(
      simulation.routePolicyRevisionId,
      'route-policy:copy.generate:quality:r3',
    );
    assert.deepEqual(
      simulation.rankedCandidates.map((candidate) => candidate.deploymentId),
      ['domestic-llm-direct-recorded', 'deepseek-v4-pro-direct'],
    );
    assert.ok(
      simulation.candidateEvaluations
        .find(
          (candidate) =>
            candidate.deploymentId === 'anthropic-direct-recorded',
        )
        ?.exclusionReasons.includes('simulated_unavailable'),
    );
    assert.ok(
      simulation.candidateEvaluations
        .find(
          (candidate) => candidate.deploymentId === 'gemini-direct-recorded',
        )
        ?.exclusionReasons.includes('data_class_disallowed'),
    );
    assert.equal(
      simulation.candidateEvaluations.some(
        (candidate) =>
          candidate.deploymentId === 'policy-excluded-openai-relay',
      ),
      false,
    );
    assert.deepEqual(simulation.expectedOutcome, {
      action: 'fallback',
      attemptLimit: 2,
      expectedAttempts: 2,
      primaryDeploymentId: 'domestic-llm-direct-recorded',
      fallbackDeploymentId: 'deepseek-v4-pro-direct',
      reason: 'safe_auto_fallback',
    });
    assert.deepEqual(simulation.decisionExplanation.sort.layerOrder, [
      'quality_reliability_gate',
      'health_capacity_guardrail',
      'cost_optimization',
    ]);
    assert.deepEqual(simulation.decisionExplanation.liveExclusions, [
      {
        deploymentId: 'anthropic-direct-recorded',
        layer: 'live',
        reasons: ['health_overlay_blocking'],
      },
    ]);
  });

  it('validates the explicitly requested RoutePolicy candidate instead of the published head', async () => {
    const repository = new MemoryModelSupplyControlPlaneRepository();
    const application = new ModelSupplyApplicationService({
      deployments: createDefaultDeployments({
        activatedDeploymentIds: [
          'openai-direct-recorded',
          'domestic-llm-direct-recorded',
        ],
      }),
      execution: new RecordedProviderExecutionPort(),
      models: createDefaultCatalogModels(),
      resultSink: repository,
    });
    const candidateRevisionId = 'route-policy:copy.generate:quality:candidate-r8';
    const planningControlPlane: ModelSupplyPlanningControlPlanePort = {
      async readPlanningState(input) {
        if (input.routePolicyRevisionId !== candidateRevisionId) {
          return {
            routePolicyRevisionId: 'route-policy:copy.generate:quality:head-r7',
            routePolicy: {
              operation: 'copy.generate',
              qualityTier: 'quality',
              hardConstraints: ['deployment_active'],
              candidateDeploymentIds: ['domestic-llm-direct-recorded'],
              maxAttempts: 1,
              fallbackAuthorized: false,
            },
          };
        }
        return {
          routePolicyRevisionId: candidateRevisionId,
          routePolicy: {
            operation: 'copy.generate',
            qualityTier: 'quality',
            hardConstraints: ['deployment_active'],
            candidateDeploymentIds: ['openai-direct-recorded'],
            maxAttempts: 1,
            fallbackAuthorized: false,
          },
        };
      },
    };
    const controlPlane = new ModelSupplyControlPlaneService({
      application,
      planningControlPlane,
      repository,
    });

    const simulation = await controlPlane.simulateRoute(admin, {
      operation: 'copy.generate',
      selection: {
        mode: 'fixed',
        catalogModelId: 'llm-openai',
      },
      dataClass: [],
      failureScenario: 'success',
      unavailableDeploymentIds: [],
      routePolicyRevisionId: candidateRevisionId,
    });

    assert.equal(simulation.routePolicyRevisionId, candidateRevisionId);
    assert.deepEqual(
      simulation.rankedCandidates.map((candidate) => candidate.deploymentId),
      ['openai-direct-recorded'],
    );

    await assert.rejects(
      controlPlane.simulateRoute(admin, {
        operation: 'copy.generate',
        selection: {
          mode: 'fixed',
          catalogModelId: 'llm-openai',
        },
        dataClass: [],
        failureScenario: 'success',
        unavailableDeploymentIds: [],
        routePolicyRevisionId: 'route-policy:copy.generate:quality:missing',
      }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'NOT_FOUND',
    );
  });

  it('returns a frontend-safe recorded catalog with stable business metadata', async () => {
    const { controlPlane, module } = setup();
    await controlPlane.initialize(owner.workspaceId);

    const view = (await query(module, owner, 'catalog', {
      operation: 'image.generate',
    })) as {
      revisionId: string;
      stage: string;
      models: Array<Record<string, unknown>>;
    };

    assert.equal(view.revisionId, 'recorded-default-v1');
    assert.equal(view.stage, 'recorded');
    assert.ok(view.models.length >= 4);
    assert.ok(view.models.every((model) => typeof model.manufacturer === 'string'));
    assert.ok(view.models.every((model) => typeof model.stableModelName === 'string'));
    assert.ok(view.models.every((model) => typeof model.version === 'string'));
    assert.ok(view.models.every((model) => Array.isArray(model.capabilities)));
    assert.ok(view.models.every((model) => model.availability === 'recorded'));
    assert.ok(
      view.models.every(
        (model) =>
          (model.durationEstimate as { status: string }).status ===
          'insufficient_data'
      )
    );
    assert.ok(
      view.models.every(
        (model) =>
          typeof (model.unitPrice as { amountMicros?: unknown } | undefined)
            ?.amountMicros === 'number'
      )
    );
    assert.equal(JSON.stringify(view).includes('"channel":'), false);
    assert.equal(JSON.stringify(view).includes('credential'), false);
    assert.equal(JSON.stringify(view).includes('endpoint'), false);
    assert.equal(JSON.stringify(view).includes('live_verified'), false);
  });

  it('projects new inactive runtime candidates into an older published catalog', async () => {
    const repository = new MemoryModelSupplyControlPlaneRepository();
    const models = createDefaultCatalogModels();
    const deployments = createDefaultDeployments();
    const application = new ModelSupplyApplicationService({
      deployments,
      execution: new RecordedProviderExecutionPort(),
      models,
      resultSink: repository,
    });
    const registry = new CatalogRevisionRegistry();
    const oldDraft = registry.createDraft({
      capabilities: [],
      deployments: deployments.filter(
        (deployment) => deployment.id !== 'seedance-1-5-pro-tuzi-relay',
      ),
      models: models.filter((model) => model.id !== 'seedance-1-5-pro'),
      prices: [],
      routes: [],
    });
    const published = registry.publish(registry.enable(oldDraft.id).id);
    await repository.setCurrentPublishedCatalogRevision(
      owner.workspaceId,
      published,
      null,
    );
    const controlPlane = new ModelSupplyControlPlaneService({
      application,
      fallbackCatalog: {
        payload: {
          capabilities: [],
          deployments,
          models,
          prices: [],
          routes: [],
        },
        revisionId: RECORDED_CATALOG_REVISION_ID,
      },
      repository,
    });
    const module = new ModelSupplyFoundationModule(controlPlane, {
      adminActorIds: [admin.userId],
    });

    const control = (await query(
      module,
      admin,
      'admin_catalog_control',
      {},
    )) as {
      catalog: {
        deployments: Array<{
          activationEvidence: { status: string };
          id: string;
          status: string;
        }>;
        models: Array<{ id: string }>;
      };
      revisionId: string;
      stage: string;
    };

    assert.equal(control.revisionId, published.id);
    assert.equal(control.stage, 'published');
    assert.equal(
      control.catalog.models.some((model) => model.id === 'seedance-1-5-pro'),
      true,
    );
    const deployment = control.catalog.deployments.find(
      (candidate) => candidate.id === 'seedance-1-5-pro-tuzi-relay',
    );
    assert.equal(deployment?.status, 'inactive');
    assert.equal(deployment?.activationEvidence.status, 'recorded');
  });

  it('attaches P50/P90 only to live-verified model catalog entries', async () => {
    const repository = new MemoryModelSupplyControlPlaneRepository();
    const models = createDefaultCatalogModels();
    const deployments = createDefaultDeployments({
      activatedDeploymentIds: ['openai-direct-recorded'],
      activationEvidenceByDeploymentId: {
        'openai-direct-recorded': {
          status: 'live_verified',
          verifiedAt: '2026-07-13T00:00:00.000Z',
          evidenceRef: 'test://live-openai',
          configurationRevision: 'test-live-openai-v1',
        },
      },
    });
    const application = new ModelSupplyApplicationService({
      deployments,
      execution: new RecordedProviderExecutionPort(),
      models,
      resultSink: repository,
    });
    let durationReadFails = false;
    const controlPlane = new ModelSupplyControlPlaneService({
      application,
      durationSamples: {
        async listGenerationDurationSamples(
          workspaceId,
          operation,
          catalogModelId
        ) {
          if (durationReadFails) throw new Error('duration database offline');
          assert.equal(workspaceId, owner.workspaceId);
          assert.equal(operation, 'copy');
          return catalogModelId === 'llm-openai'
            ? [10, 20, 30, 40, 50, 60]
            : [];
        },
      },
      fallbackCatalog: {
        payload: {
          capabilities: [],
          deployments,
          models,
          prices: [],
          routes: [],
        },
        revisionId: 'live-runtime-v1',
      },
      repository,
    });

    const view = await controlPlane.getCatalog(
      owner.workspaceId,
      'copy.generate'
    );
    assert.deepEqual(
      view.models.find((model) => model.id === 'llm-openai')
        ?.durationEstimate,
      {
        status: 'observed',
        p50Seconds: 30,
        p90Seconds: 60,
        sampleSize: 6,
        windowDays: 30,
        asOf: view.models[0]?.durationEstimate.asOf,
      }
    );
    assert.equal(
      view.models.find((model) => model.id !== 'llm-openai')
        ?.durationEstimate.status,
      'insufficient_data'
    );

    durationReadFails = true;
    const degraded = await controlPlane.getCatalog(
      owner.workspaceId,
      'copy.generate'
    );
    assert.equal(
      degraded.models.find((model) => model.id === 'llm-openai')
        ?.durationEstimate.status,
      'insufficient_data'
    );
  });

  it('projects single-channel versus multi-channel readiness from qualified deployments', async () => {
    const repository = new MemoryModelSupplyControlPlaneRepository();
    const models = createDefaultCatalogModels();
    const liveEvidence = {
      status: 'live_verified' as const,
      verifiedAt: '2026-07-20T00:00:00.000Z',
      evidenceRef: 'test://provider-live/channel-a',
      configurationRevision: 'provider-live-a-v1',
    };
    const deployments = createDefaultDeployments({
      activatedDeploymentIds: ['openai-direct-recorded'],
      activationEvidenceByDeploymentId: {
        'openai-direct-recorded': liveEvidence,
      },
    });
    const primary = deployments.find(
      (deployment) => deployment.id === 'openai-direct-recorded',
    );
    assert.ok(primary);
    primary.accountIdentity = 'account-fingerprint-official';
    primary.endpointFingerprint = 'endpoint-fingerprint-official';
    const application = new ModelSupplyApplicationService({
      deployments,
      execution: new RecordedProviderExecutionPort(),
      models,
      resultSink: repository,
    });
    const controlPlane = new ModelSupplyControlPlaneService({
      application,
      fallbackCatalog: {
        payload: {
          capabilities: [],
          deployments,
          models,
          prices: [],
          routes: [],
        },
        revisionId: 'single-channel-v1',
      },
      repository,
    });

    const single = await controlPlane.getCatalog(
      owner.workspaceId,
      'copy.generate',
    );
    assert.equal(
      single.models.find((model) => model.id === 'llm-openai')
        ?.channelReadiness,
      'single_channel',
    );
    assert.equal(
      single.models.find((model) => model.id === 'llm-anthropic')
        ?.channelReadiness,
      'not_verified',
    );

    const dualDeployments = [
      ...deployments,
      {
        ...primary,
        id: 'openai-reseller-live',
        accountIdentity: 'account-fingerprint-reseller',
        channel: 'managed' as const,
        endpointFingerprint: 'endpoint-fingerprint-reseller',
        providerProfileId: 'provider-openai-reseller',
        executionChannelId: 'channel-openai-reseller',
        activationEvidence: {
          ...liveEvidence,
          evidenceRef: 'test://provider-live/channel-b',
          configurationRevision: 'provider-live-b-v1',
        },
      },
    ];
    const readinessFor = async (
      candidateDeployments: PublishedDeployment[],
      revisionId: string,
    ) => {
      const candidateControlPlane = new ModelSupplyControlPlaneService({
        application: new ModelSupplyApplicationService({
          deployments: candidateDeployments,
          execution: new RecordedProviderExecutionPort(),
          models,
          resultSink: repository,
        }),
        fallbackCatalog: {
          payload: {
            capabilities: [],
            deployments: candidateDeployments,
            models,
            prices: [],
            routes: [],
          },
          revisionId,
        },
        repository,
      });
      const catalog = await candidateControlPlane.getCatalog(
        owner.workspaceId,
        'copy.generate',
      );
      return catalog.models.find((model) => model.id === 'llm-openai')
        ?.channelReadiness;
    };

    assert.equal(
      await readinessFor(dualDeployments, 'dual-channel-v1'),
      'multi_channel_ready',
    );

    const aliasedDeployments = dualDeployments.map((deployment) =>
      deployment.id === 'openai-reseller-live'
        ? {
            ...deployment,
            accountIdentity: primary.accountIdentity,
          }
        : deployment,
    );
    assert.equal(
      await readinessFor(aliasedDeployments, 'aliased-account-channel-v1'),
      'single_channel',
    );

    const endpointAliasedDeployments = dualDeployments.map((deployment) =>
      deployment.id === 'openai-reseller-live'
        ? {
            ...deployment,
            endpointFingerprint: primary.endpointFingerprint,
          }
        : deployment,
    );
    assert.equal(
      await readinessFor(
        endpointAliasedDeployments,
        'aliased-endpoint-channel-v1',
      ),
      'single_channel',
    );

    const directOnlyDeployments = dualDeployments.map((deployment) => ({
      ...deployment,
      channel: 'direct' as const,
    }));
    assert.equal(
      await readinessFor(directOnlyDeployments, 'direct-only-channel-v1'),
      'single_channel',
    );

    const idOnlyDeployments = dualDeployments.map((deployment) => {
      const {
        accountIdentity: _accountIdentity,
        endpointFingerprint: _endpointFingerprint,
        ...idOnly
      } = deployment;
      return idOnly;
    });
    assert.equal(
      await readinessFor(idOnlyDeployments, 'id-only-channel-v1'),
      'single_channel',
    );
  });

  it('marks recorded deployments executable only for the explicit local fixture runtime', async () => {
    const repository = new MemoryModelSupplyControlPlaneRepository();
    const fixture = modelRuntimeAssemblyFromEnv({
      APP_ENV: 'e2e',
      MODEL_EXECUTION_MODE: 'fixture',
    });
    const application = new ModelSupplyApplicationService({
      deployments: fixture.deployments,
      execution: fixture.runtime.execution,
      models: fixture.models,
      resultSink: repository,
      runtimeCapabilities: fixture.runtimeCapabilities,
    });
    const controlPlane = new ModelSupplyControlPlaneService({
      allowRecordedExecution: true,
      application,
      fallbackCatalog: {
        payload: {
          capabilities: [],
          deployments: fixture.deployments,
          models: fixture.models,
          prices: [],
          routes: [],
        },
        revisionId: 'fixture-runtime-v1',
      },
      repository,
    });

    const view = await controlPlane.getCatalog(
      owner.workspaceId,
      'copy.generate',
    );
    assert.ok(view.models.every((model) => model.available === true));
    assert.ok(view.models.every((model) => model.availability === 'recorded'));
    assert.ok(
      view.models.every(
        (model) => model.activationEvidence.status === 'recorded'
      )
    );
    const canvasCatalog = await controlPlane.getCanvasGenerationCatalog(
      owner.workspaceId,
      owner.userId,
    );
    assert.equal(
      canvasCatalog.operations.find(
        (operation) => operation.operation === 'audio.speech',
      )?.usageAmount,
      0,
    );
    const nonFixtureControlPlane = new ModelSupplyControlPlaneService({
      application,
      fallbackCatalog: {
        payload: {
          capabilities: [],
          deployments: fixture.deployments,
          models: fixture.models,
          prices: [],
          routes: [],
        },
        revisionId: 'non-fixture-runtime-v1',
      },
      repository: new MemoryModelSupplyControlPlaneRepository(),
    });
    const nonFixtureCatalog =
      await nonFixtureControlPlane.getCanvasGenerationCatalog(
        owner.workspaceId,
        owner.userId,
      );
    // Production gate keeps fixture audio closed even if the catalog row is
    // active for e2e — no real provider/price/probe, no generation activation.
    const nonFixtureSpeech = nonFixtureCatalog.operations.find(
      (operation) => operation.operation === 'audio.speech',
    );
    assert.equal(nonFixtureSpeech?.activation, 'inactive');
    assert.equal(nonFixtureSpeech?.usageAmount, 0);
    assert.equal(nonFixtureSpeech?.modelId, null);
  });

  it('seeds commercial-use permission only into the explicit local fixture supply contracts', async () => {
    const repository = new MemoryModelSupplyControlPlaneRepository();
    const fixture = modelRuntimeAssemblyFromEnv({
      APP_ENV: 'e2e',
      MODEL_EXECUTION_MODE: 'fixture',
    });
    const application = new ModelSupplyApplicationService({
      deployments: fixture.deployments,
      execution: fixture.runtime.execution,
      models: fixture.models,
      resultSink: repository,
      runtimeCapabilities: fixture.runtimeCapabilities,
    });
    let fixtureContracts:
      | Array<{ commercialUse?: 'allowed'; termsRevisionId: string }>
      | undefined;
    const controlPlane = new ModelSupplyControlPlaneService({
      allowRecordedExecution: true,
      application,
      fallbackCatalog: {
        payload: {
          capabilities: [],
          deployments: fixture.deployments,
          executionChannels: createDefaultExecutionChannels(),
          models: fixture.models,
          prices: [],
          providerProfiles: createDefaultProviderProfiles(),
          routes: [],
        },
        revisionId: 'fixture-rights-contract-v1',
      },
      repository,
      supplyRegistry: {
        async getCurrentRegistryRevision() {
          return null;
        },
        async setCurrentRegistryRevision(_workspaceId, snapshot) {
          fixtureContracts = snapshot.contracts;
        },
      },
    });

    await controlPlane.initialize(owner.workspaceId);

    assert.ok(fixtureContracts?.length);
    assert.ok(
      fixtureContracts?.every(
        (contract) =>
          contract.commercialUse === 'allowed' &&
          contract.termsRevisionId.endsWith(
            LOCAL_FIXTURE_COMMERCIAL_USE_TERMS_SUFFIX,
          ),
      ),
    );

    let nonFixtureContracts:
      | Array<{ commercialUse?: 'allowed'; termsRevisionId: string }>
      | undefined;
    const nonFixtureControlPlane = new ModelSupplyControlPlaneService({
      application,
      fallbackCatalog: {
        payload: {
          capabilities: [],
          deployments: fixture.deployments,
          executionChannels: createDefaultExecutionChannels(),
          models: fixture.models,
          prices: [],
          providerProfiles: createDefaultProviderProfiles(),
          routes: [],
        },
        revisionId: 'non-fixture-rights-contract-v1',
      },
      repository: new MemoryModelSupplyControlPlaneRepository(),
      supplyRegistry: {
        async getCurrentRegistryRevision() {
          return null;
        },
        async setCurrentRegistryRevision(_workspaceId, snapshot) {
          nonFixtureContracts = snapshot.contracts;
        },
      },
    });

    await nonFixtureControlPlane.initialize(`${owner.workspaceId}-non-fixture`);

    assert.ok(nonFixtureContracts?.length);
    assert.ok(
      nonFixtureContracts?.every(
        (contract) => contract.commercialUse === undefined,
      ),
    );
  });

  it('does not reactivate recorded deployments when the runtime fallback is disabled', async () => {
    const repository = new MemoryModelSupplyControlPlaneRepository();
    const catalogModels = createDefaultCatalogModels();
    const disabledDeployments = createDefaultDeployments({
      activatedDeploymentIds: [],
      activationEvidenceStatus: 'recorded',
    });
    const models = new ModelSupplyApplicationService({
      deployments: disabledDeployments,
      execution: new RecordedProviderExecutionPort(),
      models: catalogModels,
      resultSink: repository,
    });
    const controlPlane = new ModelSupplyControlPlaneService({
      application: models,
      fallbackCatalog: {
        payload: {
          capabilities: [],
          deployments: disabledDeployments,
          models: catalogModels,
          prices: [],
          routes: [],
        },
        revisionId: 'disabled-default-v1',
      },
      repository,
    });
    await controlPlane.initialize(owner.workspaceId);
    const view = await controlPlane.getCatalog(
      owner.workspaceId,
      'image.generate',
    );
    assert.equal(view.revisionId, 'disabled-default-v1');
    assert.ok(view.models.every((model) => model.availability === 'unavailable'));
    await assert.rejects(
      models.submit({
        actorId: owner.userId,
        dataClass: [],
        idempotencyKey: 'disabled-image',
        operation: 'image.generate',
        prompt: '门店图片',
        selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
        workspaceId: owner.workspaceId,
      }),
      /not active|unavailable|No deployment/u,
    );
  });

  it('intersects persisted catalogs with immutable runtime capabilities', async () => {
    const repository = new MemoryModelSupplyControlPlaneRepository();
    const disabled = modelRuntimeAssemblyFromEnv({
      MODEL_EXECUTION_MODE: 'disabled',
    });
    const application = new ModelSupplyApplicationService({
      deployments: disabled.deployments,
      execution: disabled.runtime.execution,
      models: disabled.models,
      resultSink: repository,
      runtimeCapabilities: disabled.runtimeCapabilities,
    });
    const controlPlane = new ModelSupplyControlPlaneService({
      application,
      fallbackCatalog: {
        payload: {
          capabilities: [],
          deployments: disabled.deployments,
          models: disabled.models,
          prices: [],
          routes: [],
        },
        revisionId: 'disabled-runtime-v1',
      },
      repository,
    });
    const registry = new CatalogRevisionRegistry();
    const draft = registry.createDraft({
      capabilities: [],
      deployments: createDefaultDeployments({
        activatedDeploymentIds: ['gpt-image-2-managed'],
        activationEvidenceStatus: 'recorded',
      }),
      models: createDefaultCatalogModels(),
      prices: [],
      routes: [],
    });
    const published = registry.publish(registry.enable(draft.id).id);
    await repository.setCurrentPublishedCatalogRevision(
      owner.workspaceId,
      published,
      null,
    );

    await controlPlane.initialize(owner.workspaceId);
    const view = await controlPlane.getCatalog(
      owner.workspaceId,
      'image.generate',
    );
    assert.ok(
      view.models.every((model) => model.availability === 'unavailable'),
    );
    await assert.rejects(
      application.submit({
        actorId: owner.userId,
        dataClass: [],
        idempotencyKey: 'disabled-persisted-image',
        operation: 'image.generate',
        prompt: '门店图片',
        selection: { catalogModelId: 'gpt-image-2', mode: 'fixed' },
        workspaceId: owner.workspaceId,
      }),
      /not active|runtime capability/i,
    );
  });

  it('rejects publication that activates a deployment outside direct runtime capability', async () => {
    const repository = new MemoryModelSupplyControlPlaneRepository();
    const direct = modelRuntimeAssemblyFromEnv({
      MODEL_DIRECT_API_KEY: 'configured-secret',
      MODEL_DIRECT_BASE_URL: 'https://provider.example.test/v1',
      MODEL_DIRECT_CATALOG_MODEL_ID: 'llm-openai',
      MODEL_DIRECT_CREDENTIAL_VERSION: 'staging-key-v3',
      MODEL_DIRECT_ENDPOINT_REVISION: 'openai-compatible-v2',
      MODEL_DIRECT_INPUT_COST_PER_MILLION: '1',
      MODEL_DIRECT_MODEL: 'provider-copy-model',
      MODEL_DIRECT_OUTPUT_COST_PER_MILLION: '1',
      MODEL_EXECUTION_MODE: 'direct',
    });
    const application = new ModelSupplyApplicationService({
      deployments: direct.deployments,
      execution: direct.runtime.execution,
      models: direct.models,
      resultSink: repository,
      runtimeCapabilities: direct.runtimeCapabilities,
    });
    const controlPlane = new ModelSupplyControlPlaneService({
      application,
      repository,
    });
    const draft = await controlPlane.createCatalogDraft(owner.workspaceId, {
      capabilities: [],
      deployments: createDefaultDeployments({
        activatedDeploymentIds: ['gpt-image-2-managed'],
        activationEvidenceStatus: 'recorded',
      }),
      models: createDefaultCatalogModels(),
      prices: [],
      routes: [],
    });
    const enabled = await controlPlane.enableCatalog(
      owner.workspaceId,
      draft.id,
    );

    await assert.rejects(
      controlPlane.publishCatalog(owner.workspaceId, enabled.id, null),
      /runtime capability/i,
    );
    assert.equal(
      await repository.getCurrentPublishedCatalogRevision(owner.workspaceId),
      null,
    );
  });

  it('persists independent workspace/user defaults, favorites and recent choices', async () => {
    const { module } = setup();
    await command(module, owner, 'set_workspace_default', {
      operation: 'image.generate',
      modelId: 'seedream-5-pro',
    });
    await command(module, owner, 'set_user_default', {
      operation: 'image.generate',
      modelId: 'nano-banana-2',
    });
    await command(module, owner, 'set_favorite', {
      operation: 'image.generate',
      modelId: 'gpt-image-2',
      favorite: true,
    });
    await command(module, owner, 'record_recent', {
      operation: 'image.generate',
      modelId: 'nano-banana-pro',
    });

    const view = await query(module, owner, 'preferences', {
      operation: 'image.generate',
    });
    assert.deepEqual(view, {
      workspaceDefault: 'seedream-5-pro',
      userDefault: 'nano-banana-2',
      favorites: ['gpt-image-2'],
      recent: ['nano-banana-pro'],
    });
  });

  it('does not hide durable runtime failures behind the legacy job fallback', async () => {
    const { controlPlane, models } = setup();
    models.getDurableMediaJob = () => {
      throw new Error('durable job database unavailable');
    };

    await assert.rejects(
      controlPlane.getJob(owner.workspaceId, 'job-outage'),
      /durable job database unavailable/,
    );
  });

  it('keeps a disallowed tenant outside the production model catalog and warns without rejecting startup', async () => {
    const warnings: string[] = [];
    const repository = new MemoryModelSupplyControlPlaneRepository();
    const models = new ModelSupplyApplicationService({
      models: createDefaultCatalogModels(),
      deployments: createDefaultDeployments({
        activatedDeploymentIds: ['openai-direct-recorded'],
        activationEvidenceStatus: 'recorded',
      }),
      execution: new RecordedProviderExecutionPort(),
    });
    const controlPlane = new ModelSupplyControlPlaneService({
      application: models,
      repository,
      modelCatalogTenantAllowlist: ['workspace-allowed'],
      warn: (message) => warnings.push(message),
    });

    await controlPlane.initialize(owner.workspaceId);
    const catalog = await controlPlane.getCatalog(
      owner.workspaceId,
      'copy.generate',
    );
    assert.deepEqual(catalog.models, []);
    await assert.rejects(
      models.submit({
        workspaceId: owner.workspaceId,
        actorId: owner.userId,
        idempotencyKey: 'disallowed-explicit-model',
        operation: 'copy.generate',
        selection: { mode: 'fixed', catalogModelId: 'llm-openai' },
        dataClass: [],
        prompt: 'must remain unavailable',
      }),
      /not active/u,
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /modelCatalogTenantAllowlist/u);
  });

  it('gates catalog lifecycle commands to configured admin actors and activates the published revision', async () => {
    const { controlPlane, models, module } = setup();
    await controlPlane.initialize('workspace-b');
    const payload = {
      models: createDefaultCatalogModels(),
      deployments: createDefaultDeployments({
        activatedDeploymentIds: ['gpt-image-2-managed'],
        activationEvidenceStatus: 'recorded' as const,
      }),
      capabilities: [{ id: 'image-v2', operation: 'image.generate', revision: 2 }],
      prices: [{
        id: 'image-price-v2',
        catalogModelId: 'gpt-image-2',
        executionChannelId: 'channel-openai-image-managed',
        pricingTier: 'standard' as const,
        currency: 'CNY' as const,
        amount: 1,
        revision: 2,
      }],
      routes: [{ id: 'image-route-v2', operation: 'image.generate', revision: 2 }],
    };

    await assert.rejects(
      command(module, owner, 'catalog_create_draft', { catalog: payload }),
      (error: unknown) => error instanceof P1DomainError && error.code === 'FORBIDDEN',
    );
    await assert.rejects(
      command(module, admin, 'catalog_create_draft', {
        catalog: {
          ...payload,
          prices: [{
            ...payload.prices[0],
            pricingTier: 'merchant_discount',
          }],
        },
      }),
      /pricing tier/u,
    );
    const discovered = (await command(
      module,
      admin,
      'catalog_discover_draft',
      { catalog: payload },
    )) as { stage: string; reason: string };
    assert.deepEqual(
      { stage: discovered.stage, reason: discovered.reason },
      { stage: 'draft', reason: 'provider_discovery' },
    );
    await assert.rejects(
      command(module, owner, 'reconcile_cancelled_provider_terminal', {
        jobId: 'cancelled-job',
        providerTaskRef: 'provider-task',
      }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'FORBIDDEN',
    );

    const draft = (await command(module, admin, 'catalog_create_draft', {
      catalog: payload,
    })) as { id: string };
    const enabled = (await command(module, admin, 'catalog_enable', {
      revisionId: draft.id,
    })) as { id: string };
    await assert.rejects(
      command(module, admin, 'catalog_publish', {
        revisionId: enabled.id,
      }),
      /expectedHeadRevisionId is required/,
    );
    const published = (await command(module, admin, 'catalog_publish', {
      revisionId: enabled.id,
      expectedHeadRevisionId: null,
    })) as { id: string };

    const view = (await query(module, owner, 'catalog', {
      operation: 'image.generate',
    })) as { revisionId: string; stage: string };
    assert.equal(view.revisionId, published.id);
    assert.equal(view.stage, 'published');

    const result = await models.submit({
      workspaceId: owner.workspaceId,
      actorId: owner.userId,
      idempotencyKey: 'published-image',
      operation: 'image.generate',
      selection: { mode: 'fixed', catalogModelId: 'gpt-image-2' },
      dataClass: [],
      prompt: '门店环境图',
    });
    assert.equal(result.snapshot.catalogRevisionId, published.id);
    assert.equal(result.snapshot.actualCatalogModelId, 'gpt-image-2');

    const otherWorkspace = await models.submit({
      workspaceId: 'workspace-b',
      actorId: 'owner-b',
      idempotencyKey: 'recorded-image',
      operation: 'image.generate',
      selection: { mode: 'fixed', catalogModelId: 'nano-banana-2' },
      dataClass: [],
      prompt: '另一工作区图片',
    });
    assert.equal(otherWorkspace.snapshot.catalogRevisionId, 'recorded-default-v1');
  });

  it('lets only admins read and publish the complete provider-channel catalog', async () => {
    const { module } = setup();

    await assert.rejects(
      query(module, owner, 'admin_catalog_control', {}),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'FORBIDDEN',
    );

    const control = (await query(module, admin, 'admin_catalog_control', {})) as {
      catalog: {
        providerProfiles: Array<{
          id: string;
          lifecycle: string;
          revision: number;
        }>;
        executionChannels: Array<{
          id: string;
          providerProfileId: string;
          revision: number;
        }>;
        deployments: Array<{
          id: string;
          lifecycleRevision: string;
        }>;
        capabilities: Array<{ revision: number }>;
        prices: Array<{ revision: number }>;
        routes: Array<{ revision: number }>;
      };
      revisionId: string;
      stage: string;
    };
    assert.equal(control.revisionId, RECORDED_CATALOG_REVISION_ID);
    assert.equal(control.stage, 'recorded');
    assert.ok(control.catalog.providerProfiles.length > 0);
    assert.ok(control.catalog.executionChannels.length > 0);
    assert.ok(control.catalog.deployments.length > 0);
    assert.ok(control.catalog.capabilities.every((item) => item.revision > 0));
    assert.ok(control.catalog.prices.every((item) => item.revision > 0));
    assert.ok(control.catalog.routes.every((item) => item.revision > 0));
    assert.ok(
      control.catalog.deployments.every((item) => item.lifecycleRevision),
    );

    const editedCatalog = structuredClone(control.catalog);
    const profile = editedCatalog.providerProfiles[0];
    assert.ok(profile);
    profile.revision += 1;
    Object.assign(profile, { credentialSecret: 'redacted-fixture' });
    const draft = (await command(module, admin, 'catalog_create_draft', {
      catalog: editedCatalog,
    })) as { id: string };
    const enabled = (await command(module, admin, 'catalog_enable', {
      revisionId: draft.id,
    })) as { id: string };
    const published = (await command(module, admin, 'catalog_publish', {
      revisionId: enabled.id,
      expectedHeadRevisionId: null,
    })) as { id: string };

    const publishedControl = (await query(
      module,
      admin,
      'admin_catalog_control',
      {},
    )) as typeof control;
    assert.equal(publishedControl.revisionId, published.id);
    assert.equal(publishedControl.stage, 'published');
    assert.equal(
      publishedControl.catalog.providerProfiles[0]?.revision,
      profile.revision,
    );
    assert.equal(
      JSON.stringify(publishedControl).includes('credentialSecret'),
      false,
    );

    const publicCatalog = await query(module, owner, 'catalog', {
      operation: 'image.generate',
    });
    const publicJson = JSON.stringify(publicCatalog);
    assert.equal(publicJson.includes('providerProfiles'), false);
    assert.equal(publicJson.includes('executionChannels'), false);
    assert.equal(publicJson.includes('deployments'), false);
  });

  it('merges safe admin edits without exposing or rebuilding private deployments', async () => {
    const { module, repository } = setup();
    await assert.rejects(
      command(module, admin, 'catalog_create_safe_draft', {
        models: [
          {
            activationEvidence: { status: 'live_verified' },
            allowedDataClasses: ['public'],
            deniedDataClasses: ['contains_face', 'pii', 'medical'],
            id: 'llm-openai',
            lifecycle: 'available',
          },
        ],
      }),
      /reference, canonical UTC timestamp, and configuration revision/,
    );
    const draft = (await command(module, admin, 'catalog_create_safe_draft', {
      models: [
        {
          activationEvidence: {
            evidenceRef: 'evidence://admin/recorded-gpt-image-2',
            status: 'recorded',
            verifiedAt: '2026-07-11T00:00:00.000Z',
          },
          allowedDataClasses: ['public', 'contains_face'],
          deniedDataClasses: ['pii', 'medical'],
          id: 'gpt-image-2',
          lifecycle: 'recorded',
        },
      ],
    })) as { id: string };
    assert.equal(JSON.stringify(draft).includes('channel'), false);
    assert.equal(JSON.stringify(draft).includes('deployment'), false);

    const stored = (await repository.listCatalogRevisions(owner.workspaceId)).find(
      (revision) => revision.id === draft.id,
    );
    const deployment = stored?.payload.deployments.find(
      (candidate) => candidate.catalogModelId === 'gpt-image-2',
    );
    assert.equal(deployment?.id, 'gpt-image-2-managed');
    assert.equal(deployment?.channel, 'managed');
    assert.equal(deployment?.region, 'overseas');
    assert.equal(deployment?.status, 'active');
    assert.deepEqual(deployment?.allowedDataClasses, ['public', 'contains_face']);
  });

  it('rejects a deployment whose provider and execution-channel facts contradict each other', async () => {
    const { module } = setup();
    const deployments = createDefaultDeployments();
    const forged = deployments.find(
      (deployment) => deployment.id === 'gpt-image-2-managed'
    );
    assert.ok(forged);
    forged.apiCounterparty = 'FORGED';
    forged.credentialOwner = 'platform';
    forged.channel = 'direct';
    forged.region = 'domestic';

    await assert.rejects(
      command(module, admin, 'catalog_create_draft', {
        catalog: {
          models: createDefaultCatalogModels(),
          deployments,
          capabilities: [],
          prices: [],
          routes: [],
        },
      }),
      /conflicts with its immutable ExecutionChannel facts/
    );
  });

  it('rejects a catalog model that omits a governed operation credit price', async () => {
    const { module } = setup();
    const models = createDefaultCatalogModels();
    const copy = models.find((model) => model.id === 'deepseek-v4-pro');
    assert.ok(copy?.creditPricing);
    delete copy.creditPricing['copy.generate'];

    await assert.rejects(
      command(module, admin, 'catalog_create_draft', {
        catalog: {
          capabilities: [],
          deployments: createDefaultDeployments(),
          models,
          prices: [],
          routes: [],
        },
      }),
      /missing credit pricing for copy\.generate/i,
    );
  });

  it('returns workspace-scoped jobs and an honest quality dashboard', async () => {
    const { models, module } = setup();
    const generated = await models.submit({
      workspaceId: owner.workspaceId,
      actorId: owner.userId,
      idempotencyKey: 'copy-job',
      operation: 'copy.generate',
      selection: { mode: 'fixed', catalogModelId: 'llm-openai' },
      dataClass: [],
      prompt: '三条美业文案',
    });

    assert.equal(
      ((await query(module, owner, 'job', { jobId: generated.jobId })) as { jobId: string })
        .jobId,
      generated.jobId,
    );
    assert.deepEqual(await query(module, owner, 'quality_dashboard', {}), {
      northStar: {
        status: 'unknown',
        target: 0.6,
        sampleSize: 0,
        minimumSampleSize: 20,
      },
      byModel: [],
      byPromptRevision: [],
      byTemplateRevision: [],
      byScenario: [],
      funnel: {
        abandoned: 0,
        adoptedDirectly: 0,
        adoptedWithSmallEdit: 0,
        published: 0,
        rerolled: 0,
      },
    });

    await assert.rejects(
      command(module, owner, 'record_quality', {
        outcome: 'abandoned',
        catalogModelId: 'forged-model',
        promptRevision: 'forged-prompt',
        exampleSetRevision: 'forged-examples',
        scenario: 'forged-scenario',
      }),
      (error) =>
        error instanceof P1DomainError && error.code === 'FORBIDDEN',
    );

    for (const poisoned of [
      {},
      {
        outcome: 'invented_outcome',
        catalogModelId: 'llm-openai',
        promptRevision: 'prompt-v1',
        exampleSetRevision: 'examples-v1',
        scenario: '到店转化',
      },
      {
        outcome: 'adopted_with_small_edit',
        catalogModelId: 'llm-openai',
        promptRevision: 'prompt-v1',
        exampleSetRevision: 'examples-v1',
        scenario: '到店转化',
        editDistance: 2,
      },
      {
        outcome: 'abandoned',
        catalogModelId: 'llm-openai',
        promptRevision: 'prompt-v1',
        exampleSetRevision: 'examples-v1',
        scenario: '到店转化',
        unexpected: 'poison',
      },
    ]) {
      await assert.rejects(
        command(module, admin, 'record_quality', poisoned),
        (error) =>
          error instanceof P1DomainError && error.code === 'INVALID_STATE',
      );
    }
    assert.deepEqual(await query(module, owner, 'quality_dashboard', {}), {
      northStar: {
        status: 'unknown',
        target: 0.6,
        sampleSize: 0,
        minimumSampleSize: 20,
      },
      byModel: [],
      byPromptRevision: [],
      byTemplateRevision: [],
      byScenario: [],
      funnel: {
        abandoned: 0,
        adoptedDirectly: 0,
        adoptedWithSmallEdit: 0,
        published: 0,
        rerolled: 0,
      },
    });

    await command(module, admin, 'record_quality', {
      outcome: 'adopted_with_small_edit',
      catalogModelId: 'llm-openai',
      promptRevision: 'prompt-v1',
      exampleSetRevision: 'examples-v1',
      scenario: '到店转化',
      templateRevision: 'template-v1',
      editDistance: 0.08,
    });
    const dashboard = (await query(module, owner, 'quality_dashboard', {})) as {
      northStar: Record<string, unknown>;
      byModel: Array<Record<string, unknown>>;
    };
    assert.deepEqual(dashboard.northStar, {
      status: 'unknown',
      target: 0.6,
      sampleSize: 1,
      minimumSampleSize: 20,
    });
    assert.deepEqual(dashboard.byModel[0], {
      key: 'llm-openai',
      sampleSize: 1,
      accepted: 1,
      rate: 1,
    });

    await command(module, admin, 'record_quality', {
      outcome: 'published',
      catalogModelId: 'llm-openai',
      promptRevision: 'prompt-v1',
      exampleSetRevision: 'examples-v1',
      scenario: '到店转化',
    });
    const withPublished = (await query(
      module,
      owner,
      'quality_dashboard',
      {}
    )) as {
      northStar: { status: string; sampleSize: number };
      funnel: { published: number };
    };
    assert.equal(withPublished.northStar.sampleSize, 1);
    assert.equal(withPublished.northStar.status, 'unknown');
    assert.equal(withPublished.funnel.published, 1);

    for (let index = 1; index < 20; index += 1) {
      await command(module, admin, 'record_quality', {
        outcome: 'adopted_directly',
        catalogModelId: 'llm-openai',
        promptRevision: 'prompt-v1',
        exampleSetRevision: 'examples-v1',
        scenario: '到店转化',
      });
    }
    const thresholdReached = (await query(
      module,
      owner,
      'quality_dashboard',
      {},
    )) as {
      northStar: {
        status: string;
        sampleSize: number;
        minimumSampleSize: number;
        accepted: number;
        rate: number;
        met: boolean;
      };
    };
    assert.deepEqual(thresholdReached.northStar, {
      status: 'known',
      target: 0.6,
      sampleSize: 20,
      minimumSampleSize: 20,
      accepted: 20,
      rate: 1,
      met: true,
    });
  });

  it('runs and persists the fixed beauty evaluation set with per-case evidence', async () => {
    const { module } = setup(new RecordedAdapterRouter());
    await assert.rejects(
      command(module, owner, 'quality_evaluation_run', {}),
      (error) =>
        error instanceof P1DomainError && error.code === 'FORBIDDEN',
    );

    const run = (await command(module, admin, 'quality_evaluation_run', {
      catalogModelId: 'llm-openai',
    })) as {
      id: string;
      status: string;
      datasetRevision: string;
      promptRevision: string;
      exampleSetRevision: string;
      catalogRevisionId: string;
      evidenceKind: string;
      summary: {
        caseCount: number;
        passed: number;
        passRate: number;
        rejectionCaseCount: number;
        rejectionsCaught: number;
      };
      cases: Array<{
        passed: boolean;
        routeSnapshotId: string;
        evidenceKind: string;
        activationEvidence: { status: string };
        deploymentId: string;
        evaluation: { dimensionScore: number; warnings: string[] };
      }>;
      rejectionCases: Array<{
        caught: boolean;
        expectedWarnings: string[];
        evaluation: { warnings: string[] };
      }>;
    };

    assert.equal(run.status, 'completed');
    assert.equal(run.datasetRevision, 'beauty-copy-eval-v2');
    assert.equal(run.promptRevision, 'beauty-copy-prompt-v1');
    assert.equal(run.exampleSetRevision, 'beauty-copy-examples-v1');
    assert.equal(run.catalogRevisionId, 'recorded-default-v1');
    assert.equal(run.evidenceKind, 'recorded_contract');
    assert.equal(run.summary.caseCount, 30);
    assert.equal(run.summary.passed, 30);
    assert.equal(run.summary.passRate, 1);
    assert.equal(run.summary.rejectionCaseCount, 10);
    assert.equal(run.summary.rejectionsCaught, 10);
    assert.ok(run.cases.every((testCase) => testCase.passed));
    assert.ok(run.cases.every((testCase) => testCase.routeSnapshotId.length > 0));
    assert.ok(
      run.cases.every(
        (testCase) =>
          testCase.evidenceKind === 'recorded_contract' &&
          testCase.activationEvidence.status === 'recorded' &&
          testCase.deploymentId.length > 0,
      ),
    );
    assert.ok(
      run.cases.every(
        (testCase) =>
          testCase.evaluation.dimensionScore === 1 &&
          testCase.evaluation.warnings.length === 0,
      ),
    );
    assert.ok(run.rejectionCases.every((testCase) => testCase.caught));
    assert.ok(
      run.rejectionCases.every((testCase) =>
        testCase.expectedWarnings.every((warning) =>
          testCase.evaluation.warnings.includes(warning),
        ),
      ),
    );

    const listed = (await query(
      module,
      owner,
      'quality_evaluations',
      {},
    )) as Array<{ id: string; cases: unknown[] }>;
    assert.equal(listed[0]?.id, run.id);
    assert.equal(listed[0]?.cases.length, 30);
    const restored = (await query(module, owner, 'quality_evaluation', {
      runId: run.id,
    })) as { id: string; cases: unknown[] };
    assert.equal(restored.id, run.id);
    assert.equal(restored.cases.length, 30);

    const otherWorkspace = { ...owner, workspaceId: 'workspace-b' };
    assert.deepEqual(
      await query(module, otherWorkspace, 'quality_evaluations', {}),
      [],
    );
  });

  it('rolls future prompt and catalog heads back with immutable audit records', async () => {
    const { module } = setup(new RecordedAdapterRouter());
    const firstDraft = (await command(module, admin, 'catalog_create_draft', {
      catalog: {
        models: createDefaultCatalogModels(),
        deployments: createDefaultDeployments({
          activatedDeploymentIds: ['openai-direct-recorded'],
        }),
        capabilities: [
          { id: 'copy-cap-v1', operation: 'copy.generate', revision: 1 },
        ],
        prices: [
          {
            id: 'copy-price-v1',
            catalogModelId: 'llm-openai',
            executionChannelId: 'channel-openai-direct',
            pricingTier: 'standard',
            currency: 'CNY',
            amount: 1,
            revision: 1,
          },
        ],
        routes: [
          { id: 'copy-route-v1', operation: 'copy.generate', revision: 1 },
        ],
      },
    })) as { id: string };
    const firstEnabled = (await command(module, admin, 'catalog_enable', {
      revisionId: firstDraft.id,
    })) as { id: string };
    const firstPublished = (await command(module, admin, 'catalog_publish', {
      revisionId: firstEnabled.id,
      expectedHeadRevisionId: null,
    })) as { id: string };

    const secondDraft = (await command(module, admin, 'catalog_create_draft', {
      catalog: {
        models: createDefaultCatalogModels(),
        deployments: createDefaultDeployments({
          activatedDeploymentIds: ['openai-direct-recorded'],
        }),
        capabilities: [
          { id: 'copy-cap-v2', operation: 'copy.generate', revision: 2 },
        ],
        prices: [
          {
            id: 'copy-price-v2',
            catalogModelId: 'llm-openai',
            executionChannelId: 'channel-openai-direct',
            pricingTier: 'standard',
            currency: 'CNY',
            amount: 2,
            revision: 2,
          },
        ],
        routes: [
          { id: 'copy-route-v2', operation: 'copy.generate', revision: 2 },
        ],
      },
    })) as { id: string };
    const secondEnabled = (await command(module, admin, 'catalog_enable', {
      revisionId: secondDraft.id,
    })) as { id: string };
    const secondPublished = (await command(module, admin, 'catalog_publish', {
      revisionId: secondEnabled.id,
      expectedHeadRevisionId: firstPublished.id,
    })) as { id: string };

    await command(module, admin, 'catalog_rollback', {
      revisionId: firstPublished.id,
      reason: 'offline evaluation regressed',
    });
    const catalog = (await query(module, owner, 'catalog', {
      operation: 'copy.generate',
    })) as { revisionId: string };
    assert.equal(catalog.revisionId, firstPublished.id);

    await command(module, admin, 'prompt_revision_rollback', {
      revisionId: 'beauty-copy-prompt-v0',
      reason: 'restore the stable prompt baseline',
    });
    const prompts = (await query(module, owner, 'prompt_revisions', {})) as {
      currentPromptRevision: string;
      currentExampleSetRevision: string;
    };
    assert.equal(prompts.currentPromptRevision, 'beauty-copy-prompt-v0');
    assert.equal(prompts.currentExampleSetRevision, 'beauty-copy-examples-v0');

    const run = (await command(module, admin, 'quality_evaluation_run', {
      catalogModelId: 'llm-openai',
    })) as { promptRevision: string; catalogRevisionId: string };
    assert.equal(run.promptRevision, 'beauty-copy-prompt-v0');
    assert.equal(run.catalogRevisionId, firstPublished.id);

    const audits = (await query(
      module,
      owner,
      'revision_rollback_audits',
      {},
    )) as Array<{
      kind: string;
      fromRevisionId: string;
      toRevisionId: string;
      reason: string;
      actorId: string;
      correlationId: string;
    }>;
    assert.equal(audits.length, 2);
    assert.deepEqual(
      new Set(audits.map((audit) => audit.kind)),
      new Set(['catalog', 'prompt']),
    );
    const catalogAudit = audits.find((audit) => audit.kind === 'catalog');
    assert.equal(catalogAudit?.fromRevisionId, secondPublished.id);
    assert.equal(catalogAudit?.toRevisionId, firstPublished.id);
    assert.equal(catalogAudit?.reason, 'offline evaluation regressed');
    assert.equal(catalogAudit?.actorId, admin.userId);
    assert.equal(catalogAudit?.correlationId, admin.correlationId);

    const activity = (await query(
      module,
      admin,
      'catalog_revisions',
      {},
    )) as {
      revisions: Array<{ actorId?: string; correlationId?: string }>;
    };
    assert.ok(
      activity.revisions
        .filter((revision) => revision.actorId)
        .every(
          (revision) =>
            revision.actorId === admin.userId &&
            revision.correlationId === admin.correlationId,
      ),
    );
  });

  it('keeps recorded contract evaluation available to admins without opening user routes', async () => {
    const runtime = modelRuntimeAssemblyFromEnv({
      MODEL_EXECUTION_MODE: 'recorded',
    });
    const repository = new MemoryModelSupplyControlPlaneRepository();
    const application = new ModelSupplyApplicationService({
      models: runtime.models,
      deployments: runtime.deployments,
      execution: runtime.runtime.execution,
      resultSink: repository,
      runtimeCapabilities: runtime.runtimeCapabilities,
    });
    const controlPlane = new ModelSupplyControlPlaneService({
      application,
      fallbackCatalog: {
        payload: {
          capabilities: [],
          deployments: runtime.deployments,
          models: runtime.models,
          prices: [],
          routes: [],
        },
        revisionId: RECORDED_CATALOG_REVISION_ID,
      },
      repository,
    });
    const module = new ModelSupplyFoundationModule(controlPlane, {
      adminActorIds: ['admin-a'],
    });

    const run = (await command(module, admin, 'quality_evaluation_run', {
      catalogModelId: 'llm-openai',
    })) as { status: string; evidenceKind: string };
    assert.equal(run.status, 'completed');
    assert.equal(run.evidenceKind, 'recorded_contract');
    assert.throws(
      () =>
        application.freezeFixedRoute({
          workspaceId: admin.workspaceId,
          operation: 'copy.generate',
          catalogModelId: 'llm-openai',
          dataClass: [],
        }),
      /not active/i,
    );
  });

  it('submits a fixed video model through the workspace-scoped application seam', async () => {
    const { module } = setup();
    const result = (await command(module, owner, 'submit_generation', {
      dataClass: [],
      input: { durationSeconds: 15 },
      operation: 'video.generate',
      prompt: '门店项目 15 秒竖屏视频',
      selection: { catalogModelId: 'seedance-2', mode: 'fixed' },
    })) as { status: string; snapshot: { actualCatalogModelId: string } };

    assert.equal(result.status, 'completed');
    assert.equal(result.snapshot.actualCatalogModelId, 'seedance-2');
    await assert.rejects(
      command(module, owner, 'submit_generation', {
        dataClass: [],
        operation: 'video.generate',
        prompt: '不允许媒体 Auto',
        selection: { mode: 'auto' },
      }),
      /only for LLM/
    );
  });

  it('requires exact reserved billing facts before the provider effect', async () => {
    let providerCalls = 0;
    const { controlPlane } = setup({
      async execute(request) {
        providerCalls += 1;
        return new RecordedProviderExecutionPort().execute(request);
      },
    });
    const quoteByTask = new Map<string, ProductQuoteSnapshot>([
      [
        'credit-task-valid',
        {
          catalogModelId: 'llm-openai',
          lifecycleStatus: 'reserved',
          operation: 'copy.generate',
          outputCount: 1,
          quoteId: 'quote-valid',
          revision: 'quote-r1',
          taskId: 'credit-task-valid',
          workspaceId: owner.workspaceId,
        } as ProductQuoteSnapshot,
      ],
      [
        'credit-task-cross-workspace',
        {
          lifecycleStatus: 'reserved',
          quoteId: 'quote-cross-workspace',
          revision: 'quote-r1',
          taskId: 'credit-task-cross-workspace',
          workspaceId: 'workspace-b',
        } as ProductQuoteSnapshot,
      ],
      [
        'credit-task-confirmed',
        {
          lifecycleStatus: 'confirmed',
          quoteId: 'quote-confirmed',
          revision: 'quote-r1',
          taskId: 'credit-task-confirmed',
          workspaceId: owner.workspaceId,
        } as ProductQuoteSnapshot,
      ],
      [
        'credit-task-terminal',
        {
          lifecycleStatus: 'settled',
          quoteId: 'quote-terminal',
          revision: 'quote-r1',
          taskId: 'credit-task-terminal',
          workspaceId: owner.workspaceId,
        } as ProductQuoteSnapshot,
      ],
    ]);
    const reservedBilling = merchantExecutionBillingStub({
      getQuote(taskId: string) {
        return quoteByTask.get(taskId) ?? null;
      },
      getUsage(taskId: string) {
        if (taskId === 'credit-task-valid') {
          return {
            quoteId: 'quote-valid',
            status: 'reserved',
            taskId,
            workspaceId: owner.workspaceId,
          } as ProductUsageRecord;
        }
        if (taskId === 'credit-task-terminal') {
          return {
            quoteId: 'quote-terminal',
            status: 'committed',
            taskId,
            workspaceId: owner.workspaceId,
          } as ProductUsageRecord;
        }
        return null;
      },
    });
    const module = new ModelSupplyFoundationModule(controlPlane, {
      requireReservedBilling: true,
      reservedBilling,
    });
    const payload = {
      dataClass: [],
      operation: 'copy.generate',
      prompt: 'Return one concise campaign direction.',
      selection: { catalogModelId: 'llm-openai', mode: 'fixed' },
    };

    await assert.rejects(
      command(module, owner, 'submit_generation', payload),
      /reserved credit billing task/i,
    );
    for (const invalid of [
      {
        billingTaskId: 'credit-task-missing',
        billingQuoteRevision: 'quote-r1',
      },
      {
        billingTaskId: 'credit-task-cross-workspace',
        billingQuoteRevision: 'quote-r1',
      },
      {
        billingTaskId: 'credit-task-valid',
        billingQuoteRevision: 'quote-stale',
      },
      {
        billingTaskId: 'credit-task-confirmed',
        billingQuoteRevision: 'quote-r1',
      },
      {
        billingTaskId: 'credit-task-terminal',
        billingQuoteRevision: 'quote-r1',
      },
    ]) {
      await assert.rejects(
        command(module, owner, 'submit_generation', { ...payload, ...invalid }),
        /reserved credit (?:billing task|quote)/i,
      );
    }
    for (const drift of [
      { operation: 'copy.adapt' },
      { selection: { catalogModelId: 'llm-backup', mode: 'fixed' } },
      { billingOutputCount: 2 },
    ]) {
      await assert.rejects(
        command(module, owner, 'submit_generation', {
          ...payload,
          ...drift,
          billingTaskId: 'credit-task-valid',
          billingQuoteRevision: 'quote-r1',
        }),
        /reserved credit (?:quote|billing)|quoted CatalogModel|derived/i,
      );
    }
    assert.equal(providerCalls, 0);
    const result = (await command(module, owner, 'submit_generation', {
      ...payload,
      billingTaskId: 'credit-task-valid',
      billingQuoteRevision: 'quote-r1',
    })) as { status: string };
    assert.equal(result.status, 'completed');
    assert.equal(providerCalls, 1);
  });

  it('allows only one provider effect for a reserved task across command keys', async () => {
    let providerCalls = 0;
    const { controlPlane } = setup({
      async execute(request) {
        providerCalls += 1;
        return new RecordedProviderExecutionPort().execute(request);
      },
    });
    const reservedBilling = merchantExecutionBillingStub({
      getQuote(taskId: string) {
        return taskId === 'credit-task-exclusive'
          ? ({
              catalogModelId: 'llm-openai',
              lifecycleStatus: 'reserved',
              operation: 'copy.generate',
              outputCount: 1,
              quoteId: 'quote-exclusive',
              revision: 'quote-r1',
              taskId,
              workspaceId: owner.workspaceId,
            } as ProductQuoteSnapshot)
          : null;
      },
      getUsage(taskId: string) {
        return taskId === 'credit-task-exclusive'
          ? ({
              quoteId: 'quote-exclusive',
              status: 'reserved',
              taskId,
              workspaceId: owner.workspaceId,
            } as ProductUsageRecord)
          : null;
      },
    });
    const module = new ModelSupplyFoundationModule(controlPlane, {
      requireReservedBilling: true,
      reservedBilling,
    });
    const execute = (idempotencyKey: string) =>
      module.execute({
        context: owner,
        idempotencyKey,
        input: {
          action: 'submit_generation',
          payload: {
            billingQuoteRevision: 'quote-r1',
            billingTaskId: 'credit-task-exclusive',
            dataClass: [],
            operation: 'copy.generate',
            prompt: 'Return one campaign direction.',
            selection: { catalogModelId: 'llm-openai', mode: 'fixed' },
          },
        },
      });

    const results = await Promise.allSettled([
      execute('merchant-command-a'),
      execute('merchant-command-b'),
    ]);

    assert.equal(providerCalls, 1);
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1,
    );
  });

  it('claims every reserved provider effect and rejects missing merchant billing facts', async () => {
    let providerCalls = 0;
    const execution = {
      async execute(request: Parameters<ProviderExecutionPort['execute']>[0]) {
        providerCalls += 1;
        return new RecordedProviderExecutionPort().execute(request);
      },
    } satisfies ProviderExecutionPort;
    const quote = {
      catalogModelId: 'llm-openai',
      lifecycleStatus: 'reserved',
      operation: 'copy.generate',
      outputCount: 1,
      quoteId: 'quote-effect-claim',
      revision: 'quote-r1',
      taskId: 'credit-task-effect-claim',
      workspaceId: owner.workspaceId,
    } as ProductQuoteSnapshot;
    const reservedBilling = merchantExecutionBillingStub({
      getQuote: () => quote,
      getUsage: () =>
        ({
          quoteId: quote.quoteId,
          status: 'reserved',
          taskId: quote.taskId,
          workspaceId: owner.workspaceId,
        }) as ProductUsageRecord,
    });
    const withoutBilling = setup(execution).models;
    const billed = setup(
      execution,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      reservedBilling,
    ).models;
    const base = {
      actorId: owner.userId,
      dataClass: [],
      idempotencyKey: 'merchant-effect-test',
      operation: 'copy.generate' as const,
      prompt: 'Return one campaign direction.',
      selection: { catalogModelId: 'llm-openai', mode: 'fixed' as const },
      workspaceId: owner.workspaceId,
    };

    await assert.rejects(
      withoutBilling.submit({
        ...base,
        billingQuoteRevision: quote.revision,
        billingTaskId: quote.taskId,
        productUsageQuantity: 0,
      }),
      /billing is unavailable/i,
    );
    await assert.rejects(billed.submit(base), /billing task and quote revision/i);
    await assert.rejects(
      billed.submit({
        ...base,
        billingQuoteRevision: quote.revision,
        billingTaskId: 'forged-task',
        productUsageQuantity: 0,
      }),
      /reserved credit quote contract|reserved credit quote/i,
    );
    assert.equal(providerCalls, 0);

    const result = await billed.submit({
      ...base,
      billingQuoteRevision: quote.revision,
      billingTaskId: quote.taskId,
      idempotencyKey: 'durable-zero-usage-effect',
      operation: 'text.respond',
      productUsageQuantity: 0,
    });
    assert.equal(result.status, 'completed');
    assert.equal(providerCalls, 1);
  });

  it('shares the reserved three-platform copy.adapt claim with direct control-plane consumers', async () => {
    let providerCalls = 0;
    let providerEffectKey: string | undefined;
    let providerPrompt: string | undefined;
    let providerAssetIds: string[] = [];
    const quote = {
      catalogModelId: 'llm-openai',
      lifecycleStatus: 'reserved',
      operation: 'copy.adapt',
      outputCount: 3,
      quoteId: 'quote-shared-consumer',
      revision: 'quote-r1',
      submissionContractHash: 'signed-snapshot-shared-consumer',
      taskId: 'credit-task-shared-consumer',
      workspaceId: owner.workspaceId,
    } as ProductQuoteSnapshot;
    const reservedBilling = merchantExecutionBillingStub({
      getQuote: () => quote,
      getUsage: () =>
        ({
          quoteId: quote.quoteId,
          status: 'reserved',
          taskId: quote.taskId,
          workspaceId: owner.workspaceId,
        }) as ProductUsageRecord,
    });
    const referenceAssets: ReferenceAssetResolverPort = {
      async inspect(_workspaceId, assetIds) {
        return assetIds.map((assetId) => ({
          assetId,
          classificationSource: 'server_fact' as const,
          contentType: 'image/png',
          dataClass: [],
          kind: 'resolved' as const,
          rightsRevision: 'rights-r1',
          sha256: '0'.repeat(64),
        }));
      },
      async resolve(_workspaceId, assetIds) {
        return assetIds.map((assetId) => ({
          assetId,
          bytes: new Uint8Array([1, 2, 3]),
          contentType: 'image/png',
          kind: 'resolved' as const,
          providerReadableUrl: 'data:image/png;base64,AQID',
          sha256: '0'.repeat(64),
        }));
      },
    };
    const { controlPlane, models } = setup(
      {
        async execute(request) {
          providerCalls += 1;
          providerEffectKey = request.effectIdempotencyKey;
          providerPrompt = request.submission.prompt;
          providerAssetIds = request.submission.input?.referenceAssetIds ?? [];
          return new RecordedProviderExecutionPort().execute(request);
        },
      },
      [],
      undefined,
      referenceAssets,
      undefined,
      undefined,
      reservedBilling,
    );
    const input = {
      billingQuoteRevision: quote.revision,
      billingTaskId: quote.taskId,
      dataClass: [],
      input: { referenceAssetIds: ['asset-reference-a'] },
      operation: 'copy.adapt' as const,
      prompt: 'Return three campaign directions.',
      selection: { catalogModelId: quote.catalogModelId, mode: 'fixed' as const },
    };

    const concurrent = await Promise.allSettled([
      controlPlane.submitGeneration(owner, input, 'operations-entry'),
      models.submit({
        ...input,
        actorId: owner.userId,
        idempotencyKey: 'operations-entry',
        workspaceId: owner.workspaceId,
      }),
      models.submitWithProviderEffectKey(
        {
          ...input,
          actorId: owner.userId,
          idempotencyKey: 'harness-worker-entry',
          workspaceId: owner.workspaceId,
        },
        'harness-worker-provider-effect',
      ),
    ]);
    assert.equal(providerCalls, 1);
    assert.equal(
      providerEffectKey,
      `merchant-execution:${quote.taskId}`,
    );
    assert.equal(providerPrompt, input.prompt);
    assert.deepEqual(providerAssetIds, ['asset-reference-a']);
    assert.equal(
      concurrent.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    const fulfilled = concurrent.find(
      (result) => result.status === 'fulfilled',
    );
    assert.ok(fulfilled && fulfilled.status === 'fulfilled');
    if (!fulfilled || fulfilled.status !== 'fulfilled') return;
    const operations = fulfilled.value;
    assert.equal(operations.copyCandidates?.length, quote.outputCount);
    const replay = await models.submit({
      ...input,
      actorId: owner.userId,
      idempotencyKey: 'harness-replay-entry',
      workspaceId: owner.workspaceId,
    });
    assert.deepEqual(replay, operations);
    await assert.rejects(
      models.submit({
        ...input,
        actorId: owner.userId,
        idempotencyKey: 'prompt-drift-entry',
        prompt: 'Return a different campaign direction.',
        workspaceId: owner.workspaceId,
      }),
      /another merchant execution|already claimed/i,
    );
    await assert.rejects(
      models.submit({
        ...input,
        actorId: owner.userId,
        idempotencyKey: 'reference-drift-entry',
        input: { referenceAssetIds: ['asset-reference-b'] },
        workspaceId: owner.workspaceId,
      }),
      /another merchant execution|already claimed/i,
    );
  });

  it('derives native image edit execution from a reference-transform quote', async () => {
    let providerCalls = 0;
    let providerOperation: string | undefined;
    const quote = {
      catalogModelId: 'seedream-5-pro',
      lifecycleStatus: 'reserved',
      operation: 'image.reference_transform',
      outputCount: 1,
      quoteId: 'quote-reference-transform',
      revision: 'quote-r1',
      taskId: 'credit-task-reference-transform',
      workspaceId: owner.workspaceId,
    } as ProductQuoteSnapshot;
    const reservedBilling = merchantExecutionBillingStub({
      getQuote: () => quote,
      getUsage: () =>
        ({
          quoteId: quote.quoteId,
          status: 'reserved',
          taskId: quote.taskId,
          workspaceId: owner.workspaceId,
        }) as ProductUsageRecord,
    });
    const { controlPlane } = setup(
      {
        async execute(request) {
          providerCalls += 1;
          providerOperation = request.submission.operation;
          return new RecordedProviderExecutionPort().execute(request);
        },
      },
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      reservedBilling,
    );
    const input = {
      billingQuoteRevision: quote.revision,
      billingTaskId: quote.taskId,
      dataClass: [],
      operation: 'image.edit' as const,
      prompt: 'Convert the supplied reference into a campaign poster.',
      selection: { catalogModelId: quote.catalogModelId, mode: 'fixed' as const },
    };

    await assert.rejects(
      controlPlane.submitGeneration(
        owner,
        { ...input, operation: 'image.generate' },
        'reference-transform-drift',
      ),
      /operation does not match/i,
    );
    const result = await controlPlane.submitGeneration(
      owner,
      input,
      'reference-transform-execute',
    );

    assert.equal(result.status, 'completed');
    assert.equal(providerOperation, 'image.edit');
    assert.equal(providerCalls, 1);
  });

  it('passes a multi-image reserved quote count to provider execution', async () => {
    let providerOutputCount: number | undefined;
    const quote = {
      catalogModelId: 'seedream-5-pro',
      lifecycleStatus: 'reserved',
      operation: 'image.generate',
      outputCount: 2,
      quoteId: 'quote-image-two',
      revision: 'quote-r1',
      taskId: 'credit-task-image-two',
      workspaceId: owner.workspaceId,
    } as ProductQuoteSnapshot;
    const reservedBilling = merchantExecutionBillingStub({
      getQuote: () => quote,
      getUsage: () =>
        ({
          quoteId: quote.quoteId,
          status: 'reserved',
          taskId: quote.taskId,
          workspaceId: owner.workspaceId,
        }) as ProductUsageRecord,
    });
    const { controlPlane } = setup(
      {
        async execute(request) {
          providerOutputCount = request.submission.outputCount;
          return new RecordedProviderExecutionPort().execute(request);
        },
      },
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      reservedBilling,
    );

    const result = await controlPlane.submitGeneration(
      owner,
      {
        billingQuoteRevision: quote.revision,
        billingTaskId: quote.taskId,
        dataClass: [],
        operation: 'image.generate',
        prompt: 'Generate two coordinated campaign images.',
        selection: { catalogModelId: quote.catalogModelId, mode: 'fixed' },
      },
      'image-two-provider-effect',
    );

    assert.equal(result.status, 'completed');
    assert.equal(providerOutputCount, quote.outputCount);
  });

  it('derives video duration from the reserved quote before provider execution', async () => {
    let providerCalls = 0;
    let providerDuration: number | undefined;
    const quote = {
      catalogModelId: 'seedance-2',
      lifecycleStatus: 'reserved',
      operation: 'video.generate',
      outputCount: 1,
      quoteId: 'quote-video-duration',
      revision: 'quote-r1',
      targetSeconds: 15,
      taskId: 'credit-task-video-duration',
      workspaceId: owner.workspaceId,
    } as ProductQuoteSnapshot;
    const reservedBilling = merchantExecutionBillingStub({
      getQuote: () => quote,
      getUsage: () =>
        ({
          quoteId: quote.quoteId,
          status: 'reserved',
          taskId: quote.taskId,
          workspaceId: owner.workspaceId,
        }) as ProductUsageRecord,
    });
    const { controlPlane } = setup(
      {
        async execute(request) {
          providerCalls += 1;
          providerDuration = request.submission.input?.durationSeconds;
          return new RecordedProviderExecutionPort().execute(request);
        },
      },
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      reservedBilling,
    );
    const input = {
      billingQuoteRevision: quote.revision,
      billingTaskId: quote.taskId,
      dataClass: [],
      operation: 'video.generate' as const,
      prompt: 'Produce the confirmed treatment introduction clip.',
      selection: { catalogModelId: quote.catalogModelId, mode: 'fixed' as const },
    };

    await assert.rejects(
      controlPlane.submitGeneration(
        owner,
        { ...input, input: { durationSeconds: 60 } },
        'video-duration-drift',
      ),
      /duration does not match/i,
    );
    await controlPlane.submitGeneration(owner, input, 'video-duration-execute');

    assert.equal(providerCalls, 1);
    assert.equal(providerDuration, quote.targetSeconds);
  });

  it('replays a completed merchant execution before terminal quote rejection', async () => {
    let providerCalls = 0;
    const { controlPlane } = setup({
      async execute(request) {
        providerCalls += 1;
        return new RecordedProviderExecutionPort().execute(request);
      },
    });
    const quote = {
      catalogModelId: 'llm-openai',
      lifecycleStatus: 'reserved',
      operation: 'copy.generate',
      outputCount: 1,
      quoteId: 'quote-replay',
      revision: 'quote-r1',
      taskId: 'credit-task-replay',
      workspaceId: owner.workspaceId,
    } as ProductQuoteSnapshot;
    const usage = {
      quoteId: quote.quoteId,
      status: 'reserved',
      taskId: quote.taskId,
      workspaceId: owner.workspaceId,
    } as ProductUsageRecord;
    const reservedBilling = merchantExecutionBillingStub({
      getQuote: () => quote,
      getUsage: () => usage,
    });
    const module = new ModelSupplyFoundationModule(controlPlane, {
      requireReservedBilling: true,
      reservedBilling,
    });
    const args = {
      context: owner,
      idempotencyKey: 'merchant-replay-key',
      input: {
        action: 'submit_generation',
        payload: {
          billingQuoteRevision: quote.revision,
          billingTaskId: quote.taskId,
          dataClass: [],
          operation: 'copy.generate',
          prompt: 'Return one durable result.',
          selection: { catalogModelId: 'llm-openai', mode: 'fixed' },
        },
      },
    };

    const first = await module.execute(args);
    quote.lifecycleStatus = 'settled';
    usage.status = 'committed';
    const replay = await module.execute(args);

    assert.deepEqual(replay, first);
    assert.equal(providerCalls, 1);
  });

  it('submits fixed or automatic text.respond as one plain-text deliverable instead of copy candidates', async () => {
    const { module } = setup();

    const result = (await command(module, owner, 'submit_generation', {
      dataClass: [],
      operation: 'text.respond',
      prompt: 'Return one concise campaign direction.',
      selection: { catalogModelId: 'llm-openai', mode: 'fixed' },
    })) as {
      status: string;
      text?: string;
      copyCandidates?: unknown[];
      usage: { status: string };
    };

    assert.equal(result.status, 'completed');
    assert.equal(result.text, 'Return one concise campaign direction.');
    assert.equal(result.copyCandidates, undefined);
    assert.equal(result.usage.status, 'committed');

    const automatic = (await command(module, {
      ...owner,
      correlationId: 'corr-owner-text-auto',
    }, 'submit_generation', {
      dataClass: [],
      operation: 'text.respond',
      prompt: 'Return one automatic planning response.',
      selection: { mode: 'auto' },
    })) as { status: string; text?: string };
    assert.equal(automatic.status, 'completed');
    assert.equal(automatic.text, 'Return one automatic planning response.');
  });

  it('does not complete or commit usage for an empty text.respond deliverable', async () => {
    const { module } = setup({
      async execute() {
        return {
          kind: 'completed' as const,
          text: '   ',
          providerCost: {
            amount: 0.01,
            currency: 'USD' as const,
            usage: { outputTokens: 1 },
          },
        };
      },
    });
    const result = (await command(module, owner, 'submit_generation', {
      dataClass: [],
      operation: 'text.respond',
      prompt: 'Return one response.',
      selection: { catalogModelId: 'llm-openai', mode: 'fixed' },
    })) as { failureCode?: string; status: string; usage: { status: string } };
    assert.equal(result.status, 'failed');
    assert.equal(result.failureCode, 'EMPTY_TEXT_DELIVERABLE');
    assert.equal(result.usage.status, 'refunded');
  });

  it('fails closed before provider execution when the multimodal Asset resolver is inactive', async () => {
    let providerCalls = 0;
    const { module } = setup({
      async execute(request) {
        providerCalls += 1;
        return new RecordedProviderExecutionPort().execute(request);
      },
    });

    await assert.rejects(command(module, owner, 'submit_generation', {
        dataClass: [],
        input: {
          inputAssets: [
            { assetId: 'asset-image-1', role: 'reference_image' },
          ],
        },
        operation: 'text.respond',
        prompt: 'Reverse this image into a prompt.',
        selection: { catalogModelId: 'llm-openai', mode: 'fixed' },
      }), /Reference asset resolver is unavailable/u);
    assert.equal(providerCalls, 0);
  });

  it('resolves authorized image Asset IDs for a durable multimodal text deliverable', async () => {
    let resolvedAssetIds: string[] = [];
    let providerAssetIds: string[] = [];
    const execution: ProviderExecutionPort = {
      async execute(request) {
        providerAssetIds = request.resolvedReferenceAssets?.map(
          (asset) => asset.assetId,
        ) ?? [];
        return new RecordedProviderExecutionPort().execute(request);
      },
    };
    const referenceAssets: ReferenceAssetResolverPort = {
      async inspect(_workspaceId, assetIds) {
        return assetIds.map((assetId) => ({
          assetId,
          classificationSource: 'server_fact' as const,
          contentType: 'image/png',
          dataClass: [],
          kind: 'resolved' as const,
          rightsRevision: 'rights-r1',
          sha256: '0'.repeat(64),
        }));
      },
      async resolve(_workspaceId, assetIds) {
        resolvedAssetIds = assetIds;
        return assetIds.map((assetId) => ({
          assetId,
          bytes: new Uint8Array([1, 2, 3]),
          contentType: 'image/png',
          kind: 'resolved' as const,
          providerReadableUrl: 'data:image/png;base64,AQID',
          sha256: '0'.repeat(64),
        }));
      },
    };
    const { module } = setup(execution, [], undefined, referenceAssets);
    const result = (await command(module, owner, 'submit_generation', {
      dataClass: [],
      input: {
        inputAssets: [
          { assetId: 'asset-image-1', role: 'reference_image' },
        ],
      },
      operation: 'text.respond',
      prompt: 'Reverse this image into a prompt.',
      selection: { catalogModelId: 'llm-openai', mode: 'fixed' },
    })) as { status: string; text?: string };
    assert.equal(result.status, 'completed');
    assert.equal(result.text, 'Reverse this image into a prompt.');
    assert.deepEqual(resolvedAssetIds, ['asset-image-1']);
    assert.deepEqual(providerAssetIds, ['asset-image-1']);
  });

  it.skip('exposes a fixed Canvas catalog, quote, submit, get, and project-list contract', async () => {
    let providerCalls = 0;
    const providerEffectKeys: Array<string | undefined> = [];
    const { models, module, repository } = setup(
      {
        async execute(request) {
          providerCalls += 1;
          providerEffectKeys.push(request.effectIdempotencyKey);
          return new RecordedProviderExecutionPort().execute(request);
        },
      },
      [],
      undefined,
      {
        async inspect(_workspaceId, assetIds) {
          return assetIds.map((assetId) => ({
            assetId,
            classificationSource: 'server_fact' as const,
            contentType: 'image/png',
            dataClass: [],
            kind: 'resolved' as const,
            rightsRevision: 'rights-r1',
            sha256: '0'.repeat(64),
          }));
        },
        async resolve(_workspaceId, assetIds) {
          return assetIds.map((assetId) => ({
            assetId,
            bytes: new Uint8Array([1, 2, 3]),
            contentType: 'image/png',
            kind: 'resolved' as const,
            providerReadableUrl: 'data:image/png;base64,AQID',
            sha256: '0'.repeat(64),
          }));
        },
      },
    );
    const workerContext: P1Context = { ...owner, actor: 'worker' };
    await repository.setWorkspaceDefault(
      workerContext.workspaceId,
      'text.respond',
      'llm-openai',
    );
    const request = {
      checkpointId: 'revision-1',
      count: 1,
      dataClass: [],
      inputAssets: [
        { assetId: 'asset-reference-1', role: 'reference_image' as const },
      ],
      inputNodeBindings: [
        {
          assetId: 'asset-reference-1',
          nodeId: 'image-reference-1',
          role: 'reference_image' as const,
        },
      ],
      modelId: 'llm-openai',
      nodeId: 'image-reference-1',
      operation: 'text.respond',
      parameters: {},
      projectId: 'project-1',
      prompt: 'Return one direction.',
      revisionId: 'revision-1',
    };
    const catalog = (await query(
      module,
      workerContext,
      'canvas_generation_catalog',
      {},
    )) as {
      operations: Array<{
        activation: 'active' | 'inactive';
        operation: string;
        usageAmount: number;
      }>;
      schema: { inputAssetRoles: string[]; parameters: string[] };
    };
    assert.ok(catalog.schema.inputAssetRoles.includes('mask'));
    assert.ok(catalog.schema.parameters.includes('watermark'));
    const textOperation = catalog.operations.find(
      (operation) => operation.operation === 'text.respond',
    );
    assert.equal(textOperation?.activation, 'active');
    assert.equal(textOperation?.usageAmount, 1);
    await assert.rejects(
      command(
        module,
        { ...workerContext, correlationId: 'corr-canvas-batch-unsupported' },
        'canvas_generation_quote',
        { ...request, count: 2 },
      ),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'INVALID_STATE',
    );
    assert.equal(providerCalls, 0);
    const quote = (await command(
      module,
      workerContext,
      'canvas_generation_quote',
      request,
    )) as {
      quoteId: string;
      catalogRevisionId: string;
      payloadHash: string;
      priceRevision: string;
      workspaceId: string;
    };
    assert.match(quote.quoteId, /^canvas-quote-/u);
    assert.equal(quote.workspaceId, workerContext.workspaceId);
    assert.equal(quote.catalogRevisionId, RECORDED_CATALOG_REVISION_ID);
    assert.match(quote.payloadHash, /^[a-f0-9]{64}$/u);
    assert.ok(quote.priceRevision);
    await assert.rejects(
      module.execute({
        context: workerContext,
        idempotencyKey: 'canvas-quote-unknown-project',
        input: {
          action: 'canvas_generation_quote',
          payload: { ...request, projectId: 'project-missing' },
        },
      }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'NOT_FOUND',
    );
    await assert.rejects(
      module.execute({
        context: workerContext,
        idempotencyKey: 'canvas-quote-unknown-revision',
        input: {
          action: 'canvas_generation_quote',
          payload: { ...request, revisionId: 'revision-missing' },
        },
      }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'NOT_FOUND',
    );
    await assert.rejects(
      module.execute({
        context: {
          ...workerContext,
          correlationId: 'corr-quote-replay',
          userId: 'other-worker',
        },
        idempotencyKey: 'canvas_generation_quote-corr-owner',
        input: {
          action: 'canvas_generation_quote',
          payload: request,
        },
      }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'FORBIDDEN',
    );
    await assert.rejects(
      command(
        module,
        {
          ...workerContext,
          correlationId: 'corr-other-worker',
          userId: 'other-worker',
        },
        'canvas_generation_submit',
        { ...request, quoteId: quote.quoteId },
      ),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'FORBIDDEN',
    );
    const submitted = (await command(
      module,
      workerContext,
      'canvas_generation_submit',
      { ...request, quoteId: quote.quoteId },
    )) as {
      deliverable?: { kind: string; text?: string };
      inputAssetIds: string[];
      inputNodeIds: string[];
      jobId: string;
      projectId: string;
      status: string;
    };
    assert.equal(submitted.status, 'queued');
    assert.equal(submitted.projectId, 'project-1');
    assert.equal(submitted.deliverable, null);
    assert.deepEqual(submitted.inputAssetIds, ['asset-reference-1']);
    assert.deepEqual(submitted.inputNodeIds, ['image-reference-1']);
    assert.equal(providerCalls, 0);
    const crashedClaim = await repository.claimCanvasTextGeneration({
      claimToken: 'crashed-claim',
      leaseExpiresAt: '2026-07-16T10:01:00.000Z',
      now: '2026-07-16T10:00:00.000Z',
    });
    assert.ok(crashedClaim);
    assert.equal(
      await repository.renewCanvasTextGenerationLease({
        claimToken: 'stale-claim',
        id: crashedClaim!.id,
        leaseExpiresAt: '2026-07-16T10:03:00.000Z',
      }),
      false,
    );
    assert.equal(
      await repository.renewCanvasTextGenerationLease({
        claimToken: 'crashed-claim',
        id: crashedClaim!.id,
        leaseExpiresAt: '2026-07-16T10:01:30.000Z',
      }),
      true,
    );
    assert.deepEqual(
      await repository.beginCanvasTextGenerationProviderEffect({
        claimToken: 'crashed-claim',
        effectKey: `canvas-text:${crashedClaim!.id}`,
        id: crashedClaim!.id,
      }),
      { status: 'execute' },
    );
    const crashedResult = await models.submitWithProviderEffectKey(
      crashedClaim!.submission,
      `canvas-text:${crashedClaim!.id}`,
    );
    await repository.completeCanvasTextGenerationProviderEffect({
      claimToken: 'crashed-claim',
      effectKey: `canvas-text:${crashedClaim!.id}`,
      id: crashedClaim!.id,
      result: crashedResult,
    });
    assert.equal(providerCalls, 1);
    assert.deepEqual(providerEffectKeys, [`canvas-text:${crashedClaim!.id}`]);
    const outboxWorker = new CanvasTextGenerationOutboxWorker({
      application: models,
      claimToken: () => 'claim-1',
      clock: () => new Date('2026-07-16T10:02:00.000Z'),
      repository,
    });
    const [firstRun, secondRun] = await Promise.all([
      outboxWorker.runOnce(),
      outboxWorker.runOnce(),
    ]);
    assert.deepEqual(
      [firstRun.status, secondRun.status].sort(),
      ['completed', 'idle'],
    );
    assert.equal(providerCalls, 1);
    const fetched = (await query(module, workerContext, 'canvas_generation_job', {
      jobId: submitted.jobId,
      projectId: 'project-1',
    })) as { inputAssetIds: string[]; inputNodeIds: string[]; jobId: string };
    assert.equal(fetched.jobId, submitted.jobId);
    assert.deepEqual(fetched.inputAssetIds, ['asset-reference-1']);
    assert.deepEqual(fetched.inputNodeIds, ['image-reference-1']);
    assert.deepEqual(
      (fetched as { deliverable?: unknown }).deliverable,
      { kind: 'text', text: 'Return one direction.' },
    );
    const listed = (await query(module, workerContext, 'canvas_generation_jobs', {
      projectId: 'project-1',
    })) as Array<{
      inputAssetIds: string[];
      inputNodeIds: string[];
      jobId: string;
    }>;
    assert.deepEqual(listed.map((job) => job.jobId), [submitted.jobId]);
    assert.deepEqual(listed[0]?.inputAssetIds, ['asset-reference-1']);
    assert.deepEqual(listed[0]?.inputNodeIds, ['image-reference-1']);
    assert.equal(providerCalls, 1);

    await assert.rejects(
      command(module, workerContext, 'canvas_generation_quote', {
        ...request,
        inputAssets: [{ assetId: 'mask-1', role: 'mask' }],
        inputNodeBindings: [
          { assetId: 'mask-1', nodeId: 'mask-node-1', role: 'mask' },
        ],
      }),
      /input role mask is inactive/u,
    );
    assert.equal(providerCalls, 1);

    await assert.rejects(
      command(module, workerContext, 'canvas_generation_quote', {
        ...request,
        inputNodeBindings: [
          {
            assetId: 'asset-other',
            nodeId: 'image-reference-1',
            role: 'reference_image',
          },
        ],
      }),
      /node bindings must match input assets/u,
    );

    await assert.rejects(
      command(module, workerContext, 'canvas_generation_submit', {
        ...request,
        prompt: 'Mutated after quote.',
        quoteId: quote.quoteId,
      }),
      /quote does not match/u,
    );
    await assert.rejects(
      query(module, workerContext, 'canvas_generation_job', {
        jobId: submitted.jobId,
        projectId: 'project-2',
      }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'NOT_FOUND',
    );
    assert.equal(providerCalls, 1);
  });

  it.skip('streams one Canvas text job through its durable event cursor without replaying the provider', async () => {
    class CountingCanvasTextRunner extends FixtureAiStreamingRunner {
      canvasTextStreamCalls = 0;

      override startCanvasTextStream(
        request: Parameters<FixtureAiStreamingRunner['startCanvasTextStream']>[0],
        abortSignal?: AbortSignal,
      ) {
        this.canvasTextStreamCalls += 1;
        return super.startCanvasTextStream(request, abortSignal);
      }
    }

    const { controlPlane, module, repository } = setup();
    const saveResult = repository.saveResult.bind(repository);
    let completedJobWrites = 0;
    repository.saveResult = async (workspaceId, result) => {
      if (result.status === 'completed') completedJobWrites += 1;
      await saveResult(workspaceId, result);
    };
    const context: P1Context = {
      ...owner,
      actor: 'worker',
      correlationId: 'corr-canvas-native-stream',
    };
    const request = {
      checkpointId: 'revision-1',
      count: 1,
      dataClass: [],
      inputAssets: [],
      inputNodeBindings: [],
      modelId: 'llm-openai',
      nodeId: 'text-node-1',
      operation: 'text.respond',
      parameters: {},
      projectId: 'project-1',
      prompt: '只生成一次可恢复的画布文本。',
      revisionId: 'revision-1',
    };
    const quote = (await command(
      module,
      context,
      'canvas_generation_quote',
      request,
    )) as { quoteId: string };
    const submitted = (await command(
      module,
      context,
      'canvas_generation_submit',
      { ...request, quoteId: quote.quoteId },
    )) as { jobId: string; status: string };
    assert.equal(submitted.status, 'queued');

    const runner = new CountingCanvasTextRunner();
    const firstConnection: Array<{
      sequence: number;
      type: 'delta' | 'recoverable' | 'terminal';
    }> = [];
    await controlPlane.streamCanvasTextGeneration(context, {
      afterSequence: 0,
      jobId: submitted.jobId,
      onEvent(event) {
        firstConnection.push({ sequence: event.sequence, type: event.type });
      },
      projectId: 'project-1',
      runner,
    });
    assert.equal(runner.canvasTextStreamCalls, 1);
    assert.equal(completedJobWrites, 1);
    assert.ok(firstConnection.some((event) => event.type === 'delta'));
    assert.equal(
      firstConnection.filter((event) => event.type === 'terminal').length,
      1,
    );
    assert.deepEqual(
      firstConnection.map((event) => event.sequence),
      [...firstConnection.map((event) => event.sequence)].sort((a, b) => a - b),
    );
    const completed = (await query(module, context, 'canvas_generation_job', {
      jobId: submitted.jobId,
      projectId: 'project-1',
    })) as { deliverable: { kind: string; text: string } | null; status: string };
    assert.equal(completed.status, 'completed');
    assert.deepEqual(completed.deliverable, {
      kind: 'text',
      text: `画布文本：${request.prompt}`,
    });

    const resumed: number[] = [];
    await controlPlane.streamCanvasTextGeneration(context, {
      afterSequence: firstConnection[0]!.sequence,
      jobId: submitted.jobId,
      onEvent(event) {
        resumed.push(event.sequence);
      },
      projectId: 'project-1',
      runner,
    });
    assert.equal(runner.canvasTextStreamCalls, 1);
    assert.deepEqual(
      resumed,
      firstConnection.slice(1).map((event) => event.sequence),
    );
    await assert.rejects(
      controlPlane.streamCanvasTextGeneration(
        context,
        {
          afterSequence: 0,
          jobId: submitted.jobId,
          onEvent() {},
          projectId: 'project-2',
          runner,
        },
      ),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'NOT_FOUND',
    );
    assert.equal(runner.canvasTextStreamCalls, 1);
  });

  it.skip('keeps one Canvas text producer alive across an active disconnect and another Core cursor reconnect', async () => {
    class ControlledCanvasTextRunner extends FixtureAiStreamingRunner {
      canvasTextStreamCalls = 0;
      private finish!: () => void;
      private readonly finishGate = new Promise<void>((resolve) => {
        this.finish = resolve;
      });

      override startCanvasTextStream(
        request: Parameters<FixtureAiStreamingRunner['startCanvasTextStream']>[0],
      ) {
        this.canvasTextStreamCalls += 1;
        const text = `画布文本：${request.prompt}`;
        const finishGate = this.finishGate;
        return {
          deltas: (async function* () {
            yield '已持久化的首段。';
            await finishGate;
            yield '断线后继续的尾段。';
          })(),
          result: finishGate.then(() => ({
            providerTaskRef: 'fixture-canvas-text-reconnect',
            text,
            usage: { inputTokens: 0, outputTokens: 0 },
          })),
        };
      }

      complete() {
        this.finish();
      }
    }

    const { controlPlane, models, module, repository } = setup();
    const context: P1Context = {
      ...owner,
      actor: 'worker',
      correlationId: 'corr-canvas-native-stream-reconnect',
    };
    const request = {
      checkpointId: 'revision-1',
      count: 1,
      dataClass: [],
      inputAssets: [],
      inputNodeBindings: [],
      modelId: 'llm-openai',
      nodeId: 'text-node-2',
      operation: 'text.respond',
      parameters: {},
      projectId: 'project-1',
      prompt: '断线后必须从同一个画布文本任务恢复。',
      revisionId: 'revision-1',
    };
    const quote = (await command(
      module,
      context,
      'canvas_generation_quote',
      request,
    )) as { quoteId: string };
    const submitted = (await command(
      module,
      context,
      'canvas_generation_submit',
      { ...request, quoteId: quote.quoteId },
    )) as { jobId: string };
    const runner = new ControlledCanvasTextRunner();
    let firstSequence = 0;
    let firstDelta!: () => void;
    const firstDeltaPersisted = new Promise<void>((resolve) => {
      firstDelta = resolve;
    });
    const disconnected = controlPlane
      .streamCanvasTextGeneration(context, {
        afterSequence: 0,
        jobId: submitted.jobId,
        onEvent(event) {
          if (event.type !== 'delta') return;
          firstSequence = event.sequence;
          firstDelta();
          throw new Error('browser disconnected');
        },
        projectId: 'project-1',
        runner,
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    await firstDeltaPersisted;
    const disconnectError = await disconnected;
    assert.match(String(disconnectError), /browser disconnected/u);
    assert.equal(runner.canvasTextStreamCalls, 1);

    const partial = (await query(module, context, 'canvas_generation_job', {
      jobId: submitted.jobId,
      projectId: 'project-1',
    })) as { deliverable: unknown; status: string };
    assert.notEqual(partial.status, 'completed');
    assert.equal(partial.deliverable, null);

    const remoteControlPlane = new ModelSupplyControlPlaneService({
      application: models,
      canvasProjects: canvasProjectAuthority(),
      repository,
    });
    let remoteClaimRejected!: () => void;
    const remoteClaimRejectedWhileOwned = new Promise<void>((resolve) => {
      remoteClaimRejected = resolve;
    });
    const claimById = repository.claimCanvasTextGenerationById.bind(repository);
    repository.claimCanvasTextGenerationById = async (input) => {
      const claimed = await claimById(input);
      if (!claimed) remoteClaimRejected();
      return claimed;
    };
    const resumed: Array<{
      sequence: number;
      type: 'delta' | 'recoverable' | 'terminal';
    }> = [];
    const reconnected = remoteControlPlane.streamCanvasTextGeneration(context, {
      afterSequence: firstSequence,
      jobId: submitted.jobId,
      onEvent(event) {
        resumed.push({ sequence: event.sequence, type: event.type });
      },
      projectId: 'project-1',
      runner,
    });
    await remoteClaimRejectedWhileOwned;
    assert.equal(runner.canvasTextStreamCalls, 1);
    runner.complete();
    await reconnected;
    assert.equal(runner.canvasTextStreamCalls, 1);
    assert.deepEqual(resumed.map((event) => event.sequence), [2, 3]);
    assert.deepEqual(resumed.map((event) => event.type), ['delta', 'terminal']);

    const completed = (await query(module, context, 'canvas_generation_job', {
      jobId: submitted.jobId,
      projectId: 'project-1',
    })) as {
      deliverable: { kind: string; text: string } | null;
      status: string;
    };
    assert.equal(completed.status, 'completed');
    assert.deepEqual(completed.deliverable, {
      kind: 'text',
      text: `画布文本：${request.prompt}`,
    });
  });

  it.skip('releases an idle disconnected Canvas subscriber without aborting its producer', async () => {
    class PausedCanvasTextRunner extends FixtureAiStreamingRunner {
      canvasTextStreamCalls = 0;
      receivedAbortSignal: AbortSignal | undefined;
      private finish!: () => void;
      private readonly finishGate = new Promise<void>((resolve) => {
        this.finish = resolve;
      });

      override startCanvasTextStream(
        request: Parameters<FixtureAiStreamingRunner['startCanvasTextStream']>[0],
        abortSignal?: AbortSignal,
      ) {
        this.canvasTextStreamCalls += 1;
        this.receivedAbortSignal = abortSignal;
        const text = `画布文本：${request.prompt}`;
        const finishGate = this.finishGate;
        return {
          deltas: (async function* () {
            yield '连接断开前的首段。';
            await finishGate;
            yield '连接断开后的尾段。';
          })(),
          result: finishGate.then(() => ({
            providerTaskRef: 'fixture-canvas-text-subscriber-abort',
            text,
            usage: { inputTokens: 0, outputTokens: 0 },
          })),
        };
      }

      complete() {
        this.finish();
      }
    }

    const { controlPlane, module, repository } = setup();
    const context: P1Context = {
      ...owner,
      actor: 'worker',
      correlationId: 'corr-canvas-native-stream-subscriber-abort',
    };
    const request = {
      checkpointId: 'revision-1',
      count: 1,
      dataClass: [],
      inputAssets: [],
      inputNodeBindings: [],
      modelId: 'llm-openai',
      nodeId: 'text-node-2',
      operation: 'text.respond',
      parameters: {},
      projectId: 'project-1',
      prompt: '断线只释放订阅，不停止服务端生成。',
      revisionId: 'revision-1',
    };
    const quote = (await command(
      module,
      context,
      'canvas_generation_quote',
      request,
    )) as { quoteId: string };
    const submitted = (await command(
      module,
      context,
      'canvas_generation_submit',
      { ...request, quoteId: quote.quoteId },
    )) as { jobId: string };
    let openDurableSubscriptions = 0;
    const subscribe =
      repository.subscribeCanvasTextGenerationStreamEvents.bind(repository);
    repository.subscribeCanvasTextGenerationStreamEvents = async (input) => {
      openDurableSubscriptions += 1;
      const durableSubscription = await subscribe(input);
      return {
        close: async () => {
          openDurableSubscriptions -= 1;
          await durableSubscription.close();
        },
      };
    };

    const runner = new PausedCanvasTextRunner();
    const abortController = new AbortController();
    let firstSequence = 0;
    let firstDelta!: () => void;
    const firstDeltaPersisted = new Promise<void>((resolve) => {
      firstDelta = resolve;
    });
    const disconnected = controlPlane.streamCanvasTextGeneration(context, {
      abortSignal: abortController.signal,
      afterSequence: 0,
      jobId: submitted.jobId,
      onEvent(event) {
        if (event.type !== 'delta') return;
        firstSequence = event.sequence;
        firstDelta();
      },
      projectId: 'project-1',
      runner,
    });
    await firstDeltaPersisted;
    assert.equal(openDurableSubscriptions, 1);
    abortController.abort();
    await disconnected;
    assert.equal(openDurableSubscriptions, 0);
    assert.equal(runner.receivedAbortSignal, undefined);

    const partial = (await query(module, context, 'canvas_generation_job', {
      jobId: submitted.jobId,
      projectId: 'project-1',
    })) as { deliverable: unknown; status: string };
    assert.notEqual(partial.status, 'completed');
    assert.equal(partial.deliverable, null);

    const cancelled = (await command(
      module,
      context,
      'canvas_generation_cancel',
      { jobId: submitted.jobId, projectId: 'project-1' },
    )) as { deliverable: unknown; status: string };
    assert.notEqual(cancelled.status, 'completed');
    assert.equal(cancelled.deliverable, null);

    runner.complete();
    const resumed: number[] = [];
    await controlPlane.streamCanvasTextGeneration(context, {
      afterSequence: firstSequence,
      jobId: submitted.jobId,
      onEvent(event) {
        resumed.push(event.sequence);
      },
      projectId: 'project-1',
      runner,
    });
    assert.equal(runner.canvasTextStreamCalls, 1);
    assert.deepEqual(resumed, [2, 3]);
  });

  it.skip('recovers an accepted-unknown Canvas text effect as terminal unknown without another provider call', async () => {
    class CountingCanvasTextRunner extends FixtureAiStreamingRunner {
      canvasTextStreamCalls = 0;

      override startCanvasTextStream(
        request: Parameters<FixtureAiStreamingRunner['startCanvasTextStream']>[0],
        abortSignal?: AbortSignal,
      ) {
        this.canvasTextStreamCalls += 1;
        return super.startCanvasTextStream(request, abortSignal);
      }
    }

    const { controlPlane, module, repository } = setup();
    const context: P1Context = {
      ...owner,
      actor: 'worker',
      correlationId: 'corr-canvas-native-stream-unknown',
    };
    const request = {
      checkpointId: 'revision-1',
      count: 1,
      dataClass: [],
      inputAssets: [],
      inputNodeBindings: [],
      modelId: 'llm-openai',
      nodeId: 'text-node-2',
      operation: 'text.respond',
      parameters: {},
      projectId: 'project-1',
      prompt: 'provider 接受后失联不能重新调用。',
      revisionId: 'revision-1',
    };
    const quote = (await command(
      module,
      context,
      'canvas_generation_quote',
      request,
    )) as { quoteId: string };
    const submitted = (await command(
      module,
      context,
      'canvas_generation_submit',
      { ...request, quoteId: quote.quoteId },
    )) as { jobId: string };
    const stale = await repository.claimCanvasTextGeneration({
      claimToken: 'provider-accepted-before-crash',
      leaseExpiresAt: '2026-07-23T00:01:00.000Z',
      now: '2026-07-23T00:00:00.000Z',
    });
    assert.ok(stale);
    assert.deepEqual(
      await repository.beginCanvasTextGenerationProviderEffect({
        claimToken: 'provider-accepted-before-crash',
        effectKey: `canvas-text:${stale.id}`,
        id: stale.id,
      }),
      { status: 'execute' },
    );
    await repository.releaseCanvasTextGeneration({
      claimToken: 'provider-accepted-before-crash',
      id: stale.id,
    });

    const events: Array<{
      status?: string;
      type: 'delta' | 'recoverable' | 'terminal';
    }> = [];
    const runner = new CountingCanvasTextRunner();
    await controlPlane.streamCanvasTextGeneration(context, {
      afterSequence: 0,
      jobId: submitted.jobId,
      onEvent(event) {
        events.push(
          event.type === 'terminal'
            ? { status: event.result.status, type: event.type }
            : { type: event.type },
        );
      },
      projectId: 'project-1',
      runner,
    });
    const interrupted = (await query(module, context, 'canvas_generation_job', {
      jobId: submitted.jobId,
      projectId: 'project-1',
    })) as { deliverable: unknown; status: string; usage: { status: string } };
    assert.equal(runner.canvasTextStreamCalls, 0);
    assert.equal(interrupted.status, 'queued');
    assert.equal(interrupted.deliverable, null);
    assert.equal(interrupted.usage.status, 'refunded');
    assert.equal(
      (await repository.getJob('workspace-a', submitted.jobId))?.status,
      'unknown',
    );
    assert.deepEqual(events.at(-1), { status: 'unknown', type: 'terminal' });
  });

  it.skip('emits a durable recoverable event when a Canvas producer cannot settle, then resumes the same provider effect', async () => {
    class CountingCanvasTextRunner extends FixtureAiStreamingRunner {
      canvasTextStreamCalls = 0;

      override startCanvasTextStream(
        request: Parameters<FixtureAiStreamingRunner['startCanvasTextStream']>[0],
        abortSignal?: AbortSignal,
      ) {
        this.canvasTextStreamCalls += 1;
        return super.startCanvasTextStream(request, abortSignal);
      }
    }

    const { controlPlane, module, repository } = setup();
    const context: P1Context = {
      ...owner,
      actor: 'worker',
      correlationId: 'corr-canvas-native-stream-recoverable',
    };
    const request = {
      checkpointId: 'revision-1',
      count: 1,
      dataClass: [],
      inputAssets: [],
      inputNodeBindings: [],
      modelId: 'llm-openai',
      nodeId: 'text-node-2',
      operation: 'text.respond',
      parameters: {},
      projectId: 'project-1',
      prompt: '结算异常后必须显式要求按游标恢复。',
      revisionId: 'revision-1',
    };
    const quote = (await command(
      module,
      context,
      'canvas_generation_quote',
      request,
    )) as { quoteId: string };
    const submitted = (await command(
      module,
      context,
      'canvas_generation_submit',
      { ...request, quoteId: quote.quoteId },
    )) as { jobId: string };
    const complete = repository.completeCanvasTextGeneration.bind(repository);
    let rejectSettlement = true;
    repository.completeCanvasTextGeneration = async (input) =>
      rejectSettlement ? false : complete(input);

    const firstEvents: Array<{ sequence: number; type: string }> = [];
    const runner = new CountingCanvasTextRunner();
    await controlPlane.streamCanvasTextGeneration(context, {
      afterSequence: 0,
      jobId: submitted.jobId,
      onEvent(event) {
        firstEvents.push({ sequence: event.sequence, type: event.type });
      },
      projectId: 'project-1',
      runner,
    });
    const recovery = firstEvents.at(-1);
    assert.deepEqual(recovery?.type, 'recoverable');
    assert.equal(runner.canvasTextStreamCalls, 1);
    const partial = (await query(module, context, 'canvas_generation_job', {
      jobId: submitted.jobId,
      projectId: 'project-1',
    })) as { deliverable: unknown; status: string };
    assert.notEqual(partial.status, 'completed');
    assert.equal(partial.deliverable, null);

    rejectSettlement = false;
    const resumed: Array<{ sequence: number; type: string }> = [];
    await controlPlane.streamCanvasTextGeneration(context, {
      afterSequence: recovery!.sequence,
      jobId: submitted.jobId,
      onEvent(event) {
        resumed.push({ sequence: event.sequence, type: event.type });
      },
      projectId: 'project-1',
      runner,
    });
    assert.equal(runner.canvasTextStreamCalls, 1);
    assert.deepEqual(resumed.map((event) => event.type), ['terminal']);

    const completed = (await query(module, context, 'canvas_generation_job', {
      jobId: submitted.jobId,
      projectId: 'project-1',
    })) as {
      deliverable: { kind: string; text: string } | null;
      status: string;
    };
    assert.equal(completed.status, 'completed');
    assert.deepEqual(completed.deliverable, {
      kind: 'text',
      text: `画布文本：${request.prompt}`,
    });
  });

  it.skip('retries only a safely failed Canvas job with its frozen model, parameters, and lineage', async () => {
    let providerCalls = 0;
    const frozenRequests: Array<{
      input: unknown;
      lineage: unknown;
      originRef: unknown;
      prompt: string;
      selection: unknown;
      snapshot: unknown;
    }> = [];
    const recorded = new RecordedProviderExecutionPort();
    const { models, module, repository } = setup({
      async execute(request) {
        providerCalls += 1;
        frozenRequests.push({
          input: structuredClone(request.submission.input),
          lineage: structuredClone(request.submission.lineage),
          originRef: structuredClone(request.submission.originRef),
          prompt: request.submission.prompt,
          selection: structuredClone(request.submission.selection),
          snapshot: structuredClone(request.submission.frozenRouteSnapshot),
        });
        if (providerCalls === 1) {
          return {
            acceptance: 'rejected_before_accept' as const,
            errorCode: 'TRANSIENT_PROVIDER_FAILURE',
            kind: 'failure' as const,
				message: 'Recorded transient failure before provider acceptance.',
            providerCost: { amount: 0, currency: 'USD' as const, usage: {} },
            retryable: true,
          };
        }
        return recorded.execute(request);
      },
    });
    const context: P1Context = {
      ...owner,
      actor: 'worker',
      correlationId: 'corr-canvas-retry-source',
    };
    const request = {
      checkpointId: 'revision-1',
      count: 1,
      dataClass: [],
      inputAssets: [],
      inputNodeBindings: [],
      modelId: 'llm-openai',
      nodeId: 'text-node-1',
      operation: 'text.respond',
      parameters: { maxOutputTokens: 120, temperature: 0.2 },
      projectId: 'project-1',
      prompt: 'Retry this exact campaign direction.',
      revisionId: 'revision-1',
    };
    const quote = (await command(
      module,
      context,
      'canvas_generation_quote',
      request,
    )) as { quoteId: string };
    const source = (await command(
      module,
      context,
      'canvas_generation_submit',
      { ...request, quoteId: quote.quoteId },
    )) as { jobId: string; status: string };
    assert.equal(source.status, 'queued');

    const worker = new CanvasTextGenerationOutboxWorker({
      application: models,
      claimToken: () => `canvas-retry-claim-${providerCalls}`,
      clock: () => new Date('2026-07-23T00:00:00.000Z'),
      repository,
    });
    assert.equal((await worker.runOnce()).status, 'completed');
    const failed = (await query(module, context, 'canvas_generation_job', {
      jobId: source.jobId,
      projectId: 'project-1',
    })) as {
      originRef?: {
        checkpointId: string;
        count: number;
        modelId: string;
        nodeId?: string;
        parameters: Record<string, unknown>;
        prompt: string;
      };
      retryable?: boolean;
      status: string;
      usage: { status: string };
    };
    assert.equal(failed.status, 'failed');
    assert.equal(failed.retryable, true);
    assert.equal(failed.usage.status, 'refunded');
    assert.deepEqual(failed.originRef, {
      checkpointId: 'revision-1',
      count: 1,
      modelId: 'llm-openai',
      nodeId: 'text-node-1',
      parameters: { maxOutputTokens: 120, temperature: 0.2 },
      projectId: 'project-1',
      prompt: 'Retry this exact campaign direction.',
      revisionId: 'revision-1',
      type: 'advanced_canvas_project_revision',
    });

    const storedSource = await repository.getJob('workspace-a', source.jobId);
    assert.ok(storedSource);
    assert.ok(storedSource.originRef);
    const sourceOriginRef = structuredClone(storedSource.originRef);
    const missingLineageOriginRef = structuredClone(sourceOriginRef);
    delete missingLineageOriginRef.nodeId;
    await repository.saveResult('workspace-a', {
      ...storedSource,
      originRef: missingLineageOriginRef,
    });
    await assert.rejects(
      command(
        module,
        { ...context, correlationId: 'corr-canvas-retry-missing-lineage' },
        'canvas_generation_retry',
        { jobId: source.jobId, projectId: 'project-1' },
      ),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'INVALID_STATE',
    );

    const pseudoBatchOriginRef = structuredClone(sourceOriginRef);
    pseudoBatchOriginRef.count = 2;
    await repository.saveResult('workspace-a', {
      ...storedSource,
      originRef: pseudoBatchOriginRef,
    });
    await assert.rejects(
      command(
        module,
        { ...context, correlationId: 'corr-canvas-retry-pseudo-batch' },
        'canvas_generation_retry',
        { jobId: source.jobId, projectId: 'project-1' },
      ),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'INVALID_STATE',
    );
    await repository.saveResult('workspace-a', storedSource);
    assert.equal(providerCalls, 1);

    const retryContext: P1Context = {
      ...context,
      correlationId: 'corr-canvas-retry',
    };
    const firstRetry = (await command(
      module,
      retryContext,
      'canvas_generation_retry',
      { jobId: source.jobId, projectId: 'project-1' },
    )) as { jobId: string; status: string };
    const replayedRetry = (await command(
      module,
      retryContext,
      'canvas_generation_retry',
      { jobId: source.jobId, projectId: 'project-1' },
    )) as { jobId: string; status: string };
    assert.equal(firstRetry.status, 'queued');
    assert.equal(replayedRetry.jobId, firstRetry.jobId);
    assert.equal(providerCalls, 1);

    assert.equal((await worker.runOnce()).status, 'completed');
    const completed = (await query(module, retryContext, 'canvas_generation_job', {
      jobId: firstRetry.jobId,
      projectId: 'project-1',
    })) as { status: string; usage: { status: string } };
    assert.equal(completed.status, 'completed');
    assert.equal(completed.usage.status, 'committed');
    assert.equal(providerCalls, 2);
    const firstFrozenRequest = structuredClone(frozenRequests[0]);
    const firstFrozenSnapshot = firstFrozenRequest?.snapshot as
      | {
          allowedCandidates?: Array<{
            capabilityProfile?: unknown;
          }>;
        }
      | undefined;
    for (const candidate of firstFrozenSnapshot?.allowedCandidates ?? []) {
      if (candidate.capabilityProfile === null) {
        delete candidate.capabilityProfile;
      }
    }
    assert.deepEqual(frozenRequests[1], firstFrozenRequest);

    await assert.rejects(
      command(module, retryContext, 'canvas_generation_retry', {
        jobId: firstRetry.jobId,
        projectId: 'project-1',
      }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'INVALID_STATE',
    );
    await assert.rejects(
      command(
        module,
        { ...retryContext, workspaceId: 'workspace-b' },
        'canvas_generation_retry',
        { jobId: source.jobId, projectId: 'project-1' },
      ),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'NOT_FOUND',
    );
  });

  it.skip('executes the exact deployment frozen by the Canvas quote', async () => {
    const base = createDefaultDeployments({
      activatedDeploymentIds: ['openai-direct-recorded'],
      activationEvidenceStatus: 'recorded',
    }).find((deployment) => deployment.id === 'openai-direct-recorded');
    assert.ok(base);
    const deployments = [
      {
        ...structuredClone(base),
        canvasGenerationCapabilities: [],
        id: 'openai-direct-without-canvas-capability',
      },
      base,
    ];
    let executedDeploymentId = '';
    const repository = new MemoryModelSupplyControlPlaneRepository();
    const application = new ModelSupplyApplicationService({
      deployments,
      execution: {
        async execute(request) {
          executedDeploymentId = request.deployment.id;
          return new RecordedProviderExecutionPort().execute(request);
        },
      },
      models: createDefaultCatalogModels(),
      resultSink: repository,
    });
    const controlPlane = new ModelSupplyControlPlaneService({
      application,
      fallbackCatalog: {
        payload: {
          capabilities: [],
          deployments,
          models: createDefaultCatalogModels(),
          prices: [],
          routes: [],
        },
        revisionId: 'canvas-two-deployment-catalog-v1',
      },
      canvasProjects: canvasProjectAuthority(),
      repository,
    });
    const module = new ModelSupplyFoundationModule(controlPlane);
    const context: P1Context = { ...owner, actor: 'worker' };
    const request = {
      checkpointId: 'revision-1',
      count: 1,
      dataClass: [],
      inputAssets: [],
      itemId: 'canvas-item-1',
      modelId: 'llm-openai',
      operation: 'text.respond',
      parameters: {},
      projectId: 'project-1',
      prompt: 'Return one direction.',
      revisionId: 'revision-1',
    };
    const quote = (await command(
      module,
      context,
      'canvas_generation_quote',
      request,
    )) as { deploymentId: string; quoteId: string };
    const submitted = (await command(
      module,
      context,
      'canvas_generation_submit',
      { ...request, quoteId: quote.quoteId },
    )) as { jobId: string };
    const completed = await new CanvasTextGenerationOutboxWorker({
      application,
      repository,
    }).runOnce();
    assert.equal(completed.status, 'completed');
    assert.equal(completed.jobId, submitted.jobId);

    assert.equal(quote.deploymentId, 'openai-direct-recorded');
    assert.equal(executedDeploymentId, quote.deploymentId);
    assert.equal(completed.result?.snapshot.deploymentId, quote.deploymentId);
  });

  it('allows only a trusted worker to preserve zero product usage through the generation command seam', async () => {
    const { module } = setup();
    const worker: P1Context = { ...owner, actor: 'worker' };

    await assert.rejects(
      command(module, owner, 'submit_generation', {
        dataClass: [],
        input: { durationSeconds: 15 },
        operation: 'video.generate',
        productUsageQuantity: 0,
        prompt: '用户不能跳过产品计费',
        selection: { catalogModelId: 'seedance-2', mode: 'fixed' },
      }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'FORBIDDEN',
    );

    const result = (await command(module, worker, 'submit_generation', {
      dataClass: [],
      input: { durationSeconds: 15 },
      operation: 'video.generate',
      productUsageQuantity: 0,
      prompt: '由 Canvas canonical ledger 结算的视频',
      selection: { catalogModelId: 'seedance-2', mode: 'fixed' },
    })) as { usage: { quantity: number } };

    assert.equal(result.usage.quantity, 0);
  });

  it('rejects an invalid product usage quantity before provider execution', async () => {
    let providerCalls = 0;
    const { module } = setup({
      async execute(request) {
        providerCalls += 1;
        return new RecordedProviderExecutionPort().execute(request);
      },
    });

    await assert.rejects(
      command(module, owner, 'submit_generation', {
        dataClass: [],
        input: { durationSeconds: 15 },
        operation: 'video.generate',
        productUsageQuantity: 2,
        prompt: '非法用量',
        selection: { catalogModelId: 'seedance-2', mode: 'fixed' },
      }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'INVALID_STATE',
    );
    assert.equal(providerCalls, 0);
  });

  it('keeps catalog revisions immutable after restoring them from persistence', async () => {
    const repository = new MemoryModelSupplyControlPlaneRepository();
    const registry = new CatalogRevisionRegistry();
    const draft = registry.createDraft({
      models: createDefaultCatalogModels(),
      deployments: createDefaultDeployments(),
      capabilities: [],
      prices: [],
      routes: [],
    });
    await repository.saveCatalogRevision(owner.workspaceId, draft);

    const restored = new CatalogRevisionRegistry(
      await repository.listCatalogRevisions(owner.workspaceId),
    );
    const enabled = restored.enable(draft.id);
    assert.equal(enabled.number, draft.number + 1);
    assert.equal(Object.isFrozen(enabled.payload.models), true);
  });

  it('rejects a catalog publication based on a stale head', async () => {
    const repository = new MemoryModelSupplyControlPlaneRepository();
    const registry = new CatalogRevisionRegistry();
    const publish = () => {
      const draft = registry.createDraft({
        models: createDefaultCatalogModels(),
        deployments: createDefaultDeployments(),
        capabilities: [],
        prices: [],
        routes: [],
      });
      return registry.publish(registry.enable(draft.id).id);
    };
    const first = publish();
    const stale = publish();

    const results = await Promise.allSettled(
      [first, stale].map((revision) =>
        repository.setCurrentPublishedCatalogRevision(
          owner.workspaceId,
          revision,
          null,
        ),
      ),
    );
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    const conflict = results.find((result) => result.status === 'rejected');
    assert.ok(
      conflict?.reason instanceof P1DomainError &&
        conflict.reason.code === 'IDEMPOTENCY_CONFLICT',
    );
    const current = await repository.getCurrentPublishedCatalogRevision(
      owner.workspaceId,
    );
    assert.ok([first.id, stale.id].includes(current?.id ?? ''));
    assert.equal(
      (await repository.listCatalogRevisions(owner.workspaceId)).length,
      1,
    );
  });
});

it.skip('renews the canvas text lease while a slow provider effect is in flight', async () => {
  const repository = new MemoryModelSupplyControlPlaneRepository();
  const submission = {
    actorId: 'worker-a',
    dataClass: [],
    idempotencyKey: 'slow-provider-effect',
    operation: 'copy.generate' as const,
    prompt: 'Write one direction.',
    selection: { catalogModelId: 'llm-domestic', mode: 'fixed' as const },
    workspaceId: 'workspace-a',
  };
  await repository.enqueueCanvasTextGeneration(
    'workspace-a',
    { jobId: 'queued-job' } as ModelSupplyResult,
    {
      createdAt: new Date().toISOString(),
      id: 'slow-outbox',
      status: 'pending',
      submission,
      workspaceId: 'workspace-a',
    },
  );
  let renewals = 0;
  const renew = repository.renewCanvasTextGenerationLease.bind(repository);
  repository.renewCanvasTextGenerationLease = async (input) => {
    renewals += 1;
    return renew(input);
  };
  const application = {
    async submitWithProviderEffectKey() {
      await new Promise((resolve) => setTimeout(resolve, 35));
      return { jobId: 'completed-job' } as ModelSupplyResult;
    },
  } as unknown as ModelSupplyApplicationService;
  const worker = new CanvasTextGenerationOutboxWorker({
    application,
    heartbeatMs: 5,
    leaseMs: 20,
    repository,
  });

  assert.equal((await worker.runOnce()).status, 'completed');
  assert.ok(renewals >= 1);
});

function canvasProjectAuthority() {
  return {
    async getProject(workspaceId: string, projectId: string) {
      return workspaceId === owner.workspaceId && projectId === 'project-1'
        ? { id: projectId }
        : null;
    },
    async getRevision(
      workspaceId: string,
      projectId: string,
      revisionId: string,
    ) {
      return workspaceId === owner.workspaceId &&
        projectId === 'project-1' &&
        revisionId === 'revision-1'
        ? { id: revisionId }
        : null;
    },
  };
}
