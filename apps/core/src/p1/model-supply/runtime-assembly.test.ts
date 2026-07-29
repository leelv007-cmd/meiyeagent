import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createDefaultCapabilityRevisions,
  createDefaultExecutionChannels,
  createDefaultPriceRevisions,
  createDefaultProviderProfiles,
  createDefaultRouteRevisions,
} from './catalog.js';
import {
  MemoryModelSupplyControlPlaneRepository,
  type ModelSupplyPlanningControlPlanePort,
} from './foundation-module.js';
import { MemoryHealthOverlayPort } from '../supply-registry/health-overlay.js';
import type { RankingCandidateInput } from '../supply-registry/three-layer-ranking.js';
import { createModelSupplyRuntime } from './runtime-assembly.js';
import {
  modelRuntimeAssemblyFromEnv,
  type ModelRuntimeAssembly,
} from './runtime-config.js';

function assemble(
  catalog: ModelRuntimeAssembly,
  planningControlPlane?: ModelSupplyPlanningControlPlanePort,
) {
  const repository = new MemoryModelSupplyControlPlaneRepository();
  return createModelSupplyRuntime({
    application: {
      execution: catalog.runtime.execution,
      resultSink: repository,
    },
    catalog,
    controlPlane: { repository, planningControlPlane },
  });
}

function freshRankingInput(
  deployment: ModelRuntimeAssembly['deployments'][number],
  amountMicros: number,
): RankingCandidateInput {
  const observedAt = new Date().toISOString();
  const evidence = (value?: number) => ({
    observedAt,
    sampleSize: 20,
    status: 'fresh' as const,
    ...(value === undefined ? {} : { value }),
  });
  return {
    deploymentId: deployment.id,
    deployment,
    quality: {
      activationEvidence: { ...evidence(), kind: 'activation_evidence' },
      conformance: { ...evidence(), kind: 'conformance' },
      mappingTrust: { ...evidence(), kind: 'mapping_trust' },
      versionedQualityBaseline: {
        ...evidence(),
        kind: 'versioned_quality_baseline',
      },
      successRate: { ...evidence(0.99), kind: 'success_rate' },
      p95: { ...evidence(500), kind: 'p95' },
      acceptanceCompleteness: {
        ...evidence(1),
        kind: 'acceptance_completeness',
      },
    },
    health: { capacityHeadroom: 1, healthState: 'healthy' as const },
    cost: {
      amountMicros,
      currency: 'USD' as const,
      source: 'observed_usage' as const,
    },
  };
}

