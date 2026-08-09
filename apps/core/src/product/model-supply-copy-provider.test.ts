import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDefaultCatalogModels,
  createDefaultDeployments,
  createDefaultPriceRevisions,
} from '../p1/model-supply/catalog.js';
import {
  MemoryModelSupplyControlPlaneRepository,
  ModelSupplyControlPlaneService,
} from '../p1/model-supply/foundation-module.js';
import {
  ModelSupplyApplicationService,
  ProductCopyProviderBridge,
  RecordedProviderExecutionPort,
} from '../p1/model-supply/index.js';
import { modelSupplyCheckpointToFoundationRoute } from '../p1/route-snapshot-normalize.js';
import type { CopyProviderRequest } from './copy-provider.js';
import { pinnedPromptResolver } from '../p1/model-supply/prompt-pin.testing.js';
import {
  ModelSupplyProductCopyProvider,
  resolveCanonicalCopySelection,
} from './model-supply-copy-provider.js';

test('domestic copy slot resolves to a domestic deployment with CNY route evidence', () => {
  const domesticCopyCatalogModelId = 'deepseek-v4-pro';
  const model = createDefaultCatalogModels().find(
    (candidate) => candidate.id === domesticCopyCatalogModelId,
  );
  const deployment = createDefaultDeployments().find(
    (candidate) => candidate.catalogModelId === domesticCopyCatalogModelId,
  );
  const price = createDefaultPriceRevisions().find(
    (candidate) => candidate.catalogModelId === domesticCopyCatalogModelId,
  );
  assert.ok(model);
  assert.ok(deployment);
  assert.equal(deployment.region, 'domestic');
  assert.equal(price?.currency, 'CNY');

  const checkpoint = modelSupplyCheckpointToFoundationRoute({
    snapshot: {
      id: 'route-domestic-copy',
      catalogRevisionId: 'catalog-default',
      requestedSelection: {
        mode: 'fixed',
        catalogModelId: domesticCopyCatalogModelId,
      },
      candidateCatalogModelIds: [domesticCopyCatalogModelId],
      actualCatalogModelId: domesticCopyCatalogModelId,
      deploymentId: deployment.id,
      reason: 'fixed_selection',
      dataClass: ['pii'],
      createdAt: '2026-07-25T00:00:00.000Z',
    },
    model,
    deployment,
    submission: {
      selection: {
        mode: 'fixed',
        catalogModelId: domesticCopyCatalogModelId,
      },
      dataClass: ['pii'],
    },
    ordinal: 1,
    revisionMode: 'recorded_harness',
  });
  assert.equal(checkpoint.allowedCandidates[0]?.region, 'cn');
  assert.equal(checkpoint.allowedCandidates[0]?.currency, 'CNY');
});

test('copy uses the canonical platform default when the merchant chose none', () => {
  assert.deepEqual(
    resolveCanonicalCopySelection({
      favorites: [],
      platformDefault: 'llm-domestic',
      recent: [],
    }),
    { catalogModelId: 'llm-domestic', mode: 'fixed' },
  );
});

test('copy fails closed when no canonical default is configured', () => {
  assert.throws(
    () =>
      resolveCanonicalCopySelection({
        favorites: [],
        recent: [],
      }),
    /No canonical copy model is configured/u,
  );
});

test('prompt-head rollback changes only future copy generation evidence', async () => {
  const repository = new MemoryModelSupplyControlPlaneRepository();
  const models = new ModelSupplyApplicationService({
    promptResolver: pinnedPromptResolver,
    models: createDefaultCatalogModels(),
    deployments: createDefaultDeployments({
      activatedDeploymentIds: ['openai-direct-recorded'],
    }),
    execution: new RecordedProviderExecutionPort(),
  });
  const controlPlane = new ModelSupplyControlPlaneService({
    application: models,
    repository,
  });
  const provider = new ModelSupplyProductCopyProvider(
    new ProductCopyProviderBridge(models, async (workspaceId) => {
      await controlPlane.initialize(workspaceId);
    }),
    { catalogModelId: 'llm-openai', mode: 'fixed' },
    'overseas',
    undefined,
    (request) => controlPlane.getPromptRevision(request.workspaceId),
  );
  const request: CopyProviderRequest = {
    workspaceId: 'workspace-a',
    userId: 'owner-a',
    idempotencyKey: 'copy-before-rollback',
    correlationId: 'corr-before-rollback',
    dataClasses: [],
    brief: {
      assetIds: ['asset-a'],
      conversionGoal: '预约到店',
      hook: '真实到店记录',
      platform: 'xiaohongshu',
      projectId: 'project-a',
      scenario: '项目种草',
      tone: '克制',
    },
    store: {
      name: '测试门店',
      city: '杭州',
      brandVoice: '专业、克制',
      project: { id: 'project-a', name: '护理项目', price: 299 },
    },
    assets: [
      {
        id: 'asset-a',
        tags: ['门店'],
        aigcStatus: 'not_ai',
      },
    ],
  };

  const before = await provider.generate(request);
  assert.equal(before.evidence.promptRevision, 'beauty-copy-prompt-v1');
  assert.equal(before.evidence.templateRevision, 'beauty-copy-template-v1');
  assert.equal(before.evidence.exampleSetRevision, 'beauty-copy-examples-v1');

  await controlPlane.rollbackPromptRevision(
    {
      workspaceId: request.workspaceId,
      userId: 'admin-a',
      correlationId: 'prompt-rollback',
      actor: 'admin',
    },
    'beauty-copy-prompt-v0',
    'restore stable prompt',
  );
  const after = await provider.generate({
    ...request,
    idempotencyKey: 'copy-after-rollback',
    correlationId: 'corr-after-rollback',
  });
  assert.equal(after.evidence.promptRevision, 'beauty-copy-prompt-v0');
  assert.equal(after.evidence.templateRevision, 'beauty-copy-template-v0');
  assert.equal(after.evidence.exampleSetRevision, 'beauty-copy-examples-v0');
  assert.equal(before.evidence.promptRevision, 'beauty-copy-prompt-v1');
});
