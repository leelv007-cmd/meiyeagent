import {
  assetIntakeBatchSchema,
  assetIntakeDecisionEventSchema,
  type AssetIntakeBatch,
} from '@meiye/contracts';
import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolClient } from 'pg';
import {
  AssetIntakeError,
  type AssetIntakeBatchReceipt,
  type AssetIntakeDecisionReceipt,
  type AssetIntakeRepository,
  type FactConfirmationReservation,
} from './asset-intake-service.js';

interface PayloadRow {
  payload: unknown;
}

interface BatchRow extends PayloadRow {
  command_fingerprint: string | null;
}

interface ReceiptRow extends PayloadRow {
  fingerprint: string;
}

export class PostgresAssetIntakeRepository
  implements AssetIntakeRepository
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS p1_asset_intake_batches (
        workspace_id text NOT NULL,
        batch_id text NOT NULL,
        payload jsonb NOT NULL,
        command_fingerprint text,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, batch_id)
      );
      ALTER TABLE p1_asset_intake_batches
        ADD COLUMN IF NOT EXISTS command_fingerprint text;
      CREATE TABLE IF NOT EXISTS p1_asset_intake_decisions (
        decision_order bigint GENERATED ALWAYS AS IDENTITY,
        workspace_id text NOT NULL,
        batch_id text NOT NULL,
        event_id text NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, event_id),
        UNIQUE (decision_order),
        FOREIGN KEY (workspace_id, batch_id)
          REFERENCES p1_asset_intake_batches (workspace_id, batch_id)
      );
      CREATE INDEX IF NOT EXISTS p1_asset_intake_decisions_batch_idx
        ON p1_asset_intake_decisions (
          workspace_id,
          batch_id,
          decision_order
        );
      CREATE TABLE IF NOT EXISTS p1_asset_intake_decision_receipts (
        workspace_id text NOT NULL,
        idempotency_key text NOT NULL,
        fingerprint text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS p1_asset_intake_candidate_heads (
        workspace_id text NOT NULL,
        batch_id text NOT NULL,
        candidate_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision >= 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, batch_id, candidate_id),
        FOREIGN KEY (workspace_id, batch_id)
          REFERENCES p1_asset_intake_batches (workspace_id, batch_id)
      );
      CREATE TABLE IF NOT EXISTS p1_asset_intake_fact_confirmations (
        workspace_id text NOT NULL,
        batch_id text NOT NULL,
        candidate_id text NOT NULL,
        expected_candidate_revision bigint NOT NULL CHECK (
          expected_candidate_revision >= 0
        ),
        fact_id text NOT NULL,
        expected_fact_revision bigint NOT NULL CHECK (expected_fact_revision >= 0),
        idempotency_key text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (
          workspace_id,
          batch_id,
          candidate_id,
          expected_candidate_revision
        ),
        UNIQUE (workspace_id, fact_id, expected_fact_revision),
        UNIQUE (workspace_id, idempotency_key),
        FOREIGN KEY (workspace_id, batch_id, candidate_id)
          REFERENCES p1_asset_intake_candidate_heads (
            workspace_id,
            batch_id,
            candidate_id
          )
      );
      CREATE OR REPLACE FUNCTION p1_reject_asset_intake_update()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Asset intake history is immutable';
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS p1_asset_intake_confirmation_immutable
        ON p1_asset_intake_fact_confirmations;
      CREATE TRIGGER p1_asset_intake_confirmation_immutable
        BEFORE UPDATE ON p1_asset_intake_fact_confirmations
        FOR EACH ROW EXECUTE FUNCTION p1_reject_asset_intake_update();
      DROP TRIGGER IF EXISTS p1_asset_intake_batch_immutable
        ON p1_asset_intake_batches;
      CREATE TRIGGER p1_asset_intake_batch_immutable
        BEFORE UPDATE ON p1_asset_intake_batches
        FOR EACH ROW EXECUTE FUNCTION p1_reject_asset_intake_update();
      DROP TRIGGER IF EXISTS p1_asset_intake_decision_immutable
        ON p1_asset_intake_decisions;
      CREATE TRIGGER p1_asset_intake_decision_immutable
        BEFORE UPDATE ON p1_asset_intake_decisions
        FOR EACH ROW EXECUTE FUNCTION p1_reject_asset_intake_update();
    `);
  }

  async recordBatch(input: AssetIntakeBatch, commandFingerprint?: string) {
    const batch = assetIntakeBatchSchema.parse(input);
    const result = await this.pool.query<BatchRow>(
      `INSERT INTO p1_asset_intake_batches (
         workspace_id,
         batch_id,
         payload,
         command_fingerprint,
         created_at
       ) VALUES ($1, $2, $3::jsonb, $4, $5)
       ON CONFLICT (workspace_id, batch_id) DO NOTHING
       RETURNING payload, command_fingerprint`,
      [
        batch.workspaceId,
        batch.batchId,
        batch,
        commandFingerprint ?? null,
        batch.createdAt,
      ],
    );
    const storedRow =
      result.rows[0] ??
      (
        await this.pool.query<BatchRow>(
          `SELECT payload, command_fingerprint
             FROM p1_asset_intake_batches
            WHERE workspace_id = $1 AND batch_id = $2`,
          [batch.workspaceId, batch.batchId],
        )
      ).rows[0];
    const stored = storedRow?.payload
      ? assetIntakeBatchSchema.parse(storedRow.payload)
      : null;
    if (
      !stored ||
      !isDeepStrictEqual(stored, batch) ||
      storedRow?.command_fingerprint !== (commandFingerprint ?? null)
    ) {
      throw new AssetIntakeError(
        'BATCH_CONFLICT',
        `Asset intake batch ${batch.batchId} already has another payload.`,
      );
    }
    return stored;
  }

  async getBatch(workspaceId: string, batchId: string) {
    return (await this.getBatchReceipt(workspaceId, batchId))?.batch ?? null;
  }

  async getBatchReceipt(
    workspaceId: string,
    batchId: string,
  ): Promise<AssetIntakeBatchReceipt | null> {
    const result = await this.pool.query<BatchRow>(
      `SELECT payload, command_fingerprint
         FROM p1_asset_intake_batches
        WHERE workspace_id = $1 AND batch_id = $2`,
      [workspaceId, batchId],
    );
    const row = result.rows[0];
    return row?.payload
      ? {
          batch: assetIntakeBatchSchema.parse(row.payload),
          commandFingerprint: row.command_fingerprint,
        }
      : null;
  }

  private async candidateHead(
    client: PoolClient,
    workspaceId: string,
    batchId: string,
    candidateId: string,
  ) {
    await client.query(
      `INSERT INTO p1_asset_intake_candidate_heads (
         workspace_id,
         batch_id,
         candidate_id,
         revision
       ) VALUES ($1, $2, $3, 0)
       ON CONFLICT (workspace_id, batch_id, candidate_id) DO NOTHING`,
      [workspaceId, batchId, candidateId],
    );
    const result = await client.query<{ revision: string }>(
      `SELECT revision::text AS revision
         FROM p1_asset_intake_candidate_heads
        WHERE workspace_id = $1 AND batch_id = $2 AND candidate_id = $3
        FOR UPDATE`,
      [workspaceId, batchId, candidateId],
    );
    return Number(result.rows[0]?.revision ?? 0);
  }

  async appendDecision(input: AssetIntakeDecisionReceipt) {
    const event = assetIntakeDecisionEventSchema.parse(input.event);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${event.workspaceId}:asset-intake-receipt:${input.idempotencyKey}`,
      ]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${event.workspaceId}:asset-intake-candidate:${event.batchId}:${event.candidateId}`,
      ]);
      const current = await this.decisionReceiptWithClient(
        client,
        event.workspaceId,
        input.idempotencyKey,
      );
      if (current) {
        if (current.fingerprint !== input.fingerprint) {
          throw new AssetIntakeError(
            'DECISION_CONFLICT',
            `Idempotency key ${input.idempotencyKey} was reused.`,
          );
        }
        await client.query('COMMIT');
        return current.event;
      }
      const head = await this.candidateHead(
        client,
        event.workspaceId,
        event.batchId,
        event.candidateId,
      );
      if (event.action === 'confirmed') {
        const reserved = await client.query<PayloadRow>(
          `SELECT payload FROM p1_asset_intake_fact_confirmations
            WHERE workspace_id = $1 AND idempotency_key = $2`,
          [event.workspaceId, input.idempotencyKey],
        );
        const reservation = reserved.rows[0]?.payload as
          | FactConfirmationReservation
          | undefined;
        if (
          !reservation ||
          reservation.workspaceId !== event.workspaceId ||
          reservation.batchId !== event.batchId ||
          reservation.candidateId !== event.candidateId ||
          reservation.fingerprint !== input.fingerprint ||
          event.candidateRevision !==
            reservation.expectedCandidateRevision + 1 ||
          event.candidateRevision !== head ||
          event.factId !== reservation.factId ||
          event.factRevision !== reservation.expectedFactRevision + 1
        ) {
          throw new AssetIntakeError(
            'DECISION_CONFLICT',
            'Fact confirmation does not own the current candidate generation.',
          );
        }
      } else {
        if (event.candidateRevision !== head + 1) {
          throw new AssetIntakeError(
            'DECISION_CONFLICT',
            'Asset intake candidate decision head changed.',
          );
        }
        await client.query(
          `UPDATE p1_asset_intake_candidate_heads
              SET revision = $4, updated_at = now()
            WHERE workspace_id = $1 AND batch_id = $2 AND candidate_id = $3`,
          [
            event.workspaceId,
            event.batchId,
            event.candidateId,
            event.candidateRevision,
          ],
        );
      }
      await client.query(
        `INSERT INTO p1_asset_intake_decisions (
           workspace_id,
           batch_id,
           event_id,
           payload,
           occurred_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [
          event.workspaceId,
          event.batchId,
          event.eventId,
          event,
          event.occurredAt,
        ],
      );
      await client.query(
        `INSERT INTO p1_asset_intake_decision_receipts (
           workspace_id,
           idempotency_key,
           fingerprint,
           payload
         ) VALUES ($1, $2, $3, $4::jsonb)`,
        [
          event.workspaceId,
          input.idempotencyKey,
          input.fingerprint,
          event,
        ],
      );
      await client.query('COMMIT');
      return event;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async decisionReceiptWithClient(
    client: PoolClient,
    workspaceId: string,
    idempotencyKey: string,
  ) {
    const result = await client.query<ReceiptRow>(
      `SELECT fingerprint, payload
         FROM p1_asset_intake_decision_receipts
        WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, idempotencyKey],
    );
    const row = result.rows[0];
    return row
      ? {
          idempotencyKey,
          fingerprint: row.fingerprint,
          event: assetIntakeDecisionEventSchema.parse(row.payload),
        }
      : null;
  }

  async decisionReceipt(workspaceId: string, idempotencyKey: string) {
    const client = await this.pool.connect();
    try {
      return await this.decisionReceiptWithClient(
        client,
        workspaceId,
        idempotencyKey,
      );
    } finally {
      client.release();
    }
  }

  async listDecisions(workspaceId: string, batchId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload
         FROM p1_asset_intake_decisions
        WHERE workspace_id = $1 AND batch_id = $2
        ORDER BY decision_order ASC`,
      [workspaceId, batchId],
    );
    return result.rows.map((row) =>
      assetIntakeDecisionEventSchema.parse(row.payload),
    );
  }

  async reserveFactConfirmation(input: FactConfirmationReservation) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.workspaceId}:asset-intake-receipt:${input.idempotencyKey}`,
      ]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.workspaceId}:asset-intake-candidate:${input.batchId}:${input.candidateId}`,
      ]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.workspaceId}:asset-intake-fact:${input.factId}:${input.expectedFactRevision}`,
      ]);
      const existing = await client.query<PayloadRow>(
        `SELECT payload FROM p1_asset_intake_fact_confirmations
          WHERE workspace_id = $1
            AND (
              (
                batch_id = $2
                AND candidate_id = $3
                AND expected_candidate_revision = $4
              )
              OR (
                fact_id = $5
                AND expected_fact_revision = $6
              )
              OR idempotency_key = $7
            )
          ORDER BY idempotency_key = $7 DESC
          LIMIT 1`,
        [
          input.workspaceId,
          input.batchId,
          input.candidateId,
          input.expectedCandidateRevision,
          input.factId,
          input.expectedFactRevision,
          input.idempotencyKey,
        ],
      );
      if (existing.rows[0]) {
        const current = existing.rows[0]
          .payload as FactConfirmationReservation;
        const isReplay =
          current.idempotencyKey === input.idempotencyKey &&
          current.fingerprint === input.fingerprint;
        if (!isReplay && !isDeepStrictEqual(current, input)) {
          throw new AssetIntakeError(
            'DECISION_CONFLICT',
            'This candidate generation, fact revision or idempotency key already belongs to another confirmation.',
          );
        }
        await client.query('COMMIT');
        return current;
      }
      const head = await this.candidateHead(
        client,
        input.workspaceId,
        input.batchId,
        input.candidateId,
      );
      if (head !== input.expectedCandidateRevision) {
        throw new AssetIntakeError(
          'DECISION_CONFLICT',
          'Asset intake candidate decision head changed.',
        );
      }
      const inserted = await client.query<PayloadRow>(
        `INSERT INTO p1_asset_intake_fact_confirmations (
           workspace_id,
           batch_id,
           candidate_id,
           expected_candidate_revision,
           fact_id,
           expected_fact_revision,
           idempotency_key,
           payload
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT DO NOTHING
         RETURNING payload`,
        [
          input.workspaceId,
          input.batchId,
          input.candidateId,
          input.expectedCandidateRevision,
          input.factId,
          input.expectedFactRevision,
          input.idempotencyKey,
          input,
        ],
      );
      if (!inserted.rows[0]) {
        throw new AssetIntakeError(
          'DECISION_CONFLICT',
          'This candidate generation, fact revision or idempotency key already belongs to another confirmation.',
        );
      }
      await client.query(
        `UPDATE p1_asset_intake_candidate_heads
            SET revision = $4, updated_at = now()
          WHERE workspace_id = $1 AND batch_id = $2 AND candidate_id = $3`,
        [
          input.workspaceId,
          input.batchId,
          input.candidateId,
          input.expectedCandidateRevision + 1,
        ],
      );
      await client.query('COMMIT');
      return inserted.rows[0].payload as FactConfirmationReservation;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async abortFactConfirmation(input: FactConfirmationReservation) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.workspaceId}:asset-intake-receipt:${input.idempotencyKey}`,
      ]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.workspaceId}:asset-intake-candidate:${input.batchId}:${input.candidateId}`,
      ]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.workspaceId}:asset-intake-fact:${input.factId}:${input.expectedFactRevision}`,
      ]);
      const current = await client.query<PayloadRow>(
        `SELECT payload FROM p1_asset_intake_fact_confirmations
          WHERE workspace_id = $1
            AND batch_id = $2
            AND candidate_id = $3
            AND expected_candidate_revision = $4
            AND idempotency_key = $5
          FOR UPDATE`,
        [
          input.workspaceId,
          input.batchId,
          input.candidateId,
          input.expectedCandidateRevision,
          input.idempotencyKey,
        ],
      );
      if (!current.rows[0]) {
        await client.query('COMMIT');
        return;
      }
      if (!isDeepStrictEqual(current.rows[0].payload, input)) {
        throw new AssetIntakeError(
          'DECISION_CONFLICT',
          'Only the current fact confirmation owner can abort its reservation.',
        );
      }
      const receipt = await this.decisionReceiptWithClient(
        client,
        input.workspaceId,
        input.idempotencyKey,
      );
      if (receipt) {
        throw new AssetIntakeError(
          'DECISION_CONFLICT',
          'A completed fact confirmation cannot be aborted.',
        );
      }
      const deleted = await client.query(
        `DELETE FROM p1_asset_intake_fact_confirmations
          WHERE workspace_id = $1
            AND batch_id = $2
            AND candidate_id = $3
            AND expected_candidate_revision = $4
            AND idempotency_key = $5`,
        [
          input.workspaceId,
          input.batchId,
          input.candidateId,
          input.expectedCandidateRevision,
          input.idempotencyKey,
        ],
      );
      if (deleted.rowCount !== 1) {
        throw new AssetIntakeError(
          'DECISION_CONFLICT',
          'Fact confirmation reservation changed before abort.',
        );
      }
      const released = await client.query(
        `UPDATE p1_asset_intake_candidate_heads
            SET revision = $4, updated_at = now()
          WHERE workspace_id = $1
            AND batch_id = $2
            AND candidate_id = $3
            AND revision = $4 + 1`,
        [
          input.workspaceId,
          input.batchId,
          input.candidateId,
          input.expectedCandidateRevision,
        ],
      );
      if (released.rowCount !== 1) {
        throw new AssetIntakeError(
          'DECISION_CONFLICT',
          'Fact confirmation reservation is no longer the candidate head.',
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteWorkspaceForTest(workspaceId: string) {
    await this.pool.query(
      `DELETE FROM p1_asset_intake_fact_confirmations WHERE workspace_id = $1`,
      [workspaceId],
    );
    await this.pool.query(
      `DELETE FROM p1_asset_intake_decision_receipts WHERE workspace_id = $1`,
      [workspaceId],
    );
    await this.pool.query(
      `DELETE FROM p1_asset_intake_decisions WHERE workspace_id = $1`,
      [workspaceId],
    );
    await this.pool.query(
      `DELETE FROM p1_asset_intake_candidate_heads WHERE workspace_id = $1`,
      [workspaceId],
    );
    await this.pool.query(
      `DELETE FROM p1_asset_intake_batches WHERE workspace_id = $1`,
      [workspaceId],
    );
  }
}