test('production processes inject durable ProductUsage into the bilateral supply ledger', async () => {
  for (const entrypoint of ['main.ts', 'job-worker.ts']) {
    const source = await readFile(
      new URL(`../../${entrypoint}`, import.meta.url),
      'utf8',
    );
    assert.match(
      source,
      /new FoundationModelSupplyLedger\([\s\S]*?\{[\s\S]*?billingLifecycle,[\s\S]*?productUsage: billingLifecycle,[\s\S]*?supplyFreezes: supplyFreezeStore,/,
      `${entrypoint} must inject the shared durable billing service as ProductUsage lookup`,
    );
  }
});

test('runtime assembly gives every process the complete fallback catalog', async () => {
  const catalog = modelRuntimeAssemblyFromEnv({
    APP_ENV: 'e2e',
    MODEL_EXECUTION_MODE: 'fixture',
  });
  const runtime = assemble(catalog);

  assert.deepEqual(
    runtime.fallbackCatalog.payload.capabilities,
    createDefaultCapabilityRevisions(),
  );
  assert.deepEqual(
    runtime.fallbackCatalog.payload.executionChannels,
    createDefaultExecutionChannels(),
  );
  assert.deepEqual(
    runtime.fallbackCatalog.payload.prices,
    createDefaultPriceRevisions(),
  );
  assert.deepEqual(
    runtime.fallbackCatalog.payload.providerProfiles,
    createDefaultProviderProfiles(),
  );
  assert.deepEqual(
    runtime.fallbackCatalog.payload.routes,
    createDefaultRouteRevisions(),
  );
  assert.deepEqual(
    runtime.fallbackCatalog.payload.deployments,
    catalog.deployments,
  );
  assert.deepEqual(runtime.fallbackCatalog.payload.models, catalog.models);
  assert.ok(runtime.fallbackCatalog.payload.capabilities.length > 0);
  assert.ok(runtime.fallbackCatalog.payload.executionChannels.length > 0);
  assert.ok(runtime.fallbackCatalog.payload.prices.length > 0);
  assert.ok(runtime.fallbackCatalog.payload.providerProfiles.length > 0);
  assert.ok(runtime.fallbackCatalog.payload.routes.length > 0);

  const adminView = await runtime.controlPlane.getAdminCatalogControl(
    'workspace-runtime-assembly',
  );
  assert.equal(
    adminView.catalog.capabilities.length,
    createDefaultCapabilityRevisions().length,
  );
  assert.equal(
    adminView.catalog.executionChannels.length,
    createDefaultExecutionChannels().length,
  );
  assert.equal(
    adminView.catalog.providerProfiles.length,
    createDefaultProviderProfiles().length,
  );
  assert.equal(
    adminView.catalog.prices.length,
    createDefaultPriceRevisions().length,
  );
  assert.equal(
    adminView.catalog.routes.length,
    createDefaultRouteRevisions().length,
  );
});

test('runtime assembly derives activation probe deployments from the runtime catalog', () => {
  const catalog = modelRuntimeAssemblyFromEnv({
    MODEL_DIRECT_API_KEY: 'configured-secret',
    MODEL_DIRECT_BASE_URL: 'https://openai.example.test/v1',
    MODEL_DIRECT_CATALOG_MODEL_ID: 'llm-openai',
    MODEL_DIRECT_CREDENTIAL_VERSION: 'openai-key-v1',
    MODEL_DIRECT_ENDPOINT_REVISION: 'openai-v1',
    MODEL_DIRECT_INPUT_COST_PER_MILLION: '1',
    MODEL_DIRECT_MODEL: 'gpt-test',
    MODEL_DIRECT_OUTPUT_COST_PER_MILLION: '2',
    MODEL_EXECUTION_MODE: 'direct',
  });
  const runtime = assemble(catalog);

  assert.deepEqual(
    runtime.activationProbeLiveDeploymentIds,
    catalog.deployments
      .filter((deployment) => deployment.catalogModelId === 'llm-openai')
      .map((deployment) => deployment.id),
  );
});

test('new submissions reload the effective capability head without process restart', async () => {
  const catalog = modelRuntimeAssemblyFromEnv({
    APP_ENV: 'e2e',
    MODEL_EXECUTION_MODE: 'fixture',
  });
  const runtime = assemble(catalog);
  const model = catalog.models.find((candidate) =>
    candidate.operations.includes('copy.generate'),
  );
  assert.ok(model);
  const boot = await runtime.capabilityHotAssembly.getEffectiveRevision();
  assert.ok(boot);

  await runtime.capabilityHotAssembly.applyCapabilityRevision({
    ...boot,
    revisionId: 'capability-head-empty',
    number: boot.number + 1,
    previousRevisionId: boot.revisionId,
    entries: [],
  });
  await assert.rejects(
    runtime.application.submit({
      workspaceId: 'workspace-hot-head',
      actorId: 'owner-a',
      idempotencyKey: 'submit-blocked-by-head',
      operation: 'copy.generate',
      selection: { mode: 'fixed', catalogModelId: model.id },
      dataClass: [],
      prompt: '生成三条美业文案',
    }),
    /not active|No active deployment/,
  );

  await runtime.capabilityHotAssembly.applyCapabilityRevision({
    ...boot,
    revisionId: 'capability-head-restored',
    number: boot.number + 2,
    previousRevisionId: 'capability-head-empty',
  });
  const result = await runtime.application.submit({
    workspaceId: 'workspace-hot-head',
    actorId: 'owner-a',
    idempotencyKey: 'submit-after-head-restore',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: model.id },
    dataClass: [],
    prompt: '生成三条美业文案',
  });
  assert.equal(result.status, 'completed');
});

test('provider execution receives the request-time capability binding', async () => {
  const catalog = modelRuntimeAssemblyFromEnv({
    APP_ENV: 'e2e',
    MODEL_EXECUTION_MODE: 'fixture',
  });
  const runtime = assemble(catalog);
  const originalAssemble =
    runtime.capabilityHotAssembly.assembleForRequest.bind(
      runtime.capabilityHotAssembly,
    );
  let assembledRequest:
    | Parameters<typeof originalAssemble>[0]
    | undefined;
  runtime.capabilityHotAssembly.assembleForRequest = async (request) => {
    assembledRequest = request;
    return originalAssemble(request);
  };
  const originalExecute = runtime.application.execution.execute.bind(
    runtime.application.execution,
  );
  let executionBinding: unknown;
  runtime.application.execution.execute = async (request) => {
    executionBinding = request.runtimeBinding;
    return originalExecute(request);
  };
  const model = catalog.models.find((candidate) =>
    candidate.operations.includes('copy.generate'),
  );
  assert.ok(model);

  const result = await runtime.application.submit({
    workspaceId: 'workspace-request-binding',
    actorId: 'owner-a',
    idempotencyKey: 'submit-request-binding',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: model.id },
    dataClass: [],
    prompt: '生成三条美业文案',
  });

  assert.equal(result.status, 'completed');
  assert.ok(assembledRequest);
  assert.equal(assembledRequest.requiredScope, 'platform');
  assert.equal(
    (executionBinding as { capabilityRevisionId?: string } | undefined)
      ?.capabilityRevisionId,
    (await runtime.capabilityHotAssembly.getEffectiveRevisionId()) ?? undefined,
  );
});

