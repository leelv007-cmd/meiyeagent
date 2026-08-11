/**
 * PostgreSQL MarketingPlanStore (V31-09 / V31-40 / V31-46).
 *
 * Plan revisions are append-only. Their semantic-event outbox row is written
 * in the same transaction and stores the full canonical candidate; recovery
 * never rebuilds an event from a mutable revision.
 */

import { randomUUID } from 'node:crypto';

import type { Pool, PoolClient } from 'pg';

import { canonicalJson } from '../canonical-json.js';
import {
  compiledExecutionPlanSchema,
  type CompiledExecutionPlan,
  executionPlanPackageBillingSchema,
  type ExecutionPlanPackageBilling,
  type MarketingPlanRevision,
} from '@meiye/contracts';

import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import type { SemanticEventCandidate } from '../agent-semantic-events/semantic-event-store.js';
import {
  assertCanonicalPlanEventOutboxCandidateMatches,
  parseCanonicalPlanEventOutboxCandidate,
  PLAN_EVENT_OUTBOX_MAX_ATTEMPTS,
  type PlanEventOutboxRow,
} from './plan-event-outbox-dispatcher.js';
import {
  planEventTypeForRevision,
  planSemanticEventId,
} from './plan-semantic-event.js';
import {
  assertAppendOnlyRevisionSequence,
  MarketingPlanStoreError,
  parseMarketingPlanRevision,
  type AppendMarketingPlanInput,
  type MarketingPlanCompileArtifact,
  type MarketingPlanStore,
} from './plan-store.js';

type PayloadRow = {
  plan_id: string;
  revision: string | number;
  payload: unknown;
  execution_plan: unknown;
  package_billing: unknown;
};

type StoredOutboxRow = {
  event_id: string;
  plan_id: string;
  revision: string;
  thread_id: string;
  workspace_id: string;
  event_type: string;
  payload: unknown;
  claim_token: string | null;
  dispatch_state: string;
};

type Queryable = Pick<Pool, 'query'>;

export type PlanEventOutboxMetrics = {
  pending: number;
  dispatching: number;
  dispatched: number;
  deadLettered: number;
  /** Null when no active pending/leased row exists. */
  oldestActiveAgeMs: number | null;
};

