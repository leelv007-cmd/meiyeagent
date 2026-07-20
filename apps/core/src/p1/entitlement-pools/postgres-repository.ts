import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type {
  DedicatedSupplyPool,
  SupplyCapacityLimits,
  SupplyPool,
} from '@meiye/contracts';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import { P1DomainError } from '../foundation/domain.js';
import type {
  AccountAllocation,
  EntitlementPlanTier,
  EntitlementPolicyRevision,
} from './contracts.js';
import { AccountAllocationStore } from './account-allocation.js';
import {
  buildSupplyRequestFreeze,
  type SupplyRequestFreeze,
} from './supply-ledger-fields.js';
import {
  compareFairQueueOrder,
  FAIR_QUEUE_SERVICE_TURN_WINDOW,
  type FairQueueEntry,
} from './fair-queue.js';
import {
  normalizeThreeLayerLimits,
  type CapacityAdmissionDecision,
  type CapacityLease,
  type CapacityUsageSnapshot,
  type ThreeLayerCapacityLimits,
} from './three-layer-capacity.js';

/**
 * Per-supply-account capacity lock (F-H-04).
 * Replaces the former global `p1:capacity-leases:global` hotspot so distinct
 * supply accounts no longer serialize on one advisory lock.
 */
export function capacitySupplyAccountLockKey(supplyAccountId: string): string {
  return `p1:capacity-leases:supply:${supplyAccountId}`;
}

/**
 * Independent system-total capacity lock (F-H-04).
 * Held only for the system-total count + lease insert path so supply-local
 * checks can proceed in parallel across accounts.
 */
export function capacitySystemLockKey(): string {
  return 'p1:capacity-leases:system';
}

interface PayloadRow<T = unknown> extends QueryResultRow {
  payload: T;
}

async function inTransaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function conflict(message: string): never {
  throw new P1DomainError('IDEMPOTENCY_CONFLICT', message);
}

function isoTimestamp(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString();
}

