import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { ProductState } from '@meiye/contracts';
import type {
  GenerationJob,
  OwnedAsset,
  P1Context,
  ProviderAttempt,
  ProviderCostEvent,
  ProductEntitlementEvent,
  RelationFact,
  RouteSnapshot,
  UsageEvent,
  UsageResource,
  CutoverRecord,
  CommandAuditEvent,
} from './domain.js';
import { P1DomainError } from './domain.js';
import type {
  FoundationRepository,
  FoundationStore,
  IdempotentExecution,
} from './ports.js';

export class PostgresFoundationRepository implements FoundationRepository {
  constructor(
    private readonly pool: Pool,
    private readonly client?: PoolClient
  ) {}

  private get database() {
    return this.client ?? this.pool;
  }

  async migrate(client?: PoolClient) {
    await (client ?? this.database).query(`
      CREATE TABLE IF NOT EXISTS p1_command_results (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        idempotency_key text NOT NULL,
        payload_hash text NOT NULL,
        result jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS p1_write_ownership (
        workspace_id text PRIMARY KEY,
        owner text NOT NULL CHECK (owner IN ('legacy', 'frozen', 'p1')),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS p1_command_audits (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        idempotency_key text NOT NULL,
        payload_hash text NOT NULL,
        actor_id text NOT NULL,
        correlation_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS p1_module_commands (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        idempotency_key text NOT NULL,
        payload_hash text NOT NULL,
        status text NOT NULL CHECK (status IN ('pending', 'completed')),
        claim_token text,
        lease_expires_at timestamptz,
        result jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, idempotency_key)
      );
      ALTER TABLE p1_module_commands
        ADD COLUMN IF NOT EXISTS claim_token text;
      ALTER TABLE p1_module_commands
        ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
      CREATE TABLE IF NOT EXISTS p1_relation_facts (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id text NOT NULL,
        kind text NOT NULL,
        parent_id text,
        data jsonb NOT NULL,
        legacy_source text,
        mapping_confidence text,
        actor_id text NOT NULL,
        correlation_id text NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS p1_relation_facts_kind_idx
        ON p1_relation_facts (workspace_id, kind, created_at);
      CREATE TABLE IF NOT EXISTS p1_usage_events (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id text NOT NULL,
        resource text NOT NULL,
        action text NOT NULL,
        amount numeric NOT NULL,
        reservation_id text,
        reason text NOT NULL,
        actor_id text NOT NULL,
        correlation_id text NOT NULL,
        created_at timestamptz NOT NULL,
        billing jsonb,
        PRIMARY KEY (workspace_id, id)
      );
      ALTER TABLE p1_usage_events
        DROP CONSTRAINT IF EXISTS p1_usage_events_amount_check;
      DO $$ BEGIN
        ALTER TABLE p1_usage_events
          ADD CONSTRAINT p1_usage_events_amount_v2_check
          CHECK (amount >= 0 OR action = 'adjust');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
      CREATE UNIQUE INDEX IF NOT EXISTS p1_usage_terminal_once_idx
        ON p1_usage_events (workspace_id, reservation_id)
        WHERE action IN ('commit', 'refund', 'expire');
      CREATE INDEX IF NOT EXISTS p1_usage_projection_idx
        ON p1_usage_events (workspace_id, resource, created_at);
      CREATE TABLE IF NOT EXISTS p1_route_snapshots (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id text NOT NULL,
        catalog_revision text NOT NULL,
        policy_revision text NOT NULL,
        price_revision text NOT NULL,
        requested_catalog_model_id text NOT NULL,
        selection_mode text NOT NULL,
        data_class text NOT NULL,
        data_classes jsonb NOT NULL DEFAULT '["public"]'::jsonb,
        fallback_consent boolean NOT NULL,
        max_attempts integer,
        fallback_authorized boolean,
        allowed_candidates jsonb NOT NULL,
        data_policy_revision_id text,
        source_kind text,
        retry_owner text NOT NULL DEFAULT 'product',
        provider_retry_disabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_generation_jobs (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id text NOT NULL,
        operation text NOT NULL,
        route_snapshot_id text NOT NULL,
        usage_reservation_id text NOT NULL,
        status text NOT NULL,
        created_by text NOT NULL,
        correlation_id text NOT NULL,
        result jsonb,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id),
        FOREIGN KEY (workspace_id, route_snapshot_id)
          REFERENCES p1_route_snapshots(workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_provider_attempts (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id text NOT NULL,
        job_id text NOT NULL,
        ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 2),
        deployment_id text NOT NULL,
        acceptance text NOT NULL,
        provider_task_ref text,
        status text NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id),
        UNIQUE (workspace_id, job_id, ordinal),
        FOREIGN KEY (workspace_id, job_id)
          REFERENCES p1_generation_jobs(workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_provider_cost_events (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id text NOT NULL,
        attempt_id text NOT NULL,
        stage text NOT NULL,
        amount_micros bigint CHECK (amount_micros IS NULL OR amount_micros >= 0),
        currency text NOT NULL,
        unit text NOT NULL,
        evidence text NOT NULL,
        payer text NOT NULL,
        billing_status text NOT NULL DEFAULT 'known',
        actor_id text NOT NULL,
        correlation_id text NOT NULL,
        created_at timestamptz NOT NULL,
        snapshot jsonb,
        PRIMARY KEY (workspace_id, id),
        FOREIGN KEY (workspace_id, attempt_id)
          REFERENCES p1_provider_attempts(workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS p1_provider_cost_attempt_idx
        ON p1_provider_cost_events (workspace_id, attempt_id, created_at);
      CREATE TABLE IF NOT EXISTS p1_product_entitlement_events (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id text NOT NULL,
        kind text NOT NULL,
        payment_event_id text,
        grant_key text,
        event jsonb NOT NULL,
        actor_id text NOT NULL,
        correlation_id text NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      ALTER TABLE p1_product_entitlement_events
        ADD COLUMN IF NOT EXISTS grant_key text;
      UPDATE p1_product_entitlement_events
        SET grant_key = event->>'grantKey'
        WHERE grant_key IS NULL AND event ? 'grantKey';
      CREATE UNIQUE INDEX IF NOT EXISTS p1_product_entitlement_payment_once_idx
        ON p1_product_entitlement_events (workspace_id, payment_event_id)
        WHERE payment_event_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS p1_product_entitlement_register_gift_once_idx
        ON p1_product_entitlement_events (workspace_id, grant_key)
        WHERE grant_key = 'REGISTER_GIFT';
      CREATE INDEX IF NOT EXISTS p1_product_entitlement_projection_idx
        ON p1_product_entitlement_events (workspace_id, created_at, id);
      CREATE TABLE IF NOT EXISTS p1_owned_assets (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id text NOT NULL,
        job_id text NOT NULL,
        attempt_id text NOT NULL,
        object_key text NOT NULL,
        sha256 text NOT NULL,
        size_bytes bigint NOT NULL CHECK (size_bytes > 0),
        media_type text NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id),
        UNIQUE (workspace_id, object_key),
        FOREIGN KEY (workspace_id, job_id)
          REFERENCES p1_generation_jobs(workspace_id, id),
        FOREIGN KEY (workspace_id, attempt_id)
          REFERENCES p1_provider_attempts(workspace_id, id)
      );
      CREATE TABLE IF NOT EXISTS p1_cutovers (
        workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        id text NOT NULL,
        source_revision text NOT NULL,
        target_revision text NOT NULL,
        backup_ref text NOT NULL,
        dry_run_difference_count integer NOT NULL,
        in_flight_decision text NOT NULL,
        status text NOT NULL,
        future_write_owner text NOT NULL,
        rollback_reason text,
        actor_id text NOT NULL,
        correlation_id text NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, id)
      );
      ALTER TABLE p1_route_snapshots
        ADD COLUMN IF NOT EXISTS data_classes jsonb NOT NULL DEFAULT '["public"]'::jsonb,
        ADD COLUMN IF NOT EXISTS max_attempts integer,
        ADD COLUMN IF NOT EXISTS fallback_authorized boolean,
        ADD COLUMN IF NOT EXISTS data_policy_revision_id text,
        ADD COLUMN IF NOT EXISTS source_kind text,
        ADD COLUMN IF NOT EXISTS retry_owner text NOT NULL DEFAULT 'product',
        ADD COLUMN IF NOT EXISTS provider_retry_disabled boolean NOT NULL DEFAULT true;
      ALTER TABLE p1_generation_jobs
        ADD COLUMN IF NOT EXISTS result jsonb;
      ALTER TABLE p1_provider_cost_events
        ALTER COLUMN amount_micros DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'known',
        ADD COLUMN IF NOT EXISTS snapshot jsonb;
      ALTER TABLE p1_usage_events
        ALTER COLUMN amount TYPE numeric USING amount::numeric,
        ADD COLUMN IF NOT EXISTS billing jsonb;
    `);
  }

