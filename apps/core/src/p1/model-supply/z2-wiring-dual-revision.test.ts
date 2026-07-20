import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alignProcessCapabilityHotAssembly,
  seedCapabilityHotAssemblyFromCatalog,
} from './runtime-assembly.js';
import { modelRuntimeAssemblyFromEnv } from './runtime-config.js';

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