export class PostgresEntitlementPoolsMigration
  implements PostgresSchemaMigrator
{
  async migrate(client: PoolClient) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS p1_entitlement_policy_revisions (
        tier text NOT NULL,
        revision bigint NOT NULL CHECK (revision > 0),
        revision_id text NOT NULL UNIQUE,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (tier, revision),
        UNIQUE (tier, revision, revision_id)
      );
      CREATE TABLE IF NOT EXISTS p1_entitlement_policy_heads (
        tier text PRIMARY KEY,
        revision bigint NOT NULL CHECK (revision > 0),
        revision_id text NOT NULL UNIQUE,
        updated_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (tier, revision, revision_id)
          REFERENCES p1_entitlement_policy_revisions (
            tier, revision, revision_id
          )
      );

      CREATE TABLE IF NOT EXISTS p1_account_allocations (
        allocation_id text PRIMARY KEY,
        account_id text NOT NULL,
        workspace_id text NOT NULL,
        starts_at timestamptz NOT NULL,
        ends_at timestamptz,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        CHECK (ends_at IS NULL OR ends_at > starts_at)
      );
      CREATE INDEX IF NOT EXISTS p1_account_allocations_active_idx
        ON p1_account_allocations (account_id, workspace_id, starts_at, ends_at);
      CREATE TABLE IF NOT EXISTS p1_account_allocation_rollbacks (
        allocation_id text PRIMARY KEY
          REFERENCES p1_account_allocations (allocation_id),
        actor_id text NOT NULL,
        reason text NOT NULL,
        correlation_id text NOT NULL,
        rolled_back_at timestamptz NOT NULL
      );

      CREATE TABLE IF NOT EXISTS p1_supply_pool_revisions (
        pool_id text NOT NULL,
        revision_id text NOT NULL,
        kind text NOT NULL CHECK (kind IN ('shared', 'dedicated')),
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (pool_id, revision_id)
      );
      CREATE TABLE IF NOT EXISTS p1_supply_pool_heads (
        pool_id text PRIMARY KEY,
        revision_id text NOT NULL,
        kind text NOT NULL CHECK (kind IN ('shared', 'dedicated')),
        updated_at timestamptz NOT NULL DEFAULT now(),
        FOREIGN KEY (pool_id, revision_id)
          REFERENCES p1_supply_pool_revisions (pool_id, revision_id)
      );
      CREATE INDEX IF NOT EXISTS p1_supply_pool_heads_kind_idx
        ON p1_supply_pool_heads (kind, pool_id);

      CREATE TABLE IF NOT EXISTS p1_capacity_leases (
        lease_id text PRIMARY KEY,
        supply_account_id text NOT NULL,
        product_account_id text NOT NULL,
        workspace_id text NOT NULL,
        acquired_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        released_at timestamptz,
        CHECK (expires_at > acquired_at),
        CHECK (released_at IS NULL OR released_at >= acquired_at)
      );
      CREATE INDEX IF NOT EXISTS p1_capacity_leases_supply_active_idx
        ON p1_capacity_leases (supply_account_id, expires_at)
        WHERE released_at IS NULL;
      CREATE INDEX IF NOT EXISTS p1_capacity_leases_product_active_idx
        ON p1_capacity_leases (product_account_id, expires_at)
        WHERE released_at IS NULL;

      CREATE TABLE IF NOT EXISTS p1_supply_capacity_queue (
        request_id text PRIMARY KEY,
        lease_id text,
        supply_account_id text NOT NULL,
        product_account_id text NOT NULL,
        workspace_id text NOT NULL,
        capacity_limits jsonb,
        product_account_limit integer,
        queue_priority integer NOT NULL CHECK (queue_priority >= 0),
        status text NOT NULL CHECK (status IN ('waiting', 'selected', 'admitted')),
        enqueued_at timestamptz NOT NULL,
        selected_at timestamptz,
        admitted_at timestamptz
      );
      ALTER TABLE p1_supply_capacity_queue
        ADD COLUMN IF NOT EXISTS lease_id text,
        ADD COLUMN IF NOT EXISTS capacity_limits jsonb,
        ADD COLUMN IF NOT EXISTS product_account_limit integer;
      CREATE UNIQUE INDEX IF NOT EXISTS p1_supply_capacity_queue_lease_idx
        ON p1_supply_capacity_queue (lease_id)
        WHERE lease_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS p1_supply_capacity_queue_waiting_idx
        ON p1_supply_capacity_queue (
          supply_account_id, status, queue_priority DESC, enqueued_at ASC
        );
      CREATE TABLE IF NOT EXISTS p1_supply_capacity_service_turns (
        turn_id bigserial PRIMARY KEY,
        supply_account_id text NOT NULL,
        product_account_id text NOT NULL,
        request_id text NOT NULL,
        served_at timestamptz NOT NULL
      );
      ALTER TABLE p1_supply_capacity_service_turns
        DROP CONSTRAINT IF EXISTS p1_supply_capacity_service_turns_request_id_key;
      CREATE INDEX IF NOT EXISTS p1_supply_capacity_service_account_idx
        ON p1_supply_capacity_service_turns (
          supply_account_id, product_account_id, turn_id DESC
        );
      -- Sliding-window purge/count path (F-H-05): newest turns per supply account.
      CREATE INDEX IF NOT EXISTS p1_supply_capacity_service_turns_window_idx
        ON p1_supply_capacity_service_turns (supply_account_id, turn_id DESC);

      CREATE TABLE IF NOT EXISTS p1_supply_request_freezes (
        freeze_id text PRIMARY KEY,
        workspace_id text NOT NULL,
        supply_pool_id text NOT NULL,
        route_snapshot_ref text NOT NULL,
        credential_account_version text NOT NULL,
        supplier_request_task_id text NOT NULL,
        product_usage_task_id text,
        provider_cost_attempt_id text,
        payload jsonb NOT NULL,
        frozen_at timestamptz NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS p1_supply_request_freezes_product_usage_idx
        ON p1_supply_request_freezes (workspace_id, product_usage_task_id)
        WHERE product_usage_task_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS p1_supply_request_freezes_supplier_task_idx
        ON p1_supply_request_freezes (supplier_request_task_id);

      CREATE OR REPLACE FUNCTION p1_reject_entitlement_pool_fact_change()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Entitlement/pool facts are immutable';
      END;
      $$ LANGUAGE plpgsql;
      CREATE OR REPLACE FUNCTION p1_reject_supply_request_freeze_change()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Supply request freezes are immutable';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS p1_entitlement_policy_revision_immutable
        ON p1_entitlement_policy_revisions;
      CREATE TRIGGER p1_entitlement_policy_revision_immutable
        BEFORE UPDATE OR DELETE ON p1_entitlement_policy_revisions
        FOR EACH ROW EXECUTE FUNCTION p1_reject_entitlement_pool_fact_change();
      DROP TRIGGER IF EXISTS p1_account_allocation_immutable
        ON p1_account_allocations;
      CREATE TRIGGER p1_account_allocation_immutable
        BEFORE UPDATE OR DELETE ON p1_account_allocations
        FOR EACH ROW EXECUTE FUNCTION p1_reject_entitlement_pool_fact_change();
      DROP TRIGGER IF EXISTS p1_account_allocation_rollback_immutable
        ON p1_account_allocation_rollbacks;
      CREATE TRIGGER p1_account_allocation_rollback_immutable
        BEFORE UPDATE OR DELETE ON p1_account_allocation_rollbacks
        FOR EACH ROW EXECUTE FUNCTION p1_reject_entitlement_pool_fact_change();
      DROP TRIGGER IF EXISTS p1_supply_pool_revision_immutable
        ON p1_supply_pool_revisions;
      CREATE TRIGGER p1_supply_pool_revision_immutable
        BEFORE UPDATE OR DELETE ON p1_supply_pool_revisions
        FOR EACH ROW EXECUTE FUNCTION p1_reject_entitlement_pool_fact_change();
      DROP TRIGGER IF EXISTS p1_supply_request_freeze_immutable
        ON p1_supply_request_freezes;
      CREATE TRIGGER p1_supply_request_freeze_immutable
        BEFORE UPDATE OR DELETE ON p1_supply_request_freezes
        FOR EACH ROW EXECUTE FUNCTION p1_reject_supply_request_freeze_change();
    `);
  }
}

interface PolicyHeadRow extends QueryResultRow {
  revision: string;
  revision_id: string;
}

function asPolicyHistoryRevision(
  revision: EntitlementPolicyRevision,
  publishedRevisionId: string | null
): EntitlementPolicyRevision {
  if (revision.id === publishedRevisionId) {
    return { ...revision, stage: 'published' };
  }
  return revision.stage === 'published'
    ? { ...revision, stage: 'superseded' }
    : revision;
}

/** Durable, process-shared published EntitlementPolicy revision heads. */
export class PostgresEntitlementPolicyStore {
  constructor(private readonly pool: Pool) {}

  async publish(
    revision: EntitlementPolicyRevision,
    expectedPublishedRevision: number | null
  ): Promise<EntitlementPolicyRevision> {
    if (
      revision.stage !== 'published' ||
      revision.body.tier !== revision.tier ||
      !Number.isInteger(revision.revision) ||
      revision.revision <= 0
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Published EntitlementPolicy revision must have a matching tier and positive revision.'
      );
    }
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `p1:entitlement-policy:${revision.tier}`,
      ]);
      const existing = await client.query<
        PayloadRow<EntitlementPolicyRevision>
      >(
        `SELECT payload
           FROM p1_entitlement_policy_revisions
          WHERE revision_id = $1`,
        [revision.id]
      );
      if (existing.rows[0]) {
        if (!isDeepStrictEqual(existing.rows[0].payload, revision)) {
          conflict(
            `EntitlementPolicy revision ${revision.id} already has different facts.`
          );
        }
        return structuredClone(existing.rows[0].payload);
      }

      const head = await client.query<PolicyHeadRow>(
        `SELECT revision::text AS revision, revision_id
           FROM p1_entitlement_policy_heads
          WHERE tier = $1
          FOR UPDATE`,
        [revision.tier]
      );
      const currentRevision = head.rows[0]
        ? Number(head.rows[0].revision)
        : null;
      if (currentRevision !== expectedPublishedRevision) {
        conflict(
          'EntitlementPolicy published head changed before the command could be applied.'
        );
      }
      const occupied = await client.query<{ revision_id: string }>(
        `SELECT revision_id
           FROM p1_entitlement_policy_revisions
          WHERE tier = $1 AND revision = $2`,
        [revision.tier, revision.revision]
      );
      if (occupied.rows[0]) {
        conflict(
          `EntitlementPolicy tier ${revision.tier} revision ${revision.revision} already exists.`
        );
      }

      await client.query(
        `INSERT INTO p1_entitlement_policy_revisions (
           tier, revision, revision_id, payload, created_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [
          revision.tier,
          revision.revision,
          revision.id,
          revision,
          revision.createdAt,
        ]
      );
      await client.query(
        `INSERT INTO p1_entitlement_policy_heads (
           tier, revision, revision_id, updated_at
         ) VALUES ($1, $2, $3, now())
         ON CONFLICT (tier) DO UPDATE
         SET revision = EXCLUDED.revision,
             revision_id = EXCLUDED.revision_id,
             updated_at = now()`,
        [revision.tier, revision.revision, revision.id]
      );
      return structuredClone(revision);
    });
  }

  async getPublished(
    tier: EntitlementPlanTier
  ): Promise<EntitlementPolicyRevision | null> {
    const result = await this.pool.query<PayloadRow<EntitlementPolicyRevision>>(
      `SELECT revisions.payload
         FROM p1_entitlement_policy_heads heads
         JOIN p1_entitlement_policy_revisions revisions
           ON revisions.tier = heads.tier
          AND revisions.revision = heads.revision
        WHERE heads.tier = $1`,
      [tier]
    );
    return result.rows[0]
      ? asPolicyHistoryRevision(
          result.rows[0].payload,
          result.rows[0].payload.id
        )
      : null;
  }

  async history(
    tier: EntitlementPlanTier
  ): Promise<EntitlementPolicyRevision[]> {
    const result = await this.pool.query<
      PayloadRow<EntitlementPolicyRevision> & {
        published_revision_id: string | null;
      }
    >(
      `SELECT revisions.payload,
              heads.revision_id AS published_revision_id
         FROM p1_entitlement_policy_revisions revisions
         LEFT JOIN p1_entitlement_policy_heads heads
           ON heads.tier = revisions.tier
        WHERE revisions.tier = $1
        ORDER BY revisions.revision ASC`,
      [tier]
    );
    return result.rows.map((row) =>
      asPolicyHistoryRevision(row.payload, row.published_revision_id)
    );
  }

  async listAll(): Promise<EntitlementPolicyRevision[]> {
    const result = await this.pool.query<
      PayloadRow<EntitlementPolicyRevision> & {
        published_revision_id: string | null;
      }
    >(
      `SELECT revisions.payload,
              heads.revision_id AS published_revision_id
         FROM p1_entitlement_policy_revisions revisions
         LEFT JOIN p1_entitlement_policy_heads heads
           ON heads.tier = revisions.tier
        ORDER BY revisions.tier ASC, revisions.revision ASC`
    );
    return result.rows.map((row) =>
      asPolicyHistoryRevision(row.payload, row.published_revision_id)
    );
  }
}

