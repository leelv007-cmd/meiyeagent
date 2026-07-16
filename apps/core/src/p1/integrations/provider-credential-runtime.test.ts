import assert from 'node:assert/strict';
import test from 'node:test';
import { modelRuntimeAssemblyFromEnv } from '../model-supply/runtime-config.js';
import { IntegrationApplicationService } from './application-service.js';
import { MemoryIntegrationRepository } from './repository.js';
import { FakeKmsSecretStore } from './secret-store.js';
import { providerCredentialEnvFromVault } from './provider-credential-runtime.js';

const admin = {
  correlationId: 'credential-runtime-test',
  role: 'admin' as const,
  userId: 'platform-admin',
  workspaceId: '__global__',
};

const runtimeEnv: NodeJS.ProcessEnv = {
  APP_ENV: 'development',
  MODEL_EXECUTION_MODE: 'direct',
  MODEL_DIRECT_API_KEY: 'env-direct-secret',
  MODEL_DIRECT_BASE_URL: 'https://direct.example.test/v1',
  MODEL_DIRECT_CATALOG_MODEL_ID: 'llm-openai',
  MODEL_DIRECT_CREDENTIAL_VERSION: 'env-direct-v9',
  MODEL_DIRECT_ENDPOINT_REVISION: 'openai-compatible-v1',
  MODEL_DIRECT_INPUT_COST_PER_MILLION: '1',
  MODEL_DIRECT_MODEL: 'copy-model',
  MODEL_DIRECT_OUTPUT_COST_PER_MILLION: '2',
  MODEL_DIRECT_ACTIVATION_CONFIGURATION_REVISION: 'stale-revision',
  MODEL_DIRECT_ACTIVATION_EVIDENCE_REF: 'evidence://stale/direct',
  MODEL_DIRECT_ACTIVATION_VERIFIED_AT: '2026-07-15T00:00:00.000Z',
  MODEL_MEDIA_EXECUTION_MODE: 'ark',
  ARK_MEDIA_API_KEY: 'env-ark-secret',
  ARK_MEDIA_BASE_URL: 'https://ark.example.test/api/v3',
  ARK_MEDIA_CREDENTIAL_VERSION: 'env-ark-v4',
  ARK_MEDIA_ENDPOINT_REVISION: 'ark-media-v1',
  ARK_MEDIA_SOURCE_URL_TTL_SECONDS: '3600',
  ARK_SEEDANCE_COST_PER_MILLION_TOKENS_CNY: '30',
  ARK_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND: '12000',
  ARK_SEEDANCE_MODEL: 'video-model',
  ARK_SEEDREAM_COST_PER_IMAGE_CNY: '0.25',
  ARK_SEEDREAM_MODEL: 'image-model',
  ARK_SEEDANCE_ACTIVATION_CONFIGURATION_REVISION: 'stale-video',
  ARK_SEEDANCE_ACTIVATION_EVIDENCE_REF: 'evidence://stale/video',
  ARK_SEEDANCE_ACTIVATION_VERIFIED_AT: '2026-07-15T00:00:00.000Z',
  ARK_SEEDREAM_ACTIVATION_CONFIGURATION_REVISION: 'stale-image',
  ARK_SEEDREAM_ACTIVATION_EVIDENCE_REF: 'evidence://stale/image',
  ARK_SEEDREAM_ACTIVATION_VERIFIED_AT: '2026-07-15T00:00:00.000Z',
};

async function storeCredential(
  service: IntegrationApplicationService,
  slot: 'model.direct' | 'ark.media',
  value: string,
) {
  return service.createConnection(
    admin,
    {
      id: `platform:${slot}`,
      provider: 'model',
      identityMode: 'service',
      requestedCapabilities: [slot],
      grantedCapabilities: [slot],
      subject: slot,
      credential: { scope: ['models.read'], value },
    },
    `store-${slot}`,
  );
}

test('vault credentials take over direct and Ark boot configuration and downgrade activation evidence', async () => {
  const repository = new MemoryIntegrationRepository();
  const secrets = new FakeKmsSecretStore();
  const service = new IntegrationApplicationService({ repository, secrets });
  await storeCredential(service, 'model.direct', 'vault-direct-secret');
  await storeCredential(service, 'ark.media', 'vault-ark-secret');

  const result = await providerCredentialEnvFromVault(
    repository,
    secrets,
    runtimeEnv,
  );

  assert.equal(result.env.MODEL_DIRECT_API_KEY, 'vault-direct-secret');
  assert.equal(result.env.MODEL_DIRECT_CREDENTIAL_VERSION, '1');
  assert.equal(result.env.ARK_MEDIA_API_KEY, 'vault-ark-secret');
  assert.equal(result.env.ARK_MEDIA_CREDENTIAL_VERSION, '1');
  assert.deepEqual(result.sources, {
    arkMedia: { source: 'vault', credentialVersion: 1 },
    modelDirect: { source: 'vault', credentialVersion: 1 },
  });
  assert.equal(result.env.MODEL_DIRECT_ACTIVATION_EVIDENCE_REF, undefined);
  assert.equal(result.env.ARK_SEEDREAM_ACTIVATION_EVIDENCE_REF, undefined);
  assert.equal(result.env.ARK_SEEDANCE_ACTIVATION_EVIDENCE_REF, undefined);
  const assembly = modelRuntimeAssemblyFromEnv(result.env);
  assert.notEqual(assembly.runtime.activation, 'live_verified');
  assert.equal(
    assembly.deployments.some((deployment) => deployment.status === 'active'),
    false,
  );
});

test('boot credential binding falls back to env when vault slots are absent', async () => {
  const result = await providerCredentialEnvFromVault(
    new MemoryIntegrationRepository(),
    new FakeKmsSecretStore(),
    runtimeEnv,
  );

  assert.equal(result.env.MODEL_DIRECT_API_KEY, 'env-direct-secret');
  assert.equal(result.env.ARK_MEDIA_API_KEY, 'env-ark-secret');
  assert.deepEqual(result.sources, {
    arkMedia: { source: 'env_fallback' },
    modelDirect: { source: 'env_fallback' },
  });
});

test('boot credential binding falls back to env when a recorded secret is unavailable after restart', async () => {
  const repository = new MemoryIntegrationRepository();
  const service = new IntegrationApplicationService({
    repository,
    secrets: new FakeKmsSecretStore(),
  });
  await storeCredential(service, 'model.direct', 'ephemeral-recorded-secret');

  const result = await providerCredentialEnvFromVault(
    repository,
    new FakeKmsSecretStore(),
    runtimeEnv,
  );

  assert.equal(result.env.MODEL_DIRECT_API_KEY, 'env-direct-secret');
  assert.deepEqual(result.sources.modelDirect, { source: 'env_fallback' });
});

test('boot credential binding rejects a secret with mismatched AAD', async () => {
  const repository = new MemoryIntegrationRepository();
  const secrets = new FakeKmsSecretStore();
  const service = new IntegrationApplicationService({ repository, secrets });
  const direct = await storeCredential(
    service,
    'model.direct',
    'vault-direct-secret',
  );
  const ark = await storeCredential(service, 'ark.media', 'vault-ark-secret');
  await repository.saveConnection({ ...direct, secretRef: ark.secretRef });

  await assert.rejects(
    providerCredentialEnvFromVault(repository, secrets, runtimeEnv),
    /AAD does not match/,
  );
});
