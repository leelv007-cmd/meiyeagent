import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { Pool } from 'pg';
import { PostgresAdminSupplyMigration } from '../supply-registry/postgres-admin-supply-runtime.js';
import { PostgresCredentialRotationReceiptStore } from '../supply-registry/postgres-admin-supply-runtime.js';
import { PostgresCapabilityHotAssemblyMigration } from '../supply-registry/postgres-hot-assembly.js';
import { PostgresCapabilityHotAssemblyPort } from '../supply-registry/postgres-hot-assembly.js';
import { PostgresSupplyControlPlaneRepository } from '../supply-registry/postgres-control-plane.js';
import { SecretBrokerError } from '../supply-registry/secret-broker.js';
import { IntegrationApplicationService } from './application-service.js';
import { MemoryIntegrationRepository } from './repository.js';
import { FakeKmsSecretStore } from './secret-store.js';
import {
  createProviderCredentialSecretBroker,
  migrateProviderCredentialAccountsFromIntegrations,
  ProviderCredentialAccountProvisioner,
  providerCredentialEnvFromVault,
} from './provider-credential-runtime.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe('PostgreSQL provider credential runtime truth', { skip: !databaseUrl }, () => {
  it('moves a secure rotation into request-time provider assembly while preserving frozen history', async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const capabilityWorkspaceId = `credential-runtime-${randomUUID()}`;
    const accountWorkspaceId = `credential-account-${randomUUID()}`;
    const accountId = 'credential-account:platform:model.direct';
    const accounts = new PostgresSupplyControlPlaneRepository(pool);
    const integrations = new MemoryIntegrationRepository();
    const secrets = new FakeKmsSecretStore();
    const service = new IntegrationApplicationService({
      repository: integrations,
      secrets,
    });
    const receipts = new PostgresCredentialRotationReceiptStore(
      pool,
      async (binding) => {
        await secrets.use(binding.secretReference, {
          workspaceId: binding.workspaceId,
          credentialId: binding.credentialId,
          provider: binding.provider,
          version: binding.secretVersion,
        });
      },
    );
    const provisioner = new ProviderCredentialAccountProvisioner(
      accounts,
      receipts,
      secrets,
      () => new Date('2026-07-20T00:00:00.000Z'),
    );
    const admin = {
      correlationId: 'credential-runtime-pg',
      role: 'owner' as const,
      userId: 'platform-admin',
      workspaceId: accountWorkspaceId,
    };
    try {
      const client = await pool.connect();
      try {
        await accounts.migrate(client);
        await new PostgresCapabilityHotAssemblyMigration().migrate(client);
        await new PostgresAdminSupplyMigration().migrate(client);
      } finally {
        client.release();
      }
      const connectionV1 = await service.createConnection(
        admin,
        {
          id: 'platform:model.direct',
          provider: 'model',
          identityMode: 'service',
          requestedCapabilities: ['model.direct'],
          grantedCapabilities: ['model.direct'],
          subject: 'model.direct',
          credential: {
            scope: ['models.read'],
            value: 'provider-runtime-secret-v1',
          },
        },
        'store-provider-v1',
      );
      await provisioner.provisionConnection(connectionV1);

      const broker = createProviderCredentialSecretBroker(
        accounts,
        secrets,
        accountWorkspaceId,
      );
      const runtime = new PostgresCapabilityHotAssemblyPort(
        pool,
        accounts,
        capabilityWorkspaceId,
        broker,
      );
      await runtime.seedIfEmpty({
        revisionId: 'cap-provider-runtime-legacy',
        number: 1,
        entries: [
          {
            deploymentId: 'deployment-direct',
            catalogModelId: 'llm-openai',
            apiFamily: 'openai',
            channel: 'direct',
            region: 'overseas',
            executionChannelId: 'channel-direct',
            credentialVersion: 'legacy-boot-version',
            adapterKey: 'direct-llm',
          },
        ],
        publishedAt: '2026-07-19T00:00:00.000Z',
      });
      await runtime.seedIfEmpty({
        revisionId: 'cap-provider-runtime-v1',
        number: 1,
        entries: [
          {
            deploymentId: 'deployment-direct',
            catalogModelId: 'llm-openai',
            apiFamily: 'openai',
            channel: 'direct',
            region: 'overseas',
            executionChannelId: 'channel-direct',
            credentialAccountId: accountId,
            credentialVersion: '1',
            adapterKey: 'direct-llm',
          },
        ],
        publishedAt: '2026-07-20T00:00:00.000Z',
      });
      const reconciled = await runtime.getEffectiveRevision();
      assert.equal(
        reconciled?.entries[0]?.credentialAccountId,
        accountId,
      );
      assert.equal(reconciled?.entries[0]?.credentialVersion, '1');

      const before = await runtime.assembleForRequest({
        deploymentId: 'deployment-direct',
        requiredScope: 'platform',
      });
      assert.equal(before.credential?.version, '1');
      assert.equal(before.credential?.secret, 'provider-runtime-secret-v1');

      const staged = await provisioner.stageRotation({
        workspaceId: accountWorkspaceId,
        accountId,
        secret: 'provider-runtime-secret-v2',
      });
      const receipt = staged.secureWriteReceipt;
      assert.equal(receipt.nextSecretVersion, 2);
      assert.equal('secretReference' in receipt, false);
      await receipts.consumeAndRotate({
        workspaceId: accountWorkspaceId,
        accountId,
        receiptId: receipt.id,
        expectedAccountVersion: '1',
        now: '2026-07-20T00:01:00.000Z',
      });

      await assert.rejects(
        runtime.assembleForRequest({
          deploymentId: 'deployment-direct',
          requiredScope: 'platform',
        }),
        (error: unknown) =>
          error instanceof SecretBrokerError &&
          error.code === 'ACCOUNT_PENDING',
      );
      await provisioner.recordConnectivityResult({
        workspaceId: accountWorkspaceId,
        accountId,
        expectedVersion: '2',
        status: 'unauthorized',
        errorCode: 'http_401',
        testedAt: '2026-07-20T00:01:30.000Z',
        evidenceRef: 'test://credential-runtime/v2/fail',
      });
      assert.equal(
        (
          await accounts.getCredentialAccount(accountWorkspaceId, accountId)
        )?.account.status,
        'pending',
      );
      await provisioner.recordConnectivityResult({
        workspaceId: accountWorkspaceId,
        accountId,
        expectedVersion: '2',
        status: 'passed',
        testedAt: '2026-07-20T00:02:00.000Z',
        evidenceRef: 'test://credential-runtime/v2/pass',
      });

      const nextRequest = await runtime.assembleForRequest({
        deploymentId: 'deployment-direct',
        requiredScope: 'platform',
      });
      assert.equal(nextRequest.credential?.version, '2');
      assert.equal(
        nextRequest.credential?.secret,
        'provider-runtime-secret-v2',
      );
      const supplySecretReference = nextRequest.credential?.secretReference;
      const frozenRequest = await runtime.assembleForRequest({
        deploymentId: 'deployment-direct',
        frozenCredentialVersion: '1',
        requiredScope: 'platform',
      });
      assert.equal(frozenRequest.credential?.version, '1');
      assert.equal(
        frozenRequest.credential?.secret,
        'provider-runtime-secret-v1',
      );

      const boot = await providerCredentialEnvFromVault(accounts, secrets, {
        MODEL_DIRECT_API_KEY: 'stale-env-secret',
        MODEL_DIRECT_CREDENTIAL_VERSION: 'stale-env-version',
      }, accountWorkspaceId);
      assert.equal(boot.env.MODEL_DIRECT_API_KEY, 'provider-runtime-secret-v2');
      assert.equal(boot.env.MODEL_DIRECT_CREDENTIAL_VERSION, '2');

      await service.rotateConnectionCredential(
        admin,
        connectionV1.id,
        { scope: ['models.read'], value: 'legacy-only-secret-v3' },
        'rotate-legacy-only-v3',
      );
      await migrateProviderCredentialAccountsFromIntegrations(
        integrations,
        accounts,
        accountWorkspaceId,
      );
      assert.equal(
        (
          await accounts.getCredentialAccount(accountWorkspaceId, accountId)
        )?.account.version,
        '2',
      );
      assert.equal(
        (
          await accounts.getCredentialAccount(accountWorkspaceId, accountId)
        )?.account.secretReference,
        supplySecretReference,
      );
    } finally {
      await pool.query(
        'DELETE FROM p1_admin_supply_secure_write_receipts WHERE workspace_id = $1',
        [accountWorkspaceId],
      );
      await accounts.deleteWorkspaceForTest(capabilityWorkspaceId);
      await accounts.deleteWorkspaceForTest(accountWorkspaceId);
      await pool.end();
    }
  });
});
