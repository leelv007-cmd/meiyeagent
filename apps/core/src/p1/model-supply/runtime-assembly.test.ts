import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDefaultCapabilityRevisions,
  createDefaultExecutionChannels,
  createDefaultPriceRevisions,
  createDefaultProviderProfiles,
  createDefaultRouteRevisions,
} from './catalog.js';
import { MemoryModelSupplyControlPlaneRepository } from './foundation-module.js';
import { createModelSupplyRuntime } from './runtime-assembly.js';
import {
  modelRuntimeAssemblyFromEnv,
  type ModelRuntimeAssembly,
} from './runtime-config.js';

function assemble(catalog: ModelRuntimeAssembly) {
  const repository = new MemoryModelSupplyControlPlaneRepository();
  return createModelSupplyRuntime({
    application: {
      execution: catalog.runtime.execution,
      resultSink: repository,
    },
    catalog,
    controlPlane: { repository },
  });
}

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
