import {
  contextBundleRecompileEventSchema,
  contextBundleSchema,
  type ContextBundle,
} from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';
import {
  type ContextBundleRepository,
  ContextBundleIdempotencyConflictError,
  ContextBundleRevisionConflictError,
  contextBundleFreezeFingerprint,
  type FreezeContextBundleInput,
  validateCompiledContextBundle,
} from './context-bundle-repository.js';
import { contextSourceChanges } from './context-compiler.js';

interface PayloadRow {
  payload: unknown;
}

interface ReceiptRow {
  fingerprint: string;
  bundle_id: string;
  revision: string;
}

export class PostgresContextBundleRepository
  implements ContextBundleRepository
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS p1_context_bundle_heads (
        workspace_id text NOT NULL,
        bundle_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision >= 0),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, bundle_id)
      );
      CREATE TABLE IF NOT EXISTS p1_context_bundle_revisions (
        workspace_id text NOT NULL,
        bundle_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision > 0),
        bundle_hash text NOT NULL CHECK (bundle_hash ~ '^[a-f0-9]{64}$'),
        payload jsonb NOT NULL,
        frozen_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, bundle_id, revision),
        FOREIGN KEY (workspace_id, bundle_id)
          REFERENCES p1_context_bundle_heads (workspace_id, bundle_id)
      );
      CREATE TABLE IF NOT EXISTS p1_context_bundle_recompile_events (
        workspace_id text NOT NULL,
        bundle_id text NOT NULL,
        to_revision bigint NOT NULL CHECK (to_revision > 1),
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, bundle_id, to_revision),
        FOREIGN KEY (workspace_id, bundle_id, to_revision)
          REFERENCES p1_context_bundle_revisions (
            workspace_id,
            bundle_id,
            revision
          )
      );
      CREATE TABLE IF NOT EXISTS p1_context_bundle_freeze_receipts (
        workspace_id text NOT NULL,
        idempotency_key text NOT NULL,
        fingerprint text NOT NULL,
        bundle_id text NOT NULL,
        revision bigint NOT NULL CHECK (revision > 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, idempotency_key),
        FOREIGN KEY (workspace_id, bundle_id, revision)
          REFERENCES p1_context_bundle_revisions (
            workspace_id,
            bundle_id,
            revision
          )
      );
      CREATE OR REPLACE FUNCTION p1_reject_context_bundle_update()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'ContextBundle revisions are immutable';
      END;
      $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS p1_context_bundle_revision_immutable
        ON p1_context_bundle_revisions;
      CREATE TRIGGER p1_context_bundle_revision_immutable
        BEFORE UPDATE ON p1_context_bundle_revisions
        FOR EACH ROW EXECUTE FUNCTION p1_reject_context_bundle_update();
    `);
  }

  async freeze(input: FreezeContextBundleInput) {
    validateCompiledContextBundle(input.compiled);
    const fingerprint = contextBundleFreezeFingerprint(input);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${input.workspaceId}:context-freeze:${input.idempotencyKey}`,
      ]);
      const existingReceipt = await client.query<ReceiptRow>(
        `SELECT fingerprint, bundle_id, revision::text AS revision
           FROM p1_context_bundle_freeze_receipts
          WHERE workspace_id = $1 AND idempotency_key = $2`,
        [input.workspaceId, input.idempotencyKey],
      );
      const receipt = existingReceipt.rows[0];
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) {
          throw new ContextBundleIdempotencyConflictError(
            input.idempotencyKey,
          );
        }
        const replay = await this.getWithClient(
          client,
          input.workspaceId,
          receipt.bundle_id,
          Number(receipt.revision),
        );
        if (!replay) throw new Error('ContextBundle freeze receipt is corrupt.');
        await client.query('COMMIT');
        return replay;
      }

      await client.query(
        `INSERT INTO p1_context_bundle_heads (
           workspace_id,
           bundle_id,
           revision
         ) VALUES ($1, $2, 0)
         ON CONFLICT (workspace_id, bundle_id) DO NOTHING`,
        [input.workspaceId, input.bundleId],
      );
      const head = await client.query<{ revision: string }>(
        `SELECT revision::text AS revision
           FROM p1_context_bundle_heads
          WHERE workspace_id = $1 AND bundle_id = $2
          FOR UPDATE`,
        [input.workspaceId, input.bundleId],
      );
      const currentRevision = Number(head.rows[0]?.revision ?? 0);
      if (currentRevision !== input.expectedRevision) {
        throw new ContextBundleRevisionConflictError(
          input.bundleId,
          input.expectedRevision,
          currentRevision,
        );
      }
      const current =
        currentRevision === 0
          ? null
          : await this.getWithClient(
              client,
              input.workspaceId,
              input.bundleId,
              currentRevision,
            );
      const changedSources = current
        ? contextSourceChanges(
            current.sourceRevisions,
            input.compiled.payload.sourceRevisions,
          )
        : [];
      if (current && changedSources.length === 0) {
        throw new Error(
          'A ContextBundle recompile requires at least one source revision change.',
        );
      }
      const bundle = contextBundleSchema.parse({
        ...input.compiled.payload,
        bundleId: input.bundleId,
        revision: currentRevision + 1,
        hash: input.compiled.hash,
        frozenAt: input.frozenAt,
        frozenBy: input.frozenBy,
        previousRevision: current?.revision ?? null,
      });
      await client.query(
        `INSERT INTO p1_context_bundle_revisions (
           workspace_id,
           bundle_id,
           revision,
           bundle_hash,
           payload,
           frozen_at
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [
          bundle.workspaceId,
          bundle.bundleId,
          bundle.revision,
          bundle.hash,
          bundle,
          bundle.frozenAt,
        ],
      );
      if (current) {
        const event = contextBundleRecompileEventSchema.parse({
          eventId: `${input.bundleId}:recompile:${bundle.revision}`,
          workspaceId: input.workspaceId,
          bundleId: input.bundleId,
          fromRevision: current.revision,
          toRevision: bundle.revision,
          changedSources,
          reason: input.reason,
          occurredAt: input.frozenAt,
        });
        await client.query(
          `INSERT INTO p1_context_bundle_recompile_events (
             workspace_id,
             bundle_id,
             to_revision,
             payload,
             occurred_at
           ) VALUES ($1, $2, $3, $4::jsonb, $5)`,
          [
            event.workspaceId,
            event.bundleId,
            event.toRevision,
            event,
            event.occurredAt,
          ],
        );
      }
      await client.query(
        `UPDATE p1_context_bundle_heads
            SET revision = $3, updated_at = now()
          WHERE workspace_id = $1 AND bundle_id = $2`,
        [input.workspaceId, input.bundleId, bundle.revision],
      );
      await client.query(
        `INSERT INTO p1_context_bundle_freeze_receipts (
           workspace_id,
           idempotency_key,
           fingerprint,
           bundle_id,
           revision
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          input.workspaceId,
          input.idempotencyKey,
          fingerprint,
          input.bundleId,
          bundle.revision,
        ],
      );
      await client.query('COMMIT');
      return bundle;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async get(workspaceId: string, bundleId: string, revision?: number) {
    if (revision !== undefined) {
      return this.getWithClient(this.pool, workspaceId, bundleId, revision);
    }
    const result = await this.pool.query<PayloadRow>(
      `SELECT revisions.payload
         FROM p1_context_bundle_heads heads
         JOIN p1_context_bundle_revisions revisions
           ON revisions.workspace_id = heads.workspace_id
          AND revisions.bundle_id = heads.bundle_id
          AND revisions.revision = heads.revision
        WHERE heads.workspace_id = $1 AND heads.bundle_id = $2`,
      [workspaceId, bundleId],
    );
    return result.rows[0]
      ? contextBundleSchema.parse(result.rows[0].payload)
      : null;
  }

  async history(workspaceId: string, bundleId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload
         FROM p1_context_bundle_revisions
        WHERE workspace_id = $1 AND bundle_id = $2
        ORDER BY revision ASC`,
      [workspaceId, bundleId],
    );
    return result.rows.map((row) => contextBundleSchema.parse(row.payload));
  }

  async listRecompileEvents(workspaceId: string, bundleId: string) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload
         FROM p1_context_bundle_recompile_events
        WHERE workspace_id = $1 AND bundle_id = $2
        ORDER BY to_revision ASC`,
      [workspaceId, bundleId],
    );
    return result.rows.map((row) =>
      contextBundleRecompileEventSchema.parse(row.payload),
    );
  }

  async listReferencingBundles(
    workspaceId: string,
    factId: string,
    revision: number,
  ) {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload
         FROM p1_context_bundle_revisions
        WHERE workspace_id = $1
          AND payload->'referencedFactRevisions' @> $2::jsonb
        ORDER BY bundle_id ASC, revision ASC`,
      [workspaceId, JSON.stringify([{ factId, revision }])],
    );
    return result.rows.map((row) => contextBundleSchema.parse(row.payload));
  }

  async deleteWorkspaceForTest(workspaceId: string) {
    for (const table of [
      'p1_context_bundle_freeze_receipts',
      'p1_context_bundle_recompile_events',
      'p1_context_bundle_revisions',
      'p1_context_bundle_heads',
    ]) {
      await this.pool.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [
        workspaceId,
      ]);
    }
  }

  private async getWithClient(
    database: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
    workspaceId: string,
    bundleId: string,
    revision: number,
  ): Promise<ContextBundle | null> {
    const result = await database.query<PayloadRow>(
      `SELECT payload
         FROM p1_context_bundle_revisions
        WHERE workspace_id = $1 AND bundle_id = $2 AND revision = $3`,
      [workspaceId, bundleId, revision],
    );
    return result.rows[0]
      ? contextBundleSchema.parse(result.rows[0].payload)
      : null;
  }
}