export class PostgresMarketingPlanStore
  implements MarketingPlanStore, PostgresSchemaMigrator
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    const db: Queryable = client ?? this.pool;
    await db.query(`
      CREATE TABLE IF NOT EXISTS p1_marketing_plan_revisions (
        plan_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision >= 1),
        thread_id text NOT NULL,
        content_hash text NOT NULL,
        payload jsonb NOT NULL,
        execution_plan jsonb NOT NULL,
        package_billing jsonb,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (plan_id, revision)
      )
    `);
    await db.query(`
      ALTER TABLE p1_marketing_plan_revisions
        ADD COLUMN IF NOT EXISTS package_billing jsonb
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS p1_marketing_plan_revisions_thread_idx
        ON p1_marketing_plan_revisions (thread_id, plan_id, revision DESC)
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS p1_marketing_plan_event_outbox (
        event_id text PRIMARY KEY,
        plan_id text NOT NULL,
        revision bigint NOT NULL,
        thread_id text NOT NULL,
        workspace_id text NOT NULL,
        event_type text NOT NULL,
        -- Full immutable SemanticEventCandidate, not a reconstruction hint.
        payload jsonb NOT NULL,
        dispatch_state text NOT NULL DEFAULT 'pending',
        attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        claim_token text,
        lease_expires_at timestamptz,
        last_error text,
        dead_lettered_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        dispatched_at timestamptz,
        CONSTRAINT p1_marketing_plan_event_outbox_dispatch_state_check
          CHECK (dispatch_state IN (
            'pending', 'dispatching', 'dispatched', 'dead_letter'
          )),
        UNIQUE (plan_id, revision)
      )
    `);

    // Upgrade the V31-40 table in place. Existing loose payload rows are only
    // retained when an already-projected semantic event proves the canonical
    // candidate exactly; all other legacy rows become visible dead letters.
    await db.query(`
      ALTER TABLE p1_marketing_plan_event_outbox
        ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0
          CHECK (attempt_count >= 0),
        ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
        ADD COLUMN IF NOT EXISTS claim_token text,
        ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
        ADD COLUMN IF NOT EXISTS last_error text,
        ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz
    `);
    await db.query(`
      UPDATE p1_marketing_plan_event_outbox
         SET next_attempt_at = COALESCE(next_attempt_at, created_at)
       WHERE next_attempt_at IS NULL
    `);
    await db.query(`
      ALTER TABLE p1_marketing_plan_event_outbox
        ALTER COLUMN next_attempt_at SET NOT NULL,
        ALTER COLUMN next_attempt_at SET DEFAULT clock_timestamp()
    `);
    await db.query(`
      ALTER TABLE p1_marketing_plan_event_outbox
        DROP CONSTRAINT IF EXISTS p1_marketing_plan_event_outbox_dispatch_state_check
    `);
    await db.query(`
      UPDATE p1_marketing_plan_event_outbox
         SET dispatch_state = 'dead_letter',
             dead_lettered_at = COALESCE(dead_lettered_at, clock_timestamp()),
             last_error = COALESCE(
               last_error,
               'Legacy plan-event outbox row used expired state and has no canonical candidate.'
             ),
             claim_token = NULL,
             lease_expires_at = NULL
       WHERE dispatch_state = 'expired'
    `);
    await db.query(`
      DO $migration$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
            FROM pg_constraint
           WHERE conname = 'p1_marketing_plan_event_outbox_dispatch_state_check'
             AND conrelid = 'p1_marketing_plan_event_outbox'::regclass
        ) THEN
          ALTER TABLE p1_marketing_plan_event_outbox
            ADD CONSTRAINT p1_marketing_plan_event_outbox_dispatch_state_check
            CHECK (dispatch_state IN (
              'pending', 'dispatching', 'dispatched', 'dead_letter'
            ));
        END IF;
      END
      $migration$
    `);

    // A legacy row may have stored threadId as workspaceId. The agent thread
    // table is the only authoritative source for repairing that boundary.
    await db.query(`
      DO $authority$
      BEGIN
        IF to_regclass('public.p1_agent_threads') IS NOT NULL THEN
          EXECUTE $update$
            UPDATE p1_marketing_plan_event_outbox outbox
               SET workspace_id = thread.resource_id
              FROM p1_agent_threads thread
             WHERE outbox.thread_id = thread.thread_id
               AND outbox.workspace_id IS DISTINCT FROM thread.resource_id
          $update$;
        END IF;
      END
      $authority$
    `);
    // If a semantic event already exists, it is the authoritative exact
    // candidate. Promote it instead of deriving payload from the revision.
    await db.query(`
      DO $projected$
      BEGIN
        IF to_regclass('public.p1_agent_semantic_events') IS NOT NULL
           AND to_regclass('public.p1_agent_threads') IS NOT NULL THEN
          EXECUTE $recover_with_thread$
            UPDATE p1_marketing_plan_event_outbox outbox
               SET workspace_id = event.resource_id,
                   payload = (event.payload - 'schemaVersion' - 'streamOffset')
                     || jsonb_build_object('resourceId', event.resource_id),
                   dispatch_state = 'dispatched',
                   dispatched_at = COALESCE(outbox.dispatched_at, clock_timestamp()),
                   claim_token = NULL,
                   lease_expires_at = NULL
              FROM p1_agent_semantic_events event,
                   p1_agent_threads thread
             WHERE event.event_id = outbox.event_id
               AND event.thread_id = outbox.thread_id
               AND event.event_type = outbox.event_type
               AND thread.thread_id = outbox.thread_id
               AND event.resource_id = thread.resource_id
               AND NOT (
                 outbox.payload ? 'eventId'
                 AND outbox.payload ? 'resourceId'
                 AND outbox.payload ? 'sourceDomain'
                 AND outbox.payload ? 'sourceEntityId'
                 AND outbox.payload ? 'sourceRevision'
                 AND outbox.payload ? 'contextRole'
                 AND outbox.payload ? 'correlationId'
                 AND outbox.payload ? 'occurredAt'
                 AND outbox.payload->>'eventId' = outbox.event_id
                 AND outbox.payload->>'resourceId' = outbox.workspace_id
                 AND outbox.payload->>'threadId' = outbox.thread_id
                 AND outbox.payload->>'eventType' = outbox.event_type
                 AND outbox.payload->>'sourceDomain' = 'marketing_plan_revision'
                 AND outbox.payload->>'sourceEntityId' = outbox.plan_id
                 AND outbox.payload->>'sourceRevision' = outbox.revision::text
               )
          $recover_with_thread$;
        ELSIF to_regclass('public.p1_agent_semantic_events') IS NOT NULL THEN
          EXECUTE $recover_without_thread$
            UPDATE p1_marketing_plan_event_outbox outbox
               SET workspace_id = event.resource_id,
                   payload = (event.payload - 'schemaVersion' - 'streamOffset')
                     || jsonb_build_object('resourceId', event.resource_id),
                   dispatch_state = 'dispatched',
                   dispatched_at = COALESCE(outbox.dispatched_at, clock_timestamp()),
                   claim_token = NULL,
                   lease_expires_at = NULL
              FROM p1_agent_semantic_events event
             WHERE event.event_id = outbox.event_id
               AND event.thread_id = outbox.thread_id
               AND event.event_type = outbox.event_type
               AND NOT (
                 outbox.payload ? 'eventId'
                 AND outbox.payload ? 'resourceId'
                 AND outbox.payload ? 'sourceDomain'
                 AND outbox.payload ? 'sourceEntityId'
                 AND outbox.payload ? 'sourceRevision'
                 AND outbox.payload ? 'contextRole'
                 AND outbox.payload ? 'correlationId'
                 AND outbox.payload ? 'occurredAt'
                 AND outbox.payload->>'eventId' = outbox.event_id
                 AND outbox.payload->>'resourceId' = outbox.workspace_id
                 AND outbox.payload->>'threadId' = outbox.thread_id
                 AND outbox.payload->>'eventType' = outbox.event_type
                 AND outbox.payload->>'sourceDomain' = 'marketing_plan_revision'
                 AND outbox.payload->>'sourceEntityId' = outbox.plan_id
                 AND outbox.payload->>'sourceRevision' = outbox.revision::text
               )
          $recover_without_thread$;
        END IF;
      END
      $projected$
    `);
    await db.query(`
      UPDATE p1_marketing_plan_event_outbox
         SET dispatch_state = 'dead_letter',
             dead_lettered_at = COALESCE(dead_lettered_at, clock_timestamp()),
             last_error = COALESCE(
               last_error,
               'Legacy plan-event outbox row has no authoritative canonical candidate.'
             ),
             claim_token = NULL,
             lease_expires_at = NULL
       WHERE dispatch_state <> 'dead_letter'
         AND NOT (
           payload ? 'eventId'
           AND payload ? 'resourceId'
           AND payload ? 'sourceDomain'
           AND payload ? 'sourceEntityId'
           AND payload ? 'sourceRevision'
           AND payload ? 'contextRole'
           AND payload ? 'correlationId'
           AND payload ? 'occurredAt'
           AND payload->>'eventId' = event_id
           AND payload->>'resourceId' = workspace_id
           AND payload->>'threadId' = thread_id
           AND payload->>'eventType' = event_type
           AND payload->>'sourceDomain' = 'marketing_plan_revision'
           AND payload->>'sourceEntityId' = plan_id
           AND payload->>'sourceRevision' = revision::text
         )
    `);
    await db.query(`
      DROP INDEX IF EXISTS p1_marketing_plan_event_outbox_pending_idx
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS p1_marketing_plan_event_outbox_claim_idx
        ON p1_marketing_plan_event_outbox (
          next_attempt_at, created_at, event_id
        )
        WHERE dispatch_state = 'pending'
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS p1_marketing_plan_event_outbox_lease_idx
        ON p1_marketing_plan_event_outbox (lease_expires_at, event_id)
        WHERE dispatch_state = 'dispatching'
    `);
  }

  async append(
    input: AppendMarketingPlanInput,
  ): Promise<MarketingPlanCompileArtifact> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const stored = await this.appendInTransaction(client, input);
      await client.query('COMMIT');
      return stored;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw this.normalizeAppendError(error, input);
    } finally {
      client.release();
    }
  }

  /**
   * Transaction-aware append for a larger admission transaction. The caller
   * owns BEGIN/COMMIT so a plan revision and its semantic outbox candidate can
   * never survive a failed paid-successor admission.
   */
  async appendInTransaction(
    client: PoolClient,
    input: AppendMarketingPlanInput,
  ): Promise<MarketingPlanCompileArtifact> {
    const revision = parseMarketingPlanRevision(input.revision);
    const executionPlan = compiledExecutionPlanSchema.parse(input.executionPlan);
    const workspaceId = input.workspaceId?.trim();
    if (!workspaceId) {
      throw new MarketingPlanStoreError(
        'PLAN_EVENT_WORKSPACE_REQUIRED',
        'Postgres plan append requires an explicit workspaceId.',
      );
    }
    if (!input.semanticEventCandidate) {
      throw new MarketingPlanStoreError(
        'PLAN_EVENT_CANDIDATE_REQUIRED',
        'Postgres plan append requires a canonical semantic event candidate.',
      );
    }
    const eventId = planSemanticEventId(revision.planId, revision.revision);
    const eventType = planEventTypeForRevision(revision.revision);
    let candidate: SemanticEventCandidate;
    try {
      candidate = parseCanonicalPlanEventOutboxCandidate({
        eventId,
        planId: revision.planId,
        revision: revision.revision,
        threadId: revision.threadId,
        workspaceId,
        eventType,
        payload: input.semanticEventCandidate,
      });
    } catch (error) {
      throw new MarketingPlanStoreError(
        'PLAN_EVENT_CANDIDATE_INVALID',
        error instanceof Error ? error.message : String(error),
      );
    }

    const latest = await client.query<{ revision: string }>(
      `SELECT revision::text AS revision
         FROM p1_marketing_plan_revisions
        WHERE plan_id = $1
        ORDER BY revision DESC
        LIMIT 1
        FOR UPDATE`,
      [revision.planId],
    );
    const previous =
      latest.rows[0] !== undefined
        ? Number(latest.rows[0].revision)
        : null;
    assertAppendOnlyRevisionSequence({
      planId: revision.planId,
      nextRevision: revision.revision,
      previousRevision: previous,
    });

    await client.query(
        `INSERT INTO p1_marketing_plan_revisions (
           plan_id, revision, thread_id, content_hash,
           payload, execution_plan, package_billing, created_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::timestamptz)`,
      [
        revision.planId,
        revision.revision,
        revision.threadId,
        revision.contentHash,
          JSON.stringify(revision),
          JSON.stringify(executionPlan),
          input.packageBilling ? JSON.stringify(input.packageBilling) : null,
          revision.createdAt,
      ],
    );

    // Same transaction: a committed revision always has its exact candidate.
    const inserted = await client.query<StoredOutboxRow>(
      `INSERT INTO p1_marketing_plan_event_outbox (
         event_id, plan_id, revision, thread_id, workspace_id,
         event_type, payload, dispatch_state, next_attempt_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'pending', clock_timestamp())
       ON CONFLICT (plan_id, revision) DO NOTHING
       RETURNING event_id, plan_id, revision::text AS revision, thread_id,
                 workspace_id, event_type, payload, claim_token, dispatch_state`,
      [
        eventId,
        revision.planId,
        revision.revision,
        revision.threadId,
        workspaceId,
        eventType,
        JSON.stringify(candidate),
      ],
    );
    if (!inserted.rows[0]) {
      const existing = await client.query<StoredOutboxRow>(
        `SELECT event_id, plan_id, revision::text AS revision, thread_id,
                workspace_id, event_type, payload, claim_token, dispatch_state
           FROM p1_marketing_plan_event_outbox
          WHERE plan_id = $1 AND revision = $2
          FOR UPDATE`,
        [revision.planId, revision.revision],
      );
      const row = existing.rows[0];
      if (!row) {
        throw new MarketingPlanStoreError(
          'PLAN_EVENT_OUTBOX_CONFLICT',
          `Plan ${revision.planId}@${revision.revision} has no readable outbox row after conflict.`,
        );
      }
      this.assertExactStoredOutboxCandidate(row, candidate);
    }
    return {
      revision,
      executionPlan,
      ...(input.packageBilling
        ? { packageBilling: structuredClone(input.packageBilling) }
        : {}),
    };
  }

  private normalizeAppendError(error: unknown, input: AppendMarketingPlanInput): unknown {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    ) {
      const constraint = (error as { constraint?: string }).constraint;
      if (constraint === 'p1_marketing_plan_revisions_pkey') {
        return new MarketingPlanStoreError(
          'PLAN_REVISION_CONFLICT',
          `Plan revision already exists for ${input.revision.planId}@${input.revision.revision}.`,
        );
      }
      return new MarketingPlanStoreError(
        'PLAN_EVENT_OUTBOX_CONFLICT',
        `Canonical plan event conflicts with an existing outbox identity for ${input.revision.planId}@${input.revision.revision}.`,
      );
    }
    return error;
  }

  async listRevisions(planId: string): Promise<MarketingPlanRevision[]> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT plan_id, revision, payload, execution_plan, package_billing
         FROM p1_marketing_plan_revisions
        WHERE plan_id = $1
        ORDER BY revision ASC`,
      [planId],
    );
    return result.rows.map((row) => parseMarketingPlanRevision(row.payload));
  }

  async getRevision(
    planId: string,
    revision: number,
  ): Promise<MarketingPlanCompileArtifact | null> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT plan_id, revision, payload, execution_plan, package_billing
         FROM p1_marketing_plan_revisions
        WHERE plan_id = $1 AND revision = $2`,
      [planId, revision],
    );
    const row = result.rows[0];
    return row ? parseArtifact(row) : null;
  }

  async getRevisionInTransaction(
    client: PoolClient,
    planId: string,
    revision: number,
  ): Promise<MarketingPlanCompileArtifact | null> {
    const result = await client.query<PayloadRow>(
      `SELECT plan_id, revision, payload, execution_plan, package_billing
         FROM p1_marketing_plan_revisions
        WHERE plan_id = $1 AND revision = $2
        FOR UPDATE`,
      [planId, revision],
    );
    const row = result.rows[0];
    return row ? parseArtifact(row) : null;
  }

  async getLatest(
    planId: string,
  ): Promise<MarketingPlanCompileArtifact | null> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT plan_id, revision, payload, execution_plan, package_billing
         FROM p1_marketing_plan_revisions
        WHERE plan_id = $1
        ORDER BY revision DESC
        LIMIT 1`,
      [planId],
    );
    const row = result.rows[0];
    return row ? parseArtifact(row) : null;
  }

  async getLatestInTransaction(
    client: PoolClient,
    planId: string,
  ): Promise<MarketingPlanCompileArtifact | null> {
    const result = await client.query<PayloadRow>(
      `SELECT plan_id, revision, payload, execution_plan, package_billing
         FROM p1_marketing_plan_revisions
        WHERE plan_id = $1
        ORDER BY revision DESC
        LIMIT 1
        FOR UPDATE`,
      [planId],
    );
    const row = result.rows[0];
    return row ? parseArtifact(row) : null;
  }

  /** Atomically leases due or expired claims for independent pollers. */
  async claimPendingPlanEventOutbox(input: {
    limit: number;
    leaseMs?: number;
  }): Promise<PlanEventOutboxRow[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error('Plan event outbox claim limit must be 1..100.');
    }
    const leaseMs = input.leaseMs ?? 30_000;
    if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) {
      throw new Error('Plan event outbox lease must be 1,000..300,000 ms.');
    }
    const claimToken = randomUUID();
    const result = await this.pool.query<StoredOutboxRow>(
      `WITH eligible AS (
         SELECT event_id
           FROM p1_marketing_plan_event_outbox
          WHERE (
                  dispatch_state = 'pending'
                  AND next_attempt_at <= clock_timestamp()
                )
             OR (
                  dispatch_state = 'dispatching'
                  AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
                )
          ORDER BY next_attempt_at ASC, created_at ASC, event_id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE p1_marketing_plan_event_outbox outbox
          SET dispatch_state = 'dispatching',
              claim_token = $2,
              lease_expires_at = clock_timestamp() + ($3::integer * interval '1 millisecond')
         FROM eligible
        WHERE outbox.event_id = eligible.event_id
       RETURNING outbox.event_id, outbox.plan_id, outbox.revision::text AS revision,
                 outbox.thread_id, outbox.workspace_id, outbox.event_type,
                 outbox.payload, outbox.claim_token, outbox.dispatch_state`,
      [input.limit, claimToken, leaseMs],
    );
    return result.rows.map((row) => ({
      eventId: row.event_id,
      planId: row.plan_id,
      revision: Number(row.revision),
      threadId: row.thread_id,
      workspaceId: row.workspace_id,
      eventType: row.event_type,
      payload: row.payload,
      leaseToken: row.claim_token ?? claimToken,
    }));
  }

  async markPlanEventOutboxDispatched(input: {
    eventId: string;
    leaseToken: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE p1_marketing_plan_event_outbox
          SET dispatch_state = 'dispatched',
              dispatched_at = clock_timestamp(),
              claim_token = NULL,
              lease_expires_at = NULL
        WHERE event_id = $1
          AND dispatch_state = 'dispatching'
          AND claim_token = $2`,
      [input.eventId, input.leaseToken],
    );
    return result.rowCount === 1;
  }

  /** Fast path may acknowledge only the exact candidate it just projected. */
  async markPlanEventOutboxProjected(input: {
    eventId: string;
    candidate: SemanticEventCandidate;
  }): Promise<boolean> {
    if (input.eventId !== input.candidate.eventId) {
      throw new MarketingPlanStoreError(
        'PLAN_EVENT_OUTBOX_CONFLICT',
        'Fast-path plan outbox acknowledgement eventId does not match its candidate.',
      );
    }
    const result = await this.pool.query(
      `UPDATE p1_marketing_plan_event_outbox
          SET dispatch_state = 'dispatched',
              dispatched_at = clock_timestamp(),
              claim_token = NULL,
              lease_expires_at = NULL
        WHERE event_id = $1
          AND payload = $2::jsonb
          AND dispatch_state IN ('pending', 'dispatching')`,
      [input.eventId, JSON.stringify(input.candidate)],
    );
    return result.rowCount === 1;
  }

  async getPlanEventOutboxCandidate(
    eventId: string,
  ): Promise<SemanticEventCandidate | null> {
    const result = await this.pool.query<StoredOutboxRow>(
      `SELECT event_id, plan_id, revision::text AS revision, thread_id,
              workspace_id, event_type, payload, claim_token, dispatch_state
         FROM p1_marketing_plan_event_outbox
        WHERE event_id = $1`,
      [eventId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.dispatch_state === 'dead_letter') {
      throw new MarketingPlanStoreError(
        'PLAN_EVENT_OUTBOX_DEAD_LETTER',
        `Plan semantic event ${eventId} is dead-lettered and cannot be re-emitted.`,
      );
    }
    return parseCanonicalPlanEventOutboxCandidate({
      eventId: row.event_id,
      planId: row.plan_id,
      revision: Number(row.revision),
      threadId: row.thread_id,
      workspaceId: row.workspace_id,
      eventType: row.event_type,
      payload: row.payload,
    });
  }

  async recordPlanEventOutboxFailure(input: {
    eventId: string;
    leaseToken: string;
    error: string;
    terminal: boolean;
  }): Promise<'retry_scheduled' | 'dead_lettered' | 'stale'> {
    const result = await this.pool.query<{ dispatch_state: string }>(
      `UPDATE p1_marketing_plan_event_outbox
          SET attempt_count = attempt_count + 1,
              last_error = $3,
              dispatch_state = CASE
                WHEN $4::boolean OR attempt_count + 1 >= $5::integer
                  THEN 'dead_letter'
                ELSE 'pending'
              END,
              next_attempt_at = CASE
                WHEN $4::boolean OR attempt_count + 1 >= $5::integer
                  THEN next_attempt_at
                ELSE clock_timestamp() + (
                  LEAST(
                    300,
                    CAST(power(2, LEAST(attempt_count + 1, 8)) AS integer)
                  ) * interval '1 second'
                )
              END,
              dead_lettered_at = CASE
                WHEN $4::boolean OR attempt_count + 1 >= $5::integer
                  THEN clock_timestamp()
                ELSE NULL
              END,
              claim_token = NULL,
              lease_expires_at = NULL
        WHERE event_id = $1
          AND dispatch_state = 'dispatching'
          AND claim_token = $2
      RETURNING dispatch_state`,
      [
        input.eventId,
        input.leaseToken,
        input.error.slice(0, 2_000),
        input.terminal,
        PLAN_EVENT_OUTBOX_MAX_ATTEMPTS,
      ],
    );
    const state = result.rows[0]?.dispatch_state;
    if (state === 'dead_letter') return 'dead_lettered';
    if (state === 'pending') return 'retry_scheduled';
    return 'stale';
  }

  /** Durable observability for poison rows and queue age alarms. */
  async getPlanEventOutboxMetrics(): Promise<PlanEventOutboxMetrics> {
    const result = await this.pool.query<{
      pending: string;
      dispatching: string;
      dispatched: string;
      dead_lettered: string;
      oldest_active_age_seconds: string | null;
    }>(
      `SELECT
         count(*) FILTER (WHERE dispatch_state = 'pending')::text AS pending,
         count(*) FILTER (WHERE dispatch_state = 'dispatching')::text AS dispatching,
         count(*) FILTER (WHERE dispatch_state = 'dispatched')::text AS dispatched,
         count(*) FILTER (WHERE dispatch_state = 'dead_letter')::text AS dead_lettered,
         EXTRACT(
           EPOCH FROM (
             clock_timestamp() - MIN(created_at) FILTER (
               WHERE dispatch_state IN ('pending', 'dispatching')
             )
           )
         )::text AS oldest_active_age_seconds
         FROM p1_marketing_plan_event_outbox`,
    );
    const row = result.rows[0];
    return {
      pending: Number(row?.pending ?? 0),
      dispatching: Number(row?.dispatching ?? 0),
      dispatched: Number(row?.dispatched ?? 0),
      deadLettered: Number(row?.dead_lettered ?? 0),
      oldestActiveAgeMs:
        row?.oldest_active_age_seconds === null ||
        row?.oldest_active_age_seconds === undefined
          ? null
          : Math.round(Number(row.oldest_active_age_seconds) * 1_000),
    };
  }

  private assertExactStoredOutboxCandidate(
    row: StoredOutboxRow,
    candidate: SemanticEventCandidate,
  ) {
    const parsed = parseCanonicalPlanEventOutboxCandidate({
      eventId: row.event_id,
      planId: row.plan_id,
      revision: Number(row.revision),
      threadId: row.thread_id,
      workspaceId: row.workspace_id,
      eventType: row.event_type,
      payload: row.payload,
    });
    assertCanonicalPlanEventOutboxCandidateMatches({
      eventId: row.event_id,
      planId: row.plan_id,
      revision: Number(row.revision),
      threadId: row.thread_id,
      workspaceId: row.workspace_id,
      eventType: row.event_type,
      candidate: parsed,
    });
    if (canonicalJson(parsed) !== canonicalJson(candidate)) {
      throw new MarketingPlanStoreError(
        'PLAN_EVENT_OUTBOX_CONFLICT',
        `Plan event outbox ${row.event_id} exists with a different canonical candidate.`,
      );
    }
  }
}

function parseArtifact(row: PayloadRow): MarketingPlanCompileArtifact {
  const packageBilling = row.package_billing
    ? executionPlanPackageBillingSchema.parse(row.package_billing)
    : undefined;
  return {
    revision: parseMarketingPlanRevision(row.payload),
    executionPlan: compiledExecutionPlanSchema.parse(
      row.execution_plan,
    ) as CompiledExecutionPlan,
    ...(packageBilling
      ? { packageBilling: packageBilling as ExecutionPlanPackageBilling }
      : {}),
  };
}
