import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { P1DomainError, type P1Context } from '../foundation/domain.js';
import {
  CatalogRevisionRegistry,
  createDefaultCatalogModels,
  createDefaultDeployments,
} from './catalog.js';
import {
  MemoryModelSupplyControlPlaneRepository,
  CanvasTextGenerationOutboxWorker,
  ModelSupplyControlPlaneService,
  ModelSupplyFoundationModule,
  RECORDED_CATALOG_REVISION_ID,
  type ActivationProbeExecutionPort,
} from './foundation-module.js';
import {
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
  type MediaProviderLifecyclePort,
  type ProviderExecutionPort,
  type ReferenceAssetResolverPort,
} from './index.js';
import { RecordedAdapterRouter } from './adapters.js';
import { MediaActivationProbeExecutor } from './activation-probe-executor.js';
import { modelRuntimeAssemblyFromEnv } from './runtime-config.js';
import { MemoryAdminConfigRepository } from '../admin-config/foundation-module.js';

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
) {
  const repository = new MemoryModelSupplyControlPlaneRepository();
  const activationEvidenceConfig = new MemoryAdminConfigRepository();
  const models = new ModelSupplyApplicationService({
    models: createDefaultCatalogModels(),
    deployments: createDefaultDeployments({
      activatedDeploymentIds: ['openai-direct-recorded'],
      activationEvidenceStatus: 'recorded',
    }),
    execution,
    ...(referenceAssets ? { referenceAssets } : {}),
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
    },
    canvasProjects: canvasProjectAuthority(),
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

async function query(
  module: ModelSupplyFoundationModule,
  context: P1Context,
  action: string,
  payload: Record<string, unknown>,
) {
  return module.query({ context, input: { action, payload } });
}

describe('ModelSupplyFoundationModule', () => {
  it('replays each language probe and activates only after complete operation coverage', async () => {
    let providerCalls = 0;
    const setupResult = setup(
      {
        async execute(request) {
          providerCalls += 1;
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
    const { module, models } = setup({
      async execute() {
        providerCalls += 1;
        throw new Error('route simulation must not execute a provider');
      },
    });

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
    assert.equal(JSON.stringify(view).includes('channel'), false);
    assert.equal(JSON.stringify(view).includes('credential'), false);
    assert.equal(JSON.stringify(view).includes('endpoint'), false);
    assert.equal(JSON.stringify(view).includes('live_verified'), false);
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
      await nonFixtureControlPlane.getCanvasGenerationCatalog(owner.workspaceId);
    assert.equal(
      nonFixtureCatalog.operations.find(
        (operation) => operation.operation === 'audio.speech',
      )?.usageAmount,
      1,
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
      prices: [{ id: 'image-price-v2', currency: 'CNY' as const, amount: 1, revision: 2 }],
      routes: [{ id: 'image-route-v2', operation: 'image.generate', revision: 2 }],
    };

    await assert.rejects(
      command(module, owner, 'catalog_create_draft', { catalog: payload }),
      (error: unknown) => error instanceof P1DomainError && error.code === 'FORBIDDEN',
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
          { id: 'copy-price-v1', currency: 'CNY', amount: 1, revision: 1 },
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
          { id: 'copy-price-v2', currency: 'CNY', amount: 2, revision: 2 },
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
      })) as { failureCode?: string; status: string; usage: { status: string } };
    assert.equal(result.status, 'failed');
    assert.equal(result.failureCode, 'REFERENCE_ASSET_RESOLVER_INACTIVE');
    assert.equal(result.usage.status, 'refunded');
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
      async inspect() { return []; },
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

  it('exposes a fixed Canvas catalog, quote, submit, get, and project-list contract', async () => {
    let providerCalls = 0;
    const { models, module, repository } = setup({
      async execute(request) {
        providerCalls += 1;
        return new RecordedProviderExecutionPort().execute(request);
      },
    });
    const workerContext: P1Context = { ...owner, actor: 'worker' };
    const request = {
      dataClass: [],
      inputAssets: [],
      modelId: 'llm-openai',
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
      jobId: string;
      projectId: string;
      status: string;
    };
    assert.equal(submitted.status, 'queued');
    assert.equal(submitted.projectId, 'project-1');
    assert.equal(submitted.deliverable, null);
    assert.equal(providerCalls, 0);
    const crashedClaim = await repository.claimCanvasTextGeneration({
      claimToken: 'crashed-claim',
      leaseExpiresAt: '2026-07-16T10:01:00.000Z',
      now: '2026-07-16T10:00:00.000Z',
    });
    assert.ok(crashedClaim);
    await models.submit(crashedClaim!.submission);
    assert.equal(providerCalls, 1);
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
    })) as { jobId: string };
    assert.equal(fetched.jobId, submitted.jobId);
    assert.deepEqual(
      (fetched as { deliverable?: unknown }).deliverable,
      { kind: 'text', text: 'Return one direction.' },
    );
    const listed = (await query(module, workerContext, 'canvas_generation_jobs', {
      projectId: 'project-1',
    })) as Array<{ jobId: string }>;
    assert.deepEqual(listed.map((job) => job.jobId), [submitted.jobId]);
    assert.equal(providerCalls, 1);

    await assert.rejects(
      command(module, workerContext, 'canvas_generation_quote', {
        ...request,
        inputAssets: [{ assetId: 'mask-1', role: 'mask' }],
      }),
      /input role mask is inactive/u,
    );
    assert.equal(providerCalls, 1);

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

  it('executes the exact deployment frozen by the Canvas quote', async () => {
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
      dataClass: [],
      inputAssets: [],
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
