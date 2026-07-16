import assert from 'node:assert/strict';
import test from 'node:test';
import { RecordedAdapterRouter } from './adapters.js';
import { createDefaultCatalogModels, createDefaultDeployments } from './catalog.js';
import { ProductCopyProviderBridge } from './copy-provider-bridge.js';
import { ModelSupplyApplicationService } from './index.js';

test('Product CopyProvider bridge returns content plus requested/actual route and revisioned usage evidence', async () => {
  const deployments = createDefaultDeployments({
    activatedDeploymentIds: ['openai-direct-recorded'],
  });
  const bridge = new ProductCopyProviderBridge(
    new ModelSupplyApplicationService({
      models: createDefaultCatalogModels(),
      deployments,
      execution: new RecordedAdapterRouter(),
    })
  );

  const result = await bridge.generate({
    workspaceId: 'workspace-a',
    actorId: 'owner-a',
    correlationId: 'corr-copy-1',
    idempotencyKey: 'copy-bridge-1',
    requestedSelection: { mode: 'fixed', catalogModelId: 'llm-openai' },
    dataClass: [],
    prompt: '为门店护理项目生成小红书文案',
    promptRevision: 'prompt-v7',
    exampleSetRevision: 'examples-v4',
  });

  assert.equal(result.candidates.length, 3);
  assert.equal(result.evidence.requestedSelection.catalogModelId, 'llm-openai');
  assert.equal(result.evidence.actualCatalogModelId, 'llm-openai');
  assert.equal(result.evidence.routeSnapshot.promptRevision, 'prompt-v7');
  assert.equal(result.evidence.routeSnapshot.exampleSetRevision, 'examples-v4');
  assert.equal(result.evidence.usage.status, 'committed');
  assert.equal(result.evidence.providerCost.status, 'observed');
});
