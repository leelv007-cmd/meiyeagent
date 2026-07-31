import assert from 'node:assert/strict';
import test from 'node:test';
import { modelRuntimeAssemblyFromEnv } from '../model-supply/runtime-config.js';
import { IntegrationApplicationService } from './application-service.js';
import { MemoryIntegrationRepository } from './repository.js';
import { FakeKmsSecretStore } from './secret-store.js';
import {
  assembleProviderCredentialByFrozenVersion,
  createProviderCredentialSecretBroker,
  migrateProviderCredentialAccountsFromIntegrations,
  projectProviderCredentialEnvFallbackMonitor,
  ProviderCredentialAccountProvisioner,
  providerCredentialEnvFromVault,
  type ProviderCredentialAccountRepository,
} from './provider-credential-runtime.js';
import type { CredentialAccount } from '../supply-registry/credential-account.js';
import { transitionCredentialLifecycle } from '../supply-registry/credential-lifecycle.js';

class MemoryProviderCredentialAccountRepository
  implements ProviderCredentialAccountRepository
{
  private readonly rows = new Map<
    string,
    { account: CredentialAccount; recordRevision: number }
  >();

  async getCredentialAccount(workspaceId: string, accountId: string) {
    const row = this.rows.get(`${workspaceId}:${accountId}`);
    return row ? structuredClone(row) : null;
  }

  async saveCredentialAccount(
    workspaceId: string,
    account: CredentialAccount,
    expectedRecordRevision: number | null,
  ) {
    const key = `${workspaceId}:${account.id}`;
    const current = this.rows.get(key);
    if (
      (expectedRecordRevision === null && current) ||
      (expectedRecordRevision !== null &&
        current?.recordRevision !== expectedRecordRevision)
    ) {
      throw new Error('credential account CAS conflict');
    }
    const recordRevision = (current?.recordRevision ?? 0) + 1;
    this.rows.set(key, {
      account: structuredClone(account),
      recordRevision,
    });
    return recordRevision;
  }

  async listCredentialAccounts(workspaceId: string) {
    return [...this.rows.entries()]
      .filter(([key]) => key.startsWith(`${workspaceId}:credential-account:`))
      .map(([, row]) => structuredClone(row));
  }
}

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
  const accounts = new MemoryProviderCredentialAccountRepository();
  await migrateProviderCredentialAccountsFromIntegrations(repository, accounts);

  const result = await providerCredentialEnvFromVault(
    accounts,
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
    new MemoryProviderCredentialAccountRepository(),
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
  const accounts = new MemoryProviderCredentialAccountRepository();
  await migrateProviderCredentialAccountsFromIntegrations(repository, accounts);

  const result = await providerCredentialEnvFromVault(
    accounts,
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
  const accounts = new MemoryProviderCredentialAccountRepository();
  await migrateProviderCredentialAccountsFromIntegrations(repository, accounts);

  await assert.rejects(
    providerCredentialEnvFromVault(accounts, secrets, runtimeEnv),
    /AAD does not match/,
  );
});

test('G2 migration adapter assembles vault credentials by frozen version without echo', async () => {
  const repository = new MemoryIntegrationRepository();
  const secrets = new FakeKmsSecretStore();
  const service = new IntegrationApplicationService({ repository, secrets });
  await storeCredential(service, 'model.direct', 'vault-direct-secret-v1');
  const accounts = new MemoryProviderCredentialAccountRepository();
  await migrateProviderCredentialAccountsFromIntegrations(repository, accounts);

  const broker = createProviderCredentialSecretBroker(accounts, secrets);
  const assembled = await assembleProviderCredentialByFrozenVersion(broker, {
    credentialAccountId: 'credential-account:platform:model.direct',
    frozenVersion: '1',
    requiredScope: 'platform',
  });
  assert.equal(assembled.secret, 'vault-direct-secret-v1');
  assert.equal(assembled.version, '1');

  const publicMeta = await broker.projectPublic(
    'credential-account:platform:model.direct',
  );
  assert.equal(publicMeta.id, 'credential-account:platform:model.direct');
  assert.equal(JSON.stringify(publicMeta).includes('vault-direct-secret'), false);
});

test('connectivity verification activates only the exact tested pending head', async () => {
  const integrations = new MemoryIntegrationRepository();
  const secrets = new FakeKmsSecretStore();
  const service = new IntegrationApplicationService({
    repository: integrations,
    secrets,
  });
  await storeCredential(
    service,
    'model.direct',
    'vault-direct-secret-v1',
  );
  const accounts = new MemoryProviderCredentialAccountRepository();
  await migrateProviderCredentialAccountsFromIntegrations(
    integrations,
    accounts,
  );
  const accountId = 'credential-account:platform:model.direct';
  const current = await accounts.getCredentialAccount('__global__', accountId);
  assert.ok(current);
  const secretReference = await secrets.put(
    {
      workspaceId: '__global__',
      credentialId: current.account.credentialId,
      version: 2,
      provider: 'model',
    },
    'vault-direct-secret-v2',
  );
  const pending = transitionCredentialLifecycle(
    current.account,
    {
      kind: 'rotate',
      next: { version: '2', secretReference, secretVersion: 2 },
    },
    { now: '2026-07-20T00:00:00.000Z' },
  );
  await accounts.saveCredentialAccount(
    '__global__',
    pending,
    current.recordRevision,
  );
  const verifier = new ProviderCredentialAccountProvisioner(
    accounts,
    { async issue() { throw new Error('not used'); } },
    secrets,
  );

  await verifier.recordConnectivityResult({
    workspaceId: '__global__',
    accountId,
    expectedVersion: '2',
    status: 'unauthorized',
    errorCode: 'http_401',
    testedAt: '2026-07-20T00:01:00.000Z',
    evidenceRef: 'audit://credential-connectivity/v2/fail',
  });
  assert.equal(
    (await accounts.getCredentialAccount('__global__', accountId))?.account
      .status,
    'pending',
  );

  await verifier.recordConnectivityResult({
    workspaceId: '__global__',
    accountId,
    expectedVersion: '2',
    status: 'passed',
    testedAt: '2026-07-20T00:02:00.000Z',
    evidenceRef: 'audit://credential-connectivity/v2/pass',
  });
  assert.equal(
    (await accounts.getCredentialAccount('__global__', accountId))?.account
      .status,
    'active',
  );

  await assert.rejects(
    verifier.recordConnectivityResult({
      workspaceId: '__global__',
      accountId,
      expectedVersion: '1',
      status: 'passed',
      testedAt: '2026-07-20T00:03:00.000Z',
      evidenceRef: 'audit://credential-connectivity/v1/stale',
    }),
    /changed before connectivity verification/,
  );
});

test('G2 boot sources project env_fallback monitor with migration entry', async () => {
  const result = await providerCredentialEnvFromVault(
    new MemoryProviderCredentialAccountRepository(),
    new FakeKmsSecretStore(),
    runtimeEnv,
  );
  const monitor = projectProviderCredentialEnvFallbackMonitor(result.sources);
  assert.equal(monitor.workerSecretsAreNotRegistryTruth, true);
  assert.ok(monitor.migrationRequiredSlots.includes('model.direct'));
  assert.ok(monitor.migrationRequiredSlots.includes('ark.media'));
  const modelDirect = monitor.projections.find((p) => p.slot === 'model.direct');
  assert.equal(modelDirect?.effectiveSource, 'env_fallback');
  assert.ok(modelDirect?.migrationEntry);
});
