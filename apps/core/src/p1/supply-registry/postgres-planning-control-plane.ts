import { isDeepStrictEqual } from 'node:util';
import type {
  HealthOverlayPort,
  HealthOverlayRecord,
  RoutePolicyRevision,
} from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';
import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import type {
  ModelSupplyPlanningControlPlanePort,
  ModelSupplyPlanningControlPlaneState,
} from '../model-supply/index.js';
import {
  applyHealthFailureFact,
  healthOverlayTargetKey,
  resolveHealthOverlayRecord,
  type HealthFailureFact,
  type StoredHealthOverlay,
} from './health-overlay.js';
import type { DeploymentDataPolicyBinding } from './supply-control-plane.js';
import type { RankingCandidateInput } from './three-layer-ranking.js';
import type { RoutePolicyPayload } from './route-policy.js';

interface HealthRow {
  value: StoredHealthOverlay;
}

function routePayload(revision: RoutePolicyRevision): RoutePolicyPayload {
  return {
    operation: revision.operation,
    qualityTier: revision.qualityTier ?? 'quality',
    hardConstraints: [...revision.hardConstraints],
    candidateDeploymentIds: [...revision.candidateDeploymentIds],
    ...(revision.orderBands ? { orderBands: [...revision.orderBands] } : {}),
    maxAttempts: revision.maxAttempts,
    ...(revision.costBoundaryMicros !== undefined
      ? { costBoundaryMicros: revision.costBoundaryMicros }
      : {}),
    fallbackAuthorized: revision.fallbackAuthorized,
    ...(revision.modelSubstitutionDegradationSurfaces
      ? {
          modelSubstitutionDegradationSurfaces: structuredClone(
            revision.modelSubstitutionDegradationSurfaces,
          ),
        }
      : {}),
  };
}

export class PostgresSupplyPlanningMigration implements PostgresSchemaMigrator {
  async migrate(client: PoolClient): Promise<void> {
    await client.query(`
      CREATE TABLE IF NOT EXISTS p1_supply_route_policy_revisions (
        workspace_id text NOT NULL,
        revision_id text NOT NULL,
        operation text NOT NULL,
        quality_tier text NOT NULL,
        value jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, revision_id)
      );
      CREATE TABLE IF NOT EXISTS p1_supply_route_policy_heads (
        workspace_id text NOT NULL,
        operation text NOT NULL,
        quality_tier text NOT NULL,
        revision_id text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, operation, quality_tier),
        FOREIGN KEY (workspace_id, revision_id)
          REFERENCES p1_supply_route_policy_revisions (workspace_id, revision_id)
      );
      CREATE TABLE IF NOT EXISTS p1_supply_route_policy_publications (
        workspace_id text NOT NULL,
        revision_id text NOT NULL,
        operation text NOT NULL,
        quality_tier text NOT NULL,
        published_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, revision_id),
        FOREIGN KEY (workspace_id, revision_id)
          REFERENCES p1_supply_route_policy_revisions (workspace_id, revision_id)
      );
      INSERT INTO p1_supply_route_policy_publications
        (workspace_id, revision_id, operation, quality_tier)
      SELECT workspace_id, revision_id, operation, quality_tier
        FROM p1_supply_route_policy_heads
      ON CONFLICT (workspace_id, revision_id) DO NOTHING;
      CREATE TABLE IF NOT EXISTS p1_supply_health_overlays (
        scope_id text NOT NULL,
        target_key text NOT NULL,
        target_kind text NOT NULL,
        target_id text NOT NULL,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (scope_id, target_key)
      );
      CREATE TABLE IF NOT EXISTS p1_supply_health_overlay_events (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        scope_id text NOT NULL,
        target_key text NOT NULL,
        fact jsonb NOT NULL,
        resulting_value jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS p1_supply_data_policy_heads (
        workspace_id text NOT NULL,
        deployment_id text NOT NULL,
        revision_id text NOT NULL,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, deployment_id)
      );
      CREATE TABLE IF NOT EXISTS p1_supply_ranking_input_heads (
        workspace_id text NOT NULL,
        deployment_id text NOT NULL,
        value jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, deployment_id)
      );
      CREATE INDEX IF NOT EXISTS p1_supply_health_overlay_target_idx
        ON p1_supply_health_overlays (scope_id, target_kind, target_id);
    `);
  }
}

/** Durable G4 overlay with immutable transition events. */
export class PostgresHealthOverlayPort implements HealthOverlayPort {
  constructor(
    private readonly pool: Pool,
    private readonly scopeId = '__platform_supply__',
    private readonly clock: () => number = Date.now,
  ) {}

