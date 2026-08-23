/**
 * Postgres durability for ops-console state (V31-22 one-shot fix).
 *
 * Tables:
 * - p1_ops_console_audit              (append-only)
 * - p1_ops_console_tool_policies      (immutable revision rows)
 * - p1_ops_console_kill_switches      (current state per switch)
 * - p1_ops_console_candidate_trials   (workspace → candidate release)
 * - p1_ops_console_rollback_drills    (append-only drill records)
 */

import type { Pool, PoolClient } from 'pg';

import type { OpsConsoleAuditEntry, OpsConsoleAuditStore } from './audit.js';
import {
  OPS_KILL_SWITCH_IDS,
  isOpsKillSwitchId,
  type OpsKillSwitchId,
  type OpsKillSwitchState,
} from './kill-switches.js';
import {
  defaultKillSwitchState,
  type OpsCandidateTrial,
  type OpsCandidateTrialStore,
  type OpsKillSwitchStore,
  type OpsRollbackDrillRecord,
  type OpsRollbackDrillStore,
  parseOpsCandidateTrial,
  type OpsRollbackOperation,
  type OpsRollbackOperationStore,
} from './state-stores.js';
import type {
  AgentToolPolicyRevision,
  ToolPolicyStore,
} from './tool-policy.js';

type PayloadRow<T> = { payload: T };

function clonePayload<T>(row: PayloadRow<T> | undefined): T | null {
  return row ? structuredClone(row.payload) : null;
}

