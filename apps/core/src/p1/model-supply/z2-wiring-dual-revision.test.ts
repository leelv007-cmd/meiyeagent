import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alignProcessCapabilityHotAssembly,
  seedCapabilityHotAssemblyFromCatalog,
} from './runtime-assembly.js';
import {
  directModelConfigurationRevisionFromEnv,
  modelRuntimeAssemblyFromEnv,
} from './runtime-config.js';

test('HTTP and Worker seed the same effective capability revision from shared catalog', () => {
  const catalog = modelRuntimeAssemblyFromEnv({
    APP_ENV: 'e2e',
    MODEL_EXECUTION_MODE: 'fixture',
  });

  const http = seedCapabilityHotAssemblyFromCatalog(catalog, {
    publishedAt: '2026-07-20T00:00:00.000Z',
  });
  const worker = seedCapabilityHotAssemblyFromCatalog(catalog, {
    publishedAt: '2026-07-20T00:00:00.000Z',
  });

  const httpView = http.report('http');
  const workerView = worker.report('job-worker');

  assert.equal(
    httpView.effectiveCapabilityRevisionId,
    workerView.effectiveCapabilityRevisionId,
  );
  assert.equal(
    httpView.capabilityRevisionNumber,
    workerView.capabilityRevisionNumber,
  );
  assert.equal(httpView.processKind, 'http');
  assert.equal(workerView.processKind, 'job-worker');
  assert.equal(
    httpView.effectiveCatalogRevisionId,
    workerView.effectiveCatalogRevisionId,
  );
});

test('dual-process shared store keeps HTTP/Worker capability head aligned after apply', () => {
  const catalog = modelRuntimeAssemblyFromEnv({
    APP_ENV: 'e2e',
    MODEL_EXECUTION_MODE: 'fixture',
  });
  const { http, worker } = alignProcessCapabilityHotAssembly(catalog, {
    publishedAt: '2026-07-20T00:00:00.000Z',
  });

  assert.equal(
    http.hotAssembly.getEffectiveRevisionId(),
    worker.hotAssembly.getEffectiveRevisionId(),
  );

  // Worker-only apply still updates the shared store head that HTTP reads.
  if (catalog.runtimeCapabilities[0]) {
    const next = {
      ...http.bootRevision!,
      revisionId: 'cap-hot-v2',
      number: 2,
      previousRevisionId: http.bootRevision!.revisionId,
    };
    worker.hotAssembly.applyCapabilityRevision(next);
    assert.equal(http.hotAssembly.getEffectiveRevisionId(), 'cap-hot-v2');
    assert.equal(worker.hotAssembly.getEffectiveRevisionId(), 'cap-hot-v2');
  }
});

test('boot seed freezes secret-free direct adapter config and binding revision', () => {
  const configured = {
    MODEL_DIRECT_API_KEY: 'must-not-enter-capability-revision',
    MODEL_DIRECT_BASE_URL: 'https://provider.example.test/v1',
    MODEL_DIRECT_CATALOG_MODEL_ID: 'llm-openai',
    MODEL_DIRECT_CREDENTIAL_VERSION: 'credential-v1',
    MODEL_DIRECT_ENDPOINT_REVISION: 'endpoint-v1',
    MODEL_DIRECT_INPUT_COST_PER_MILLION: '1.25',
    MODEL_DIRECT_MODEL: 'provider-model-v1',
    MODEL_DIRECT_OUTPUT_COST_PER_MILLION: '3.5',
    MODEL_EXECUTION_MODE: 'direct',
  };
  const configurationRevision =
    directModelConfigurationRevisionFromEnv(configured);
  const catalog = modelRuntimeAssemblyFromEnv(configured, {
    'openai-direct-recorded': {
      configurationRevision,
      evidenceRef: `activation-probe-${'a'.repeat(24)}`,
      status: 'live_verified',
      verifiedAt: '2026-07-29T09:00:00.000Z',
    },
  });

  const seeded = seedCapabilityHotAssemblyFromCatalog(catalog, {
    publishedAt: '2026-07-29T09:00:00.000Z',
  });
  const entry = seeded.bootRevision?.entries.find(
    (candidate) => candidate.deploymentId === 'openai-direct-recorded',
  );

  assert.equal(entry?.adapterBindingRevision, configurationRevision);
  assert.deepEqual(entry?.adapterConfig, {
    baseUrl: 'https://provider.example.test/v1',
    providerModel: 'provider-model-v1',
    endpointRevision: 'endpoint-v1',
    apiFamily: 'openai',
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 3.5,
    currency: 'USD',
  });
  assert.doesNotMatch(
    JSON.stringify(seeded.bootRevision),
    /must-not-enter-capability-revision/u,
  );
});