  async executeIdempotent<T>(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string,
    action: (store: FoundationStore) => Promise<T>
  ): Promise<IdempotentExecution<T>> {
    if (this.client) return this.executeInsideTransaction(context, idempotencyKey, payloadHash, action);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [context.workspaceId]);
      const result = await new PostgresFoundationRepository(this.pool, client)
        .executeInsideTransaction(context, idempotencyKey, payloadHash, action);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async claimModuleCommand<T>(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string
  ) {
    return this.withModuleCommandLock(context.workspaceId, async (repository) => {
      const existing = await repository.database.query<{
        payload_hash: string;
        status: 'pending' | 'completed';
        lease_expires_at: Date | null;
        result: T | null;
      }>(
        `SELECT payload_hash, status, lease_expires_at, result
           FROM p1_module_commands
          WHERE workspace_id = $1 AND idempotency_key = $2
          FOR UPDATE`,
        [context.workspaceId, idempotencyKey]
      );
      const stored = existing.rows[0];
      if (stored) {
        if (stored.payload_hash !== payloadHash) {
          throw new P1DomainError(
            'IDEMPOTENCY_CONFLICT',
            'Idempotency key was reused with a different payload.'
          );
        }
        if (stored.status === 'completed') {
          return { decision: 'replay' as const, value: stored.result as T };
        }
        if (
          stored.lease_expires_at &&
          stored.lease_expires_at.getTime() > Date.now()
        ) {
          return { decision: 'in_progress' as const };
        }
        const claimToken = randomUUID();
        await repository.database.query(
          `UPDATE p1_module_commands
              SET claim_token = $3,
                  lease_expires_at = now() + interval '5 minutes',
                  updated_at = now()
            WHERE workspace_id = $1 AND idempotency_key = $2`,
          [context.workspaceId, idempotencyKey, claimToken]
        );
        return { decision: 'execute' as const, claimToken };
      }
      const claimToken = randomUUID();
      await repository.database.query(
        `INSERT INTO p1_module_commands
           (workspace_id, idempotency_key, payload_hash, status, claim_token,
            lease_expires_at)
         VALUES ($1, $2, $3, 'pending', $4, now() + interval '5 minutes')`,
        [context.workspaceId, idempotencyKey, payloadHash, claimToken]
      );
      return { decision: 'execute' as const, claimToken };
    });
  }