export interface RollbackPersistedAccountAllocationInput {
  allocationId: string;
  actorId: string;
  reason: string;
  correlationId: string;
  rolledBackAt: string;
}

interface AllocationRow extends PayloadRow<AccountAllocation> {
  rolled_back_at: Date | string | null;
}

function projectAllocation(row: AllocationRow, now: Date): AccountAllocation {
  if (row.rolled_back_at) {
    return {
      ...row.payload,
      status: 'rolled_back',
      rolledBackAt: isoTimestamp(row.rolled_back_at),
    };
  }
  if (
    row.payload.endsAt !== null &&
    Date.parse(row.payload.endsAt) <= now.getTime()
  ) {
    return { ...row.payload, status: 'expired', rolledBackAt: null };
  }
  return { ...row.payload, status: 'active', rolledBackAt: null };
}

/** Append-only AccountAllocation facts with rollback and expiry read overlays. */
export class PostgresAccountAllocationStore {
  constructor(private readonly pool: Pool) {}

  async append(allocation: AccountAllocation): Promise<AccountAllocation> {
    if (allocation.status !== 'active' || allocation.rolledBackAt !== null) {
      throw new P1DomainError(
        'INVALID_STATE',
        'New AccountAllocation facts must start active and not rolled back.'
      );
    }
    if (
      !allocation.id.trim() ||
      !allocation.correlationId.trim() ||
      !Number.isFinite(Date.parse(allocation.createdAt))
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'AccountAllocation persistence requires id, correlationId, and createdAt.'
      );
    }
    new AccountAllocationStore().append({
      accountId: allocation.accountId,
      workspaceId: allocation.workspaceId,
      kind: allocation.kind,
      target: allocation.target,
      delta: allocation.delta,
      source: allocation.source,
      reason: allocation.reason,
      actorId: allocation.actorId,
      startsAt: allocation.startsAt,
      endsAt: allocation.endsAt,
      correlationId: allocation.correlationId,
    });
    const inserted = await this.pool.query<PayloadRow<AccountAllocation>>(
      `INSERT INTO p1_account_allocations (
         allocation_id, account_id, workspace_id, starts_at, ends_at,
         payload, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (allocation_id) DO NOTHING
       RETURNING payload`,
      [
        allocation.id,
        allocation.accountId,
        allocation.workspaceId,
        allocation.startsAt,
        allocation.endsAt,
        allocation,
        allocation.createdAt,
      ]
    );
    const stored =
      inserted.rows[0] ??
      (
        await this.pool.query<PayloadRow<AccountAllocation>>(
          `SELECT payload
             FROM p1_account_allocations
            WHERE allocation_id = $1`,
          [allocation.id]
        )
      ).rows[0];
    if (!stored || !isDeepStrictEqual(stored.payload, allocation)) {
      conflict(
        `AccountAllocation ${allocation.id} already has different facts.`
      );
    }
    return structuredClone(stored.payload);
  }

  async rollback(
    input: RollbackPersistedAccountAllocationInput
  ): Promise<AccountAllocation> {
    if (!input.actorId.trim() || !input.reason.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'AccountAllocation rollback requires actor and reason.'
      );
    }
    const rolledBackAtMs = Date.parse(input.rolledBackAt);
    if (!Number.isFinite(rolledBackAtMs)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'AccountAllocation rolledBackAt must be a valid ISO timestamp.'
      );
    }
    const rolledBackAt = new Date(rolledBackAtMs).toISOString();
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `p1:account-allocation:${input.allocationId}`,
      ]);
      const allocation = await client.query<PayloadRow<AccountAllocation>>(
        `SELECT payload
           FROM p1_account_allocations
          WHERE allocation_id = $1`,
        [input.allocationId]
      );
      if (!allocation.rows[0]) {
        throw new P1DomainError(
          'NOT_FOUND',
          'AccountAllocation was not found.'
        );
      }
      const existing = await client.query<{
        actor_id: string;
        reason: string;
        correlation_id: string;
        rolled_back_at: Date | string;
      }>(
        `SELECT actor_id, reason, correlation_id, rolled_back_at
           FROM p1_account_allocation_rollbacks
          WHERE allocation_id = $1`,
        [input.allocationId]
      );
      const previous = existing.rows[0];
      if (previous) {
        const previousInput = {
          allocationId: input.allocationId,
          actorId: previous.actor_id,
          reason: previous.reason,
          correlationId: previous.correlation_id,
          rolledBackAt: isoTimestamp(previous.rolled_back_at),
        };
        const normalizedInput = { ...input, rolledBackAt };
        if (!isDeepStrictEqual(previousInput, normalizedInput)) {
          conflict(
            `AccountAllocation ${input.allocationId} has another rollback fact.`
          );
        }
      } else {
        await client.query(
          `INSERT INTO p1_account_allocation_rollbacks (
             allocation_id, actor_id, reason, correlation_id, rolled_back_at
           ) VALUES ($1, $2, $3, $4, $5)`,
          [
            input.allocationId,
            input.actorId,
            input.reason,
            input.correlationId,
            rolledBackAt,
          ]
        );
      }
      return {
        ...allocation.rows[0].payload,
        status: 'rolled_back',
        rolledBackAt,
      };
    });
  }

  async listActive(input: {
    accountId: string;
    workspaceId: string;
    now?: Date;
  }): Promise<AccountAllocation[]> {
    const now = input.now ?? new Date();
    const result = await this.pool.query<PayloadRow<AccountAllocation>>(
      `SELECT allocations.payload
         FROM p1_account_allocations allocations
         LEFT JOIN p1_account_allocation_rollbacks rollbacks
           ON rollbacks.allocation_id = allocations.allocation_id
        WHERE allocations.account_id = $1
          AND allocations.workspace_id = $2
          AND allocations.starts_at <= $3
          AND (allocations.ends_at IS NULL OR allocations.ends_at > $3)
          AND rollbacks.allocation_id IS NULL
        ORDER BY allocations.created_at ASC, allocations.allocation_id ASC`,
      [input.accountId, input.workspaceId, now.toISOString()]
    );
    return result.rows.map((row) => structuredClone(row.payload));
  }

  async listAll(
    accountId?: string,
    now = new Date()
  ): Promise<AccountAllocation[]> {
    const result = await this.pool.query<AllocationRow>(
      `SELECT allocations.payload, rollbacks.rolled_back_at
         FROM p1_account_allocations allocations
         LEFT JOIN p1_account_allocation_rollbacks rollbacks
           ON rollbacks.allocation_id = allocations.allocation_id
        WHERE ($1::text IS NULL OR allocations.account_id = $1)
        ORDER BY allocations.created_at ASC, allocations.allocation_id ASC`,
      [accountId ?? null]
    );
    return result.rows.map((row) => projectAllocation(row, now));
  }

  async listForWorkspace(
    workspaceId: string,
    now = new Date()
  ): Promise<AccountAllocation[]> {
    const result = await this.pool.query<AllocationRow>(
      `SELECT allocations.payload, rollbacks.rolled_back_at
         FROM p1_account_allocations allocations
         LEFT JOIN p1_account_allocation_rollbacks rollbacks
           ON rollbacks.allocation_id = allocations.allocation_id
        WHERE allocations.workspace_id = $1
        ORDER BY allocations.created_at ASC, allocations.allocation_id ASC`,
      [workspaceId]
    );
    return result.rows.map((row) => projectAllocation(row, now));
  }
}

