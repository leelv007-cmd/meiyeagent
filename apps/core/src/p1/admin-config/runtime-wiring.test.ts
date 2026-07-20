import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryAdminConfigRepository } from './foundation-module.js';
import {
  integrationAdapterEnvFromSources,
  modelRuntimeAssemblyFromSources,
  runtimeModeValidatorsFromProviderCredentials,
} from './runtime-wiring.js';
import { directModelConfigurationRevisionFromEnv } from '../model-supply/runtime-config.js';

const globalConfig = {
  actorId: 'admin-1',
  correlationId: 'corr-1',
  reason: 'test runtime mode source',
  scope: 'global' as const,
  workspaceId: '__global__',
};

test('runtime assembly prefers stored execution modes and reports restart-bound source', async () => {
  const repository = new MemoryAdminConfigRepository();
  await repository.apply({
    ...globalConfig,
    key: 'model.execution.mode',
    value: 'disabled',
    expectedRevision: null,
  });
  await repository.apply({
    ...globalConfig,
    key: 'model.media.execution.mode',
    value: 'disabled',
    expectedRevision: null,
  });

  const result = await modelRuntimeAssemblyFromSources(repository, {
    APP_ENV: 'development',
    MODEL_EXECUTION_MODE: 'recorded',
    MODEL_MEDIA_EXECUTION_MODE: 'disabled',
  });

  assert.equal(result.assembly.runtime.mode, 'disabled');
  assert.deepEqual(result.sources, {
    execution: { source: 'db_revision', revision: 1 },
    media: { source: 'db_revision', revision: 1 },
  });
  assert.equal(result.fallbackReason, null);
});

test('runtime assembly falls back to env when a stored mode is no longer assemblable', async () => {
  const repository = new MemoryAdminConfigRepository();
  await repository.apply({
    ...globalConfig,
    key: 'model.execution.mode',
    value: 'direct',
    expectedRevision: null,
  });

  const result = await modelRuntimeAssemblyFromSources(repository, {
    APP_ENV: 'development',
    MODEL_EXECUTION_MODE: 'recorded',
    MODEL_MEDIA_EXECUTION_MODE: 'disabled',
  });

  assert.equal(result.assembly.runtime.mode, 'recorded');
  assert.equal(result.sources.execution.source, 'env_fallback');
  assert.match(result.fallbackReason ?? '', /MODEL_DIRECT_/);
});

test('runtime activation accepts only persisted current probe evidence and becomes stale after config changes', async () => {
  const repository = new MemoryAdminConfigRepository();
  const env = {
    MODEL_DIRECT_API_KEY: 'configured-secret',
    MODEL_DIRECT_BASE_URL: 'https://provider.example.test/v1',
    MODEL_DIRECT_CATALOG_MODEL_ID: 'llm-openai',
    MODEL_DIRECT_CREDENTIAL_VERSION: 'credential-v1',
    MODEL_DIRECT_ENDPOINT_REVISION: 'endpoint-v1',
    MODEL_DIRECT_INPUT_COST_PER_MILLION: '1',
    MODEL_DIRECT_MODEL: 'provider-model-v1',
    MODEL_DIRECT_OUTPUT_COST_PER_MILLION: '2',
    MODEL_EXECUTION_MODE: 'direct',
    MODEL_MEDIA_EXECUTION_MODE: 'disabled',
  };
  const configurationRevision = directModelConfigurationRevisionFromEnv(env);
  await repository.apply({
    ...globalConfig,
    expectedRevision: null,
    key: 'model.activation.evidence.openai-direct-recorded',
    value: {
      configurationRevision,
      evidenceRef: `activation-probe-${'a'.repeat(28)}`,
      status: 'live_verified',
      verifiedAt: '2026-07-15T00:00:00.000Z',
    },
  });

  const activated = await modelRuntimeAssemblyFromSources(repository, env);
  assert.equal(activated.assembly.runtime.activation, 'live_verified');

  const stale = await modelRuntimeAssemblyFromSources(repository, {
    ...env,
    MODEL_DIRECT_MODEL: 'provider-model-v2',
  });
  assert.equal(stale.assembly.runtime.activation, 'configured_unverified');
});