test('durable media effects receive the request-time capability binding', async () => {
  const catalog = modelRuntimeAssemblyFromEnv({
    APP_ENV: 'e2e',
    MODEL_EXECUTION_MODE: 'fixture',
  });
  const runtime = assemble(catalog);
  const originalAssemble =
    runtime.capabilityHotAssembly.assembleForRequest.bind(
      runtime.capabilityHotAssembly,
    );
  let assembledRequest:
    | Parameters<typeof originalAssemble>[0]
    | undefined;
  runtime.capabilityHotAssembly.assembleForRequest = async (input) => {
    assembledRequest = input;
    return originalAssemble(input);
  };
  const model = catalog.models.find((candidate) =>
    candidate.operations.includes('image.generate'),
  );
  assert.ok(model);
  const frozenRouteSnapshot = runtime.application.freezeFixedRoute({
    workspaceId: 'workspace-media-request-binding',
    operation: 'image.generate',
    catalogModelId: model.id,
    dataClass: [],
  });
  assert.deepEqual(
    frozenRouteSnapshot.allowedCandidates?.[0]?.capabilityProfile?.modalities,
    [
      {
        mime: 'image/*',
        supported: true,
        basis: 'inferred',
        evidenceRef: `catalog-model:${model.id}:modality:image/*`,
      },
    ],
  );

  const request = await runtime.application.mediaProviderRequestForExecution({
    workspaceId: 'workspace-media-request-binding',
    actorId: 'owner-a',
    idempotencyKey: 'media-request-binding',
    operation: 'image.generate',
    selection: { mode: 'fixed', catalogModelId: model.id },
    dataClass: [],
    prompt: 'Generate an image',
    frozenRouteSnapshot,
  });

  assert.equal(request.deployment.catalogModelId, model.id);
  assert.equal(
    request.runtimeBinding?.capabilityRevisionId,
    (await runtime.capabilityHotAssembly.getEffectiveRevisionId()) ?? undefined,
  );
  assert.equal(
    assembledRequest?.frozenCredentialVersion,
    frozenRouteSnapshot.credentialVersion,
  );
});