export type PersistedSupplyPool = SupplyPool | DedicatedSupplyPool;

/** Versioned SupplyPool/DedicatedSupplyPool heads with optimistic CAS. */
export class PostgresSupplyPoolStore {
  constructor(private readonly pool: Pool) {}

  async save(
    supplyPool: PersistedSupplyPool,
    expectedRevisionId: string | null
  ): Promise<PersistedSupplyPool> {
    if (!supplyPool.id.trim() || !supplyPool.revisionId.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        'SupplyPool persistence requires id and revisionId.'
      );
    }
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `p1:supply-pool:${supplyPool.id}`,
      ]);
      const existing = await client.query<PayloadRow<PersistedSupplyPool>>(
        `SELECT payload
           FROM p1_supply_pool_revisions
          WHERE pool_id = $1 AND revision_id = $2`,
        [supplyPool.id, supplyPool.revisionId]
      );
      if (existing.rows[0]) {
        if (!isDeepStrictEqual(existing.rows[0].payload, supplyPool)) {
          conflict(
            `SupplyPool ${supplyPool.id} revision ${supplyPool.revisionId} already has different facts.`
          );
        }
        return structuredClone(existing.rows[0].payload);
      }
      const head = await client.query<{ revision_id: string; kind: string }>(
        `SELECT revision_id, kind
           FROM p1_supply_pool_heads
          WHERE pool_id = $1
          FOR UPDATE`,
        [supplyPool.id]
      );
      const current = head.rows[0]?.revision_id ?? null;
      if (current !== expectedRevisionId) {
        conflict(`SupplyPool ${supplyPool.id} revision head changed.`);
      }
      if (head.rows[0] && head.rows[0].kind !== supplyPool.kind) {
        throw new P1DomainError(
          'INVALID_STATE',
          'SupplyPool kind cannot change across revisions.'
        );
      }
      await client.query(
        `INSERT INTO p1_supply_pool_revisions (
           pool_id, revision_id, kind, payload
         ) VALUES ($1, $2, $3, $4::jsonb)`,
        [supplyPool.id, supplyPool.revisionId, supplyPool.kind, supplyPool]
      );
      await client.query(
        `INSERT INTO p1_supply_pool_heads (
           pool_id, revision_id, kind, updated_at
         ) VALUES ($1, $2, $3, now())
         ON CONFLICT (pool_id) DO UPDATE
         SET revision_id = EXCLUDED.revision_id,
             kind = EXCLUDED.kind,
             updated_at = now()`,
        [supplyPool.id, supplyPool.revisionId, supplyPool.kind]
      );
      return structuredClone(supplyPool);
    });
  }

  async get(poolId: string): Promise<PersistedSupplyPool | null> {
    const result = await this.pool.query<PayloadRow<PersistedSupplyPool>>(
      `SELECT revisions.payload
         FROM p1_supply_pool_heads heads
         JOIN p1_supply_pool_revisions revisions
           ON revisions.pool_id = heads.pool_id
          AND revisions.revision_id = heads.revision_id
        WHERE heads.pool_id = $1`,
      [poolId]
    );
    return result.rows[0] ? structuredClone(result.rows[0].payload) : null;
  }

  async list(
    kind?: PersistedSupplyPool['kind']
  ): Promise<PersistedSupplyPool[]> {
    const result = await this.pool.query<PayloadRow<PersistedSupplyPool>>(
      `SELECT revisions.payload
         FROM p1_supply_pool_heads heads
         JOIN p1_supply_pool_revisions revisions
           ON revisions.pool_id = heads.pool_id
          AND revisions.revision_id = heads.revision_id
        WHERE ($1::text IS NULL OR heads.kind = $1)
        ORDER BY heads.pool_id ASC`,
      [kind ?? null]
    );
    return result.rows.map((row) => structuredClone(row.payload));
  }

  async history(poolId: string): Promise<PersistedSupplyPool[]> {
    const result = await this.pool.query<PayloadRow<PersistedSupplyPool>>(
      `SELECT payload
         FROM p1_supply_pool_revisions
        WHERE pool_id = $1
        ORDER BY created_at ASC, revision_id ASC`,
      [poolId]
    );
    return result.rows.map((row) => structuredClone(row.payload));
  }
}

export const DEFAULT_RUNTIME_CREDENTIAL_ACCOUNT_IDS = [
  'credential-account:platform:model.direct',
  'credential-account:platform:ark.media',
] as const;

/** Keep the process-shared boot pool aligned with request-time runtime identities. */
export async function ensureDefaultRuntimeSupplyPool(
  store: PostgresSupplyPoolStore,
  deploymentIds: readonly string[]
): Promise<PersistedSupplyPool> {
  const requiredDeployments = [...new Set(deploymentIds)].sort();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await store.get('pool-shared-default');
    if (current && current.kind !== 'shared') {
      throw new P1DomainError(
        'INVALID_STATE',
        'Default runtime SupplyPool must remain shared.'
      );
    }
    const hasRuntimeAccounts = DEFAULT_RUNTIME_CREDENTIAL_ACCOUNT_IDS.every(
      (id) => current?.credentialAccountIds.includes(id)
    );
    const hasDeployments = requiredDeployments.every((id) =>
      current?.deploymentIds.includes(id)
    );
    if (current && hasRuntimeAccounts && hasDeployments) return current;

    const credentialAccountIds = [
      ...new Set([
        ...(current?.credentialAccountIds ?? []),
        ...DEFAULT_RUNTIME_CREDENTIAL_ACCOUNT_IDS,
      ]),
    ];
    const mergedDeploymentIds = [
      ...new Set([...(current?.deploymentIds ?? []), ...requiredDeployments]),
    ].sort();
    const revisionHash = createHash('sha256')
      .update(
        JSON.stringify({
          credentialAccountIds,
          deploymentIds: mergedDeploymentIds,
        })
      )
      .digest('hex')
      .slice(0, 16);
    const next: SupplyPool = {
      ...(current ?? {}),
      id: 'pool-shared-default',
      kind: 'shared',
      displayName: current?.displayName ?? 'Shared default supply pool',
      credentialAccountIds,
      deploymentIds: mergedDeploymentIds,
      revisionId: `boot-pool-shared-default:${revisionHash}`,
    };
    try {
      return await store.save(next, current?.revisionId ?? null);
    } catch (error) {
      if (
        !(error instanceof P1DomainError) ||
        error.code !== 'IDEMPOTENCY_CONFLICT'
      ) {
        throw error;
      }
    }
  }
  throw new P1DomainError(
    'IDEMPOTENCY_CONFLICT',
    'Default runtime SupplyPool changed repeatedly during bootstrap.'
  );
}