  async get(
    targetKind: HealthOverlayRecord['targetKind'],
    targetId: string,
  ): Promise<HealthOverlayRecord | null> {
    const result = await this.pool.query<HealthRow>(
      `SELECT value
         FROM p1_supply_health_overlays
        WHERE scope_id = $1 AND target_key = $2`,
      [this.scopeId, healthOverlayTargetKey(targetKind, targetId)],
    );
    const stored = result.rows[0]?.value;
    return stored
      ? resolveHealthOverlayRecord(stored.record, this.clock())
      : null;
  }

  async list(filter?: {
    targetKind?: HealthOverlayRecord['targetKind'];
  }): Promise<HealthOverlayRecord[]> {
    const result = await this.pool.query<HealthRow>(
      `SELECT value
         FROM p1_supply_health_overlays
        WHERE scope_id = $1
          AND ($2::text IS NULL OR target_kind = $2)
        ORDER BY target_key`,
      [this.scopeId, filter?.targetKind ?? null],
    );
    return result.rows.map(({ value }) =>
      resolveHealthOverlayRecord(value.record, this.clock()),
    );
  }

  async upsert(record: HealthOverlayRecord): Promise<void> {
    const key = healthOverlayTargetKey(record.targetKind, record.targetId);
    const current = await this.readStored(key);
    const value: StoredHealthOverlay = {
      record: structuredClone(record),
      counters: current?.counters ?? {
        consecutiveFails: 0,
        consecutive5xx: 0,
      },
    };
    await this.write(key, value);
  }

  async clear(
    targetKind: HealthOverlayRecord['targetKind'],
    targetId: string,
  ): Promise<void> {
    await this.pool.query(
      `DELETE FROM p1_supply_health_overlays
        WHERE scope_id = $1 AND target_key = $2`,
      [this.scopeId, healthOverlayTargetKey(targetKind, targetId)],
    );
  }

