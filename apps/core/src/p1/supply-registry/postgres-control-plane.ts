import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { P1DomainError } from '../foundation/domain.js';
import type { CredentialAccount } from './credential-account.js';
import type { ExpandedSupplyRegistrySnapshot } from './expand.js';
import {
  MemoryEffectiveCapabilityRevisionStore,
  type RuntimeCapabilityRevision,
} from './hot-assembly.js';

type PersistedRegistryRevision = ExpandedSupplyRegistrySnapshot & {
  catalogRevisionId: string;
  catalogRevisionNumber: number;
};

interface RegistryRevisionRow {
  revision_id: string;
  catalog_revision_number: number;
  source: ExpandedSupplyRegistrySnapshot['source'];
}

interface JsonEntityRow<T> {
  entity: T;
}

interface CredentialAccountRow {
  account: CredentialAccount;
  record_revision: string | number;
}

function concurrencyConflict(message: string): P1DomainError {
  return new P1DomainError('IDEMPOTENCY_CONFLICT', message);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function contentDigest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

async function inTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function requireRegistryRevision(
  snapshot: ExpandedSupplyRegistrySnapshot
): asserts snapshot is PersistedRegistryRevision {
  if (
    !snapshot.catalogRevisionId ||
    typeof snapshot.catalogRevisionNumber !== 'number'
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'A durable supply registry revision requires catalog revision id and number.'
    );
  }
}

async function setHead(
  client: PoolClient,
  table: 'p1_supply_registry_heads' | 'p1_supply_capability_heads',
  workspaceId: string,
  revisionId: string,
  expectedHeadRevisionId: string | null
): Promise<void> {
  const result =
    expectedHeadRevisionId === null
      ? await client.query(
          `INSERT INTO ${table} (workspace_id, revision_id, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (workspace_id) DO NOTHING
           RETURNING revision_id`,
          [workspaceId, revisionId]
        )
      : await client.query(
          `UPDATE ${table}
              SET revision_id = $2, updated_at = now()
            WHERE workspace_id = $1 AND revision_id = $3
            RETURNING revision_id`,
          [workspaceId, revisionId, expectedHeadRevisionId]
        );
  if (result.rowCount !== 1) {
    throw concurrencyConflict(
      `Supply control-plane head changed before revision ${revisionId} could be applied.`
    );
  }
}

/**
 * PostgreSQL truth for the normalized supply registry, CredentialAccount
 * metadata, and the shared effective runtime-capability revision.
 *
 * Secret values are deliberately absent: CredentialAccount contains only a
 * secret reference plus version metadata; SecretStorePort remains authoritative
 * for the material itself.
 */