export interface AcquirePostgresCapacityLeaseInput {
  leaseId: string;
  supplyAccountId: string;
  productAccountId: string;
  workspaceId: string;
  limits: SupplyCapacityLimits | ThreeLayerCapacityLimits;
  productAccountLimit?: number;
  acquiredAt: string;
  expiresAt: string;
  /** Explicit comparison clock makes expiry behavior replayable in tests/jobs. */
  now?: string;
}

export interface AcquireFairPostgresCapacityLeaseInput
  extends AcquirePostgresCapacityLeaseInput {
  queueRequestId: string;
  queuePriority: number;
  maxWaitMs?: number;
  pollIntervalMs?: number;
}

interface CapacityLeaseRow extends QueryResultRow {
  lease_id: string;
  supply_account_id: string;
  product_account_id: string;
  workspace_id: string;
  acquired_at: Date | string;
  expires_at: Date | string;
  released_at: Date | string | null;
}

function toCapacityLease(row: CapacityLeaseRow): CapacityLease {
  return {
    leaseId: row.lease_id,
    supplyAccountId: row.supply_account_id,
    productAccountId: row.product_account_id,
    workspaceId: row.workspace_id,
    acquiredAt: isoTimestamp(row.acquired_at),
  };
}

interface FairQueueRow extends QueryResultRow {
  request_id: string;
  lease_id: string | null;
  supply_account_id: string;
  product_account_id: string;
  workspace_id: string;
  capacity_limits: SupplyCapacityLimits | ThreeLayerCapacityLimits | null;
  product_account_limit: number | null;
  queue_priority: number;
  enqueued_at: Date | string;
  status: 'waiting' | 'selected' | 'admitted';
}

/** PostgreSQL-backed fair turns shared by every HTTP/Worker process. */
export class PostgresSupplyAccountFairQueue {
  constructor(private readonly pool: Pool) {}

  async enqueue(input: {
    supplyAccountId: string;
    requestId: string;
    leaseId?: string;
    productAccountId: string;
    workspaceId: string;
    capacityLimits?: SupplyCapacityLimits | ThreeLayerCapacityLimits;
    productAccountLimit?: number;
    queuePriority: number;
    enqueuedAt: string;
  }): Promise<void> {
    const enqueuedAt = new Date(input.enqueuedAt).toISOString();
    const result = await this.pool.query<FairQueueRow>(
      `INSERT INTO p1_supply_capacity_queue (
         request_id, lease_id, supply_account_id, product_account_id,
         workspace_id, capacity_limits, product_account_limit,
         queue_priority, status, enqueued_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'waiting', $9)
       ON CONFLICT (request_id) DO UPDATE
         SET request_id = EXCLUDED.request_id
       RETURNING request_id, lease_id, supply_account_id, product_account_id,
                 workspace_id, capacity_limits, product_account_limit,
                 queue_priority, enqueued_at, status`,
      [
        input.requestId,
        input.leaseId ?? null,
        input.supplyAccountId,
        input.productAccountId,
        input.workspaceId,
        input.capacityLimits ?? null,
        input.productAccountLimit ?? null,
        input.queuePriority,
        enqueuedAt,
      ]
    );
    const existing = result.rows[0];
    if (
      !existing ||
      existing.supply_account_id !== input.supplyAccountId ||
      existing.product_account_id !== input.productAccountId ||
      existing.workspace_id !== input.workspaceId ||
      existing.queue_priority !== input.queuePriority ||
      (input.leaseId !== undefined && existing.lease_id !== input.leaseId) ||
      (input.capacityLimits !== undefined &&
        !isDeepStrictEqual(existing.capacity_limits, input.capacityLimits)) ||
      (input.productAccountLimit !== undefined &&
        existing.product_account_limit !== input.productAccountLimit)
    ) {
      conflict(`Fair queue request ${input.requestId} has different facts.`);
    }
  }

