import { storeFactSchema, type StoreFact } from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';
import type {
  ExpiredFactInvalidationClaim,
  ExpiredFactInvalidationClaimIdentity,
  ExpiredFactInvalidationOutboxRepository,
} from './expired-fact-invalidation-outbox.js';
import {
  type ActiveStoreFactQuery,
  type AppendStoreFactInput,
  isStoreFactActive,
  type StoreFactLedger,
  StoreFactRevisionConflictError,
  storeFactAppliesTo,
  storeFactContextRevision,
} from './store-fact-ledger.js';

interface StoreFactRow {
  payload: unknown;
}

interface ExpirationOutboxRow {
  attempt_count: number;
  claim_token: string;
  current_revision: string | null;
  expires_at: Date;
  fact_id: string;
  revision: string;
  workspace_id: string;
}

export class PostgresStoreFactLedger
  implements StoreFactLedger, ExpiredFactInvalidationOutboxRepository
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS p1_store_fact_heads (
        workspace_id text NOT NULL,
        fact_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision >= 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, fact_id)
      );
      CREATE TABLE IF NOT EXISTS p1_store_fact_workspace_heads (
        workspace_id text PRIMARY KEY,
        revision bigint NOT NULL CHECK (revision >= 0),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS p1_store_fact_revisions (
        workspace_id text NOT NULL,
        fact_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision > 0),
        store_id text NOT NULL,
        effective_from timestamptz NOT NULL,
        expires_at timestamptz,
        payload jsonb NOT NULL,
        recorded_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, fact_id, revision),
        FOREIGN KEY (workspace_id, fact_id)
          REFERENCES p1_store_fact_heads (workspace_id, fact_id)
      );
      CREATE INDEX IF NOT EXISTS p1_store_fact_active_idx
        ON p1_store_fact_revisions (
          workspace_id,
          store_id,
          effective_from,
          expires_at
        );
      CREATE INDEX IF NOT EXISTS p1_store_fact_expiry_idx
        ON p1_store_fact_revisions (
          expires_at,
          workspace_id,
          fact_id,
          revision
        )
        WHERE expires_at IS NOT NULL;
      CREATE TABLE IF NOT EXISTS p1_store_fact_expiration_outbox (
        workspace_id text NOT NULL,
        fact_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision > 0),
        status text NOT NULL DEFAULT 'pending' CHECK (
          status IN (
            'pending',
            'claimed',
            'retry',
            'delivered',
            'dead_letter',
            'superseded'
          )
        ),
        attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        next_attempt_at timestamptz NOT NULL,
        claimed_by text,
        claim_token text,
        lease_expires_at timestamptz,
        last_error text,
        completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, fact_id, revision),
        FOREIGN KEY (workspace_id, fact_id, revision)
          REFERENCES p1_store_fact_revisions (workspace_id, fact_id, revision)
          ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS p1_store_fact_expiration_outbox_claim_idx
        ON p1_store_fact_expiration_outbox (
          next_attempt_at,
          workspace_id,
          fact_id,
          revision
        )
        WHERE status IN ('pending', 'claimed', 'retry');
      INSERT INTO p1_store_fact_expiration_outbox (
        workspace_id,
        fact_id,
        revision,
        next_attempt_at
      )
      SELECT workspace_id, fact_id, revision, expires_at
        FROM p1_store_fact_revisions
       WHERE expires_at IS NOT NULL
      ON CONFLICT (workspace_id, fact_id, revision) DO NOTHING;
      INSERT INTO p1_store_fact_workspace_heads (workspace_id, revision)
      SELECT workspace_id, count(*)::bigint
        FROM p1_store_fact_revisions
       GROUP BY workspace_id
      ON CONFLICT (workspace_id) DO NOTHING;
    `);
  }

  async append(input: AppendStoreFactInput) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO p1_store_fact_workspace_heads (workspace_id, revision)
         VALUES ($1, 0)
         ON CONFLICT (workspace_id) DO NOTHING`,
        [input.workspaceId],
      );
      await client.query(
        `SELECT revision
           FROM p1_store_fact_workspace_heads
          WHERE workspace_id = $1
          FOR UPDATE`,
        [input.workspaceId],
      );
      await client.query(
        `INSERT INTO p1_store_fact_heads (workspace_id, fact_id, revision)
         VALUES ($1, $2, 0)
         ON CONFLICT (workspace_id, fact_id) DO NOTHING`,
        [input.workspaceId, input.factId],
      );
      const head = await client.query<{ revision: string }>(
        `SELECT revision::text AS revision
           FROM p1_store_fact_heads
          WHERE workspace_id = $1 AND fact_id = $2
          FOR UPDATE`,
        [input.workspaceId, input.factId],
      );
      const currentRevision = Number(head.rows[0]?.revision ?? 0);
      if (currentRevision !== input.expectedRevision) {
        throw new StoreFactRevisionConflictError(
          input.factId,
          input.expectedRevision,
          currentRevision,
        );
      }
      const { expectedRevision: _expectedRevision, ...factInput } = input;
      const fact = storeFactSchema.parse({
        ...factInput,
        revision: currentRevision + 1,
      });
      await client.query(
        `INSERT INTO p1_store_fact_revisions (
           workspace_id,
           fact_id,
           revision,
           store_id,
           effective_from,
           expires_at,
           payload,
           recorded_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [
          fact.workspaceId,
          fact.factId,
          fact.revision,
          fact.scope.storeId,
          fact.effectiveFrom,
          fact.expiresAt,
          fact,
          fact.recordedAt,
        ],
      );
      if (fact.expiresAt) {
        await client.query(
          `INSERT INTO p1_store_fact_expiration_outbox (
             workspace_id,
             fact_id,
             revision,
             next_attempt_at
           ) VALUES ($1, $2, $3, $4)
           ON CONFLICT (workspace_id, fact_id, revision) DO NOTHING`,
          [fact.workspaceId, fact.factId, fact.revision, fact.expiresAt],
        );
      }
      await client.query(
        `UPDATE p1_store_fact_heads
            SET revision = $3, updated_at = now()
          WHERE workspace_id = $1 AND fact_id = $2`,
        [fact.workspaceId, fact.factId, fact.revision],
      );
      await client.query(
        `UPDATE p1_store_fact_workspace_heads
            SET revision = revision + 1, updated_at = now()
          WHERE workspace_id = $1`,
        [fact.workspaceId],
      );
      await client.query('COMMIT');
      return fact;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async withPinnedHeads<T>(
    workspaceId: string,
    factIds: readonly string[],
    action: (heads: ReadonlyMap<string, StoreFact | null>) => Promise<T>,
  ) {
    const pinned = [...new Set(factIds)].sort();
    if (pinned.length === 0) return action(new Map());
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // `append` locks the same head rows `FOR UPDATE` before it decides the
      // next revision, so no revision — a revocation above all — can commit
      // between this read and the end of `action`. Sorting the ids keeps two
      // pins in one lock order.
      const heads = await client.query<{
        fact_id: string;
        payload: unknown;
      }>(
        `SELECT head.fact_id, revision.payload
           FROM p1_store_fact_heads head
           LEFT JOIN p1_store_fact_revisions revision
             ON revision.workspace_id = head.workspace_id
            AND revision.fact_id = head.fact_id
            AND revision.revision = head.revision
          WHERE head.workspace_id = $1
            AND head.fact_id = ANY($2::text[])
          ORDER BY head.fact_id
            FOR UPDATE OF head`,
        [workspaceId, pinned],
      );
      const pinnedHeads = new Map<string, StoreFact | null>(
        pinned.map((factId) => [factId, null]),
      );
      for (const row of heads.rows) {
        pinnedHeads.set(
          row.fact_id,
          row.payload === null ? null : storeFactSchema.parse(row.payload),
        );
      }
      const result = await action(pinnedHeads);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async history(workspaceId: string, factId: string) {
    const result = await this.pool.query<StoreFactRow>(
      `SELECT payload
         FROM p1_store_fact_revisions
        WHERE workspace_id = $1 AND fact_id = $2
        ORDER BY revision ASC`,
      [workspaceId, factId],
    );
    return result.rows.map((row) => storeFactSchema.parse(row.payload));
  }

  async currentRevision(workspaceId: string) {
    const result = await this.pool.query<{ revision: string }>(
      `SELECT revision::text AS revision
         FROM p1_store_fact_workspace_heads
        WHERE workspace_id = $1`,
      [workspaceId],
    );
    return Number(result.rows[0]?.revision ?? 0);
  }

  async contextRevision(input: ActiveStoreFactQuery) {
    return storeFactContextRevision(await this.listActive(input));
  }

  async listActive(input: ActiveStoreFactQuery) {
    const result = await this.pool.query<StoreFactRow>(
      `SELECT DISTINCT ON (fact_id) payload
         FROM p1_store_fact_revisions
        WHERE workspace_id = $1
          AND effective_from <= $2
        ORDER BY fact_id ASC, revision DESC`,
      [input.workspaceId, input.at],
    );
    return result.rows
      .map((row) => storeFactSchema.parse(row.payload))
      .filter(
        (fact) =>
          isStoreFactActive(fact, input.at) &&
          storeFactAppliesTo(fact.scope, input.scope),
      )
      .sort((left, right) => left.factId.localeCompare(right.factId));
  }

  async claimBatch(input: {
    claimToken: string;
    leaseMs: number;
    limit: number;
    now: Date;
    workerId: string;
  }): Promise<ExpiredFactInvalidationClaim[]> {
    const result = await this.pool.query<ExpirationOutboxRow>(
      `WITH candidates AS (
         SELECT workspace_id, fact_id, revision
           FROM p1_store_fact_expiration_outbox
          WHERE (
                  status IN ('pending', 'retry')
                  AND next_attempt_at <= $1
                )
             OR (
                  status = 'claimed'
                  AND lease_expires_at <= $1
                )
          ORDER BY next_attempt_at, workspace_id, fact_id, revision
          FOR UPDATE SKIP LOCKED
          LIMIT $5
       ), claimed AS (
         UPDATE p1_store_fact_expiration_outbox outbox
            SET status = 'claimed',
                attempt_count = attempt_count + 1,
                claimed_by = $2,
                claim_token = $3,
                lease_expires_at = $1 + ($4::bigint * interval '1 millisecond'),
                updated_at = $1
           FROM candidates
          WHERE outbox.workspace_id = candidates.workspace_id
            AND outbox.fact_id = candidates.fact_id
            AND outbox.revision = candidates.revision
         RETURNING outbox.*
       )
       SELECT claimed.workspace_id,
              claimed.fact_id,
              claimed.revision::text AS revision,
              claimed.attempt_count,
              claimed.claim_token,
              fact.expires_at,
              (
                SELECT max(current.revision)::text
                  FROM p1_store_fact_revisions current
                 WHERE current.workspace_id = claimed.workspace_id
                   AND current.fact_id = claimed.fact_id
                   AND current.effective_from <= $1
              ) AS current_revision
         FROM claimed
         JOIN p1_store_fact_revisions fact
           ON fact.workspace_id = claimed.workspace_id
          AND fact.fact_id = claimed.fact_id
          AND fact.revision = claimed.revision
        ORDER BY claimed.next_attempt_at,
                 claimed.workspace_id,
                 claimed.fact_id,
                 claimed.revision`,
      [
        input.now,
        input.workerId,
        input.claimToken,
        input.leaseMs,
        input.limit,
      ],
    );
    return result.rows.map((row) => ({
      attemptCount: row.attempt_count,
      claimToken: row.claim_token,
      currentRevision:
        row.current_revision === null ? null : Number(row.current_revision),
      expiresAt: row.expires_at.toISOString(),
      factId: row.fact_id,
      revision: Number(row.revision),
      workspaceId: row.workspace_id,
    }));
  }

  async markDelivered(
    input: ExpiredFactInvalidationClaimIdentity & { deliveredAt: Date },
  ) {
    return this.settleClaim(
      input,
      `status = 'delivered',
       completed_at = $5,
       last_error = NULL`,
      [input.deliveredAt],
    );
  }

  async markFailed(
    input: ExpiredFactInvalidationClaimIdentity & {
      deadLetter: boolean;
      error: string;
      failedAt: Date;
      retryAt: Date;
    },
  ) {
    const result = await this.pool.query(
      `UPDATE p1_store_fact_expiration_outbox
          SET status = $5,
              next_attempt_at = $6,
              last_error = $7,
              completed_at = CASE
                WHEN $5::text = 'dead_letter' THEN $8::timestamptz
                ELSE NULL
              END,
              claimed_by = NULL,
              claim_token = NULL,
              lease_expires_at = NULL,
              updated_at = $8
        WHERE workspace_id = $1
          AND fact_id = $2
          AND revision = $3
          AND status = 'claimed'
          AND claim_token = $4
      RETURNING revision`,
      [
        input.workspaceId,
        input.factId,
        input.revision,
        input.claimToken,
        input.deadLetter ? 'dead_letter' : 'retry',
        input.retryAt,
        input.error.slice(0, 2_000),
        input.failedAt,
      ],
    );
    return result.rows.length === 1;
  }

  async markSuperseded(
    input: ExpiredFactInvalidationClaimIdentity & { supersededAt: Date },
  ) {
    return this.settleClaim(
      input,
      `status = 'superseded',
       completed_at = $5`,
      [input.supersededAt],
    );
  }

  async deleteWorkspaceForTest(workspaceId: string) {
    await this.pool.query(
      `DELETE FROM p1_store_fact_revisions WHERE workspace_id = $1`,
      [workspaceId],
    );
    await this.pool.query(
      `DELETE FROM p1_store_fact_heads WHERE workspace_id = $1`,
      [workspaceId],
    );
    await this.pool.query(
      `DELETE FROM p1_store_fact_workspace_heads WHERE workspace_id = $1`,
      [workspaceId],
    );
  }

  private async settleClaim(
    input: ExpiredFactInvalidationClaimIdentity,
    settlement: string,
    values: readonly unknown[],
  ) {
    const result = await this.pool.query(
      `UPDATE p1_store_fact_expiration_outbox
          SET ${settlement},
              claimed_by = NULL,
              claim_token = NULL,
              lease_expires_at = NULL,
              updated_at = $5
        WHERE workspace_id = $1
          AND fact_id = $2
          AND revision = $3
          AND status = 'claimed'
          AND claim_token = $4
      RETURNING revision`,
      [
        input.workspaceId,
        input.factId,
        input.revision,
        input.claimToken,
        ...values,
      ],
    );
    return result.rows.length === 1;
  }
}