test('real submit uses route policy, health overlay, and three-layer ranking then freezes the decision', async () => {
  const catalog = modelRuntimeAssemblyFromEnv({
    APP_ENV: 'e2e',
    MODEL_EXECUTION_MODE: 'fixture',
  });
  const candidates = catalog.deployments.filter((deployment) =>
    catalog.models
      .find((model) => model.id === deployment.catalogModelId)
      ?.operations.includes('copy.generate'),
  );
  const primary = candidates.find(
    (deployment) => deployment.id === 'openai-direct-recorded',
  );
  const selected = candidates.find(
    (deployment) => deployment.id === 'anthropic-direct-recorded',
  );
  assert.ok(primary);
  assert.ok(selected);

  const healthOverlay = new MemoryHealthOverlayPort();
  await healthOverlay.upsert({
    targetKind: 'deployment',
    targetId: primary.id,
    state: 'cooldown',
    reason: 'provider_5xx_threshold',
    source: 'provider_runtime',
    startedAt: new Date().toISOString(),
  });
  let reads = 0;
  const planningControlPlane: ModelSupplyPlanningControlPlanePort = {
    async readPlanningState(input) {
      reads += 1;
      assert.equal(input.operation, 'copy.generate');
      assert.equal(input.qualityTier, 'quality');
      return {
        routePolicyRevisionId: 'route-policy:copy.generate:quality:r9',
        routePolicy: {
          operation: 'copy.generate',
          qualityTier: 'quality',
          hardConstraints: ['deployment_active', 'data_class'],
          candidateDeploymentIds: [primary.id, selected.id],
          maxAttempts: 1,
          fallbackAuthorized: false,
          modelSubstitutionDegradationSurfaces: {
            [selected.id]: ['tone_consistency'],
          },
        },
        healthOverlay,
        dataPolicyByDeploymentId: new Map([
          [
            selected.id,
            {
              deploymentId: selected.id,
              dataPolicyRevisionId: 'data-policy:anthropic:r4',
              dataPolicy: {
                sourceTrustLevel: 'contract_attested',
                processingRegion: 'overseas',
                allowedDataClasses: ['public'],
              },
            },
          ],
        ]),
        rankingInputsByDeploymentId: new Map([
          [primary.id, freshRankingInput(primary, 30_000)],
          [selected.id, freshRankingInput(selected, 10_000)],
        ]),
      };
    },
  };
  const runtime = assemble(catalog, planningControlPlane);

  const result = await runtime.application.submit({
    workspaceId: 'workspace-durable-planning',
    actorId: 'owner-a',
    idempotencyKey: 'submit-durable-planning',
    operation: 'copy.generate',
    selection: {
      mode: 'auto',
      profile: 'quality',
      fallbackConsent: true,
    },
    dataClass: [],
    prompt: '生成三条美业文案',
  });

  assert.equal(reads, 1);
  assert.equal(result.status, 'completed');
  assert.equal(result.snapshot.deploymentId, selected.id);
  assert.equal(
    result.snapshot.routePolicyRevisionId,
    'route-policy:copy.generate:quality:r9',
  );
  assert.equal(result.snapshot.policyRevision, 'route-policy:copy.generate:quality:r9');
  assert.equal(result.snapshot.dataPolicyRevisionId, 'data-policy:anthropic:r4');
  assert.deepEqual(
    result.snapshot.allowedCandidates?.find(
      (candidate) => candidate.deploymentId === selected.id,
    )?.fallbackDegradationSurfaces,
    ['tone_consistency'],
  );
  assert.deepEqual(result.snapshot.runtimeExclusionReasons, [
    `${primary.id}:health_overlay_blocking`,
  ]);
  assert.equal(result.snapshot.decisionExplanation?.surface, 'task_audit');
  assert.deepEqual(
    result.snapshot.decisionExplanation?.acceptanceBranch,
    {
      acceptance: 'accepted',
      decision: 'complete',
      reason: 'provider_completed',
      primaryDeploymentId: selected.id,
    },
  );
  assert.deepEqual(
    result.snapshot.decisionExplanation?.sort.layerOrder,
    [
      'quality_reliability_gate',
      'health_capacity_guardrail',
      'cost_optimization',
    ],
  );
});