  async claimTurn(
    supplyAccountId: string,
    requestId: string,
    now = new Date().toISOString()
  ): Promise<boolean> {
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `p1:supply-fair-queue:${supplyAccountId}`,
      ]);
      await client.query(
        `UPDATE p1_supply_capacity_queue
            SET status = 'waiting', selected_at = NULL
          WHERE supply_account_id = $1
            AND status = 'selected'
            AND selected_at < $2::timestamptz - interval '1 minute'`,
        [supplyAccountId, now]
      );
      const current = await client.query<Pick<FairQueueRow, 'status'>>(
        `SELECT status
           FROM p1_supply_capacity_queue
          WHERE request_id = $1 AND supply_account_id = $2`,
        [requestId, supplyAccountId]
      );
      if (current.rows[0]?.status === 'selected') return true;
      if (current.rows[0]?.status === 'admitted') return false;
      const selectedPeer = await client.query(
        `SELECT 1
           FROM p1_supply_capacity_queue
          WHERE supply_account_id = $1 AND status = 'selected'
          LIMIT 1`,
        [supplyAccountId]
      );
      if (selectedPeer.rowCount) return false;

      const waiting = await client.query<FairQueueRow>(
        `SELECT request_id, product_account_id, workspace_id,
                queue_priority, enqueued_at, status
           FROM p1_supply_capacity_queue
          WHERE supply_account_id = $1 AND status = 'waiting'`,
        [supplyAccountId]
      );
      // F-H-05: only the sliding window of recent turns feeds fair weights.
      const service = await client.query<{
        product_account_id: string;
        served_count: string;
      }>(
        `SELECT product_account_id, count(*)::text AS served_count
           FROM (
             SELECT product_account_id
               FROM p1_supply_capacity_service_turns
              WHERE supply_account_id = $1
              ORDER BY turn_id DESC
              LIMIT $2
           ) recent
          GROUP BY product_account_id`,
        [supplyAccountId, FAIR_QUEUE_SERVICE_TURN_WINDOW]
      );
      const serviceCounts = new Map(
        service.rows.map((row) => [
          row.product_account_id,
          Number(row.served_count),
        ])
      );
      const ordered = waiting.rows
        .map(
          (row): FairQueueEntry => ({
            requestId: row.request_id,
            productAccountId: row.product_account_id,
            workspaceId: row.workspace_id,
            queuePriority: row.queue_priority,
            enqueuedAt: isoTimestamp(row.enqueued_at),
          })
        )
        .sort((left, right) =>
          compareFairQueueOrder(left, right, serviceCounts)
        );
      if (ordered[0]?.requestId !== requestId) return false;
      const selected = await client.query(
        `UPDATE p1_supply_capacity_queue
            SET status = 'selected', selected_at = $2
          WHERE request_id = $1 AND status = 'waiting'`,
        [requestId, now]
      );
      return selected.rowCount === 1;
    });
  }

  async requeue(requestId: string): Promise<void> {
    await this.pool.query(
      `UPDATE p1_supply_capacity_queue
          SET status = 'waiting', selected_at = NULL
        WHERE request_id = $1 AND status = 'selected'`,
      [requestId]
    );
  }

  async reopenAdmitted(requestId: string): Promise<void> {
    await this.pool.query(
      `UPDATE p1_supply_capacity_queue
          SET status = 'waiting', selected_at = NULL, admitted_at = NULL
        WHERE request_id = $1 AND status = 'admitted'`,
      [requestId]
    );
  }

  async complete(
    supplyAccountId: string,
    requestId: string,
    productAccountId: string,
    admittedAt: string
  ): Promise<void> {
    await inTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `p1:supply-fair-queue:${supplyAccountId}`,
      ]);
      const completed = await client.query(
        `UPDATE p1_supply_capacity_queue
            SET status = 'admitted', admitted_at = $2
          WHERE request_id = $1 AND status = 'selected'`,
        [requestId, admittedAt]
      );
      if (completed.rowCount !== 1) return;
      await client.query(
        `INSERT INTO p1_supply_capacity_service_turns (
           supply_account_id, product_account_id, request_id, served_at
         ) VALUES ($1, $2, $3, $4)`,
        [supplyAccountId, productAccountId, requestId, admittedAt]
      );
      // F-H-05: purge turns outside the sliding window so the table cannot grow unbounded.
      await client.query(
        `DELETE FROM p1_supply_capacity_service_turns
          WHERE supply_account_id = $1
            AND turn_id <= (
              SELECT turn_id
                FROM p1_supply_capacity_service_turns
               WHERE supply_account_id = $1
               ORDER BY turn_id DESC
               OFFSET $2
               LIMIT 1
            )`,
        [supplyAccountId, FAIR_QUEUE_SERVICE_TURN_WINDOW]
      );
    });
  }

  async listWaiting(supplyAccountId: string): Promise<FairQueueEntry[]> {
    const rows = await this.pool.query<FairQueueRow>(
      `SELECT request_id, product_account_id, workspace_id,
              queue_priority, enqueued_at, status
         FROM p1_supply_capacity_queue
        WHERE supply_account_id = $1 AND status IN ('waiting', 'selected')
        ORDER BY enqueued_at ASC, request_id ASC`,
      [supplyAccountId]
    );
    return rows.rows.map((row) => ({
      requestId: row.request_id,
      productAccountId: row.product_account_id,
      workspaceId: row.workspace_id,
      queuePriority: row.queue_priority,
      enqueuedAt: isoTimestamp(row.enqueued_at),
    }));
  }

  async status(
    requestId: string
  ): Promise<'waiting' | 'selected' | 'admitted' | null> {
    const result = await this.pool.query<Pick<FairQueueRow, 'status'>>(
      `SELECT status FROM p1_supply_capacity_queue WHERE request_id = $1`,
      [requestId]
    );
    return result.rows[0]?.status ?? null;
  }

  async reacquireInput(
    leaseId: string,
    acquiredAt: string,
    expiresAt: string,
    maxWaitMs?: number
  ): Promise<AcquireFairPostgresCapacityLeaseInput | null> {
    const result = await this.pool.query<FairQueueRow>(
      `SELECT request_id, lease_id, supply_account_id, product_account_id,
              workspace_id, capacity_limits, product_account_limit,
              queue_priority, enqueued_at, status
         FROM p1_supply_capacity_queue
        WHERE lease_id = $1
        LIMIT 1`,
      [leaseId]
    );
    const row = result.rows[0];
    if (!row?.lease_id || !row.capacity_limits) return null;
    return {
      leaseId: row.lease_id,
      queueRequestId: row.request_id,
      supplyAccountId: row.supply_account_id,
      productAccountId: row.product_account_id,
      workspaceId: row.workspace_id,
      limits: row.capacity_limits,
      ...(row.product_account_limit === null
        ? {}
        : { productAccountLimit: row.product_account_limit }),
      queuePriority: row.queue_priority,
      acquiredAt,
      expiresAt,
      now: acquiredAt,
      ...(maxWaitMs === undefined ? {} : { maxWaitMs }),
    };
  }
}

/** Cross-process three-layer capacity admission backed by expiring leases. */
export class PostgresCapacityLeaseStore {
  private readonly fairQueue: PostgresSupplyAccountFairQueue;

  constructor(private readonly pool: Pool) {
    this.fairQueue = new PostgresSupplyAccountFairQueue(pool);
  }

