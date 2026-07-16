import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelSupplyApplicationService } from './index.js';
import {
  directModelConfigurationRevisionFromEnv,
  modelRuntimeAssemblyFromEnv,
} from './runtime-config.js';

const requiredEnvironment = [
  'MODEL_DIRECT_CATALOG_MODEL_ID',
  'MODEL_DIRECT_BASE_URL',
  'MODEL_DIRECT_API_KEY',
  'MODEL_DIRECT_MODEL',
  'MODEL_DIRECT_CREDENTIAL_VERSION',
  'MODEL_DIRECT_ENDPOINT_REVISION',
  'MODEL_DIRECT_INPUT_COST_PER_MILLION',
  'MODEL_DIRECT_OUTPUT_COST_PER_MILLION',
] as const;
const missingEnvironment = requiredEnvironment.filter(
  (name) => !process.env[name]?.trim()
);
const liveSkip =
  process.env.RUN_LIVE_MODEL_PROVIDER_TEST !== '1'
    ? 'RUN_LIVE_MODEL_PROVIDER_TEST=1 is required because this test spends provider quota'
    : missingEnvironment.length > 0
      ? `missing live provider environment: ${missingEnvironment.join(', ')}`
      : false;

test(
  'live direct LLM returns three materially different grounded candidates',
  { skip: liveSkip, timeout: 2 * 60 * 1_000 },
  async () => {
    const assembly = modelRuntimeAssemblyFromEnv({
      ...process.env,
      MODEL_EXECUTION_MODE: 'direct',
    });
    const catalogModelId = process.env.MODEL_DIRECT_CATALOG_MODEL_ID ?? '';
    const probeDeployment = assembly.deployments.find(
      (deployment) => deployment.catalogModelId === catalogModelId
    );
    assert.ok(probeDeployment, 'configured live probe deployment is missing');
    const service = new ModelSupplyApplicationService({
      models: assembly.models,
      deployments: assembly.deployments,
      execution: assembly.runtime.execution,
      runtimeCapabilities: assembly.runtimeCapabilities,
    });
    const result = await service.executeCopyQualityProbe({
      workspaceId: 'live-model-activation',
      actorId: 'staging-verifier',
      idempotencyKey: `live-copy-${Date.now()}`,
      operation: 'copy.generate',
      selection: { mode: 'fixed', catalogModelId },
      dataClass: [],
      prompt: JSON.stringify({
        brief: {
          hook: '下班后想做一次节奏清楚的日常护理',
          platform: 'xiaohongshu',
          scenario: '项目种草',
        },
        grounding: {
          city: '成都',
          name: '椿屿皮肤管理',
          project: '基础补水护理',
          price: 299,
        },
        instructions: {
          candidateCount: 3,
          preserveFacts: true,
          prohibitInventedPrices: true,
          requireMaterialDifferences: true,
        },
      }),
    });

    assert.equal(result.snapshot.actualCatalogModelId, catalogModelId);
    assert.equal(
      result.snapshot.allowedCandidates?.[0]?.deploymentStatus,
      'inactive'
    );
    assert.equal(result.copyCandidates?.length, 3);
    const rendered = (result.copyCandidates ?? []).map((candidate) =>
      `${candidate.title}\n${candidate.body}\n${candidate.conversionHook}`
        .replace(/\s+/g, ' ')
        .trim()
    );
    assert.equal(new Set(rendered).size, 3);
    assert.ok(
      rendered.every(
        (candidate) =>
          candidate.includes('椿屿皮肤管理') &&
          candidate.includes('基础补水护理')
      )
    );
    assert.ok(rendered.some((candidate) => candidate.includes('299')));
    assert.ok((result.providerCost.usage.inputTokens ?? 0) > 0);
    assert.ok((result.providerCost.usage.outputTokens ?? 0) > 0);
    assert.ok(result.providerCost.amount >= 0);
    process.stdout.write(
      `${JSON.stringify({
        catalogModelId,
        inputTokens: result.providerCost.usage.inputTokens,
        outputTokens: result.providerCost.usage.outputTokens,
        providerCost: result.providerCost.amount,
        providerModel: result.snapshot.providerModel,
      })}\n`
    );
    process.stdout.write(
      `MODEL_DIRECT_ACTIVATION_CONFIGURATION_REVISION=${directModelConfigurationRevisionFromEnv(process.env)}\n`
    );
  }
);