test('real submit fails closed before provider execution when durable DataPolicy excludes every candidate', async () => {
  const catalog = modelRuntimeAssemblyFromEnv({
    APP_ENV: 'e2e',
    MODEL_EXECUTION_MODE: 'fixture',
  });
  const deployment = catalog.deployments.find(
    (candidate) => candidate.id === 'openai-direct-recorded',
  );
  assert.ok(deployment);
  const planningControlPlane: ModelSupplyPlanningControlPlanePort = {
    async readPlanningState() {
      return {
        routePolicyRevisionId: 'route-policy:copy.generate:quality:r10',
        routePolicy: {
          operation: 'copy.generate',
          qualityTier: 'quality',
          hardConstraints: ['deployment_active', 'data_class'],
          candidateDeploymentIds: [deployment.id],
          maxAttempts: 1,
          fallbackAuthorized: false,
        },
        dataPolicyByDeploymentId: new Map([
          [
            deployment.id,
            {
              deploymentId: deployment.id,
              dataPolicyRevisionId: 'data-policy:public-only:r2',
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
  const runtime = assemble(catalog, planningControlPlane);
  let executions = 0;
  const originalExecute = runtime.application.execution.execute.bind(
    runtime.application.execution,
  );
  runtime.application.execution.execute = async (request) => {
    executions += 1;
    return originalExecute(request);
  };

  await assert.rejects(
    runtime.application.submit({
      workspaceId: 'workspace-data-policy-fail-closed',
      actorId: 'owner-a',
      idempotencyKey: 'submit-data-policy-fail-closed',
      operation: 'copy.generate',
      selection: {
        mode: 'auto',
        profile: 'quality',
        fallbackConsent: true,
      },
      dataClass: ['contains_face'],
      prompt: '使用人像生成美业文案',
    }),
    /No compliant deployment satisfies the published route and data policy/,
  );
  assert.equal(executions, 0);
});

test('task-audit explanation records the observed safe fallback branch', async () => {
  const catalog = modelRuntimeAssemblyFromEnv({
    APP_ENV: 'e2e',
    MODEL_EXECUTION_MODE: 'fixture',
  });
  const primaryId = 'deepseek-v4-pro-direct';
  const fallbackId = 'deepseek-v4-flash-direct';
  const planningControlPlane: ModelSupplyPlanningControlPlanePort = {
    async readPlanningState() {
      return {
        routePolicyRevisionId: 'route-policy:copy.generate:quality:r11',
        routePolicy: {
          operation: 'copy.generate',
          qualityTier: 'quality',
          hardConstraints: ['deployment_active', 'data_class'],
          candidateDeploymentIds: [primaryId, fallbackId],
          maxAttempts: 2,
          fallbackAuthorized: true,
          modelSubstitutionDegradationSurfaces: {
            [fallbackId]: ['latency_profile'],
          },
        },
      };
    },
  };
  const runtime = assemble(catalog, planningControlPlane);
  const originalExecute = runtime.application.execution.execute.bind(
    runtime.application.execution,
  );
  let executions = 0;
  runtime.application.execution.execute = async (request) => {
    executions += 1;
    if (executions === 1) {
      return {
        kind: 'failure',
        acceptance: 'rejected_before_accept',
        message: 'primary rejected before accept',
        providerCost: { amount: 0, currency: 'USD', usage: {} },
      };
    }
    return originalExecute(request);
  };

  const result = await runtime.application.submit({
    workspaceId: 'workspace-observed-fallback',
    actorId: 'owner-a',
    idempotencyKey: 'submit-observed-fallback',
    operation: 'copy.generate',
    selection: {
      mode: 'auto',
      profile: 'quality',
      fallbackConsent: true,
    },
    dataClass: [],
    prompt: '生成三条美业文案',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.attempts.length, 2);
  assert.deepEqual(
    result.snapshot.decisionExplanation?.acceptanceBranch,
    {
      acceptance: 'accepted',
      decision: 'safe_auto_fallback',
      reason: 'provider_completed_after_safe_auto_fallback',
      primaryDeploymentId: primaryId,
      fallbackDeploymentId: fallbackId,
    },
  );
});