  async tryAcquireFair(
    input: AcquireFairPostgresCapacityLeaseInput
  ): Promise<CapacityAdmissionDecision> {
    await this.fairQueue.enqueue({
      supplyAccountId: input.supplyAccountId,
      requestId: input.queueRequestId,
      leaseId: input.leaseId,
      productAccountId: input.productAccountId,
      workspaceId: input.workspaceId,
      capacityLimits: input.limits,
      ...(input.productAccountLimit === undefined
        ? {}
        : { productAccountLimit: input.productAccountLimit }),
      queuePriority: input.queuePriority,
      enqueuedAt: input.acquiredAt,
    });
    if ((await this.fairQueue.status(input.queueRequestId)) === 'admitted') {
      const renewedAt = new Date();
      const renewed = await this.renew(
        input.leaseId,
        new Date(
          renewedAt.getTime() +
            Math.max(
              1,
              Date.parse(input.expiresAt) - Date.parse(input.acquiredAt)
            )
        ).toISOString(),
        renewedAt.toISOString()
      );
      if (renewed) {
        return {
          status: 'admitted',
          lease: {
            leaseId: input.leaseId,
            supplyAccountId: input.supplyAccountId,
            productAccountId: input.productAccountId,
            workspaceId: input.workspaceId,
            acquiredAt: input.acquiredAt,
          },
        };
      }
      await this.fairQueue.reopenAdmitted(input.queueRequestId);
    }

    const maxWaitMs = input.maxWaitMs ?? 30_000;
    const pollIntervalMs = input.pollIntervalMs ?? 25;
    const deadline = Date.now() + maxWaitMs;
    let lastRejection: CapacityAdmissionDecision | undefined;
    for (;;) {
      if (
        await this.fairQueue.claimTurn(
          input.supplyAccountId,
          input.queueRequestId
        )
      ) {
        const decision = await this.tryAcquireInternal(input, true);
        if (decision.status === 'admitted') {
          await this.fairQueue.complete(
            input.supplyAccountId,
            input.queueRequestId,
            input.productAccountId,
            new Date().toISOString()
          );
          return decision;
        }
        lastRejection = decision;
        // Product-account rejection is terminal for this wait: release selected
        // so peers can claim the turn. Supply/system rejections may keep
        // selected and retry until the deadline.
        if (
          decision.status === 'rejected' &&
          decision.layer === 'product_account'
        ) {
          await this.fairQueue.requeue(input.queueRequestId);
          return decision;
        }
      }
      if (Date.now() >= deadline) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, pollIntervalMs);
      });
    }

    await this.fairQueue.requeue(input.queueRequestId);
    return (
      lastRejection ?? {
        status: 'rejected',
        layer: 'supply_account',
        code: 'CAPACITY_EXHAUSTED',
        message: `Supply-account ${input.supplyAccountId} remains queued behind a fair peer.`,
        inUse: 0,
        limit: normalizeThreeLayerLimits(input.limits).supplyAccount
          .concurrency,
      }
    );
  }

  async reacquireFair(
    leaseId: string,
    expiresAt: string,
    now = new Date().toISOString(),
    maxWaitMs?: number
  ): Promise<CapacityAdmissionDecision | null> {
    const input = await this.fairQueue.reacquireInput(
      leaseId,
      now,
      expiresAt,
      maxWaitMs
    );
    return input ? this.tryAcquireFair(input) : null;
  }

  async tryAcquire(
    input: AcquirePostgresCapacityLeaseInput
  ): Promise<CapacityAdmissionDecision> {
    return this.tryAcquireInternal(input, false);
  }

  private async tryAcquireInternal(
    input: AcquirePostgresCapacityLeaseInput,
    allowExpiredReacquire: boolean
  ): Promise<CapacityAdmissionDecision> {
    const limits = normalizeThreeLayerLimits(input.limits);
    const acquiredAt = Date.parse(input.acquiredAt);
    const expiresAt = Date.parse(input.expiresAt);
    const now = input.now ?? new Date().toISOString();
    const nowMs = Date.parse(now);
    if (
      !input.leaseId.trim() ||
      !input.supplyAccountId.trim() ||
      !input.productAccountId.trim() ||
      !input.workspaceId.trim() ||
      !Number.isFinite(acquiredAt) ||
      !Number.isFinite(expiresAt) ||
      !Number.isFinite(nowMs) ||
      acquiredAt > nowMs ||
      expiresAt <= nowMs
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Capacity lease requires identities and an expiry after acquisition.'
      );
    }
    const normalizedAcquiredAt = new Date(acquiredAt).toISOString();
    const normalizedExpiresAt = new Date(expiresAt).toISOString();
    const normalizedNow = new Date(nowMs).toISOString();
    const productLimit =
      input.productAccountLimit ?? limits.productAccount.concurrency;
    if (!Number.isInteger(productLimit) || productLimit <= 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'productAccountLimit must be a positive integer.'
      );
    }
    return inTransaction(this.pool, async (client) => {
      // F-H-04: per-supply-account lock (not the former global hotspot).
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        capacitySupplyAccountLockKey(input.supplyAccountId),
      ]);
      const existing = await client.query<CapacityLeaseRow>(
        `SELECT lease_id, supply_account_id, product_account_id, workspace_id,
                acquired_at, expires_at, released_at
           FROM p1_capacity_leases
          WHERE lease_id = $1`,
        [input.leaseId]
      );
      if (existing.rows[0]) {
        const sameIdentity =
          existing.rows[0].supply_account_id === input.supplyAccountId &&
          existing.rows[0].product_account_id === input.productAccountId &&
          existing.rows[0].workspace_id === input.workspaceId;
        if (!sameIdentity) {
          conflict(
            `Capacity lease ${input.leaseId} already has different facts.`
          );
        }
        if (allowExpiredReacquire) {
          if (existing.rows[0].released_at !== null) {
            conflict(`Capacity lease ${input.leaseId} is no longer active.`);
          }
          if (Date.parse(isoTimestamp(existing.rows[0].expires_at)) > nowMs) {
            return {
              status: 'admitted',
              lease: toCapacityLease(existing.rows[0]),
            };
          }
        } else {
          const existingFacts = {
            ...toCapacityLease(existing.rows[0]),
            expiresAt: isoTimestamp(existing.rows[0].expires_at),
          };
          const requestedFacts = {
            leaseId: input.leaseId,
            supplyAccountId: input.supplyAccountId,
            productAccountId: input.productAccountId,
            workspaceId: input.workspaceId,
            acquiredAt: normalizedAcquiredAt,
            expiresAt: normalizedExpiresAt,
          };
          if (!isDeepStrictEqual(existingFacts, requestedFacts)) {
            conflict(
              `Capacity lease ${input.leaseId} already has different facts.`
            );
          }
          if (
            existing.rows[0].released_at !== null ||
            Date.parse(isoTimestamp(existing.rows[0].expires_at)) <= nowMs
          ) {
            conflict(`Capacity lease ${input.leaseId} is no longer active.`);
          }
          return {
            status: 'admitted',
            lease: toCapacityLease(existing.rows[0]),
          };
        }
      }

      // Supply-local count under the supply-account lock only.
      const supplyUsage = await client.query<{ supply_in_use: string }>(
        `SELECT count(*)::text AS supply_in_use
           FROM p1_capacity_leases
          WHERE supply_account_id = $1
            AND released_at IS NULL
            AND acquired_at <= $2
            AND expires_at > $2`,
        [input.supplyAccountId, normalizedNow]
      );
      const supplyInUse = Number(supplyUsage.rows[0]?.supply_in_use ?? 0);
      if (supplyInUse >= limits.supplyAccount.concurrency) {
        return {
          status: 'rejected',
          layer: 'supply_account',
          code: 'CAPACITY_EXHAUSTED',
          message: `Supply-account ${input.supplyAccountId} concurrency exhausted (${supplyInUse}/${limits.supplyAccount.concurrency}).`,
          inUse: supplyInUse,
          limit: limits.supplyAccount.concurrency,
        };
      }

      // F-H-04: independent system-total lock (always after supply lock → no deadlock).
      // Product-account and system-total are global layers; re-check them here.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        capacitySystemLockKey(),
      ]);
      const globalUsage = await client.query<{
        product_in_use: string;
        system_in_use: string;
      }>(
        `SELECT
           count(*) FILTER (WHERE product_account_id = $1)::text AS product_in_use,
           count(*)::text AS system_in_use
         FROM p1_capacity_leases
         WHERE released_at IS NULL
           AND acquired_at <= $2
           AND expires_at > $2`,
        [input.productAccountId, normalizedNow]
      );
      const productInUse = Number(globalUsage.rows[0]?.product_in_use ?? 0);
      const systemInUse = Number(globalUsage.rows[0]?.system_in_use ?? 0);
      if (systemInUse >= limits.systemTotal.concurrency) {
        return {
          status: 'rejected',
          layer: 'system_total',
          code: 'CAPACITY_EXHAUSTED',
          message: `System-total concurrency exhausted (${systemInUse}/${limits.systemTotal.concurrency}).`,
          inUse: systemInUse,
          limit: limits.systemTotal.concurrency,
        };
      }
      if (productInUse >= productLimit) {
        return {
          status: 'rejected',
          layer: 'product_account',
          code: 'CAPACITY_EXHAUSTED',
          message: `Product-account ${input.productAccountId} concurrency exhausted (${productInUse}/${productLimit}).`,
          inUse: productInUse,
          limit: productLimit,
        };
      }
      if (existing.rows[0]) {
        const reacquired = await client.query(
          `UPDATE p1_capacity_leases
              SET acquired_at = $2, expires_at = $3
            WHERE lease_id = $1
              AND released_at IS NULL
              AND expires_at <= $2`,
          [input.leaseId, normalizedNow, normalizedExpiresAt]
        );
        if (reacquired.rowCount !== 1) {
          conflict(`Capacity lease ${input.leaseId} could not be reacquired.`);
        }
      } else {
        await client.query(
          `INSERT INTO p1_capacity_leases (
           lease_id, supply_account_id, product_account_id, workspace_id,
           acquired_at, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            input.leaseId,
            input.supplyAccountId,
            input.productAccountId,
            input.workspaceId,
            normalizedAcquiredAt,
            normalizedExpiresAt,
          ]
        );
      }
      return {
        status: 'admitted',
        lease: {
          leaseId: input.leaseId,
          supplyAccountId: input.supplyAccountId,
          productAccountId: input.productAccountId,
          workspaceId: input.workspaceId,
          acquiredAt: existing.rows[0] ? normalizedNow : normalizedAcquiredAt,
        },
      };
    });
  }

  async release(
    leaseId: string,
    releasedAt = new Date().toISOString()
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE p1_capacity_leases
          SET released_at = $2
        WHERE lease_id = $1 AND released_at IS NULL`,
      [leaseId, releasedAt]
    );
    return result.rowCount === 1;
  }

  async renew(
    leaseId: string,
    expiresAt: string,
    now = new Date().toISOString()
  ): Promise<boolean> {
    const expiresAtMs = Date.parse(expiresAt);
    const nowMs = Date.parse(now);
    if (
      !leaseId.trim() ||
      !Number.isFinite(expiresAtMs) ||
      !Number.isFinite(nowMs) ||
      expiresAtMs <= nowMs
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Capacity lease renewal requires an expiry after now.'
      );
    }
    const result = await this.pool.query(
      `UPDATE p1_capacity_leases
          SET expires_at = $2
        WHERE lease_id = $1
          AND released_at IS NULL
          AND acquired_at <= $3
          AND expires_at > $3`,
      [
        leaseId,
        new Date(expiresAtMs).toISOString(),
        new Date(nowMs).toISOString(),
      ]
    );
    return result.rowCount === 1;
  }

  async snapshot(input: {
    supplyAccountId: string;
    limits: SupplyCapacityLimits | ThreeLayerCapacityLimits;
    productAccountLimits?: Readonly<Record<string, number>>;
    now?: string;
  }): Promise<CapacityUsageSnapshot> {
    const limits = normalizeThreeLayerLimits(input.limits);
    const now = input.now ?? new Date().toISOString();
    const [supply, system] = await Promise.all([
      this.pool.query<{ product_account_id: string; in_use: string }>(
        `SELECT product_account_id, count(*)::text AS in_use
           FROM p1_capacity_leases
          WHERE supply_account_id = $1
            AND released_at IS NULL
            AND acquired_at <= $2
            AND expires_at > $2
          GROUP BY product_account_id
          ORDER BY product_account_id ASC`,
        [input.supplyAccountId, now]
      ),
      this.pool.query<{ in_use: string }>(
        `SELECT count(*)::text AS in_use
           FROM p1_capacity_leases
          WHERE released_at IS NULL
            AND acquired_at <= $1
            AND expires_at > $1`,
        [now]
      ),
    ]);
    const productAccounts = supply.rows.map((row) => ({
      productAccountId: row.product_account_id,
      inUse: Number(row.in_use),
      limit:
        input.productAccountLimits?.[row.product_account_id] ??
        limits.productAccount.concurrency,
    }));
    return {
      supplyAccountId: input.supplyAccountId,
      supplyAccountInUse: productAccounts.reduce(
        (total, account) => total + account.inUse,
        0
      ),
      supplyAccountLimit: limits.supplyAccount.concurrency,
      productAccounts,
      systemTotalInUse: Number(system.rows[0]?.in_use ?? 0),
      systemTotalLimit: limits.systemTotal.concurrency,
    };
  }
}

