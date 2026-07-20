import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import {
  DEFAULT_RUNTIME_CREDENTIAL_ACCOUNT_IDS,
  ensureDefaultRuntimeSupplyPool,
  PostgresCapacityLeaseStore,
  PostgresEntitlementPoolsMigration,
  PostgresSupplyPoolStore,
} from './postgres-repository.js';
import { PostgresModelSupplyProviderAdmission } from './model-supply-admission.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'fresh PostgreSQL bootstrap admits an attempt using the runtime CredentialAccount identity',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const schema = `p1_default_pool_${randomUUID().replaceAll('-', '')}`;
    const adminPool = new Pool({ connectionString });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    const pool = new Pool({
      connectionString,
      options: `-c search_path=${schema}`,
    });
    t.after(async () => {
      await pool.end();
      await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await adminPool.end();
    });

    const client = await pool.connect();
    try {
      await new PostgresEntitlementPoolsMigration().migrate(client);
    } finally {
      client.release();
    }

    const supplyPools = new PostgresSupplyPoolStore(pool);
    await ensureDefaultRuntimeSupplyPool(supplyPools, [
      'deployment-direct',
    ]);
    const bootPool = await supplyPools.get('pool-shared-default');
    assert.ok(bootPool);
    assert.deepEqual(
      bootPool.credentialAccountIds,
      DEFAULT_RUNTIME_CREDENTIAL_ACCOUNT_IDS,
    );
    await supplyPools.save(
      {
        ...bootPool,
        credentialAccountIds: ['cred-platform-default'],
        revisionId: 'legacy-default-pool-identity',
      },
      bootPool.revisionId,
    );
    const reconciled = await ensureDefaultRuntimeSupplyPool(supplyPools, [
      'deployment-direct',
    ]);
    assert.equal(
      DEFAULT_RUNTIME_CREDENTIAL_ACCOUNT_IDS.every((id) =>
        reconciled.credentialAccountIds.includes(id),
      ),
      true,
    );

    const admission = new PostgresModelSupplyProviderAdmission({
      productEntitlements: {
        async resolve() {
          return {
            revision: 'product:growth:fresh-pg',
            tier: 'growth',
            allowance: { copy: 10, image: 0, video: 0, audio: 0 },
            concurrencyLimit: 2,
            queuePriority: 1,
            supportLabel: 'standard',
            addOns: [],
            autoTopUp: {
              enabled: false,
              monthlyCapMicros: 0,
              spentThisMonthMicros: 0,
            },
            availableSupplyPoolIds: ['pool-shared-default'],
          };
        },
      },
      entitlementPolicies: { async getPublished() { return null; } },
      accountAllocations: { async listActive() { return []; } },
      supplyPools,
      capacityLeases: new PostgresCapacityLeaseStore(pool),
    });
    const credentialAccountId =
      'credential-account:platform:model.direct';
    const now = new Date().toISOString();
    const decision = await admission.admit({
      submission: {
        workspaceId: 'workspace-fresh-pg',
        actorId: 'account-fresh-pg',
        idempotencyKey: 'fresh-pg-attempt',
        operation: 'copy.generate',
        selection: { mode: 'fixed', catalogModelId: 'catalog-copy-a' },
        dataClass: [],
        prompt: '新库调用',
      },
      jobId: 'job-fresh-pg',
      attemptId: 'attempt-fresh-pg',
      snapshot: {
        id: 'snapshot-fresh-pg',
        catalogRevisionId: 'catalog-fresh-pg',
        requestedSelection: {
          mode: 'fixed',
          catalogModelId: 'catalog-copy-a',
        },
        candidateCatalogModelIds: ['catalog-copy-a'],
        actualCatalogModelId: 'catalog-copy-a',
        deploymentId: 'deployment-direct',
        credentialAccountId,
        reason: 'fixed_selection',
        dataClass: [],
        createdAt: now,
      },
      model: {
        id: 'catalog-copy-a',
        modality: 'llm',
        operations: ['copy.generate'],
        displayName: 'Fresh PG copy',
        qualityRank: 90,
      },
      deployment: {
        id: 'deployment-direct',
        catalogModelId: 'catalog-copy-a',
        credentialAccountId,
        apiFamily: 'openai',
        channel: 'direct',
        region: 'domestic',
        status: 'active',
      },
    });

    assert.equal(decision.status, 'admitted');
    if (decision.status === 'admitted') {
      assert.equal(decision.supplyPoolId, 'pool-shared-default');
      await admission.release(decision.leaseId);
    }
  },
);