  async completeModuleCommand<T>(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string,
    claimToken: string,
    value: T
  ) {
    await this.withModuleCommandLock(context.workspaceId, async (repository) => {
      const updated = await repository.database.query(
        `UPDATE p1_module_commands
            SET status = 'completed', result = $5::jsonb,
                claim_token = NULL, lease_expires_at = NULL, updated_at = now()
          WHERE workspace_id = $1 AND idempotency_key = $2
            AND payload_hash = $3 AND status = 'pending' AND claim_token = $4`,
        [
          context.workspaceId,
          idempotencyKey,
          payloadHash,
          claimToken,
          JSON.stringify(value),
        ]
      );
      if (updated.rowCount !== 1) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Module command claim was not found.'
        );
      }
      await repository.database.query(
        `INSERT INTO p1_command_audits
           (workspace_id,idempotency_key,payload_hash,actor_id,correlation_id)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (workspace_id, idempotency_key) DO NOTHING`,
        [
          context.workspaceId,
          idempotencyKey,
          payloadHash,
          context.userId,
          context.correlationId,
        ]
      );
    });
  }

  async renewModuleCommand(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string,
    claimToken: string
  ) {
    await this.withModuleCommandLock(context.workspaceId, async (repository) => {
      const updated = await repository.database.query(
        `UPDATE p1_module_commands
            SET lease_expires_at = now() + interval '5 minutes',
                updated_at = now()
          WHERE workspace_id = $1 AND idempotency_key = $2
            AND payload_hash = $3 AND status = 'pending' AND claim_token = $4`,
        [context.workspaceId, idempotencyKey, payloadHash, claimToken]
      );
      if (updated.rowCount !== 1) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Module command claim was not found.'
        );
      }
    });
  }

  async abandonModuleCommand(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string,
    claimToken: string
  ) {
    await this.withModuleCommandLock(context.workspaceId, async (repository) => {
      await repository.database.query(
        `DELETE FROM p1_module_commands
          WHERE workspace_id = $1 AND idempotency_key = $2
            AND payload_hash = $3 AND status = 'pending' AND claim_token = $4`,
        [context.workspaceId, idempotencyKey, payloadHash, claimToken]
      );
    });
  }

  private async withModuleCommandLock<T>(
    workspaceId: string,
    action: (repository: PostgresFoundationRepository) => Promise<T>
  ): Promise<T> {
    if (this.client) return action(this);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        workspaceId,
      ]);
      const value = await action(
        new PostgresFoundationRepository(this.pool, client)
      );
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async executeInsideTransaction<T>(
    context: P1Context,
    idempotencyKey: string,
    payloadHash: string,
    action: (store: FoundationStore) => Promise<T>
  ): Promise<IdempotentExecution<T>> {
    const existing = await this.database.query<{ payload_hash: string; result: T }>(
      `SELECT payload_hash, result FROM p1_command_results
        WHERE workspace_id = $1 AND idempotency_key = $2`,
      [context.workspaceId, idempotencyKey]
    );
    const stored = existing.rows[0];
    if (stored) {
      if (stored.payload_hash !== payloadHash) {
        throw new P1DomainError('IDEMPOTENCY_CONFLICT', 'Idempotency key was reused with a different payload.');
      }
      return { replayed: true, value: stored.result };
    }
    const value = await action(this);
    await this.database.query(
      `INSERT INTO p1_command_audits
       (workspace_id,idempotency_key,payload_hash,actor_id,correlation_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [context.workspaceId, idempotencyKey, payloadHash, context.userId, context.correlationId]
    );
    await this.database.query(
      `INSERT INTO p1_command_results (workspace_id, idempotency_key, payload_hash, result)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [context.workspaceId, idempotencyKey, payloadHash, JSON.stringify(value)]
    );
    return { replayed: false, value };
  }

  async getOwnerRole(context: P1Context): Promise<'owner' | null> {
    const result = await this.database.query(
      `SELECT 1 FROM workspace_memberships
        WHERE workspace_id = $1 AND user_id = $2 AND role = 'owner' LIMIT 1`,
      [context.workspaceId, context.userId]
    );
    return result.rowCount === 1 ? 'owner' : null;
  }

  async getWorkspaceRole(
    context: P1Context
  ): Promise<'owner' | 'operator' | 'reviewer' | null> {
    const result = await this.database.query<{ role: string }>(
      `SELECT role FROM workspace_memberships
        WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
      [context.workspaceId, context.userId]
    );
    const role = result.rows[0]?.role;
    return role === 'owner' || role === 'operator' || role === 'reviewer'
      ? role
      : null;
  }

  async insertRelationFact(fact: RelationFact) {
    await this.database.query(
      `INSERT INTO p1_relation_facts
       (workspace_id, id, kind, parent_id, data, legacy_source, mapping_confidence, actor_id, correlation_id, created_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::timestamptz)`,
      [fact.workspaceId, fact.id, fact.kind, fact.parentId ?? null, JSON.stringify(fact.data),
        fact.legacySource ?? null, fact.mappingConfidence ?? null, fact.actorId, fact.correlationId, fact.createdAt]
    );
  }

  async getRelationFact(workspaceId: string, factId: string) {
    const result = await this.database.query<RelationFact>(
      `SELECT id, workspace_id AS "workspaceId", kind, parent_id AS "parentId", data,
              legacy_source AS "legacySource", mapping_confidence AS "mappingConfidence",
              actor_id AS "actorId", correlation_id AS "correlationId", created_at::text AS "createdAt"
         FROM p1_relation_facts WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, factId]
    );
    return result.rows[0] ?? null;
  }

  async appendUsageEvent(event: UsageEvent) {
    await this.database.query(
      `INSERT INTO p1_usage_events
       (workspace_id,id,resource,action,amount,reservation_id,reason,actor_id,correlation_id,created_at,billing)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::jsonb)`,
      [event.workspaceId, event.id, event.resource, event.action, event.amount,
        event.reservationId ?? null, event.reason, event.actorId, event.correlationId, event.createdAt,
        event.billing ? JSON.stringify(event.billing) : null]
    );
    await this.syncRolledBackUsageProjection(event);
  }

  private async syncRolledBackUsageProjection(event: UsageEvent) {
    if (event.resource === 'audio') return;
    const ownership = await this.database.query<{ owner: string }>(
      'SELECT owner FROM p1_write_ownership WHERE workspace_id = $1',
      [event.workspaceId]
    );
    if (ownership.rows[0]?.owner !== 'legacy') return;
    const stored = await this.database.query<{ state: ProductState }>(
      'SELECT state FROM product_states WHERE workspace_id = $1',
      [event.workspaceId]
    );
    const state = stored.rows[0]?.state;
    if (!state) return;
    const events = await this.listUsageEvents(event.workspaceId, event.resource);
    const terminals = new Map(
      events
        .filter((item) =>
          ['commit', 'refund', 'expire'].includes(item.action)
        )
        .map((item) => [item.reservationId, item])
    );
    const allowance = events
      .filter((item) =>
        item.action === 'adjust' || item.action === 'compensate'
      )
      .reduce((sum, item) => sum + item.amount, 0);
    const reserved = events
      .filter(
        (item) =>
          item.action === 'reserve' &&
          item.reservationId &&
          !terminals.has(item.reservationId)
      )
      .reduce((sum, item) => sum + item.amount, 0);
    const committed = events
      .filter(
        (item) =>
          item.action === 'reserve' &&
          item.reservationId &&
          terminals.get(item.reservationId)?.action === 'commit'
      )
      .reduce(
        (sum, item) =>
          sum + (terminals.get(item.reservationId)?.amount ?? item.amount),
        0,
      );
    const bucket = event.resource === 'copy' ? 'content' : event.resource;
    state.entitlement[bucket] = {
      allowance,
      remaining: allowance - reserved - committed,
    };
    const productStatus = {
      commit: 'committed',
      expire: 'expired',
      refund: 'refunded',
      reserve: 'reserved',
    } as const;
    const status = productStatus[event.action as keyof typeof productStatus];
    const productEventId = `foundation:${event.id}`;
    if (
      status &&
      !state.usageEvents.some((item) => item.id === productEventId)
    ) {
      state.usageEvents.push({
        amount: event.amount,
        correlationId: event.correlationId,
        createdAt: event.createdAt,
        id: productEventId,
        reason: event.reason,
        ...(event.reservationId ? { reservationId: event.reservationId } : {}),
        resource: bucket,
        status,
      });
    }
    if (event.createdAt > state.updatedAt) state.updatedAt = event.createdAt;
    await this.database.query(
      `UPDATE product_states
          SET state = $2::jsonb, updated_at = now()
        WHERE workspace_id = $1`,
      [event.workspaceId, JSON.stringify(state)]
    );
  }

  async listUsageEvents(workspaceId: string, resource: UsageResource) {
    const result = await this.database.query<Omit<UsageEvent, 'amount'> & { amount: string | number }>(
      `SELECT id, workspace_id AS "workspaceId", resource, action, amount,
              reservation_id AS "reservationId", reason, actor_id AS "actorId",
              correlation_id AS "correlationId", created_at::text AS "createdAt", billing
         FROM p1_usage_events WHERE workspace_id = $1 AND resource = $2 ORDER BY created_at, id`,
      [workspaceId, resource]
    );
    return result.rows.map((row) => ({ ...row, amount: Number(row.amount) }));
  }

  async insertRouteSnapshot(snapshot: RouteSnapshot) {
    await this.database.query(
      `INSERT INTO p1_route_snapshots
       (workspace_id,id,catalog_revision,policy_revision,price_revision,requested_catalog_model_id,
        selection_mode,data_class,data_classes,fallback_consent,max_attempts,fallback_authorized,
        allowed_candidates,data_policy_revision_id,source_kind,retry_owner,
        provider_retry_disabled,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14,$15,$16,$17,$18::timestamptz)`,
      [snapshot.workspaceId, snapshot.id, snapshot.catalogRevision, snapshot.policyRevision,
        snapshot.priceRevision, snapshot.requestedCatalogModelId, snapshot.selectionMode,
        snapshot.dataClass, JSON.stringify(snapshot.dataClasses ?? [snapshot.dataClass]),
        snapshot.fallbackConsent, snapshot.maxAttempts ?? null,
        snapshot.fallbackAuthorized ?? null, JSON.stringify(snapshot.allowedCandidates),
        snapshot.dataPolicyRevisionId ?? null, snapshot.sourceKind ?? null,
        snapshot.retryOwner ?? 'product', snapshot.providerRetryDisabled ?? true,
        snapshot.createdAt]
    );
  }

  async getRouteSnapshot(workspaceId: string, snapshotId: string) {
    const result = await this.database.query<
      RouteSnapshot & {
        maxAttempts: number | null;
        fallbackAuthorized: boolean | null;
        dataPolicyRevisionId: string | null;
        sourceKind: RouteSnapshot['sourceKind'] | null;
      }
    >(
      `SELECT id, workspace_id AS "workspaceId", catalog_revision AS "catalogRevision",
              policy_revision AS "policyRevision", price_revision AS "priceRevision",
              requested_catalog_model_id AS "requestedCatalogModelId", selection_mode AS "selectionMode",
              data_class AS "dataClass", data_classes AS "dataClasses",
              fallback_consent AS "fallbackConsent", max_attempts AS "maxAttempts",
              fallback_authorized AS "fallbackAuthorized", allowed_candidates AS "allowedCandidates",
              data_policy_revision_id AS "dataPolicyRevisionId", source_kind AS "sourceKind",
              retry_owner AS "retryOwner", provider_retry_disabled AS "providerRetryDisabled",
              created_at::text AS "createdAt"
         FROM p1_route_snapshots WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, snapshotId]
    );
    const snapshot = result.rows[0];
    if (!snapshot) return null;
    const {
      maxAttempts,
      fallbackAuthorized,
      dataPolicyRevisionId,
      sourceKind,
      ...required
    } = snapshot;
    return {
      ...required,
      ...(maxAttempts === null ? {} : { maxAttempts }),
      ...(fallbackAuthorized === null ? {} : { fallbackAuthorized }),
      ...(dataPolicyRevisionId === null ? {} : { dataPolicyRevisionId }),
      ...(sourceKind === null ? {} : { sourceKind }),
    };
  }

  async insertGenerationJob(job: GenerationJob) {
    await this.database.query(
      `INSERT INTO p1_generation_jobs
       (workspace_id,id,operation,route_snapshot_id,usage_reservation_id,status,created_by,correlation_id,result,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz,$11::timestamptz)`,
      [job.workspaceId, job.id, job.operation, job.routeSnapshotId, job.usageReservationId,
        job.status, job.createdBy, job.correlationId,
        job.result ? JSON.stringify(job.result) : null, job.createdAt, job.updatedAt]
    );
  }

  async getGenerationJob(workspaceId: string, jobId: string) {
    const result = await this.database.query<GenerationJob>(
      `SELECT id, workspace_id AS "workspaceId", operation, route_snapshot_id AS "routeSnapshotId",
              usage_reservation_id AS "usageReservationId", status, created_by AS "createdBy",
              correlation_id AS "correlationId", result,
              created_at::text AS "createdAt", updated_at::text AS "updatedAt"
         FROM p1_generation_jobs WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, jobId]
    );
    return result.rows[0] ?? null;
  }

  async updateGenerationJob(job: GenerationJob) {
    const result = await this.database.query(
      `UPDATE p1_generation_jobs SET status = $3, result = $4::jsonb, updated_at = $5::timestamptz
        WHERE workspace_id = $1 AND id = $2`,
      [job.workspaceId, job.id, job.status,
        job.result ? JSON.stringify(job.result) : null, job.updatedAt]
    );
    if (result.rowCount !== 1) throw new P1DomainError('NOT_FOUND', 'Generation job was not found.');
  }

  async listGenerationDurationSamples(
    workspaceId: string,
    operation: GenerationJob['operation'],
    catalogModelId: string,
    since: string
  ) {
    const result = await this.database.query<{ seconds: number }>(
      `SELECT GREATEST(1, ROUND(EXTRACT(EPOCH FROM (jobs.updated_at - jobs.created_at))))::int AS seconds
         FROM p1_generation_jobs jobs
         JOIN p1_route_snapshots snapshots
           ON snapshots.workspace_id = jobs.workspace_id
          AND snapshots.id = jobs.route_snapshot_id
        WHERE jobs.workspace_id = $1
          AND jobs.operation = $2
          AND jobs.status = 'completed'
          AND jobs.created_at >= $4::timestamptz
          AND snapshots.requested_catalog_model_id = $3
          AND snapshots.allowed_candidates->0->>'catalogModelId' = $3
          AND snapshots.allowed_candidates->0->>'activationStatus' = 'live_verified'
        ORDER BY jobs.created_at DESC`,
      [workspaceId, operation, catalogModelId, since]
    );
    return result.rows.map((row) => row.seconds);
  }

  async insertProviderAttempt(attempt: ProviderAttempt) {
    await this.database.query(
      `INSERT INTO p1_provider_attempts
       (workspace_id,id,job_id,ordinal,deployment_id,acceptance,provider_task_ref,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz)`,
      [attempt.workspaceId, attempt.id, attempt.jobId, attempt.ordinal, attempt.deploymentId,
        attempt.acceptance, attempt.providerTaskRef ?? null, attempt.status, attempt.createdAt, attempt.updatedAt]
    );
  }

  async listProviderAttempts(workspaceId: string, jobId: string) {
    const result = await this.database.query<ProviderAttempt>(
      `SELECT id, workspace_id AS "workspaceId", job_id AS "jobId", ordinal,
              deployment_id AS "deploymentId", acceptance, provider_task_ref AS "providerTaskRef",
              status, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
         FROM p1_provider_attempts WHERE workspace_id = $1 AND job_id = $2 ORDER BY ordinal`,
      [workspaceId, jobId]
    );
    return result.rows;
  }

  async getProviderAttempt(workspaceId: string, attemptId: string) {
    const result = await this.database.query<ProviderAttempt>(
      `SELECT id, workspace_id AS "workspaceId", job_id AS "jobId", ordinal,
              deployment_id AS "deploymentId", acceptance, provider_task_ref AS "providerTaskRef",
              status, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
         FROM p1_provider_attempts WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, attemptId]
    );
    return result.rows[0] ?? null;
  }

  async updateProviderAttempt(attempt: ProviderAttempt) {
    const result = await this.database.query(
      `UPDATE p1_provider_attempts
          SET acceptance = $3, provider_task_ref = $4, status = $5, updated_at = $6::timestamptz
        WHERE workspace_id = $1 AND id = $2`,
      [attempt.workspaceId, attempt.id, attempt.acceptance, attempt.providerTaskRef ?? null,
        attempt.status, attempt.updatedAt]
    );
    if (result.rowCount !== 1) throw new P1DomainError('NOT_FOUND', 'Provider attempt was not found.');
  }

  async appendProviderCost(event: ProviderCostEvent) {
    await this.database.query(
      `INSERT INTO p1_provider_cost_events
       (workspace_id,id,attempt_id,stage,amount_micros,currency,unit,evidence,payer,billing_status,
        actor_id,correlation_id,created_at,snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$14::jsonb)`,
      [event.workspaceId, event.id, event.attemptId, event.stage, event.amountMicros,
        event.currency, event.unit, event.evidence, event.payer,
        event.billingStatus ?? 'known', event.actorId, event.correlationId,
        event.createdAt, event.snapshot ? JSON.stringify(event.snapshot) : null]
    );
  }

  async listProviderCosts(workspaceId: string, attemptId: string) {
    const result = await this.database.query<Omit<ProviderCostEvent, 'amountMicros'> & { amountMicros: string | number | null }>(
      `SELECT id, workspace_id AS "workspaceId", attempt_id AS "attemptId", stage,
              amount_micros AS "amountMicros", currency, unit, evidence, payer,
              billing_status AS "billingStatus",
              actor_id AS "actorId", correlation_id AS "correlationId", created_at::text AS "createdAt",
              snapshot
         FROM p1_provider_cost_events WHERE workspace_id = $1 AND attempt_id = $2 ORDER BY created_at, id`,
      [workspaceId, attemptId]
    );
    return result.rows.map((row) => ({
      ...row,
      amountMicros: row.amountMicros === null ? null : Number(row.amountMicros),
    }));
  }

  async appendProductEntitlementEvent(event: ProductEntitlementEvent) {
    await this.database.query(
      `INSERT INTO p1_product_entitlement_events
       (workspace_id,id,kind,payment_event_id,grant_key,event,actor_id,correlation_id,created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::timestamptz)`,
      [
        event.workspaceId,
        event.id,
        event.kind,
        'paymentEventId' in event ? event.paymentEventId : null,
        event.kind === 'plan_activated' ? (event.grantKey ?? null) : null,
        JSON.stringify(event),
        event.actorId,
        event.correlationId,
        event.createdAt,
      ],
    );
  }

  async listProductEntitlementEvents(workspaceId: string) {
    const result = await this.database.query<{ event: ProductEntitlementEvent }>(
      `SELECT event
         FROM p1_product_entitlement_events
        WHERE workspace_id = $1
        ORDER BY created_at, id`,
      [workspaceId],
    );
    return result.rows.map((row) => row.event);
  }

  async insertOwnedAsset(asset: OwnedAsset) {
    await this.database.query(
      `INSERT INTO p1_owned_assets
       (workspace_id,id,job_id,attempt_id,object_key,sha256,size_bytes,media_type,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz)`,
      [asset.workspaceId, asset.id, asset.jobId, asset.attemptId, asset.objectKey,
        asset.sha256, asset.sizeBytes, asset.mediaType, asset.createdAt]
    );
  }

  async getOwnedAsset(workspaceId: string, assetId: string) {
    const result = await this.database.query<
      Omit<OwnedAsset, 'sizeBytes'> & { sizeBytes: string | number }
    >(
      `SELECT id, workspace_id AS "workspaceId", job_id AS "jobId",
              attempt_id AS "attemptId", object_key AS "objectKey", sha256,
              size_bytes AS "sizeBytes", media_type AS "mediaType",
              created_at::text AS "createdAt"
         FROM p1_owned_assets WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, assetId]
    );
    const asset = result.rows[0];
    return asset ? { ...asset, sizeBytes: Number(asset.sizeBytes) } : null;
  }

  async insertCutover(record: CutoverRecord) {
    await this.database.query(
      `INSERT INTO p1_cutovers
       (workspace_id,id,source_revision,target_revision,backup_ref,dry_run_difference_count,
        in_flight_decision,status,future_write_owner,rollback_reason,actor_id,correlation_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$14::timestamptz)`,
      [record.workspaceId, record.id, record.sourceRevision, record.targetRevision, record.backupRef,
        record.dryRunDifferenceCount, record.inFlightDecision, record.status, record.futureWriteOwner,
        record.rollbackReason ?? null, record.actorId, record.correlationId, record.createdAt, record.updatedAt]
    );
  }

  async getCutover(workspaceId: string, cutoverId: string) {
    const result = await this.database.query<CutoverRecord>(
      `SELECT id, workspace_id AS "workspaceId", source_revision AS "sourceRevision",
              target_revision AS "targetRevision", backup_ref AS "backupRef",
              dry_run_difference_count AS "dryRunDifferenceCount", in_flight_decision AS "inFlightDecision",
              status, future_write_owner AS "futureWriteOwner", rollback_reason AS "rollbackReason",
              actor_id AS "actorId", correlation_id AS "correlationId",
              created_at::text AS "createdAt", updated_at::text AS "updatedAt"
         FROM p1_cutovers WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, cutoverId]
    );
    return result.rows[0] ?? null;
  }

  async updateCutover(record: CutoverRecord) {
    const result = await this.database.query(
      `UPDATE p1_cutovers SET status=$3, future_write_owner=$4, rollback_reason=$5, updated_at=$6::timestamptz
        WHERE workspace_id=$1 AND id=$2`,
      [record.workspaceId, record.id, record.status, record.futureWriteOwner,
        record.rollbackReason ?? null, record.updatedAt]
    );
    if (result.rowCount !== 1) throw new P1DomainError('NOT_FOUND', 'Cutover record was not found.');
  }

  async listCommandAudits(workspaceId: string) {
    const result = await this.database.query<CommandAuditEvent>(
      `SELECT workspace_id AS "workspaceId", idempotency_key AS "idempotencyKey",
              payload_hash AS "payloadHash", actor_id AS "actorId",
              correlation_id AS "correlationId", created_at::text AS "createdAt"
         FROM p1_command_audits WHERE workspace_id=$1 ORDER BY created_at, idempotency_key`,
      [workspaceId]
    );
    return result.rows;
  }
}