/** Immutable supply-side freeze facts; product usage and provider cost remain links. */
export class PostgresSupplyFreezeStore {
  constructor(private readonly pool: Pool) {}

  async append(freeze: SupplyRequestFreeze): Promise<SupplyRequestFreeze> {
    const fact = buildSupplyRequestFreeze(freeze);
    if (!Number.isFinite(Date.parse(fact.frozenAt))) {
      throw new P1DomainError(
        'INVALID_STATE',
        'SupplyRequestFreeze frozenAt must be a valid ISO timestamp.'
      );
    }
    return inTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `p1:supply-freeze:${fact.workspaceId}:${fact.productUsageTaskId ?? fact.id}`,
      ]);
      const existing = await client.query<PayloadRow<SupplyRequestFreeze>>(
        `SELECT payload
           FROM p1_supply_request_freezes
          WHERE freeze_id = $1`,
        [fact.id]
      );
      if (existing.rows[0]) {
        const { frozenAt: _existingFrozenAt, ...existingFacts } =
          existing.rows[0].payload;
        const { frozenAt: _retriedFrozenAt, ...retriedFacts } = fact;
        if (!isDeepStrictEqual(existingFacts, retriedFacts)) {
          conflict(
            `Supply request freeze ${fact.id} already has different facts.`
          );
        }
        return structuredClone(existing.rows[0].payload);
      }
      if (fact.productUsageTaskId) {
        const productUsage = await client.query<
          PayloadRow<SupplyRequestFreeze>
        >(
          `SELECT payload
             FROM p1_supply_request_freezes
            WHERE workspace_id = $1 AND product_usage_task_id = $2`,
          [fact.workspaceId, fact.productUsageTaskId]
        );
        if (productUsage.rows[0]) {
          conflict(
            `ProductUsage task ${fact.productUsageTaskId} already has another supply freeze.`
          );
        }
      }
      await client.query(
        `INSERT INTO p1_supply_request_freezes (
           freeze_id, workspace_id, supply_pool_id, route_snapshot_ref,
           credential_account_version, supplier_request_task_id,
           product_usage_task_id, provider_cost_attempt_id, payload, frozen_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
        [
          fact.id,
          fact.workspaceId,
          fact.supplyPoolId,
          fact.routeSnapshotRef,
          fact.credentialAccountVersion,
          fact.supplierRequestTaskId,
          fact.productUsageTaskId ?? null,
          fact.providerCostAttemptId ?? null,
          fact,
          fact.frozenAt,
        ]
      );
      return structuredClone(fact);
    });
  }

  async get(freezeId: string): Promise<SupplyRequestFreeze | null> {
    const result = await this.pool.query<PayloadRow<SupplyRequestFreeze>>(
      `SELECT payload
         FROM p1_supply_request_freezes
        WHERE freeze_id = $1`,
      [freezeId]
    );
    return result.rows[0] ? structuredClone(result.rows[0].payload) : null;
  }

  async getByProductUsageTask(
    workspaceId: string,
    productUsageTaskId: string
  ): Promise<SupplyRequestFreeze | null> {
    const result = await this.pool.query<PayloadRow<SupplyRequestFreeze>>(
      `SELECT payload
         FROM p1_supply_request_freezes
        WHERE workspace_id = $1 AND product_usage_task_id = $2`,
      [workspaceId, productUsageTaskId]
    );
    return result.rows[0] ? structuredClone(result.rows[0].payload) : null;
  }
}