  async reportFact(fact: HealthFailureFact): Promise<HealthOverlayRecord> {
    const key = healthOverlayTargetKey(fact.targetKind, fact.targetId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [JSON.stringify([this.scopeId, key])],
      );
      const current = await client.query<HealthRow>(
        `SELECT value
           FROM p1_supply_health_overlays
          WHERE scope_id = $1 AND target_key = $2
          FOR UPDATE`,
        [this.scopeId, key],
      );
      const next = applyHealthFailureFact({
        previous: current.rows[0]?.value ?? null,
        fact,
        nowMs: this.clock(),
      });
      await client.query(
        `INSERT INTO p1_supply_health_overlays
           (scope_id, target_key, target_kind, target_id, value, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, now())
         ON CONFLICT (scope_id, target_key) DO UPDATE
           SET value = EXCLUDED.value, updated_at = now()`,
        [
          this.scopeId,
          key,
          fact.targetKind,
          fact.targetId,
          JSON.stringify(next),
        ],
      );
      await client.query(
        `INSERT INTO p1_supply_health_overlay_events
           (scope_id, target_key, fact, resulting_value)
         VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
        [this.scopeId, key, JSON.stringify(fact), JSON.stringify(next)],
      );
      await client.query('COMMIT');
      return next.record;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async readStored(key: string): Promise<StoredHealthOverlay | null> {
    const result = await this.pool.query<HealthRow>(
      `SELECT value FROM p1_supply_health_overlays
        WHERE scope_id = $1 AND target_key = $2`,
      [this.scopeId, key],
    );
    return result.rows[0]?.value ?? null;
  }

  private async write(key: string, value: StoredHealthOverlay): Promise<void> {
    await this.pool.query(
      `INSERT INTO p1_supply_health_overlays
         (scope_id, target_key, target_kind, target_id, value, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, now())
       ON CONFLICT (scope_id, target_key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = now()`,
      [
        this.scopeId,
        key,
        value.record.targetKind,
        value.record.targetId,
        JSON.stringify(value),
      ],
    );
  }
}

/** Shared PostgreSQL read model consumed by the production route planner. */
export class PostgresSupplyPlanningControlPlane
  implements ModelSupplyPlanningControlPlanePort
{
  readonly health: PostgresHealthOverlayPort;

  constructor(private readonly pool: Pool, healthScopeId?: string) {
    this.health = new PostgresHealthOverlayPort(pool, healthScopeId);
  }

  async saveRoutePolicyCandidate(
    workspaceId: string,
    revision: RoutePolicyRevision,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.persistRoutePolicyRevision(client, workspaceId, revision);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async publishRoutePolicy(
    workspaceId: string,
    revision: RoutePolicyRevision,
    expectedHeadRevisionId: string | null,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.persistRoutePolicyRevision(client, workspaceId, revision);
      const changed =
        expectedHeadRevisionId === null
          ? await client.query(
              `INSERT INTO p1_supply_route_policy_heads
                 (workspace_id, operation, quality_tier, revision_id)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (workspace_id, operation, quality_tier) DO NOTHING
               RETURNING revision_id`,
              [
                workspaceId,
                revision.operation,
                revision.qualityTier ?? 'quality',
                revision.revisionId,
              ],
            )
          : await client.query(
              `UPDATE p1_supply_route_policy_heads
                  SET revision_id = $4, updated_at = now()
                WHERE workspace_id = $1 AND operation = $2
                  AND quality_tier = $3 AND revision_id = $5
              RETURNING revision_id`,
              [
                workspaceId,
                revision.operation,
                revision.qualityTier ?? 'quality',
                revision.revisionId,
                expectedHeadRevisionId,
              ],
            );
      if (changed.rowCount !== 1) {
        throw new Error('RoutePolicy head changed before publish.');
      }
      await client.query(
        `INSERT INTO p1_supply_route_policy_publications
           (workspace_id, revision_id, operation, quality_tier)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, revision_id) DO NOTHING`,
        [
          workspaceId,
          revision.revisionId,
          revision.operation,
          revision.qualityTier ?? 'quality',
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async rollbackRoutePolicy(input: {
    workspaceId: string;
    operation: string;
    qualityTier: string;
    expectedHeadRevisionId: string;
    targetRevisionId: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE p1_supply_route_policy_heads
          SET revision_id = $5, updated_at = now()
        WHERE workspace_id = $1 AND operation = $2 AND quality_tier = $3
          AND revision_id = $4
          AND EXISTS (
            SELECT 1 FROM p1_supply_route_policy_publications publications
             WHERE publications.workspace_id = $1
               AND publications.revision_id = $5
               AND publications.operation = $2
               AND publications.quality_tier = $3
          )`,
      [
        input.workspaceId,
        input.operation,
        input.qualityTier,
        input.expectedHeadRevisionId,
        input.targetRevisionId,
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error(
        'RoutePolicy head changed or rollback target was not previously published.',
      );
    }
  }

  async listPublishedRoutePolicies(
    workspaceId: string,
  ): Promise<RoutePolicyRevision[]> {
    const result = await this.pool.query<{ value: RoutePolicyRevision }>(
      `SELECT revisions.value
         FROM p1_supply_route_policy_heads heads
         JOIN p1_supply_route_policy_revisions revisions
           ON revisions.workspace_id = heads.workspace_id
          AND revisions.revision_id = heads.revision_id
        WHERE heads.workspace_id = $1
        ORDER BY heads.operation, heads.quality_tier`,
      [workspaceId],
    );
    return result.rows.map(({ value }) => structuredClone(value));
  }

  async listRoutePolicyRevisions(
    workspaceId: string,
  ): Promise<RoutePolicyRevision[]> {
    const result = await this.pool.query<{ value: RoutePolicyRevision }>(
      `SELECT value
         FROM p1_supply_route_policy_revisions
        WHERE workspace_id = $1
        ORDER BY created_at, revision_id`,
      [workspaceId],
    );
    return result.rows.map(({ value }) => structuredClone(value));
  }

  async listRoutePolicyPublicationHistory(
    workspaceId: string,
  ): Promise<RoutePolicyRevision[]> {
    const result = await this.pool.query<{ value: RoutePolicyRevision }>(
      `SELECT revisions.value
         FROM p1_supply_route_policy_publications publications
         JOIN p1_supply_route_policy_revisions revisions
           ON revisions.workspace_id = publications.workspace_id
          AND revisions.revision_id = publications.revision_id
        WHERE publications.workspace_id = $1
        ORDER BY publications.published_at, publications.revision_id`,
      [workspaceId],
    );
    return result.rows.map(({ value }) => structuredClone(value));
  }

  async getRoutePolicyRevision(
    workspaceId: string,
    revisionId: string,
  ): Promise<RoutePolicyRevision | null> {
    const result = await this.pool.query<{ value: RoutePolicyRevision }>(
      `SELECT value
         FROM p1_supply_route_policy_revisions
        WHERE workspace_id = $1 AND revision_id = $2`,
      [workspaceId, revisionId],
    );
    return result.rows[0]?.value ?? null;
  }

  async setDataPolicyBinding(
    workspaceId: string,
    binding: DeploymentDataPolicyBinding,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO p1_supply_data_policy_heads
         (workspace_id, deployment_id, revision_id, value, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (workspace_id, deployment_id) DO UPDATE
         SET revision_id = EXCLUDED.revision_id,
             value = EXCLUDED.value,
             updated_at = now()`,
      [
        workspaceId,
        binding.deploymentId,
        binding.dataPolicyRevisionId,
        JSON.stringify(binding),
      ],
    );
  }

  async setRankingInput(
    workspaceId: string,
    input: RankingCandidateInput,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO p1_supply_ranking_input_heads
         (workspace_id, deployment_id, value, updated_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (workspace_id, deployment_id) DO UPDATE
         SET value = EXCLUDED.value, updated_at = now()`,
      [workspaceId, input.deploymentId, JSON.stringify(input)],
    );
  }

  async readPlanningState(input: {
    workspaceId: string;
    catalogRevisionId: string;
    operation: string;
    qualityTier: 'quality' | 'balanced' | 'auto';
    deploymentIds: readonly string[];
    routePolicyRevisionId?: string;
  }): Promise<ModelSupplyPlanningControlPlaneState> {
    const [routes, policies, ranking] = await Promise.all([
      this.pool.query<{
        revision_id: string;
        value: RoutePolicyRevision;
      }>(
        input.routePolicyRevisionId
          ? `SELECT revisions.revision_id, revisions.value
               FROM p1_supply_route_policy_revisions revisions
              WHERE revisions.workspace_id = $1
                AND revisions.operation = $2
                AND revisions.quality_tier = $3
                AND revisions.revision_id = $4`
          : `SELECT heads.revision_id, revisions.value
               FROM p1_supply_route_policy_heads heads
               JOIN p1_supply_route_policy_revisions revisions
                 ON revisions.workspace_id = heads.workspace_id
                AND revisions.revision_id = heads.revision_id
              WHERE heads.workspace_id = $1 AND heads.operation = $2
                AND heads.quality_tier = $3`,
        input.routePolicyRevisionId
          ? [
              input.workspaceId,
              input.operation,
              input.qualityTier,
              input.routePolicyRevisionId,
            ]
          : [input.workspaceId, input.operation, input.qualityTier],
      ),
      this.pool.query<{ deployment_id: string; value: DeploymentDataPolicyBinding }>(
        `SELECT deployment_id, value
           FROM p1_supply_data_policy_heads
          WHERE workspace_id = $1 AND deployment_id = ANY($2::text[])`,
        [input.workspaceId, [...input.deploymentIds]],
      ),
      this.pool.query<{ deployment_id: string; value: RankingCandidateInput }>(
        `SELECT deployment_id, value
           FROM p1_supply_ranking_input_heads
          WHERE workspace_id = $1 AND deployment_id = ANY($2::text[])`,
        [input.workspaceId, [...input.deploymentIds]],
      ),
    ]);
    const route = routes.rows[0];
    return {
      routePolicy: route ? routePayload(route.value) : null,
      routePolicyRevisionId: route?.revision_id ?? null,
      healthOverlay: this.health,
      dataPolicyByDeploymentId: new Map(
        policies.rows.map(({ deployment_id, value }) => [deployment_id, value]),
      ),
      rankingInputsByDeploymentId: new Map(
        ranking.rows.map(({ deployment_id, value }) => [deployment_id, value]),
      ),
    };
  }

  private async persistRoutePolicyRevision(
    client: PoolClient,
    workspaceId: string,
    revision: RoutePolicyRevision,
  ): Promise<void> {
    const inserted = await client.query(
      `INSERT INTO p1_supply_route_policy_revisions
         (workspace_id, revision_id, operation, quality_tier, value)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (workspace_id, revision_id) DO NOTHING
       RETURNING revision_id`,
      [
        workspaceId,
        revision.revisionId,
        revision.operation,
        revision.qualityTier ?? 'quality',
        JSON.stringify(revision),
      ],
    );
    if (inserted.rowCount === 1) return;
    const existing = await client.query<{ value: RoutePolicyRevision }>(
      `SELECT value
         FROM p1_supply_route_policy_revisions
        WHERE workspace_id = $1 AND revision_id = $2
        FOR UPDATE`,
      [workspaceId, revision.revisionId],
    );
    if (!isDeepStrictEqual(existing.rows[0]?.value, revision)) {
      throw new Error(
        'The immutable route revision id is already bound to another payload.',
      );
    }
  }
}
