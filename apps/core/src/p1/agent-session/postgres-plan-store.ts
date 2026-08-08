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
}