export class PostgresSupplyControlPlaneRepository {
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient): Promise<void> {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS p1_supply_registry_revisions (
        workspace_id text NOT NULL,
        revision_id text NOT NULL,
        catalog_revision_number integer NOT NULL,
        content_digest text NOT NULL,
        source jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, revision_id)
      );
      CREATE TABLE IF NOT EXISTS p1_supply_registry_models (
        workspace_id text NOT NULL,
        registry_revision_id text NOT NULL,
        model_id text NOT NULL,
        ordinal integer NOT NULL,
        entity jsonb NOT NULL,
        PRIMARY KEY (workspace_id, registry_revision_id, model_id),
        FOREIGN KEY (workspace_id, registry_revision_id)
          REFERENCES p1_supply_registry_revisions (workspace_id, revision_id)
          ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS p1_supply_registry_provider_profiles (
        workspace_id text NOT NULL,
        registry_revision_id text NOT NULL,
        provider_profile_id text NOT NULL,
        ordinal integer NOT NULL,
        entity jsonb NOT NULL,
        PRIMARY KEY (workspace_id, registry_revision_id, provider_profile_id),
        FOREIGN KEY (workspace_id, registry_revision_id)
          REFERENCES p1_supply_registry_revisions (workspace_id, revision_id)
          ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS p1_supply_registry_execution_channels (
        workspace_id text NOT NULL,
        registry_revision_id text NOT NULL,
        execution_channel_id text NOT NULL,
        provider_profile_id text NOT NULL,
        ordinal integer NOT NULL,
        entity jsonb NOT NULL,
        PRIMARY KEY (workspace_id, registry_revision_id, execution_channel_id),
        FOREIGN KEY (workspace_id, registry_revision_id)
          REFERENCES p1_supply_registry_revisions (workspace_id, revision_id)
          ON DELETE CASCADE,
        FOREIGN KEY (workspace_id, registry_revision_id, provider_profile_id)
          REFERENCES p1_supply_registry_provider_profiles
            (workspace_id, registry_revision_id, provider_profile_id)
      );
      CREATE TABLE IF NOT EXISTS p1_supply_registry_deployments (
        workspace_id text NOT NULL,
        registry_revision_id text NOT NULL,
        deployment_id text NOT NULL,
        catalog_model_id text NOT NULL,
        provider_profile_id text NOT NULL,
        execution_channel_id text NOT NULL,
        ordinal integer NOT NULL,
        entity jsonb NOT NULL,
        PRIMARY KEY (workspace_id, registry_revision_id, deployment_id),
        FOREIGN KEY (workspace_id, registry_revision_id)
          REFERENCES p1_supply_registry_revisions (workspace_id, revision_id)
          ON DELETE CASCADE,
        FOREIGN KEY (workspace_id, registry_revision_id, catalog_model_id)
          REFERENCES p1_supply_registry_models
            (workspace_id, registry_revision_id, model_id),
        FOREIGN KEY (workspace_id, registry_revision_id, provider_profile_id)
          REFERENCES p1_supply_registry_provider_profiles
            (workspace_id, registry_revision_id, provider_profile_id),
        FOREIGN KEY (workspace_id, registry_revision_id, execution_channel_id)
          REFERENCES p1_supply_registry_execution_channels
            (workspace_id, registry_revision_id, execution_channel_id)
      );
      CREATE TABLE IF NOT EXISTS p1_supply_registry_contracts (
        workspace_id text NOT NULL,
        registry_revision_id text NOT NULL,
        contract_id text NOT NULL,
        provider_profile_id text NOT NULL,
        ordinal integer NOT NULL,
        entity jsonb NOT NULL,
        PRIMARY KEY (workspace_id, registry_revision_id, contract_id),
        FOREIGN KEY (workspace_id, registry_revision_id)
          REFERENCES p1_supply_registry_revisions (workspace_id, revision_id)
          ON DELETE CASCADE,
        FOREIGN KEY (workspace_id, registry_revision_id, provider_profile_id)
          REFERENCES p1_supply_registry_provider_profiles
            (workspace_id, registry_revision_id, provider_profile_id)
      );
      CREATE TABLE IF NOT EXISTS p1_supply_registry_heads (
        workspace_id text PRIMARY KEY,
        revision_id text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (workspace_id, revision_id)
          REFERENCES p1_supply_registry_revisions (workspace_id, revision_id)
          ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS p1_supply_credential_accounts (
        workspace_id text NOT NULL,
        account_id text NOT NULL,
        record_revision bigint NOT NULL,
        account jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, account_id)
      );
      CREATE TABLE IF NOT EXISTS p1_supply_capability_revisions (
        workspace_id text NOT NULL,
        revision_id text NOT NULL,
        revision_number bigint NOT NULL,
        revision jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, revision_id)
      );
      CREATE TABLE IF NOT EXISTS p1_supply_capability_heads (
        workspace_id text PRIMARY KEY,
        revision_id text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (workspace_id, revision_id)
          REFERENCES p1_supply_capability_revisions (workspace_id, revision_id)
          ON DELETE CASCADE
      );
      ALTER TABLE p1_supply_registry_models
        ADD COLUMN IF NOT EXISTS ordinal integer NOT NULL DEFAULT 0;
      ALTER TABLE p1_supply_registry_revisions
        ADD COLUMN IF NOT EXISTS content_digest text;
      ALTER TABLE p1_supply_registry_provider_profiles
        ADD COLUMN IF NOT EXISTS ordinal integer NOT NULL DEFAULT 0;
      ALTER TABLE p1_supply_registry_execution_channels
        ADD COLUMN IF NOT EXISTS ordinal integer NOT NULL DEFAULT 0;
      ALTER TABLE p1_supply_registry_deployments
        ADD COLUMN IF NOT EXISTS ordinal integer NOT NULL DEFAULT 0;
      ALTER TABLE p1_supply_registry_contracts
        ADD COLUMN IF NOT EXISTS ordinal integer NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS p1_supply_registry_revision_number_idx
        ON p1_supply_registry_revisions
          (workspace_id, catalog_revision_number, revision_id);
      CREATE INDEX IF NOT EXISTS p1_supply_capability_revision_number_idx
        ON p1_supply_capability_revisions
          (workspace_id, revision_number, revision_id);
      CREATE INDEX IF NOT EXISTS p1_supply_deployment_relations_idx
        ON p1_supply_registry_deployments
          (workspace_id, registry_revision_id, catalog_model_id,
           provider_profile_id, execution_channel_id);
    `);
  }

  async setCurrentRegistryRevision(
    workspaceId: string,
    snapshot: ExpandedSupplyRegistrySnapshot,
    expectedHeadRevisionId: string | null
  ): Promise<void> {
    requireRegistryRevision(snapshot);
    await inTransaction(this.pool, async (client) => {
      const immutableRevision = await client.query(
        `INSERT INTO p1_supply_registry_revisions
           (workspace_id, revision_id, catalog_revision_number, content_digest,
            source)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (workspace_id, revision_id) DO UPDATE
           SET content_digest = p1_supply_registry_revisions.content_digest
         WHERE p1_supply_registry_revisions.content_digest =
               EXCLUDED.content_digest
         RETURNING revision_id`,
        [
          workspaceId,
          snapshot.catalogRevisionId,
          snapshot.catalogRevisionNumber,
          contentDigest(snapshot),
          JSON.stringify(snapshot.source),
        ]
      );
      if (immutableRevision.rowCount !== 1) {
        throw concurrencyConflict(
          `Supply registry revision ${snapshot.catalogRevisionId} already exists with different content.`
        );
      }
      for (const [ordinal, model] of snapshot.models.entries()) {
        await client.query(
          `INSERT INTO p1_supply_registry_models
             (workspace_id, registry_revision_id, model_id, ordinal, entity)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT DO NOTHING`,
          [
            workspaceId,
            snapshot.catalogRevisionId,
            model.id,
            ordinal,
            JSON.stringify(model),
          ]
        );
      }
      for (const [ordinal, profile] of snapshot.providerProfiles.entries()) {
        await client.query(
          `INSERT INTO p1_supply_registry_provider_profiles
             (workspace_id, registry_revision_id, provider_profile_id, ordinal,
              entity)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT DO NOTHING`,
          [
            workspaceId,
            snapshot.catalogRevisionId,
            profile.id,
            ordinal,
            JSON.stringify(profile),
          ]
        );
      }
      for (const [ordinal, channel] of snapshot.executionChannels.entries()) {
        await client.query(
          `INSERT INTO p1_supply_registry_execution_channels
             (workspace_id, registry_revision_id, execution_channel_id,
              provider_profile_id, ordinal, entity)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT DO NOTHING`,
          [
            workspaceId,
            snapshot.catalogRevisionId,
            channel.id,
            channel.providerProfileId,
            ordinal,
            JSON.stringify(channel),
          ]
        );
      }
      for (const [ordinal, deployment] of snapshot.deployments.entries()) {
        await client.query(
          `INSERT INTO p1_supply_registry_deployments
             (workspace_id, registry_revision_id, deployment_id,
              catalog_model_id, provider_profile_id, execution_channel_id,
              ordinal, entity)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
           ON CONFLICT DO NOTHING`,
          [
            workspaceId,
            snapshot.catalogRevisionId,
            deployment.id,
            deployment.catalogModelId,
            deployment.providerProfileId,
            deployment.executionChannelId,
            ordinal,
            JSON.stringify(deployment),
          ]
        );
      }
      for (const [ordinal, contract] of snapshot.contracts.entries()) {
        await client.query(
          `INSERT INTO p1_supply_registry_contracts
             (workspace_id, registry_revision_id, contract_id,
              provider_profile_id, ordinal, entity)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           ON CONFLICT DO NOTHING`,
          [
            workspaceId,
            snapshot.catalogRevisionId,
            contract.id,
            contract.providerProfileId,
            ordinal,
            JSON.stringify(contract),
          ]
        );
      }
      await setHead(
        client,
        'p1_supply_registry_heads',
        workspaceId,
        snapshot.catalogRevisionId,
        expectedHeadRevisionId
      );
    });
  }

  async getCurrentRegistryRevision(
    workspaceId: string
  ): Promise<PersistedRegistryRevision | null> {
    const head = await this.pool.query<{ revision_id: string }>(
      `SELECT revision_id
         FROM p1_supply_registry_heads
        WHERE workspace_id = $1`,
      [workspaceId]
    );
    const revisionId = head.rows[0]?.revision_id;
    return revisionId
      ? this.getRegistryRevision(workspaceId, revisionId)
      : null;
  }

  async getRegistryRevision(
    workspaceId: string,
    revisionId: string
  ): Promise<PersistedRegistryRevision | null> {
    const revision = await this.pool.query<RegistryRevisionRow>(
      `SELECT revision_id, catalog_revision_number, source
         FROM p1_supply_registry_revisions
        WHERE workspace_id = $1 AND revision_id = $2`,
      [workspaceId, revisionId]
    );
    const row = revision.rows[0];
    if (!row) return null;

    const [models, profiles, channels, deployments, contracts] =
      await Promise.all([
        this.pool.query<
          JsonEntityRow<PersistedRegistryRevision['models'][number]>
        >(
          `SELECT entity FROM p1_supply_registry_models
            WHERE workspace_id = $1 AND registry_revision_id = $2
            ORDER BY ordinal, model_id`,
          [workspaceId, revisionId]
        ),
        this.pool.query<
          JsonEntityRow<PersistedRegistryRevision['providerProfiles'][number]>
        >(
          `SELECT entity FROM p1_supply_registry_provider_profiles
            WHERE workspace_id = $1 AND registry_revision_id = $2
            ORDER BY ordinal, provider_profile_id`,
          [workspaceId, revisionId]
        ),
        this.pool.query<
          JsonEntityRow<PersistedRegistryRevision['executionChannels'][number]>
        >(
          `SELECT entity FROM p1_supply_registry_execution_channels
            WHERE workspace_id = $1 AND registry_revision_id = $2
            ORDER BY ordinal, execution_channel_id`,
          [workspaceId, revisionId]
        ),
        this.pool.query<
          JsonEntityRow<PersistedRegistryRevision['deployments'][number]>
        >(
          `SELECT entity FROM p1_supply_registry_deployments
            WHERE workspace_id = $1 AND registry_revision_id = $2
            ORDER BY ordinal, deployment_id`,
          [workspaceId, revisionId]
        ),
        this.pool.query<
          JsonEntityRow<PersistedRegistryRevision['contracts'][number]>
        >(
          `SELECT entity FROM p1_supply_registry_contracts
            WHERE workspace_id = $1 AND registry_revision_id = $2
            ORDER BY ordinal, contract_id`,
          [workspaceId, revisionId]
        ),
      ]);
    return {
      catalogRevisionId: row.revision_id,
      catalogRevisionNumber: row.catalog_revision_number,
      models: models.rows.map(({ entity }) => entity),
      providerProfiles: profiles.rows.map(({ entity }) => entity),
      executionChannels: channels.rows.map(({ entity }) => entity),
      deployments: deployments.rows.map(({ entity }) => entity),
      contracts: contracts.rows.map(({ entity }) => entity),
      source: row.source,
    };
  }

  async listRegistryRevisions(
    workspaceId: string
  ): Promise<PersistedRegistryRevision[]> {
    const revisions = await this.pool.query<{ revision_id: string }>(
      `SELECT revision_id
         FROM p1_supply_registry_revisions
        WHERE workspace_id = $1
        ORDER BY catalog_revision_number, revision_id`,
      [workspaceId]
    );
    const loaded = await Promise.all(
      revisions.rows.map(({ revision_id }) =>
        this.getRegistryRevision(workspaceId, revision_id)
      )
    );
    return loaded.filter(
      (revision): revision is PersistedRegistryRevision => revision !== null
    );
  }

  async saveCredentialAccount(
    workspaceId: string,
    account: CredentialAccount,
    expectedRecordRevision: number | null
  ): Promise<number> {
    if (account.workspaceId !== workspaceId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'CredentialAccount workspace does not match the persistence scope.'
      );
    }
    const result =
      expectedRecordRevision === null
        ? await this.pool.query<{ record_revision: string | number }>(
            `INSERT INTO p1_supply_credential_accounts
               (workspace_id, account_id, record_revision, account, updated_at)
             VALUES ($1, $2, 1, $3::jsonb, now())
             ON CONFLICT (workspace_id, account_id) DO NOTHING
             RETURNING record_revision`,
            [workspaceId, account.id, JSON.stringify(account)]
          )
        : await this.pool.query<{ record_revision: string | number }>(
            `UPDATE p1_supply_credential_accounts
                SET account = $3::jsonb,
                    record_revision = record_revision + 1,
                    updated_at = now()
              WHERE workspace_id = $1 AND account_id = $2
                AND record_revision = $4
              RETURNING record_revision`,
            [
              workspaceId,
              account.id,
              JSON.stringify(account),
              expectedRecordRevision,
            ]
          );
    const recordRevision = result.rows[0]?.record_revision;
    if (recordRevision === undefined) {
      throw concurrencyConflict(
        `CredentialAccount ${account.id} changed before metadata could be saved.`
      );
    }
    return Number(recordRevision);
  }

  async getCredentialAccount(
    workspaceId: string,
    accountId: string
  ): Promise<{ account: CredentialAccount; recordRevision: number } | null> {
    const result = await this.pool.query<CredentialAccountRow>(
      `SELECT account, record_revision
         FROM p1_supply_credential_accounts
        WHERE workspace_id = $1 AND account_id = $2`,
      [workspaceId, accountId]
    );
    const row = result.rows[0];
    return row
      ? { account: row.account, recordRevision: Number(row.record_revision) }
      : null;
  }

  async listCredentialAccounts(
    workspaceId: string
  ): Promise<Array<{ account: CredentialAccount; recordRevision: number }>> {
    const result = await this.pool.query<CredentialAccountRow>(
      `SELECT account, record_revision
         FROM p1_supply_credential_accounts
        WHERE workspace_id = $1
        ORDER BY account_id`,
      [workspaceId]
    );
    return result.rows.map((row) => ({
      account: row.account,
      recordRevision: Number(row.record_revision),
    }));
  }

  async setEffectiveCapabilityRevision(
    workspaceId: string,
    revision: RuntimeCapabilityRevision,
    expectedHeadRevisionId: string | null
  ): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      const immutableRevision = await client.query(
        `INSERT INTO p1_supply_capability_revisions
           (workspace_id, revision_id, revision_number, revision)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (workspace_id, revision_id) DO UPDATE
           SET revision_id = p1_supply_capability_revisions.revision_id
         WHERE p1_supply_capability_revisions.revision_number =
               EXCLUDED.revision_number
           AND p1_supply_capability_revisions.revision = EXCLUDED.revision
         RETURNING revision_id`,
        [
          workspaceId,
          revision.revisionId,
          revision.number,
          JSON.stringify(revision),
        ]
      );
      if (immutableRevision.rowCount !== 1) {
        throw concurrencyConflict(
          `Effective capability revision ${revision.revisionId} already exists with different content.`
        );
      }
      await setHead(
        client,
        'p1_supply_capability_heads',
        workspaceId,
        revision.revisionId,
        expectedHeadRevisionId
      );
    });
  }

  async getEffectiveCapabilityRevision(
    workspaceId: string
  ): Promise<RuntimeCapabilityRevision | null> {
    const result = await this.pool.query<{
      revision: RuntimeCapabilityRevision;
    }>(
      `SELECT revisions.revision
         FROM p1_supply_capability_heads heads
         JOIN p1_supply_capability_revisions revisions
           ON revisions.workspace_id = heads.workspace_id
          AND revisions.revision_id = heads.revision_id
        WHERE heads.workspace_id = $1`,
      [workspaceId]
    );
    return result.rows[0]?.revision ?? null;
  }

  async getCapabilityRevision(
    workspaceId: string,
    revisionId: string
  ): Promise<RuntimeCapabilityRevision | null> {
    const result = await this.pool.query<{
      revision: RuntimeCapabilityRevision;
    }>(
      `SELECT revision
         FROM p1_supply_capability_revisions
        WHERE workspace_id = $1 AND revision_id = $2`,
      [workspaceId, revisionId]
    );
    return result.rows[0]?.revision ?? null;
  }

  async listCapabilityRevisions(
    workspaceId: string
  ): Promise<RuntimeCapabilityRevision[]> {
    const result = await this.pool.query<{
      revision: RuntimeCapabilityRevision;
    }>(
      `SELECT revision
         FROM p1_supply_capability_revisions
        WHERE workspace_id = $1
        ORDER BY revision_number, revision_id`,
      [workspaceId]
    );
    return result.rows.map(({ revision }) => revision);
  }

  async deleteWorkspaceForTest(workspaceId: string): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await client.query(
        'DELETE FROM p1_supply_registry_revisions WHERE workspace_id = $1',
        [workspaceId]
      );
      await client.query(
        'DELETE FROM p1_supply_credential_accounts WHERE workspace_id = $1',
        [workspaceId]
      );
      await client.query(
        'DELETE FROM p1_supply_capability_revisions WHERE workspace_id = $1',
        [workspaceId]
      );
    });
  }
}

/**
 * Async PostgreSQL access for effective capability revisions. Runtime callers
 * explicitly hydrate a synchronous store per refresh/request boundary because
 * CapabilityHotAssemblyRegistry intentionally rejects async stores.
 */
export class PostgresEffectiveCapabilityRevisionStore {
  constructor(
    private readonly repository: PostgresSupplyControlPlaneRepository,
    private readonly workspaceId: string
  ) {}

  get(): Promise<RuntimeCapabilityRevision | null> {
    return this.repository.getEffectiveCapabilityRevision(this.workspaceId);
  }

  async set(revision: RuntimeCapabilityRevision): Promise<void> {
    const current = await this.get();
    await this.repository.setEffectiveCapabilityRevision(
      this.workspaceId,
      revision,
      current?.revisionId ?? null
    );
  }

  getById(revisionId: string): Promise<RuntimeCapabilityRevision | null> {
    return this.repository.getCapabilityRevision(this.workspaceId, revisionId);
  }

  listHistory(): Promise<RuntimeCapabilityRevision[]> {
    return this.repository.listCapabilityRevisions(this.workspaceId);
  }

  async loadRuntimeStore(): Promise<MemoryEffectiveCapabilityRevisionStore> {
    const [history, head] = await Promise.all([this.listHistory(), this.get()]);
    const runtimeStore = new MemoryEffectiveCapabilityRevisionStore();
    for (const revision of history) runtimeStore.set(revision);
    if (head) runtimeStore.set(head);
    return runtimeStore;
  }

  compareAndSet(
    revision: RuntimeCapabilityRevision,
    expectedHeadRevisionId: string | null
  ): Promise<void> {
    return this.repository.setEffectiveCapabilityRevision(
      this.workspaceId,
      revision,
      expectedHeadRevisionId
    );
  }
}
