import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryAdminConfigRepository } from './foundation-module.js';
import {
  integrationAdapterEnvFromSources,
  modelRuntimeAssemblyFromSources,
} from './runtime-wiring.js';

// Regression: ISSUE-001 — stale admin runtime modes must not disable the explicit E2E fixture harness.
// Found by /qa on 2026-07-22
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-22.md
test('explicit E2E fixture runtime ignores stale stored execution modes', async () => {
  const repository = new MemoryAdminConfigRepository();
  const command = {
    actorId: 'qa-agent',
    correlationId: 'issue-001',
    reason: 'seed stale local runtime state',
    scope: 'global' as const,
    workspaceId: '__global__',
  };
  await repository.apply({
    ...command,
    expectedRevision: null,
    key: 'model.execution.mode',
    value: 'recorded',
  });
  await repository.apply({
    ...command,
    expectedRevision: null,
    key: 'model.media.execution.mode',
    value: 'disabled',
  });

  const result = await modelRuntimeAssemblyFromSources(repository, {
    APP_ENV: 'e2e',
    MODEL_EXECUTION_MODE: 'fixture',
    MODEL_MEDIA_EXECUTION_MODE: 'disabled',
  });

  assert.equal(result.assembly.runtime.mode, 'fixture');
  assert.deepEqual(result.sources, {
    execution: { source: 'env_fallback' },
    media: { source: 'env_fallback' },
  });
  assert.ok(
    result.assembly.deployments.some(
      (deployment) =>
        deployment.catalogModelId === 'llm-openai' &&
        deployment.status === 'active'
    )
  );
});

test('explicit E2E fixture runtime ignores stale stored BYOK mode', async () => {
  const repository = new MemoryAdminConfigRepository();
  await repository.apply({
    actorId: 'qa-agent',
    correlationId: 'issue-001-byok',
    expectedRevision: null,
    key: 'byok.adapter.assembly',
    reason: 'seed stale local adapter state',
    scope: 'global',
    value: 'live',
    workspaceId: '__global__',
  });

  const result = await integrationAdapterEnvFromSources(repository, {
    APP_ENV: 'e2e',
    BYOK_EXECUTION_MODE: 'recorded',
    MODEL_EXECUTION_MODE: 'fixture',
  });

  assert.equal(result.env.BYOK_EXECUTION_MODE, 'recorded');
  assert.deepEqual(result.byokSource, { source: 'env_fallback' });
});
