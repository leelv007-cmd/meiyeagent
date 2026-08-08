/**
 * PostgreSQL append-only opportunity decision log (V31-24).
 * Table p1_opportunity_decisions — NOT a candidate aggregate table.
 */

import type { Pool, PoolClient } from 'pg';

import type { OpportunityDecision } from '@meiye/contracts';

import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import {
  newOpportunityDecision,
  OpportunityDecisionStoreError,
  parseOpportunityDecision,
  type AppendOpportunityDecisionInput,
  type OpportunityDecisionStore,
} from './opportunity-decision-store.js';

type PayloadRow = { payload: unknown };

type Queryable = Pick<Pool, 'query'>;

export class PostgresOpportunityDecisionStore
  implements OpportunityDecisionStore, PostgresSchemaMigrator
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient): Promise<void> {
    const db: Queryable = client ?? this.pool;
    await db.query(`
      CREATE TABLE IF NOT EXISTS p1_opportunity_decisions (
        decision_id text PRIMARY KEY,
        candidate_id text NOT NULL,
        resource_id text NOT NULL,
        decision text NOT NULL CHECK (decision IN ('accepted', 'dismissed')),
        decided_at timestamptz NOT NULL,
        payload jsonb NOT NULL
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS p1_opportunity_decisions_resource_idx
        ON p1_opportunity_decisions (resource_id, decided_at, decision_id)
    `);
    // Accept idempotency: at most one accepted decision per candidate.
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS p1_opportunity_decisions_accept_idx
        ON p1_opportunity_decisions (candidate_id)
        WHERE decision = 'accepted'
    `);
  }

  async append(input: AppendOpportunityDecisionInput): Promise<{
    decision: OpportunityDecision;
    replayed: boolean;
  }> {
    if (input.decision === 'accepted') {
      const existingAccept = await this.pool.query<PayloadRow>(
        `SELECT payload
           FROM p1_opportunity_decisions
          WHERE candidate_id = $1 AND decision = 'accepted'
          LIMIT 1`,
        [input.candidateId],
      );
      if (existingAccept.rows[0]) {
        const prior = parseOpportunityDecision(existingAccept.rows[0].payload);
        if (prior.resourceId !== input.resourceId) {
          throw new OpportunityDecisionStoreError(
            'DECISION_CONFLICT',
            `Candidate ${input.candidateId} already accepted for another resource.`,
            { candidateId: input.candidateId },
          );
        }
        if (
          prior.threadId &&
          input.threadId &&
          prior.threadId !== input.threadId
        ) {
          throw new OpportunityDecisionStoreError(
            'DECISION_CONFLICT',
            `Candidate ${input.candidateId} already accepted into thread ${prior.threadId}.`,
            {
              candidateId: input.candidateId,
              existingThreadId: prior.threadId,
              requestedThreadId: input.threadId,
            },
          );
        }
        return { decision: prior, replayed: true };
      }
    }

    const decision = newOpportunityDecision(input);
    const inserted = await this.pool.query<PayloadRow>(
      `INSERT INTO p1_opportunity_decisions (
         decision_id, candidate_id, resource_id, decision, decided_at, payload
       ) VALUES (
         $1, $2, $3, $4, $5::timestamptz, $6::jsonb
       )
       ON CONFLICT (decision_id) DO NOTHING
       RETURNING payload`,
      [
        decision.decisionId,
        decision.candidateId,
        decision.resourceId,
        decision.decision,
        decision.decidedAt,
        JSON.stringify(decision),
      ],
    );
    if (inserted.rows[0]) {
      return {
        decision: parseOpportunityDecision(inserted.rows[0].payload),
        replayed: false,
      };
    }
    const existing = await this.pool.query<PayloadRow>(
      `SELECT payload FROM p1_opportunity_decisions WHERE decision_id = $1`,
      [decision.decisionId],
    );
    if (!existing.rows[0]) {
      // Unique accept index race: re-read accept row.
      if (input.decision === 'accepted') {
        const raced = await this.pool.query<PayloadRow>(
          `SELECT payload
             FROM p1_opportunity_decisions
            WHERE candidate_id = $1 AND decision = 'accepted'
            LIMIT 1`,
          [input.candidateId],
        );
        if (raced.rows[0]) {
          return {
            decision: parseOpportunityDecision(raced.rows[0].payload),
            replayed: true,
          };
        }
      }
      throw new OpportunityDecisionStoreError(
        'DECISION_CONFLICT',
        `Could not append decision ${decision.decisionId}.`,
        { decisionId: decision.decisionId },
      );
    }
    const prior = parseOpportunityDecision(existing.rows[0].payload);
    if (JSON.stringify(prior) !== JSON.stringify(decision)) {
      throw new OpportunityDecisionStoreError(
        'DECISION_CONFLICT',
        `Decision ${decision.decisionId} already exists with different payload.`,
        { decisionId: decision.decisionId },
      );
    }
    return { decision: prior, replayed: true };
  }

  async latestForCandidate(input: {
    resourceId: string;
    candidateId: string;
  }): Promise<OpportunityDecision | null> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload
         FROM p1_opportunity_decisions
        WHERE resource_id = $1 AND candidate_id = $2
        ORDER BY decided_at DESC, decision_id DESC
        LIMIT 1`,
      [input.resourceId, input.candidateId],
    );
    return result.rows[0]
      ? parseOpportunityDecision(result.rows[0].payload)
      : null;
  }

  async listForResource(input: {
    resourceId: string;
    limit?: number;
  }): Promise<OpportunityDecision[]> {
    const limit = input.limit ?? 100;
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload
         FROM p1_opportunity_decisions
        WHERE resource_id = $1
        ORDER BY decided_at ASC, decision_id ASC
        LIMIT $2`,
      [input.resourceId, limit],
    );
    return result.rows.map((row) => parseOpportunityDecision(row.payload));
  }
}