test('runtime validators use the vault-aware provider credential environment', () => {
  const validators = runtimeModeValidatorsFromProviderCredentials({
    env: {
      APP_ENV: 'development',
      MODEL_DIRECT_API_KEY: 'vault-direct-secret',
      MODEL_DIRECT_BASE_URL: 'https://provider.example.test/v1',
      MODEL_DIRECT_CATALOG_MODEL_ID: 'llm-openai',
      MODEL_DIRECT_CREDENTIAL_VERSION: '2',
      MODEL_DIRECT_ENDPOINT_REVISION: 'openai-compatible-v1',
      MODEL_DIRECT_INPUT_COST_PER_MILLION: '1',
      MODEL_DIRECT_MODEL: 'copy-model',
      MODEL_DIRECT_OUTPUT_COST_PER_MILLION: '2',
      MODEL_EXECUTION_MODE: 'recorded',
      MODEL_MEDIA_EXECUTION_MODE: 'disabled',
    },
  });

  assert.doesNotThrow(() => validators['model.execution.mode']('direct'));
  assert.throws(() => validators['model.execution.mode']('fixture'), /APP_ENV=e2e/);
});

test('runtime validators reject modes that cannot assemble at the next restart', () => {
  const validators = runtimeModeValidatorsFromProviderCredentials({
    env: {
      APP_ENV: 'development',
      MODEL_EXECUTION_MODE: 'recorded',
      MODEL_MEDIA_EXECUTION_MODE: 'disabled',
    },
  });

  assert.throws(() => validators['model.execution.mode']('direct'), /MODEL_DIRECT_/);
});

test('adapter assembly uses the stored BYOK mode while Douyin remains recorded-only', async () => {
  const repository = new MemoryAdminConfigRepository();
  await repository.apply({
    ...globalConfig,
    key: 'byok.adapter.assembly',
    value: 'live',
    expectedRevision: null,
  });

  const result = await integrationAdapterEnvFromSources(repository, {
    BYOK_EXECUTION_MODE: 'recorded',
  });

  assert.equal(result.env.BYOK_EXECUTION_MODE, 'live');
  assert.deepEqual(result.byokSource, { source: 'db_revision', revision: 1 });
  assert.equal(result.douyinMode, 'recorded');
});

test('records independent HTTP and worker effective runtime snapshots', async () => {
  const repository = new MemoryAdminConfigRepository();
  await repository.apply({
    ...globalConfig,
    key: 'model.execution.mode',
    value: 'recorded',
    expectedRevision: null,
  });
  await modelRuntimeAssemblyFromSources(
    repository,
    {
      APP_ENV: 'development',
      MODEL_EXECUTION_MODE: 'disabled',
      MODEL_MEDIA_EXECUTION_MODE: 'disabled',
    },
    { processKind: 'http', clock: () => new Date('2026-07-15T10:00:00.000Z') },
  );
  await repository.apply({
    ...globalConfig,
    key: 'model.execution.mode',
    value: 'disabled',
    expectedRevision: 1,
  });
  await modelRuntimeAssemblyFromSources(
    repository,
    {
      APP_ENV: 'development',
      MODEL_EXECUTION_MODE: 'recorded',
      MODEL_MEDIA_EXECUTION_MODE: 'disabled',
    },
    {
      processKind: 'job-worker',
      clock: () => new Date('2026-07-15T10:01:00.000Z'),
    },
  );

  assert.deepEqual(await repository.listEffectiveSnapshots(), [
    {
      bootedAt: '2026-07-15T10:00:00.000Z',
      executionMode: 'recorded',
      executionSource: { source: 'db_revision', revision: 1 },
      fallbackReason: null,
      mediaMode: 'disabled',
      mediaSource: { source: 'env_fallback' },
      processKind: 'http',
    },
    {
      bootedAt: '2026-07-15T10:01:00.000Z',
      executionMode: 'disabled',
      executionSource: { source: 'db_revision', revision: 2 },
      fallbackReason: null,
      mediaMode: 'disabled',
      mediaSource: { source: 'env_fallback' },
      processKind: 'job-worker',
    },
  ]);
});
