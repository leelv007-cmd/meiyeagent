import {
  assetRevisionSchema,
  preferenceCandidateSchema,
  preferenceSignalSchema,
  preferenceSchema,
  reusableAssetCandidateSchema,
  reusableAssetLifecycleEventSchema,
  type AssetRevision,
  type MemoryEntriesPage,
  type MemoryEntriesPageQuery,
  type PreferenceCandidate,
  type PreferenceSignal,
  type ReusableAssetCandidate,
} from '@meiye/contracts';
import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolClient } from 'pg';
import {
  ReuseMemoryError,
  type AppendAssetLifecycleInput,
  type CommitAssetRevisionInput,
  type CommitPreferenceInput,
  type MemoryCandidateDecision,
  type MemoryApprovalReceipt,
  type MemorySourceConversation,
  type MemorySedimentationAudit,
  type MemoryWorkLog,
  type ReuseMemoryRepository,
} from './reuse-memory-service.js';

interface PayloadRow {
  payload: unknown;
}

interface ReceiptRow extends PayloadRow {
  fingerprint: string;
}

export class PostgresReuseMemoryRepository
  implements ReuseMemoryRepository
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS p1_reusable_asset_candidates (
        workspace_id text NOT NULL,
        candidate_id text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, candidate_id)
      );
      CREATE TABLE IF NOT EXISTS p1_reusable_asset_heads (
        workspace_id text NOT NULL,
        asset_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision >= 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, asset_id)
      );
      CREATE TABLE IF NOT EXISTS p1_reusable_asset_promotions (
        workspace_id text NOT NULL,
        candidate_id text NOT NULL,
        asset_id text NOT NULL,
        revision_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, candidate_id),
        FOREIGN KEY (workspace_id, candidate_id)
          REFERENCES p1_reusable_asset_candidates (workspace_id, candidate_id)
      );
      CREATE TABLE IF NOT EXISTS p1_asset_revisions (
        workspace_id text NOT NULL,
        asset_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision > 0),
        revision_id text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, asset_id, revision),
        UNIQUE (workspace_id, revision_id),
        FOREIGN KEY (workspace_id, asset_id)
          REFERENCES p1_reusable_asset_heads (workspace_id, asset_id)
      );
      CREATE TABLE IF NOT EXISTS p1_reusable_asset_lifecycle (
        event_order bigint GENERATED ALWAYS AS IDENTITY,
        workspace_id text NOT NULL,
        asset_id text NOT NULL,
        revision_id text NOT NULL,
        event_id text NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, event_id),
        UNIQUE (event_order),
        FOREIGN KEY (workspace_id, revision_id)
          REFERENCES p1_asset_revisions (workspace_id, revision_id)
      );
      CREATE INDEX IF NOT EXISTS p1_reusable_asset_lifecycle_head_idx
        ON p1_reusable_asset_lifecycle (
          workspace_id,
          asset_id,
          event_order DESC
        );
      CREATE TABLE IF NOT EXISTS p1_reusable_asset_receipts (
        workspace_id text NOT NULL,
        receipt_kind text NOT NULL CHECK (
          receipt_kind IN ('asset_revision', 'asset_lifecycle')
        ),
        idempotency_key text NOT NULL,
        fingerprint text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, receipt_kind, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS p1_preference_candidates (
        workspace_id text NOT NULL,
        candidate_id text NOT NULL,
        payload jsonb NOT NULL,
        proposed_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, candidate_id)
      );
      CREATE TABLE IF NOT EXISTS p1_preference_signals (
        workspace_id text NOT NULL,
        signal_id text NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, signal_id)
      );
      CREATE INDEX IF NOT EXISTS p1_preference_signals_pattern_idx
        ON p1_preference_signals (workspace_id, occurred_at, signal_id);
      CREATE TABLE IF NOT EXISTS p1_preference_heads (
        workspace_id text NOT NULL,
        preference_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision >= 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, preference_id)
      );
      CREATE TABLE IF NOT EXISTS p1_preference_promotions (
        workspace_id text NOT NULL,
        candidate_id text NOT NULL,
        preference_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, candidate_id),
        FOREIGN KEY (workspace_id, candidate_id)
          REFERENCES p1_preference_candidates (workspace_id, candidate_id)
      );
      CREATE TABLE IF NOT EXISTS p1_preference_revisions (
        workspace_id text NOT NULL,
        preference_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision > 0),
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, preference_id, revision),
        FOREIGN KEY (workspace_id, preference_id)
          REFERENCES p1_preference_heads (workspace_id, preference_id)
      );
      CREATE TABLE IF NOT EXISTS p1_preference_receipts (
        workspace_id text NOT NULL,
        idempotency_key text NOT NULL,
        fingerprint text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS p1_memory_work_logs (
        workspace_id text NOT NULL,
        conversation_id text NOT NULL,
        turn_id text NOT NULL,
        payload jsonb NOT NULL,
        observed_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, turn_id)
      );
      CREATE TABLE IF NOT EXISTS p1_memory_source_conversations (
        workspace_id text NOT NULL,
        conversation_id text NOT NULL,
        payload jsonb NOT NULL,
        observed_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, conversation_id)
      );
      CREATE TABLE IF NOT EXISTS p1_memory_sedimentation_audits (
        workspace_id text NOT NULL,
        audit_id text NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, audit_id)
      );
      CREATE TABLE IF NOT EXISTS p1_memory_candidate_decisions (
        workspace_id text NOT NULL,
        decision_id text NOT NULL,
        candidate_id text NOT NULL,
        payload jsonb NOT NULL,
        decided_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, decision_id)
      );
      CREATE INDEX IF NOT EXISTS p1_memory_candidate_decisions_candidate_idx
        ON p1_memory_candidate_decisions (
          workspace_id,
          candidate_id,
          decided_at DESC,
          decision_id DESC
        );
      CREATE TABLE IF NOT EXISTS p1_memory_approval_receipts (
        workspace_id text NOT NULL,
        receipt_id text NOT NULL,
        candidate_id text NOT NULL,
        payload jsonb NOT NULL,
        approved_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, receipt_id)
      );
      CREATE TABLE IF NOT EXISTS p1_memory_source_tombstones (
        workspace_id text NOT NULL,
        conversation_id text NOT NULL,
        deleted_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, conversation_id)
      );
      CREATE TABLE IF NOT EXISTS p1_memory_entry_tombstones (
        workspace_id text NOT NULL,
        entry_id text NOT NULL,
        deleted_at timestamptz NOT NULL,
        deleted_by text NOT NULL,
        source_ref jsonb,
        PRIMARY KEY (workspace_id, entry_id)
      );
      CREATE OR REPLACE FUNCTION p1_reject_reuse_memory_update()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Reuse memory history is immutable';
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS p1_reusable_promotion_immutable
        ON p1_reusable_asset_promotions;
      CREATE TRIGGER p1_reusable_promotion_immutable
        BEFORE UPDATE ON p1_reusable_asset_promotions
        FOR EACH ROW EXECUTE FUNCTION p1_reject_reuse_memory_update();
      DROP TRIGGER IF EXISTS p1_preference_promotion_immutable
        ON p1_preference_promotions;
      CREATE TRIGGER p1_preference_promotion_immutable
        BEFORE UPDATE ON p1_preference_promotions
        FOR EACH ROW EXECUTE FUNCTION p1_reject_reuse_memory_update();
      DROP TRIGGER IF EXISTS p1_reusable_candidate_immutable
        ON p1_reusable_asset_candidates;
      CREATE TRIGGER p1_reusable_candidate_immutable
        BEFORE UPDATE ON p1_reusable_asset_candidates
        FOR EACH ROW EXECUTE FUNCTION p1_reject_reuse_memory_update();
      DROP TRIGGER IF EXISTS p1_asset_revision_immutable
        ON p1_asset_revisions;
      CREATE TRIGGER p1_asset_revision_immutable
        BEFORE UPDATE ON p1_asset_revisions
        FOR EACH ROW EXECUTE FUNCTION p1_reject_reuse_memory_update();
      DROP TRIGGER IF EXISTS p1_asset_lifecycle_immutable
        ON p1_reusable_asset_lifecycle;
      CREATE TRIGGER p1_asset_lifecycle_immutable
        BEFORE UPDATE ON p1_reusable_asset_lifecycle
        FOR EACH ROW EXECUTE FUNCTION p1_reject_reuse_memory_update();
      DROP TRIGGER IF EXISTS p1_preference_candidate_immutable
        ON p1_preference_candidates;
      CREATE TRIGGER p1_preference_candidate_immutable
        BEFORE UPDATE ON p1_preference_candidates
        FOR EACH ROW EXECUTE FUNCTION p1_reject_reuse_memory_update();
      DROP TRIGGER IF EXISTS p1_preference_signal_immutable
        ON p1_preference_signals;
      CREATE TRIGGER p1_preference_signal_immutable
        BEFORE UPDATE ON p1_preference_signals
        FOR EACH ROW EXECUTE FUNCTION p1_reject_reuse_memory_update();
      DROP TRIGGER IF EXISTS p1_preference_revision_immutable
        ON p1_preference_revisions;
      CREATE TRIGGER p1_preference_revision_immutable
        BEFORE UPDATE ON p1_preference_revisions
        FOR EACH ROW EXECUTE FUNCTION p1_reject_reuse_memory_update();
    `);
  }

  private async saveCandidate<T>(input: {
    table: 'p1_reusable_asset_candidates' | 'p1_preference_candidates';
    workspaceId: string;
    candidateId: string;
    payload: T;
    timestampColumn: 'created_at' | 'proposed_at';
    timestamp: string;
    parse: (value: unknown) => T;
  }) {
    const inserted = await this.pool.query<PayloadRow>(
      `INSERT INTO ${input.table} (
         workspace_id,
         candidate_id,
         payload,
         ${input.timestampColumn}
       ) VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (workspace_id, candidate_id) DO NOTHING
       RETURNING payload`,
      [input.workspaceId, input.candidateId, input.payload, input.timestamp],
    );
    const row =
      inserted.rows[0] ??
      (
        await this.pool.query<PayloadRow>(
          `SELECT payload FROM ${input.table}
            WHERE workspace_id = $1 AND candidate_id = $2`,
          [input.workspaceId, input.candidateId],
        )
      ).rows[0];
    const stored = row ? input.parse(row.payload) : null;
    if (!stored || !isDeepStrictEqual(stored, input.payload)) {
      throw new ReuseMemoryError(
        'CONFLICT',
        `Candidate ${input.candidateId} already has another payload.`,
      );
    }
    return stored;
  }

  async saveReusableCandidate(input: ReusableAssetCandidate) {
    const candidate = reusableAssetCandidateSchema.parse(input);
    return this.saveCandidate({
      table: 'p1_reusable_asset_candidates',
      workspaceId: candidate.workspaceId,
      candidateId: candidate.candidateId,
      payload: candidate,
      timestampColumn: 'created_at',
      timestamp: candidate.createdAt,
      parse: (value) => reusableAssetCandidateSchema.parse(value),
    });
  }

  async getReusableCandidate(workspaceId: string, candidateId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM p1_reusable_asset_candidates
        WHERE workspace_id = $1 AND candidate_id = $2`,
      [workspaceId, candidateId],
    );
    return result.rows[0]
      ? reusableAssetCandidateSchema.parse(result.rows[0].payload)
      : null;
  }

  private async reusableReceipt(
    client: PoolClient,
    workspaceId: string,
    kind: 'asset_revision' | 'asset_lifecycle',
    idempotencyKey: string,
  ) {
    const result = await client.query<ReceiptRow>(
      `SELECT fingerprint, payload
         FROM p1_reusable_asset_receipts
        WHERE workspace_id = $1
          AND receipt_kind = $2
          AND idempotency_key = $3`,
      [workspaceId, kind, idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  async assetRevisionReceipt(
    workspaceId: string,
    idempotencyKey: string,
    expectedFingerprint: string,
  ) {
    const client = await this.pool.connect();
    try {
      const receipt = await this.reusableReceipt(
        client,
        workspaceId,
        'asset_revision',
        idempotencyKey,
      );
      if (!receipt) return null;
      if (receipt.fingerprint !== expectedFingerprint) {
        throw new ReuseMemoryError('CONFLICT', 'Idempotency key was reused.');
      }
      return assetRevisionSchema.parse(receipt.payload);
    } finally {
      client.release();
    }
  }

  async commitAssetRevision(input: CommitAssetRevisionInput) {
    const revision = assetRevisionSchema.parse(input.revision);
    const lifecycle = reusableAssetLifecycleEventSchema.parse(input.lifecycle);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${revision.workspaceId}:reusable-receipt:asset_revision:${input.idempotencyKey}`,
      ]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${revision.workspaceId}:reusable-asset:${revision.assetId}`,
      ]);
      const receipt = await this.reusableReceipt(
        client,
        revision.workspaceId,
        'asset_revision',
        input.idempotencyKey,
      );
      if (receipt) {
        if (receipt.fingerprint !== input.fingerprint) {
          throw new ReuseMemoryError('CONFLICT', 'Idempotency key was reused.');
        }
        await client.query('COMMIT');
        return assetRevisionSchema.parse(receipt.payload);
      }
      await client.query(
        `INSERT INTO p1_reusable_asset_heads (
           workspace_id,
           asset_id,
           revision
         ) VALUES ($1, $2, 0)
         ON CONFLICT (workspace_id, asset_id) DO NOTHING`,
        [revision.workspaceId, revision.assetId],
      );
      const head = await client.query<{ revision: string }>(
        `SELECT revision::text AS revision
           FROM p1_reusable_asset_heads
          WHERE workspace_id = $1 AND asset_id = $2
          FOR UPDATE`,
        [revision.workspaceId, revision.assetId],
      );
      if (Number(head.rows[0]?.revision ?? 0) !== input.expectedRevision) {
        throw new ReuseMemoryError('CONFLICT', 'AssetRevision head changed.');
      }
      if (
        revision.revision !== input.expectedRevision + 1 ||
        lifecycle.action !== 'activated' ||
        lifecycle.workspaceId !== revision.workspaceId ||
        lifecycle.assetId !== revision.assetId ||
        lifecycle.revisionId !== revision.revisionId
      ) {
        throw new ReuseMemoryError('INVALID_STATE', 'Invalid AssetRevision commit.');
      }
      const promotion = await client.query(
        `INSERT INTO p1_reusable_asset_promotions (
           workspace_id,
           candidate_id,
           asset_id,
           revision_id
         ) VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, candidate_id) DO NOTHING
         RETURNING candidate_id`,
        [
          revision.workspaceId,
          revision.candidateId,
          revision.assetId,
          revision.revisionId,
        ],
      );
      if (promotion.rowCount !== 1) {
        throw new ReuseMemoryError(
          'CONFLICT',
          'Reusable asset candidate was already promoted.',
        );
      }
      await client.query(
        `INSERT INTO p1_asset_revisions (
           workspace_id,
           asset_id,
           revision,
           revision_id,
           payload,
           created_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          revision.workspaceId,
          revision.assetId,
          revision.revision,
          revision.revisionId,
          revision,
          revision.createdAt,
        ],
      );
      await client.query(
        `INSERT INTO p1_reusable_asset_lifecycle (
           workspace_id,
           asset_id,
           revision_id,
           event_id,
           payload,
           occurred_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          lifecycle.workspaceId,
          lifecycle.assetId,
          lifecycle.revisionId,
          lifecycle.eventId,
          lifecycle,
          lifecycle.occurredAt,
        ],
      );
      await client.query(
        `UPDATE p1_reusable_asset_heads
            SET revision = $3, updated_at = now()
          WHERE workspace_id = $1 AND asset_id = $2`,
        [revision.workspaceId, revision.assetId, revision.revision],
      );
      await client.query(
        `INSERT INTO p1_reusable_asset_receipts (
           workspace_id,
           receipt_kind,
           idempotency_key,
           fingerprint,
           payload
         ) VALUES ($1, 'asset_revision', $2, $3, $4::jsonb)`,
        [
          revision.workspaceId,
          input.idempotencyKey,
          input.fingerprint,
          revision,
        ],
      );
      await client.query('COMMIT');
      return revision;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async appendAssetLifecycle(input: AppendAssetLifecycleInput) {
    const event = reusableAssetLifecycleEventSchema.parse(input.event);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${event.workspaceId}:reusable-receipt:asset_lifecycle:${input.idempotencyKey}`,
      ]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${event.workspaceId}:reusable-asset:${event.assetId}`,
      ]);
      const receipt = await this.reusableReceipt(
        client,
        event.workspaceId,
        'asset_lifecycle',
        input.idempotencyKey,
      );
      if (receipt) {
        if (receipt.fingerprint !== input.fingerprint) {
          throw new ReuseMemoryError('CONFLICT', 'Idempotency key was reused.');
        }
        await client.query('COMMIT');
        return reusableAssetLifecycleEventSchema.parse(receipt.payload);
      }
      const current = await client.query<PayloadRow>(
        `SELECT payload
           FROM p1_reusable_asset_lifecycle
          WHERE workspace_id = $1 AND asset_id = $2
          ORDER BY event_order DESC
          LIMIT 1`,
        [event.workspaceId, event.assetId],
      );
      const currentEvent = current.rows[0]
        ? reusableAssetLifecycleEventSchema.parse(current.rows[0].payload)
        : null;
      if (event.action !== 'deactivated' || currentEvent?.action !== 'activated') {
        throw new ReuseMemoryError('INVALID_STATE', 'Series is not active.');
      }
      const target = await client.query<{ revision_id: string }>(
        `SELECT revisions.revision_id
           FROM p1_reusable_asset_heads heads
           JOIN p1_asset_revisions revisions
             ON revisions.workspace_id = heads.workspace_id
            AND revisions.asset_id = heads.asset_id
            AND revisions.revision = heads.revision
          WHERE heads.workspace_id = $1 AND heads.asset_id = $2`,
        [event.workspaceId, event.assetId],
      );
      if (target.rows[0]?.revision_id !== event.revisionId) {
        throw new ReuseMemoryError('NOT_FOUND', 'Current AssetRevision not found.');
      }
      await client.query(
        `INSERT INTO p1_reusable_asset_lifecycle (
           workspace_id,
           asset_id,
           revision_id,
           event_id,
           payload,
           occurred_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          event.workspaceId,
          event.assetId,
          event.revisionId,
          event.eventId,
          event,
          event.occurredAt,
        ],
      );
      await client.query(
        `INSERT INTO p1_reusable_asset_receipts (
           workspace_id,
           receipt_kind,
           idempotency_key,
           fingerprint,
           payload
         ) VALUES ($1, 'asset_lifecycle', $2, $3, $4::jsonb)`,
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

  async assetHistory(workspaceId: string, assetId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM p1_asset_revisions
        WHERE workspace_id = $1 AND asset_id = $2
        ORDER BY revision ASC`,
      [workspaceId, assetId],
    );
    return result.rows.map((row) => assetRevisionSchema.parse(row.payload));
  }

  async assetLifecycle(workspaceId: string, assetId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM p1_reusable_asset_lifecycle
        WHERE workspace_id = $1 AND asset_id = $2
        ORDER BY event_order ASC`,
      [workspaceId, assetId],
    );
    return result.rows.map((row) =>
      reusableAssetLifecycleEventSchema.parse(row.payload),
    );
  }

  async listAssetHeads(workspaceId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT revisions.payload
         FROM p1_reusable_asset_heads heads
         JOIN p1_asset_revisions revisions
           ON revisions.workspace_id = heads.workspace_id
          AND revisions.asset_id = heads.asset_id
          AND revisions.revision = heads.revision
        WHERE heads.workspace_id = $1
        ORDER BY heads.asset_id ASC`,
      [workspaceId],
    );
    return result.rows.map((row) => assetRevisionSchema.parse(row.payload));
  }

  async savePreferenceSignal(input: PreferenceSignal) {
    const signal = preferenceSignalSchema.parse(input);
    const inserted = await this.pool.query<PayloadRow>(
      `INSERT INTO p1_preference_signals (
         workspace_id,
         signal_id,
         payload,
         occurred_at
       ) VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (workspace_id, signal_id) DO NOTHING
       RETURNING payload`,
      [signal.workspaceId, signal.signalId, signal, signal.occurredAt],
    );
    const row =
      inserted.rows[0] ??
      (
        await this.pool.query<PayloadRow>(
          `SELECT payload FROM p1_preference_signals
            WHERE workspace_id = $1 AND signal_id = $2`,
          [signal.workspaceId, signal.signalId],
        )
      ).rows[0];
    const stored = row ? preferenceSignalSchema.parse(row.payload) : null;
    if (!stored || !isDeepStrictEqual(stored, signal)) {
      throw new ReuseMemoryError(
        'CONFLICT',
        `Preference signal ${signal.signalId} already has another payload.`,
      );
    }
    return stored;
  }

  async getPreferenceSignal(workspaceId: string, signalId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM p1_preference_signals
        WHERE workspace_id = $1 AND signal_id = $2`,
      [workspaceId, signalId],
    );
    return result.rows[0]
      ? preferenceSignalSchema.parse(result.rows[0].payload)
      : null;
  }

  async listPreferenceSignals(workspaceId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM p1_preference_signals
        WHERE workspace_id = $1
        ORDER BY occurred_at ASC, signal_id ASC`,
      [workspaceId],
    );
    return result.rows.map((row) => preferenceSignalSchema.parse(row.payload));
  }

  async savePreferenceCandidate(input: PreferenceCandidate) {
    const candidate = preferenceCandidateSchema.parse(input);
    return this.saveCandidate({
      table: 'p1_preference_candidates',
      workspaceId: candidate.workspaceId,
      candidateId: candidate.candidateId,
      payload: candidate,
      timestampColumn: 'proposed_at',
      timestamp: candidate.proposedAt,
      parse: (value) => preferenceCandidateSchema.parse(value),
    });
  }

  async getPreferenceCandidate(workspaceId: string, candidateId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM p1_preference_candidates
        WHERE workspace_id = $1 AND candidate_id = $2`,
      [workspaceId, candidateId],
    );
    return result.rows[0]
      ? preferenceCandidateSchema.parse(result.rows[0].payload)
      : null;
  }

  async preferenceReceipt(
    workspaceId: string,
    idempotencyKey: string,
    expectedFingerprint: string,
  ) {
    const result = await this.pool.query<ReceiptRow>(
      `SELECT fingerprint, payload FROM p1_preference_receipts
        WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, idempotencyKey],
    );
    const receipt = result.rows[0];
    if (!receipt) return null;
    if (receipt.fingerprint !== expectedFingerprint) {
      throw new ReuseMemoryError('CONFLICT', 'Idempotency key was reused.');
    }
    return preferenceSchema.parse(receipt.payload);
  }

  async commitPreference(input: CommitPreferenceInput) {
    const preference = preferenceSchema.parse(input.preference);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${preference.workspaceId}:preference-receipt:${input.idempotencyKey}`,
      ]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${preference.workspaceId}:memory-candidate:${preference.candidateId}`,
      ]);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${preference.workspaceId}:preference:${preference.preferenceId}`,
      ]);
      const receipt = await client.query<ReceiptRow>(
        `SELECT fingerprint, payload FROM p1_preference_receipts
          WHERE workspace_id = $1 AND idempotency_key = $2`,
        [preference.workspaceId, input.idempotencyKey],
      );
      if (receipt.rows[0]) {
        if (receipt.rows[0].fingerprint !== input.fingerprint) {
          throw new ReuseMemoryError('CONFLICT', 'Idempotency key was reused.');
        }
        await client.query('COMMIT');
        return preferenceSchema.parse(receipt.rows[0].payload);
      }
      const rejected = await client.query(
        `SELECT 1 FROM p1_memory_candidate_decisions
          WHERE workspace_id = $1
            AND candidate_id = $2
            AND payload->>'action' = 'rejected'
          LIMIT 1`,
        [preference.workspaceId, preference.candidateId],
      );
      if (rejected.rowCount) {
        throw new ReuseMemoryError(
          'INVALID_STATE',
          'A rejected candidate cannot be confirmed.',
        );
      }
      await client.query(
        `INSERT INTO p1_preference_heads (
           workspace_id,
           preference_id,
           revision
         ) VALUES ($1, $2, 0)
         ON CONFLICT (workspace_id, preference_id) DO NOTHING`,
        [preference.workspaceId, preference.preferenceId],
      );
      const head = await client.query<{ revision: string }>(
        `SELECT revision::text AS revision FROM p1_preference_heads
          WHERE workspace_id = $1 AND preference_id = $2
          FOR UPDATE`,
        [preference.workspaceId, preference.preferenceId],
      );
      if (Number(head.rows[0]?.revision ?? 0) !== input.expectedRevision) {
        throw new ReuseMemoryError('CONFLICT', 'Preference head changed.');
      }
      if (preference.revision !== input.expectedRevision + 1) {
        throw new ReuseMemoryError('INVALID_STATE', 'Invalid Preference revision.');
      }
      if (input.expectedRevision === 0) {
        const promotion = await client.query(
          `INSERT INTO p1_preference_promotions (
             workspace_id,
             candidate_id,
             preference_id
           ) VALUES ($1, $2, $3)
           ON CONFLICT (workspace_id, candidate_id) DO NOTHING
           RETURNING candidate_id`,
          [
            preference.workspaceId,
            preference.candidateId,
            preference.preferenceId,
          ],
        );
        if (promotion.rowCount !== 1) {
          throw new ReuseMemoryError(
            'CONFLICT',
            'PreferenceCandidate was already promoted.',
          );
        }
      } else {
        const promotion = await client.query<{ preference_id: string }>(
          `SELECT preference_id FROM p1_preference_promotions
            WHERE workspace_id = $1 AND candidate_id = $2`,
          [preference.workspaceId, preference.candidateId],
        );
        if (promotion.rows[0]?.preference_id !== preference.preferenceId) {
          throw new ReuseMemoryError(
            'CONFLICT',
            'PreferenceCandidate promotion does not match this Preference.',
          );
        }
      }
      await client.query(
        `INSERT INTO p1_preference_revisions (
           workspace_id,
           preference_id,
           revision,
           payload,
           created_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [
          preference.workspaceId,
          preference.preferenceId,
          preference.revision,
          preference,
          preference.changedAt,
        ],
      );
      await client.query(
        `UPDATE p1_preference_heads
            SET revision = $3, updated_at = now()
          WHERE workspace_id = $1 AND preference_id = $2`,
        [
          preference.workspaceId,
          preference.preferenceId,
          preference.revision,
        ],
      );
      await client.query(
        `INSERT INTO p1_preference_receipts (
           workspace_id,
           idempotency_key,
           fingerprint,
           payload
         ) VALUES ($1, $2, $3, $4::jsonb)`,
        [
          preference.workspaceId,
          input.idempotencyKey,
          input.fingerprint,
          preference,
        ],
      );
      if (input.expectedRevision === 0) {
        if (!input.decision || !input.approvalReceipt) {
          throw new ReuseMemoryError(
            'INVALID_STATE',
            'Preference confirmation requires a decision and approval receipt.',
          );
        }
        await client.query(
          `INSERT INTO p1_memory_candidate_decisions (
           workspace_id, decision_id, candidate_id, payload, decided_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
          [
            input.decision.workspaceId,
            input.decision.decisionId,
            input.decision.candidateId,
            input.decision,
            input.decision.decidedAt,
          ],
        );
        await client.query(
          `INSERT INTO p1_memory_approval_receipts (
           workspace_id, receipt_id, candidate_id, payload, approved_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
          [
            input.approvalReceipt.workspaceId,
            input.approvalReceipt.receiptId,
            input.approvalReceipt.candidateId,
            input.approvalReceipt,
            input.approvalReceipt.approvedAt,
          ],
        );
      }
      await client.query('COMMIT');
      return preference;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async preferenceHistory(workspaceId: string, preferenceId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM p1_preference_revisions
        WHERE workspace_id = $1 AND preference_id = $2
        ORDER BY revision ASC`,
      [workspaceId, preferenceId],
    );
    return result.rows.map((row) => preferenceSchema.parse(row.payload));
  }

  async listPreferenceCandidates(workspaceId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM p1_preference_candidates
        WHERE workspace_id = $1
        ORDER BY candidate_id ASC`,
      [workspaceId],
    );
    return result.rows.map((row) =>
      preferenceCandidateSchema.parse(row.payload),
    );
  }

  async listPreferenceHeads(workspaceId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT revisions.payload
         FROM p1_preference_heads heads
         JOIN p1_preference_revisions revisions
           ON revisions.workspace_id = heads.workspace_id
          AND revisions.preference_id = heads.preference_id
          AND revisions.revision = heads.revision
        WHERE heads.workspace_id = $1
        ORDER BY heads.preference_id ASC`,
      [workspaceId],
    );
    return result.rows.map((row) => preferenceSchema.parse(row.payload));
  }

  async saveMemoryWorkLog(input: MemoryWorkLog) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.workspaceId}:memory-source:${input.conversationId}`,
      ]);
      const tombstone = await client.query(
        `SELECT 1 FROM p1_memory_source_tombstones
          WHERE workspace_id = $1 AND conversation_id = $2`,
        [input.workspaceId, input.conversationId],
      );
      if (tombstone.rowCount) {
        throw new ReuseMemoryError(
          'INVALID_STATE',
          `Conversation ${input.conversationId} was deleted.`,
        );
      }
      const inserted = await client.query<PayloadRow>(
        `INSERT INTO p1_memory_work_logs (
           workspace_id, conversation_id, turn_id, payload, observed_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (workspace_id, turn_id) DO NOTHING
         RETURNING payload`,
        [
          input.workspaceId,
          input.conversationId,
          input.turnId,
          input,
          input.observedAt,
        ],
      );
      const row =
        inserted.rows[0] ??
        (
          await client.query<PayloadRow>(
            `SELECT payload FROM p1_memory_work_logs
              WHERE workspace_id = $1 AND turn_id = $2`,
            [input.workspaceId, input.turnId],
          )
        ).rows[0];
      if (!row || !isDeepStrictEqual(row.payload, input)) {
        throw new ReuseMemoryError(
          'CONFLICT',
          `Work log ${input.turnId} already has another payload.`,
        );
      }
      await client.query('COMMIT');
      return structuredClone(input);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async saveMemorySourceConversation(input: MemorySourceConversation) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.workspaceId}:memory-source:${input.conversationId}`,
      ]);
      const tombstone = await client.query(
        `SELECT 1 FROM p1_memory_source_tombstones
          WHERE workspace_id = $1 AND conversation_id = $2`,
        [input.workspaceId, input.conversationId],
      );
      if (tombstone.rowCount) {
        throw new ReuseMemoryError(
          'INVALID_STATE',
          `Conversation ${input.conversationId} was deleted.`,
        );
      }
      const inserted = await client.query<PayloadRow>(
        `INSERT INTO p1_memory_source_conversations (
           workspace_id, conversation_id, payload, observed_at
         ) VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (workspace_id, conversation_id) DO NOTHING
         RETURNING payload`,
        [
          input.workspaceId,
          input.conversationId,
          input,
          input.observedAt,
        ],
      );
      const row =
        inserted.rows[0] ??
        (
          await client.query<PayloadRow>(
            `SELECT payload FROM p1_memory_source_conversations
              WHERE workspace_id = $1 AND conversation_id = $2`,
            [input.workspaceId, input.conversationId],
          )
        ).rows[0];
      if (!row || !isDeepStrictEqual(row.payload, input)) {
        throw new ReuseMemoryError(
          'CONFLICT',
          `Source conversation ${input.conversationId} already has another payload.`,
        );
      }
      await client.query('COMMIT');
      return structuredClone(input);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getMemoryWorkLog(workspaceId: string, turnId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM p1_memory_work_logs
        WHERE workspace_id = $1 AND turn_id = $2`,
      [workspaceId, turnId],
    );
    return (result.rows[0]?.payload as MemoryWorkLog | undefined) ?? null;
  }

  async hasMemorySourceConversation(
    workspaceId: string,
    conversationId: string,
  ) {
    const result = await this.pool.query(
      `SELECT 1 FROM p1_memory_source_conversations
        WHERE workspace_id = $1 AND conversation_id = $2
        LIMIT 1`,
      [workspaceId, conversationId],
    );
    return Boolean(result.rowCount);
  }

  async appendMemorySedimentationAudit(input: MemorySedimentationAudit) {
    const inserted = await this.pool.query<PayloadRow>(
      `INSERT INTO p1_memory_sedimentation_audits (
         workspace_id, audit_id, payload, occurred_at
       ) VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (workspace_id, audit_id) DO NOTHING
       RETURNING payload`,
      [input.workspaceId, input.auditId, input, input.occurredAt],
    );
    const row =
      inserted.rows[0] ??
      (
        await this.pool.query<PayloadRow>(
          `SELECT payload FROM p1_memory_sedimentation_audits
            WHERE workspace_id = $1 AND audit_id = $2`,
          [input.workspaceId, input.auditId],
        )
      ).rows[0];
    if (!row || !isDeepStrictEqual(row.payload, input)) {
      throw new ReuseMemoryError('CONFLICT', 'Sedimentation audit identity reused.');
    }
    return structuredClone(input);
  }

  async listMemorySedimentationAudits(workspaceId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM p1_memory_sedimentation_audits
        WHERE workspace_id = $1
        ORDER BY occurred_at ASC, audit_id ASC`,
      [workspaceId],
    );
    return result.rows.map((row) => row.payload as MemorySedimentationAudit);
  }

  async appendMemoryCandidateDecision(input: MemoryCandidateDecision) {
    const inserted = await this.pool.query<PayloadRow>(
      `INSERT INTO p1_memory_candidate_decisions (
         workspace_id, decision_id, candidate_id, payload, decided_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (workspace_id, decision_id) DO NOTHING
       RETURNING payload`,
      [
        input.workspaceId,
        input.decisionId,
        input.candidateId,
        input,
        input.decidedAt,
      ],
    );
    const row =
      inserted.rows[0] ??
      (
        await this.pool.query<PayloadRow>(
          `SELECT payload FROM p1_memory_candidate_decisions
            WHERE workspace_id = $1 AND decision_id = $2`,
          [input.workspaceId, input.decisionId],
        )
      ).rows[0];
    if (!row || !isDeepStrictEqual(row.payload, input)) {
      throw new ReuseMemoryError(
        'CONFLICT',
        `Memory decision ${input.decisionId} already has another payload.`,
      );
    }
    return structuredClone(input);
  }

  async listMemoryCandidateDecisions(workspaceId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM p1_memory_candidate_decisions
        WHERE workspace_id = $1
        ORDER BY decided_at ASC, decision_id ASC`,
      [workspaceId],
    );
    return result.rows.map((row) => row.payload as MemoryCandidateDecision);
  }

  async listMemoryApprovalReceipts(workspaceId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM p1_memory_approval_receipts
        WHERE workspace_id = $1
        ORDER BY approved_at ASC, receipt_id ASC`,
      [workspaceId],
    );
    return result.rows.map((row) => row.payload as MemoryApprovalReceipt);
  }

  async rejectMemoryCandidate(input: MemoryCandidateDecision) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.workspaceId}:memory-candidate:${input.candidateId}`,
      ]);
      const promotion = await client.query(
        `SELECT 1 FROM p1_preference_promotions
          WHERE workspace_id = $1 AND candidate_id = $2`,
        [input.workspaceId, input.candidateId],
      );
      if (promotion.rowCount) {
        throw new ReuseMemoryError(
          'INVALID_STATE',
          'A confirmed candidate cannot be rejected.',
        );
      }
      const inserted = await client.query<PayloadRow>(
        `INSERT INTO p1_memory_candidate_decisions (
           workspace_id, decision_id, candidate_id, payload, decided_at
         ) VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (workspace_id, decision_id) DO NOTHING
         RETURNING payload`,
        [
          input.workspaceId,
          input.decisionId,
          input.candidateId,
          input,
          input.decidedAt,
        ],
      );
      const row =
        inserted.rows[0] ??
        (
          await client.query<PayloadRow>(
            `SELECT payload FROM p1_memory_candidate_decisions
              WHERE workspace_id = $1 AND decision_id = $2`,
            [input.workspaceId, input.decisionId],
          )
        ).rows[0];
      if (!row || !isDeepStrictEqual(row.payload, input)) {
        throw new ReuseMemoryError(
          'CONFLICT',
          `Memory decision ${input.decisionId} already has another payload.`,
        );
      }
      await client.query('COMMIT');
      return 'rejected' as const;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listMemoryEntriesPage(
    workspaceId: string,
    query: MemoryEntriesPageQuery,
  ): Promise<MemoryEntriesPage> {
    let cursor: [string, string] | null = null;
    if (query.cursor) {
      const decoded = JSON.parse(
        Buffer.from(query.cursor, 'base64url').toString('utf8'),
      ) as unknown;
      if (
        !Array.isArray(decoded) ||
        decoded.length !== 2 ||
        decoded.some((value) => typeof value !== 'string')
      ) {
        throw new SyntaxError('Invalid memory page cursor.');
      }
      cursor = decoded as [string, string];
    }
    const result = await this.pool.query<{
      payload: unknown;
      work_log: unknown | null;
      source_deleted_at: string | null;
      confirmed: boolean;
      rejected: boolean;
    }>(
      `SELECT candidates.payload,
              work_logs.payload AS work_log,
              tombstones.deleted_at::text AS source_deleted_at,
              (promotions.candidate_id IS NOT NULL) AS confirmed,
              EXISTS (
                SELECT 1
                  FROM p1_memory_candidate_decisions decisions
                 WHERE decisions.workspace_id = candidates.workspace_id
                   AND decisions.candidate_id = candidates.candidate_id
                   AND decisions.payload->>'action' = 'rejected'
              ) AS rejected
         FROM p1_preference_candidates candidates
         LEFT JOIN p1_preference_promotions promotions
           ON promotions.workspace_id = candidates.workspace_id
          AND promotions.candidate_id = candidates.candidate_id
         LEFT JOIN p1_memory_source_conversations work_logs
           ON work_logs.workspace_id = candidates.workspace_id
          AND work_logs.conversation_id =
              candidates.payload #>> '{source,conversationId}'
         LEFT JOIN p1_memory_source_tombstones tombstones
           ON tombstones.workspace_id = candidates.workspace_id
          AND tombstones.conversation_id =
              candidates.payload #>> '{source,conversationId}'
         LEFT JOIN p1_memory_entry_tombstones entry_tombstones
           ON entry_tombstones.workspace_id = candidates.workspace_id
          AND entry_tombstones.entry_id = candidates.candidate_id
        WHERE candidates.workspace_id = $1
          AND entry_tombstones.entry_id IS NULL
          AND (
            $2::timestamptz IS NULL
            OR (candidates.proposed_at, candidates.candidate_id) <
               ($2::timestamptz, $3::text)
          )
        ORDER BY candidates.proposed_at DESC, candidates.candidate_id DESC
        LIMIT $4`,
      [workspaceId, cursor?.[0] ?? null, cursor?.[1] ?? null, query.limit + 1],
    );
    const selected = result.rows.slice(0, query.limit);
    const candidates = selected.map((row) => ({
      row,
      candidate: preferenceCandidateSchema.parse(row.payload),
      log: row.work_log as MemoryWorkLog | null,
    }));
    return {
      items: candidates.map(({ row, candidate, log }) => {
        const source = candidate.source;
        const preview =
          source && log
            ? log.messages
                .filter(
                  (message) =>
                    message.index >= source.messageRange.start &&
                    message.index <= source.messageRange.end,
                )
                .map((message) => message.text)
                .join(' ')
                .trim()
            : '';
        return {
          entryId: candidate.candidateId,
          semanticKey: candidate.semanticKey,
          value: candidate.proposedValue,
          status: row.confirmed
            ? ('confirmed' as const)
            : row.rejected
              ? ('rejected' as const)
              : ('pending' as const),
          proposedAt: candidate.proposedAt,
          source:
            source
              ? {
                  conversationId: source.conversationId,
                  sourceTurnId: source.sourceTurnId,
                  messageRange: source.messageRange,
                  status: row.source_deleted_at
                    ? ('deleted' as const)
                    : log && preview
                      ? ('available' as const)
                      : ('unavailable' as const),
                  observedAt: log?.observedAt ?? null,
                  preview: row.source_deleted_at
                    ? null
                    : preview
                      ? preview.slice(0, 500)
                      : null,
                  deletedAt: row.source_deleted_at
                    ? new Date(row.source_deleted_at).toISOString()
                    : null,
                }
              : null,
        };
      }),
      nextCursor:
        result.rows.length > query.limit && candidates.at(-1)
          ? Buffer.from(
              JSON.stringify([
                candidates.at(-1)?.candidate.proposedAt,
                candidates.at(-1)?.candidate.candidateId,
              ]),
            ).toString('base64url')
          : null,
    };
  }

  async markMemorySourceDeleted(
    workspaceId: string,
    conversationId: string,
    deletedAt: string,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${workspaceId}:memory-source:${conversationId}`,
      ]);
      await client.query(
        `INSERT INTO p1_memory_source_tombstones (
           workspace_id, conversation_id, deleted_at
         ) VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, conversation_id) DO NOTHING`,
        [workspaceId, conversationId, deletedAt],
      );
      await client.query(
        `DELETE FROM p1_memory_source_conversations
          WHERE workspace_id = $1 AND conversation_id = $2`,
        [workspaceId, conversationId],
      );
      await client.query(
        `DELETE FROM p1_memory_work_logs
          WHERE workspace_id = $1 AND conversation_id = $2`,
        [workspaceId, conversationId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async deleteMemoryEntry(input: {
    workspaceId: string;
    entryId: string;
    deletedAt: string;
    deletedBy: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.workspaceId}:memory-entry:${input.entryId}`,
      ]);
      const tombstone = await client.query(
        `SELECT 1 FROM p1_memory_entry_tombstones
          WHERE workspace_id = $1 AND entry_id = $2`,
        [input.workspaceId, input.entryId],
      );
      if (tombstone.rowCount) {
        await client.query('COMMIT');
        return 'deleted' as const;
      }
      const candidate = await client.query<PayloadRow>(
        `SELECT payload FROM p1_preference_candidates
          WHERE workspace_id = $1 AND candidate_id = $2
          FOR UPDATE`,
        [input.workspaceId, input.entryId],
      );
      if (!candidate.rows[0]) {
        await client.query('COMMIT');
        return 'not_found' as const;
      }
      const sourceRef = preferenceCandidateSchema.parse(
        candidate.rows[0].payload,
      ).source;
      const promotions = await client.query<{ preference_id: string }>(
        `SELECT preference_id FROM p1_preference_promotions
          WHERE workspace_id = $1 AND candidate_id = $2`,
        [input.workspaceId, input.entryId],
      );
      await client.query(
        `DELETE FROM p1_preference_receipts
          WHERE workspace_id = $1 AND payload->>'candidateId' = $2`,
        [input.workspaceId, input.entryId],
      );
      for (const { preference_id: preferenceId } of promotions.rows) {
        await client.query(
          `DELETE FROM p1_preference_revisions
            WHERE workspace_id = $1 AND preference_id = $2`,
          [input.workspaceId, preferenceId],
        );
        await client.query(
          `DELETE FROM p1_preference_heads
            WHERE workspace_id = $1 AND preference_id = $2`,
          [input.workspaceId, preferenceId],
        );
      }
      await client.query(
        `DELETE FROM p1_preference_promotions
          WHERE workspace_id = $1 AND candidate_id = $2`,
        [input.workspaceId, input.entryId],
      );
      await client.query(
        `DELETE FROM p1_preference_candidates
          WHERE workspace_id = $1 AND candidate_id = $2`,
        [input.workspaceId, input.entryId],
      );
      await client.query(
        `INSERT INTO p1_memory_entry_tombstones (
           workspace_id, entry_id, deleted_at, deleted_by, source_ref
         ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          input.workspaceId,
          input.entryId,
          input.deletedAt,
          input.deletedBy,
          sourceRef ?? null,
        ],
      );
      await client.query('COMMIT');
      return 'deleted' as const;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async isMemoryEntryDeleted(workspaceId: string, entryId: string) {
    const result = await this.pool.query(
      `SELECT 1 FROM p1_memory_entry_tombstones
        WHERE workspace_id = $1 AND entry_id = $2`,
      [workspaceId, entryId],
    );
    return Boolean(result.rowCount);
  }

  async deleteWorkspaceForTest(workspaceId: string) {
    for (const table of [
      'p1_preference_receipts',
      'p1_memory_entry_tombstones',
      'p1_memory_source_tombstones',
      'p1_memory_candidate_decisions',
      'p1_memory_approval_receipts',
      'p1_memory_sedimentation_audits',
      'p1_memory_source_conversations',
      'p1_memory_work_logs',
      'p1_preference_revisions',
      'p1_preference_heads',
      'p1_preference_promotions',
      'p1_preference_candidates',
      'p1_preference_signals',
      'p1_reusable_asset_receipts',
      'p1_reusable_asset_lifecycle',
      'p1_asset_revisions',
      'p1_reusable_asset_heads',
      'p1_reusable_asset_promotions',
      'p1_reusable_asset_candidates',
    ]) {
      await this.pool.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [
        workspaceId,
      ]);
    }
  }
}
