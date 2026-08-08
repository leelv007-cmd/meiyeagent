/**
 * PostgreSQL MarketingGoalStore (V31-24 / V3.1 §33.1 p1_marketing_goals).
 * Production assembly path — Memory store is tests only.
 */

import type { Pool, PoolClient } from 'pg';

import { marketingGoalSchema, type MarketingGoal } from '@meiye/contracts';

import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import {
  assertGoalFound,
  assertGoalRevision,
  goalWithEvidence,
  goalWithStatus,
  MarketingGoalStoreError,
  newMarketingGoal,
  type AppendGoalEvidenceInput,
  type CreateMarketingGoalInput,
  type MarketingGoalStore,
  type TransitionMarketingGoalStatusInput,
} from './goal-store.js';

type PayloadRow = { payload: unknown };

type Queryable = Pick<Pool, 'query'>;

export class PostgresMarketingGoalStore
  implements MarketingGoalStore, PostgresSchemaMigrator
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient): Promise<void> {
    const db: Queryable = client ?? this.pool;
    await db.query(`
      CREATE TABLE IF NOT EXISTS p1_marketing_goals (
        goal_id text PRIMARY KEY,
        resource_id text NOT NULL,
        status text NOT NULL CHECK (
          status IN ('active', 'paused', 'completed', 'abandoned')
        ),
        priority text NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
        revision bigint NOT NULL CHECK (revision >= 0),
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS p1_marketing_goals_resource_idx
        ON p1_marketing_goals (resource_id, status, priority, updated_at DESC)
    `);
  }

  async create(input: CreateMarketingGoalInput): Promise<MarketingGoal> {
    const goal = newMarketingGoal(input);
    const inserted = await this.pool.query<PayloadRow>(
      `INSERT INTO p1_marketing_goals (
         goal_id, resource_id, status, priority, revision,
         payload, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, $8::timestamptz
       )
       ON CONFLICT (goal_id) DO NOTHING
       RETURNING payload`,
      [
        goal.goalId,
        goal.resourceId,
        goal.status,
        goal.priority,
        goal.revision,
        JSON.stringify(goal),
        goal.createdAt,
        goal.updatedAt,
      ],
    );
    if (inserted.rows[0]) return parseGoal(inserted.rows[0]);
    const existing = await this.get({
      resourceId: input.resourceId,
      goalId: input.goalId,
    });
    if (existing) return existing;
    throw new MarketingGoalStoreError(
      'GOAL_ID_TAKEN',
      `Marketing goal ${input.goalId} already exists for another resource.`,
      { goalId: input.goalId },
    );
  }

  async get(input: {
    resourceId: string;
    goalId: string;
  }): Promise<MarketingGoal | null> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload
         FROM p1_marketing_goals
        WHERE goal_id = $1 AND resource_id = $2`,
      [input.goalId, input.resourceId],
    );
    return result.rows[0] ? parseGoal(result.rows[0]) : null;
  }

  async list(input: {
    resourceId: string;
    status?: MarketingGoal['status'];
    limit?: number;
  }): Promise<MarketingGoal[]> {
    const limit = input.limit ?? 50;
    const result = input.status
      ? await this.pool.query<PayloadRow>(
          `SELECT payload
             FROM p1_marketing_goals
            WHERE resource_id = $1 AND status = $2
            ORDER BY
              CASE priority
                WHEN 'high' THEN 3
                WHEN 'normal' THEN 2
                ELSE 1
              END DESC,
              updated_at DESC,
              goal_id
            LIMIT $3`,
          [input.resourceId, input.status, limit],
        )
      : await this.pool.query<PayloadRow>(
          `SELECT payload
             FROM p1_marketing_goals
            WHERE resource_id = $1
            ORDER BY
              CASE priority
                WHEN 'high' THEN 3
                WHEN 'normal' THEN 2
                ELSE 1
              END DESC,
              updated_at DESC,
              goal_id
            LIMIT $2`,
          [input.resourceId, limit],
        );
    return result.rows.map(parseGoal);
  }

  async transitionStatus(
    input: TransitionMarketingGoalStatusInput,
  ): Promise<MarketingGoal> {
    return this.inTransaction(async (client) => {
      const locked = await client.query<PayloadRow>(
        `SELECT payload
           FROM p1_marketing_goals
          WHERE goal_id = $1 AND resource_id = $2
          FOR UPDATE`,
        [input.goalId, input.resourceId],
      );
      const current = assertGoalFound(
        locked.rows[0] ? parseGoal(locked.rows[0]) : null,
        input.goalId,
      );
      assertGoalRevision(current, input.expectedRevision);
      const next = goalWithStatus(current, input.nextStatus, input.now);
      await client.query(
        `UPDATE p1_marketing_goals
            SET status = $2,
                revision = $3,
                payload = $4::jsonb,
                updated_at = $5::timestamptz
          WHERE goal_id = $1`,
        [
          next.goalId,
          next.status,
          next.revision,
          JSON.stringify(next),
          next.updatedAt,
        ],
      );
      return next;
    });
  }

  async appendEvidence(input: AppendGoalEvidenceInput): Promise<MarketingGoal> {
    return this.inTransaction(async (client) => {
      const locked = await client.query<PayloadRow>(
        `SELECT payload
           FROM p1_marketing_goals
          WHERE goal_id = $1 AND resource_id = $2
          FOR UPDATE`,
        [input.goalId, input.resourceId],
      );
      const current = assertGoalFound(
        locked.rows[0] ? parseGoal(locked.rows[0]) : null,
        input.goalId,
      );
      assertGoalRevision(current, input.expectedRevision);
      const next = goalWithEvidence(current, input.evidenceRefs, input.now);
      await client.query(
        `UPDATE p1_marketing_goals
            SET revision = $2,
                payload = $3::jsonb,
                updated_at = $4::timestamptz
          WHERE goal_id = $1`,
        [next.goalId, next.revision, JSON.stringify(next), next.updatedAt],
      );
      return next;
    });
  }

  private async inTransaction<T>(
    body: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await body(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function parseGoal(row: PayloadRow): MarketingGoal {
  return marketingGoalSchema.parse(row.payload);
}
