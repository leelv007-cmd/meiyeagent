/**
 * Postgres store for HarnessRelease three objects (V31-21 / V3.1 §33.1):
 * p1_harness_release_artifacts / p1_harness_release_lifecycle / p1_harness_release_rollouts.
 */

import { isDeepStrictEqual } from 'node:util';

import type { Pool, PoolClient } from 'pg';

import {
  harnessReleaseArtifactSchema,
  harnessReleaseLifecycleSchema,
  harnessReleaseRolloutSchema,
  type HarnessReleaseArtifact,
  type HarnessReleaseLifecycle,
  type HarnessReleaseRollout,
} from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import type {
  HarnessReleaseLifecycleStatus,
  HarnessReleaseStore,
} from './harness-release.js';

type PayloadRow<T> = { payload: T };

function clonePayload<T>(row: PayloadRow<T> | undefined): T | null {
  return row ? structuredClone(row.payload) : null;
}

export class PostgresHarnessReleaseStore implements HarnessReleaseStore {
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient): Promise<void> {
    const executor = client ?? this.pool;
    await executor.query(`
      SELECT pg_advisory_xact_lock(
        hashtext('p1-harness-release-migration-v1')
      );
      CREATE TABLE IF NOT EXISTS p1_harness_release_artifacts (
        release_id text PRIMARY KEY,
        version bigint NOT NULL CHECK (version > 0),
        manifest_hash text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS p1_harness_release_artifacts_manifest_hash_idx
        ON p1_harness_release_artifacts (manifest_hash);
      CREATE TABLE IF NOT EXISTS p1_harness_release_lifecycle (
        release_id text PRIMARY KEY,
        status text NOT NULL CHECK (
          status IN ('draft', 'evaluating', 'canary', 'production', 'retired')
        ),
        approved_by text,
        approved_at timestamptz,
        updated_at timestamptz NOT NULL,
        payload jsonb NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS p1_harness_release_lifecycle_production_uq
        ON p1_harness_release_lifecycle ((status))
        WHERE status = 'production';
      CREATE UNIQUE INDEX IF NOT EXISTS p1_harness_release_lifecycle_canary_uq
        ON p1_harness_release_lifecycle ((status))
        WHERE status = 'canary';
      CREATE TABLE IF NOT EXISTS p1_harness_release_production_history (
        release_id text PRIMARY KEY,
        first_promoted_at timestamptz NOT NULL
      );
      INSERT INTO p1_harness_release_production_history (release_id, first_promoted_at)
      SELECT release_id, COALESCE(approved_at, updated_at)
      FROM p1_harness_release_lifecycle
      WHERE status = 'production'
      ON CONFLICT (release_id) DO NOTHING;
      CREATE TABLE IF NOT EXISTS p1_harness_release_rollouts (
        release_id text PRIMARY KEY,
        workspace_allowlist jsonb NOT NULL DEFAULT '[]'::jsonb,
        percentage integer,
        industry_allowlist jsonb,
        updated_at timestamptz NOT NULL,
        payload jsonb NOT NULL
      );
    `);
  }

  async putArtifactImmutable(
    artifact: HarnessReleaseArtifact,
  ): Promise<HarnessReleaseArtifact> {
    const parsed = harnessReleaseArtifactSchema.parse(artifact);
    const inserted = await this.pool.query<PayloadRow<HarnessReleaseArtifact>>(
      `INSERT INTO p1_harness_release_artifacts
         (release_id, version, manifest_hash, payload, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
       ON CONFLICT (release_id) DO NOTHING
       RETURNING payload`,
      [
        parsed.releaseId,
        parsed.version,
        parsed.manifestHash,
        JSON.stringify(parsed),
        parsed.createdAt,
      ],
    );
    if (inserted.rows[0]) {
      return structuredClone(parsed);
    }
    const existing = await this.pool.query<PayloadRow<HarnessReleaseArtifact>>(
      'SELECT payload FROM p1_harness_release_artifacts WHERE release_id = $1',
      [parsed.releaseId],
    );
    const stored = clonePayload(existing.rows[0]);
    if (stored && isDeepStrictEqual(stored, parsed)) {
      return structuredClone(stored);
    }
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      `HarnessReleaseArtifact ${parsed.releaseId} is immutable and already bound to a different manifest.`,
    );
  }

  async getArtifact(
    releaseId: string,
  ): Promise<HarnessReleaseArtifact | null> {
    const result = await this.pool.query<PayloadRow<unknown>>(
      'SELECT payload FROM p1_harness_release_artifacts WHERE release_id = $1',
      [releaseId],
    );
    const payload = clonePayload(result.rows[0]);
    return payload ? harnessReleaseArtifactSchema.parse(payload) : null;
  }

  async listArtifacts(): Promise<HarnessReleaseArtifact[]> {
    const result = await this.pool.query<PayloadRow<unknown>>(
      'SELECT payload FROM p1_harness_release_artifacts ORDER BY created_at DESC',
    );
    return result.rows.map((row) =>
      harnessReleaseArtifactSchema.parse(clonePayload(row)),
    );
  }

  async putLifecycle(
    lifecycle: HarnessReleaseLifecycle,
  ): Promise<HarnessReleaseLifecycle> {
    const parsed = harnessReleaseLifecycleSchema.parse(lifecycle);
    // Clear conflicting unique status holders in the same transaction when
    // needed; service layer already retires them, but enforce at write too.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (parsed.status === 'production' || parsed.status === 'canary') {
        const conflict = await client.query<{ release_id: string }>(
          `SELECT release_id FROM p1_harness_release_lifecycle
            WHERE status = $1 AND release_id <> $2
            FOR UPDATE`,
          [parsed.status, parsed.releaseId],
        );
        if (conflict.rows[0]) {
          await client.query('ROLLBACK');
          throw new P1DomainError(
            'INVALID_STATE',
            `Only one HarnessRelease may be ${parsed.status} at a time (held by ${conflict.rows[0].release_id}).`,
          );
        }
      }
      const result = await client.query<PayloadRow<HarnessReleaseLifecycle>>(
        `INSERT INTO p1_harness_release_lifecycle
           (release_id, status, approved_by, approved_at, updated_at, payload)
         VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::jsonb)
         ON CONFLICT (release_id) DO UPDATE SET
           status = EXCLUDED.status,
           approved_by = EXCLUDED.approved_by,
           approved_at = EXCLUDED.approved_at,
           updated_at = EXCLUDED.updated_at,
           payload = EXCLUDED.payload
         RETURNING payload`,
        [
          parsed.releaseId,
          parsed.status,
          parsed.approvedBy ?? null,
          parsed.approvedAt ?? null,
          parsed.updatedAt,
          JSON.stringify(parsed),
        ],
      );
      if (parsed.status === 'production') {
        await client.query(
          `INSERT INTO p1_harness_release_production_history (release_id, first_promoted_at)
           VALUES ($1, $2::timestamptz) ON CONFLICT (release_id) DO NOTHING`,
          [parsed.releaseId, parsed.updatedAt],
        );
      }
      await client.query('COMMIT');
      return harnessReleaseLifecycleSchema.parse(result.rows[0]!.payload);
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback failures after commit/connection errors
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async transitionLifecycleAtomic(
    expectedStatus: HarnessReleaseLifecycleStatus,
    lifecycle: HarnessReleaseLifecycle,
    options: { requirePriorProduction?: boolean } = {},
  ) {
    const parsed = harnessReleaseLifecycleSchema.parse(lifecycle);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('p1-harness-release-lifecycle-swap'))`,
      );
      const targetResult = await client.query<PayloadRow<unknown>>(
        `SELECT payload FROM p1_harness_release_lifecycle
          WHERE release_id = $1 FOR UPDATE`,
        [parsed.releaseId],
      );
      const targetPayload = clonePayload(targetResult.rows[0]);
      if (!targetPayload) {
        throw new P1DomainError('NOT_FOUND', `HarnessReleaseLifecycle not found: ${parsed.releaseId}`);
      }
      const target = harnessReleaseLifecycleSchema.parse(targetPayload);
      if (target.status !== expectedStatus) {
        throw new P1DomainError('INVALID_STATE', `Stale lifecycle transition for ${parsed.releaseId}; expected ${expectedStatus}, found ${target.status}.`);
      }
      const transitions: Record<HarnessReleaseLifecycleStatus, readonly HarnessReleaseLifecycleStatus[]> = {
        draft: ['evaluating', 'retired'],
        evaluating: ['canary', 'draft', 'retired'],
        canary: ['production', 'evaluating', 'retired'],
        production: ['retired'],
        retired: ['production'],
      };
      if (!transitions[target.status].includes(parsed.status)) {
        throw new P1DomainError('INVALID_STATE', `Illegal lifecycle transition ${target.status} → ${parsed.status} for ${parsed.releaseId}.`);
      }
      if (options.requirePriorProduction) {
        const history = await client.query(
          'SELECT 1 FROM p1_harness_release_production_history WHERE release_id = $1',
          [parsed.releaseId],
        );
        if (!history.rows[0]) {
          throw new P1DomainError('INVALID_STATE', `Rollback target ${parsed.releaseId} has no prior production identity.`);
        }
      }
      const holderResult = await client.query<PayloadRow<unknown>>(
        `SELECT payload FROM p1_harness_release_lifecycle
          WHERE status = $1 AND release_id <> $2
          FOR UPDATE`,
        [parsed.status, parsed.releaseId],
      );
      let previousHolder: HarnessReleaseLifecycle | null = null;
      const holderPayload = clonePayload(holderResult.rows[0]);
      if (holderPayload && (parsed.status === 'production' || parsed.status === 'canary')) {
        const holder = harnessReleaseLifecycleSchema.parse(holderPayload);
        previousHolder = harnessReleaseLifecycleSchema.parse({
          ...holder,
          status: 'retired',
          updatedAt: parsed.updatedAt,
        });
        await client.query(
          `UPDATE p1_harness_release_lifecycle SET
             status = 'retired', updated_at = $2::timestamptz, payload = $3::jsonb
           WHERE release_id = $1`,
          [
            previousHolder.releaseId,
            previousHolder.updatedAt,
            JSON.stringify(previousHolder),
          ],
        );
      }
      const result = await client.query<PayloadRow<HarnessReleaseLifecycle>>(
        `UPDATE p1_harness_release_lifecycle SET
           status = $2, approved_by = $3, approved_at = $4::timestamptz,
           updated_at = $5::timestamptz, payload = $6::jsonb
         WHERE release_id = $1 AND status = $7
         RETURNING payload`,
        [
          parsed.releaseId,
          parsed.status,
          parsed.approvedBy ?? null,
          parsed.approvedAt ?? null,
          parsed.updatedAt,
          JSON.stringify(parsed),
          expectedStatus,
        ],
      );
      if (!result.rows[0]) {
        throw new P1DomainError('INVALID_STATE', `Stale lifecycle transition for ${parsed.releaseId}.`);
      }
      if (parsed.status === 'production') {
        await client.query(
          `INSERT INTO p1_harness_release_production_history (release_id, first_promoted_at)
           VALUES ($1, $2::timestamptz) ON CONFLICT (release_id) DO NOTHING`,
          [parsed.releaseId, parsed.updatedAt],
        );
      }
      await client.query('COMMIT');
      return {
        lifecycle: harnessReleaseLifecycleSchema.parse(result.rows[0]!.payload),
        previousHolder,
      };
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback failures after connection errors
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async getLifecycle(
    releaseId: string,
  ): Promise<HarnessReleaseLifecycle | null> {
    const result = await this.pool.query<PayloadRow<unknown>>(
      'SELECT payload FROM p1_harness_release_lifecycle WHERE release_id = $1',
      [releaseId],
    );
    const payload = clonePayload(result.rows[0]);
    return payload ? harnessReleaseLifecycleSchema.parse(payload) : null;
  }

  async listLifecycles(): Promise<HarnessReleaseLifecycle[]> {
    const result = await this.pool.query<PayloadRow<unknown>>(
      'SELECT payload FROM p1_harness_release_lifecycle ORDER BY updated_at DESC',
    );
    return result.rows.map((row) =>
      harnessReleaseLifecycleSchema.parse(clonePayload(row)),
    );
  }

  async getLifecycleByStatus(
    status: 'production' | 'canary',
  ): Promise<HarnessReleaseLifecycle | null> {
    const result = await this.pool.query<PayloadRow<unknown>>(
      `SELECT payload FROM p1_harness_release_lifecycle
        WHERE status = $1
        LIMIT 1`,
      [status],
    );
    const payload = clonePayload(result.rows[0]);
    return payload ? harnessReleaseLifecycleSchema.parse(payload) : null;
  }

  async putRollout(
    rollout: HarnessReleaseRollout,
  ): Promise<HarnessReleaseRollout> {
    const parsed = harnessReleaseRolloutSchema.parse(rollout);
    const result = await this.pool.query<PayloadRow<HarnessReleaseRollout>>(
      `INSERT INTO p1_harness_release_rollouts
         (release_id, workspace_allowlist, percentage, industry_allowlist, updated_at, payload)
       VALUES ($1, $2::jsonb, $3, $4::jsonb, $5::timestamptz, $6::jsonb)
       ON CONFLICT (release_id) DO UPDATE SET
         workspace_allowlist = EXCLUDED.workspace_allowlist,
         percentage = EXCLUDED.percentage,
         industry_allowlist = EXCLUDED.industry_allowlist,
         updated_at = EXCLUDED.updated_at,
         payload = EXCLUDED.payload
       RETURNING payload`,
      [
        parsed.releaseId,
        JSON.stringify(parsed.workspaceAllowlist),
        parsed.percentage ?? null,
        parsed.industryAllowlist
          ? JSON.stringify(parsed.industryAllowlist)
          : null,
        parsed.updatedAt,
        JSON.stringify(parsed),
      ],
    );
    return harnessReleaseRolloutSchema.parse(result.rows[0]!.payload);
  }

  async getRollout(releaseId: string): Promise<HarnessReleaseRollout | null> {
    const result = await this.pool.query<PayloadRow<unknown>>(
      'SELECT payload FROM p1_harness_release_rollouts WHERE release_id = $1',
      [releaseId],
    );
    const payload = clonePayload(result.rows[0]);
    return payload ? harnessReleaseRolloutSchema.parse(payload) : null;
  }

  async listRollouts(): Promise<HarnessReleaseRollout[]> {
    const result = await this.pool.query<PayloadRow<unknown>>(
      'SELECT payload FROM p1_harness_release_rollouts ORDER BY updated_at DESC',
    );
    return result.rows.map((row) =>
      harnessReleaseRolloutSchema.parse(clonePayload(row)),
    );
  }
}