export class PostgresOpsConsoleStore
  implements
    OpsConsoleAuditStore,
    ToolPolicyStore,
    OpsKillSwitchStore,
    OpsCandidateTrialStore,
    OpsRollbackOperationStore,
    OpsRollbackDrillStore
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient): Promise<void> {
    const executor = client ?? this.pool;
    await executor.query(`
      SELECT pg_advisory_xact_lock(
        hashtext('p1-ops-console-migration-v1')
      );
      CREATE TABLE IF NOT EXISTS p1_ops_console_audit (
        id text PRIMARY KEY,
        action text NOT NULL,
        operator_id text NOT NULL,
        reason text NOT NULL,
        evidence text,
        target text NOT NULL,
        created_at timestamptz NOT NULL,
        correlation_id text NOT NULL,
        payload jsonb NOT NULL
      );
      CREATE INDEX IF NOT EXISTS p1_ops_console_audit_created_at_idx
        ON p1_ops_console_audit (created_at DESC);

      CREATE TABLE IF NOT EXISTS p1_ops_console_tool_policies (
        tool_name text NOT NULL,
        revision text NOT NULL,
        created_at timestamptz NOT NULL,
        payload jsonb NOT NULL,
        PRIMARY KEY (tool_name, revision)
      );
      CREATE INDEX IF NOT EXISTS p1_ops_console_tool_policies_tool_idx
        ON p1_ops_console_tool_policies (tool_name, created_at DESC);

      CREATE TABLE IF NOT EXISTS p1_ops_console_kill_switches (
        switch_id text PRIMARY KEY,
        enabled boolean NOT NULL DEFAULT false,
        updated_at timestamptz NOT NULL,
        updated_by text,
        reason text,
        payload jsonb NOT NULL
      );

      CREATE TABLE IF NOT EXISTS p1_ops_console_candidate_trials (
        workspace_id text PRIMARY KEY,
        candidate_release_id text NOT NULL,
        operator_id text NOT NULL,
        reason text NOT NULL,
        updated_at timestamptz NOT NULL,
        payload jsonb NOT NULL
      );
      CREATE INDEX IF NOT EXISTS p1_ops_console_candidate_trials_updated_idx
        ON p1_ops_console_candidate_trials (updated_at DESC);
      DELETE FROM p1_ops_console_candidate_trials
      WHERE NOT (payload ? 'expiresAt')
         OR jsonb_typeof(payload->'expiresAt') <> 'string';

      CREATE TABLE IF NOT EXISTS p1_ops_console_rollback_operations (
        id text PRIMARY KEY,
        to_release_id text NOT NULL,
        created_at timestamptz NOT NULL,
        payload jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS p1_harness_release_production_history (
        release_id text PRIMARY KEY,
        first_promoted_at timestamptz NOT NULL
      );
      DO $backfill$
      BEGIN
        IF to_regclass('public.p1_harness_release_lifecycle') IS NOT NULL THEN
          INSERT INTO p1_harness_release_production_history (release_id, first_promoted_at)
          SELECT audit.target, MIN(audit.created_at)
          FROM p1_ops_console_audit audit
          JOIN p1_harness_release_lifecycle lifecycle
            ON lifecycle.release_id = audit.target
          WHERE audit.action IN ('promote_to_production', 'rollback_production')
            AND lifecycle.status IN ('production', 'retired')
          GROUP BY audit.target
          ON CONFLICT (release_id) DO NOTHING;
        END IF;
      END $backfill$;

      CREATE TABLE IF NOT EXISTS p1_ops_console_rollback_drills (
        id text PRIMARY KEY,
        release_id text NOT NULL,
        operator_id text NOT NULL,
        result text NOT NULL,
        created_at timestamptz NOT NULL,
        payload jsonb NOT NULL
      );
      CREATE INDEX IF NOT EXISTS p1_ops_console_rollback_drills_created_idx
        ON p1_ops_console_rollback_drills (created_at DESC);
    `);
  }

  // ── Audit (append-only) ──────────────────────────────────────────────────

  async append(entry: OpsConsoleAuditEntry): Promise<OpsConsoleAuditEntry> {
    const payload = structuredClone(entry);
    await this.pool.query(
      `INSERT INTO p1_ops_console_audit
         (id, action, operator_id, reason, evidence, target, created_at, correlation_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9::jsonb)`,
      [
        payload.id,
        payload.action,
        payload.operatorId,
        payload.reason,
        payload.evidence,
        payload.target,
        payload.createdAt,
        payload.correlationId,
        JSON.stringify(payload),
      ],
    );
    return structuredClone(payload);
  }

  async list(limit = 100): Promise<OpsConsoleAuditEntry[]> {
    const result = await this.pool.query<PayloadRow<OpsConsoleAuditEntry>>(
      `SELECT payload FROM p1_ops_console_audit
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => structuredClone(row.payload));
  }

  // ── Tool policy (immutable revisions) ────────────────────────────────────

  async putRevisionImmutable(
    policy: AgentToolPolicyRevision,
  ): Promise<AgentToolPolicyRevision> {
    const payload = structuredClone(policy);
    const inserted = await this.pool.query<PayloadRow<AgentToolPolicyRevision>>(
      `INSERT INTO p1_ops_console_tool_policies
         (tool_name, revision, created_at, payload)
       VALUES ($1, $2, $3::timestamptz, $4::jsonb)
       ON CONFLICT (tool_name, revision) DO NOTHING
       RETURNING payload`,
      [
        payload.toolName,
        payload.revision,
        payload.createdAt,
        JSON.stringify(payload),
      ],
    );
    if (inserted.rows[0]) {
      return structuredClone(payload);
    }
    throw new Error(
      `Tool policy revision ${payload.toolName}@${payload.revision} is immutable; create a new revision instead of in-place update.`,
    );
  }

  async getRevision(
    toolName: string,
    revision: string,
  ): Promise<AgentToolPolicyRevision | null> {
    const result = await this.pool.query<PayloadRow<AgentToolPolicyRevision>>(
      `SELECT payload FROM p1_ops_console_tool_policies
        WHERE tool_name = $1 AND revision = $2`,
      [toolName, revision],
    );
    return clonePayload(result.rows[0]);
  }

  async listByTool(toolName: string): Promise<AgentToolPolicyRevision[]> {
    const result = await this.pool.query<PayloadRow<AgentToolPolicyRevision>>(
      `SELECT payload FROM p1_ops_console_tool_policies
        WHERE tool_name = $1
        ORDER BY created_at DESC`,
      [toolName],
    );
    return result.rows.map((row) => structuredClone(row.payload));
  }

  async listTools(): Promise<string[]> {
    const result = await this.pool.query<{ tool_name: string }>(
      `SELECT DISTINCT tool_name FROM p1_ops_console_tool_policies
        ORDER BY tool_name ASC`,
    );
    return result.rows.map((row) => row.tool_name);
  }

  // ── Kill switches ────────────────────────────────────────────────────────

  async getKillSwitch(
    switchId: OpsKillSwitchId,
  ): Promise<OpsKillSwitchState | null> {
    const result = await this.pool.query<PayloadRow<OpsKillSwitchState>>(
      `SELECT payload FROM p1_ops_console_kill_switches WHERE switch_id = $1`,
      [switchId],
    );
    return clonePayload(result.rows[0]);
  }

  async putKillSwitch(state: OpsKillSwitchState): Promise<OpsKillSwitchState> {
    const payload = structuredClone(state);
    await this.pool.query(
      `INSERT INTO p1_ops_console_kill_switches
         (switch_id, enabled, updated_at, updated_by, reason, payload)
       VALUES ($1, $2, $3::timestamptz, $4, $5, $6::jsonb)
       ON CONFLICT (switch_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         updated_at = EXCLUDED.updated_at,
         updated_by = EXCLUDED.updated_by,
         reason = EXCLUDED.reason,
         payload = EXCLUDED.payload`,
      [
        payload.switchId,
        payload.enabled,
        payload.updatedAt,
        payload.updatedBy,
        payload.reason,
        JSON.stringify(payload),
      ],
    );
    return structuredClone(payload);
  }

  async listKillSwitches(): Promise<OpsKillSwitchState[]> {
    const result = await this.pool.query<PayloadRow<OpsKillSwitchState>>(
      `SELECT payload FROM p1_ops_console_kill_switches`,
    );
    const byId = new Map<OpsKillSwitchId, OpsKillSwitchState>();
    for (const row of result.rows) {
      const state = structuredClone(row.payload);
      if (isOpsKillSwitchId(state.switchId)) {
        byId.set(state.switchId, state);
      }
    }
    return OPS_KILL_SWITCH_IDS.map(
      (switchId) => byId.get(switchId) ?? defaultKillSwitchState(switchId),
    );
  }

  // ── Candidate trials ─────────────────────────────────────────────────────

  async putCandidateTrial(
    trial: OpsCandidateTrial,
  ): Promise<OpsCandidateTrial> {
    const payload = parseOpsCandidateTrial(trial);
    await this.pool.query(
      `INSERT INTO p1_ops_console_candidate_trials
         (workspace_id, candidate_release_id, operator_id, reason, updated_at, payload)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)
       ON CONFLICT (workspace_id) DO UPDATE SET
         candidate_release_id = EXCLUDED.candidate_release_id,
         operator_id = EXCLUDED.operator_id,
         reason = EXCLUDED.reason,
         updated_at = EXCLUDED.updated_at,
         payload = EXCLUDED.payload`,
      [
        payload.workspaceId,
        payload.candidateReleaseId,
        payload.operatorId,
        payload.reason,
        payload.updatedAt,
        JSON.stringify(payload),
      ],
    );
    return structuredClone(payload);
  }

  async listCandidateTrials(): Promise<OpsCandidateTrial[]> {
    const result = await this.pool.query<PayloadRow<OpsCandidateTrial>>(
      `SELECT payload FROM p1_ops_console_candidate_trials
        ORDER BY updated_at DESC`,
    );
    return result.rows.map((row) => parseOpsCandidateTrial(row.payload));
  }

  async getCandidateTrial(
    workspaceId: string,
  ): Promise<OpsCandidateTrial | null> {
    const result = await this.pool.query<PayloadRow<OpsCandidateTrial>>(
      `SELECT payload FROM p1_ops_console_candidate_trials
        WHERE workspace_id = $1`,
      [workspaceId],
    );
    return result.rows[0]
      ? parseOpsCandidateTrial(result.rows[0].payload)
      : null;
  }

  async consumeCandidateTrial(input: {
    workspaceId: string;
    runId: string;
    now: string;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<PayloadRow<OpsCandidateTrial>>(
        `SELECT payload FROM p1_ops_console_candidate_trials
         WHERE workspace_id = $1 FOR UPDATE`,
        [input.workspaceId],
      );
      const current = result.rows[0]?.payload
        ? parseOpsCandidateTrial(result.rows[0].payload)
        : null;
      if (!current || current.expiresAt <= input.now) {
        if (current)
          await client.query(
            'DELETE FROM p1_ops_console_candidate_trials WHERE workspace_id = $1',
            [input.workspaceId],
          );
        await client.query('COMMIT');
        return null;
      }
      if (current.consumedByRunId && current.consumedByRunId !== input.runId) {
        await client.query('COMMIT');
        return null;
      }
      const consumed: OpsCandidateTrial = {
        ...current,
        consumedByRunId: input.runId,
        consumedAt: current.consumedAt ?? input.now,
      };
      await client.query(
        'UPDATE p1_ops_console_candidate_trials SET payload = $2::jsonb WHERE workspace_id = $1',
        [input.workspaceId, JSON.stringify(consumed)],
      );
      await client.query('COMMIT');
      return structuredClone(consumed);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async clearCandidateTrials(): Promise<void> {
    await this.pool.query('DELETE FROM p1_ops_console_candidate_trials');
  }

  /**
   * V31-105 §5: a shared Core fills the recent window with other releases'
   * runs, so a caller inspecting one release must be able to scope the read.
   * Without releaseId the historical "most recent N" behaviour is kept.
   */
  async listRecentRunPins(limit = 20, releaseId?: string): Promise<
    Array<{
      runId: string;
      workspaceId: string;
      harnessReleaseId: string;
      status: string;
      startedAt: string;
    }>
  > {
    const result = await this.pool.query<{
      run_id: string;
      resource_id: string;
      harness_release_id: string;
      status: string;
      started_at: Date;
    }>(
      `WITH release_pins AS (
         SELECT runs.run_id, threads.resource_id, runs.harness_release_id,
                runs.status, runs.started_at
         FROM p1_agent_runs runs
         JOIN p1_agent_threads threads ON threads.thread_id = runs.thread_id
         UNION ALL
         SELECT requests.task_id AS run_id,
                requests.request->>'workspaceId' AS resource_id,
                requests.request#>>'{executionPlanSnapshot,harnessReleaseId}' AS harness_release_id,
                'waiting' AS status,
                requests.created_at AS started_at
         FROM harness_runtime.task_requests requests
         JOIN harness_runtime.pending_questions questions
           ON questions.task_id = requests.task_id AND questions.status = 'pending'
         WHERE requests.request->>'workspaceId' IS NOT NULL
           AND requests.request#>>'{executionPlanSnapshot,harnessReleaseId}' IS NOT NULL
       )
       SELECT run_id, resource_id, harness_release_id, status, started_at
       FROM release_pins
       WHERE $2::text IS NULL OR harness_release_id = $2::text
       ORDER BY started_at DESC LIMIT $1`,
      [limit, releaseId ?? null],
    );
    return result.rows.map((row) => ({
      runId: row.run_id,
      workspaceId: row.resource_id,
      harnessReleaseId: row.harness_release_id,
      status: row.status,
      startedAt: row.started_at.toISOString(),
    }));
  }

  async listActiveRunPins(limit = 100) {
    const result = await this.pool.query<{
      run_id: string;
      resource_id: string;
      harness_release_id: string;
      status: string;
      started_at: Date;
    }>(
      `WITH active_release_pins AS (
         SELECT runs.run_id, threads.resource_id, runs.harness_release_id,
                runs.status, runs.started_at
         FROM p1_agent_runs runs
         JOIN p1_agent_threads threads ON threads.thread_id = runs.thread_id
         WHERE runs.status IN ('running', 'waiting')
         UNION ALL
         SELECT requests.task_id AS run_id,
                requests.request->>'workspaceId' AS resource_id,
                requests.request#>>'{executionPlanSnapshot,harnessReleaseId}' AS harness_release_id,
                'waiting' AS status,
                requests.created_at AS started_at
         FROM harness_runtime.task_requests requests
         JOIN harness_runtime.pending_questions questions
           ON questions.task_id = requests.task_id AND questions.status = 'pending'
         WHERE requests.request->>'workspaceId' IS NOT NULL
           AND requests.request#>>'{executionPlanSnapshot,harnessReleaseId}' IS NOT NULL
       )
       SELECT run_id, resource_id, harness_release_id, status, started_at
       FROM active_release_pins ORDER BY started_at DESC LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      runId: row.run_id,
      workspaceId: row.resource_id,
      harnessReleaseId: row.harness_release_id,
      status: row.status,
      startedAt: row.started_at.toISOString(),
    }));
  }

  async beginRollbackOperation(operation: OpsRollbackOperation): Promise<void> {
    await this.pool.query(
      `INSERT INTO p1_ops_console_rollback_operations (id, to_release_id, created_at, payload)
       VALUES ($1, $2, $3::timestamptz, $4::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        operation.id,
        operation.toReleaseId,
        operation.createdAt,
        JSON.stringify(operation),
      ],
    );
  }

  async listPendingRollbackOperations(): Promise<OpsRollbackOperation[]> {
    const result = await this.pool.query<PayloadRow<OpsRollbackOperation>>(
      'SELECT payload FROM p1_ops_console_rollback_operations ORDER BY created_at ASC',
    );
    return result.rows.map((row) => structuredClone(row.payload));
  }

  async completeRollbackOperation(
    operationId: string,
  ): Promise<OpsConsoleAuditEntry> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const pending = await client.query<PayloadRow<OpsRollbackOperation>>(
        'SELECT payload FROM p1_ops_console_rollback_operations WHERE id = $1 FOR UPDATE',
        [operationId],
      );
      const operation = pending.rows[0]?.payload;
      if (!operation) {
        const completed = await client.query<PayloadRow<OpsConsoleAuditEntry>>(
          `SELECT payload FROM p1_ops_console_audit
           WHERE id = $1 AND action = 'rollback_production'`,
          [operationId],
        );
        const audit = clonePayload(completed.rows[0]);
        if (audit) {
          await client.query('COMMIT');
          return audit;
        }
        throw new Error(`Rollback operation not found: ${operationId}`);
      }
      await client.query('DELETE FROM p1_ops_console_candidate_trials');
      const audit = operation.audit;
      await client.query(
        `INSERT INTO p1_ops_console_audit
           (id, action, operator_id, reason, evidence, target, created_at, correlation_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [
          audit.id,
          audit.action,
          audit.operatorId,
          audit.reason,
          audit.evidence,
          audit.target,
          audit.createdAt,
          audit.correlationId,
          JSON.stringify(audit),
        ],
      );
      await client.query(
        'DELETE FROM p1_ops_console_rollback_operations WHERE id = $1',
        [operationId],
      );
      await client.query('COMMIT');
      return structuredClone(audit);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ── Rollback drills (append-only) ────────────────────────────────────────

  async appendRollbackDrill(
    record: OpsRollbackDrillRecord,
  ): Promise<OpsRollbackDrillRecord> {
    const payload = structuredClone(record);
    await this.pool.query(
      `INSERT INTO p1_ops_console_rollback_drills
         (id, release_id, operator_id, result, created_at, payload)
       VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)`,
      [
        payload.id,
        payload.releaseId,
        payload.operatorId,
        payload.result,
        payload.createdAt,
        JSON.stringify(payload),
      ],
    );
    return structuredClone(payload);
  }

  async listRollbackDrills(limit = 100): Promise<OpsRollbackDrillRecord[]> {
    const result = await this.pool.query<PayloadRow<OpsRollbackDrillRecord>>(
      `SELECT payload FROM p1_ops_console_rollback_drills
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => structuredClone(row.payload));
  }
}
