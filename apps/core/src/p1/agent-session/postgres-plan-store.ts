/**
 * PostgreSQL MarketingPlanStore (V31-09).
 *
 * Table is append-only: PRIMARY KEY (plan_id, revision); no status column.
 * CompiledExecutionPlan stored as companion payload for session re-read;
 * ExecutionPlanSnapshot admission remains a separate semantic (V31-12).
 */

import type { Pool, PoolClient } from 'pg';

import {
  compiledExecutionPlanSchema,
  type CompiledExecutionPlan,
  type MarketingPlanRevision,
} from '@meiye/contracts';

import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import { planSemanticEventId } from './plan-semantic-event.js';
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
};

type Queryable = Pick<Pool, 'query'>;

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
        created_at timestamptz NOT NULL,
        PRIMARY KEY (plan_id, revision)
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS p1_marketing_plan_revisions_thread_idx
        ON p1_marketing_plan_revisions (thread_id, plan_id, revision DESC)
    `);
    // V31-40: same-transaction outbox candidate for plan.created/plan.revised.
    // dispatch_state mirrors confirmationDispatch: pending → dispatched.
    await db.query(`
      CREATE TABLE IF NOT EXISTS p1_marketing_plan_event_outbox (
        event_id text PRIMARY KEY,
        plan_id text NOT NULL,
        revision bigint NOT NULL,
        thread_id text NOT NULL,
        workspace_id text NOT NULL,
        event_type text NOT NULL,
        payload jsonb NOT NULL,
        dispatch_state text NOT NULL DEFAULT 'pending'
          CHECK (dispatch_state IN ('pending', 'dispatched', 'expired')),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        dispatched_at timestamptz,
        UNIQUE (plan_id, revision)
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS p1_marketing_plan_event_outbox_pending_idx
        ON p1_marketing_plan_event_outbox (dispatch_state, created_at)
        WHERE dispatch_state = 'pending'
    `);
  }

  async append(
    input: AppendMarketingPlanInput,
  ): Promise<MarketingPlanCompileArtifact> {
    const revision = parseMarketingPlanRevision(input.revision);
    const executionPlan = compiledExecutionPlanSchema.parse(input.executionPlan);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
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
           payload, execution_plan, created_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::timestamptz)`,
        [
          revision.planId,
          revision.revision,
          revision.threadId,
          revision.contentHash,
          JSON.stringify(revision),
          JSON.stringify(executionPlan),
          revision.createdAt,
        ],
      );
      // V31-40: revision + event candidate are atomic — no revision without outbox.
      // eventId matches planSemanticEventId so emit + outbox dispatch share one key.
      const eventType =
        revision.revision <= 1 ? 'plan.created' : 'plan.revised';
      const eventId = planSemanticEventId(revision.planId, revision.revision);
      const workspaceId =
        typeof input.workspaceId === 'string' && input.workspaceId.trim()
          ? input.workspaceId.trim()
          : revision.threadId;
      await client.query(
        `INSERT INTO p1_marketing_plan_event_outbox (
           event_id, plan_id, revision, thread_id, workspace_id,
           event_type, payload, dispatch_state
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'pending')
         ON CONFLICT (plan_id, revision) DO NOTHING`,
        [
          eventId,
          revision.planId,
          revision.revision,
          revision.threadId,
          workspaceId,
          eventType,
          JSON.stringify({
            eventId,
            eventType,
            planId: revision.planId,
            revision: revision.revision,
            threadId: revision.threadId,
            workspaceId,
            contentHash: revision.contentHash,
          }),
        ],
      );
      await client.query('COMMIT');
      return { revision, executionPlan };
    } catch (error) {
      await client.query('ROLLBACK');
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        throw new MarketingPlanStoreError(
          'PLAN_REVISION_CONFLICT',
          `Plan revision already exists for ${revision.planId}@${revision.revision}.`,
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async listRevisions(planId: string): Promise<MarketingPlanRevision[]> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT plan_id, revision, payload, execution_plan
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
      `SELECT plan_id, revision, payload, execution_plan
         FROM p1_marketing_plan_revisions
        WHERE plan_id = $1 AND revision = $2`,
      [planId, revision],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      revision: parseMarketingPlanRevision(row.payload),
      executionPlan: compiledExecutionPlanSchema.parse(
        row.execution_plan,
      ) as CompiledExecutionPlan,
    };
  }

  async getLatest(
    planId: string,
  ): Promise<MarketingPlanCompileArtifact | null> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT plan_id, revision, payload, execution_plan
         FROM p1_marketing_plan_revisions
        WHERE plan_id = $1
        ORDER BY revision DESC
        LIMIT 1`,
      [planId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      revision: parseMarketingPlanRevision(row.payload),
      executionPlan: compiledExecutionPlanSchema.parse(
        row.execution_plan,
      ) as CompiledExecutionPlan,
    };
  }

  /**
   * V31-40: list pending plan semantic event outbox rows for dispatch.
   * confirmationDispatch-style lifecycle (pending → dispatched); projector is
   * idempotent on eventId so concurrent pollers are safe without a lease.
   */
  async claimPendingPlanEventOutbox(input: {
    limit: number;
  }): Promise<
    Array<{
      eventId: string;
      planId: string;
      revision: number;
      threadId: string;
      workspaceId: string;
      eventType: string;
      payload: unknown;
    }>
  > {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error('Plan event outbox claim limit must be 1..100.');
    }
    const result = await this.pool.query<{
      event_id: string;
      plan_id: string;
      revision: string;
      thread_id: string;
      workspace_id: string;
      event_type: string;
      payload: unknown;
    }>(
      `SELECT event_id, plan_id, revision::text AS revision, thread_id,
              workspace_id, event_type, payload
         FROM p1_marketing_plan_event_outbox
        WHERE dispatch_state = 'pending'
        ORDER BY created_at ASC, event_id ASC
        LIMIT $1`,
      [input.limit],
    );
    return result.rows.map((row) => ({
      eventId: row.event_id,
      planId: row.plan_id,
      revision: Number(row.revision),
      threadId: row.thread_id,
      workspaceId: row.workspace_id,
      eventType: row.event_type,
      payload: row.payload,
    }));
  }

  async markPlanEventOutboxDispatched(eventId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE p1_marketing_plan_event_outbox
          SET dispatch_state = 'dispatched',
              dispatched_at = clock_timestamp()
        WHERE event_id = $1 AND dispatch_state = 'pending'`,
      [eventId],
    );
    return result.rowCount === 1;
  }
}
