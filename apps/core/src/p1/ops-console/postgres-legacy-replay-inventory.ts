/**
 * Postgres inventory for U14 legacy replay archive gate (V31-26a).
 *
 * Production-only. Memory inventory is test-only (see legacy-replay-archive-gate.ts).
 */

import type { Pool } from 'pg';

import type {
  LegacyReplayInventoryPort,
  LegacyReplayInventorySnapshot,
} from './legacy-replay-archive-gate.js';

function isMissingExecutionPlanSnapshot(request: unknown): boolean {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return true;
  }
  const snapshot = (request as { executionPlanSnapshot?: unknown })
    .executionPlanSnapshot;
  return snapshot === undefined || snapshot === null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export class PostgresLegacyReplayInventory implements LegacyReplayInventoryPort {
  constructor(private readonly pool: Pool) {}

  async snapshot(): Promise<LegacyReplayInventorySnapshot> {
    // Active/pending = admitted, not terminal, no hold-expiry resolution.
    // Mirror listActiveTasks terminal exclusions so merchant-visible actives
    // and archive-gate actives stay consistent.
    const active = await this.pool.query<{
      task_id: string;
      workflow_id: string;
      request: unknown;
      created_at: Date | string;
    }>(
      `select requests.task_id,
              requests.workflow_id,
              requests.request,
              requests.created_at
       from harness_runtime.task_requests requests
       where not exists (
           select 1 from harness_runtime.audit_events events
           where events.workflow_id = requests.task_id
             and events.event_type in (
               'package_delivered', 'workflow_failed', 'revision_conflict'
             )
         )
         and not exists (
           select 1 from harness_runtime.decision_events decisions
           where decisions.task_id = requests.task_id
             and decisions.resolution_source = 'core_hold_expired'
         )
       order by requests.created_at asc
       limit 500`,
    );

    const activeLegacy = active.rows.filter((row) =>
      isMissingExecutionPlanSnapshot(row.request),
    );

    const terminal = await this.pool.query<{
      terminal_at: Date | string | null;
    }>(
      `select max(terminal_at) as terminal_at
       from (
         select events.created_at as terminal_at
         from harness_runtime.task_requests requests
         join harness_runtime.audit_events events
           on events.workflow_id = requests.task_id
          and events.event_type in (
            'package_delivered', 'workflow_failed', 'revision_conflict'
          )
         where requests.request->'executionPlanSnapshot' is null
            or jsonb_typeof(requests.request->'executionPlanSnapshot') = 'null'
         union all
         select decisions.created_at as terminal_at
         from harness_runtime.task_requests requests
         join harness_runtime.decision_events decisions
           on decisions.task_id = requests.task_id
          and decisions.resolution_source = 'core_hold_expired'
         where requests.request->'executionPlanSnapshot' is null
            or jsonb_typeof(requests.request->'executionPlanSnapshot') = 'null'
       ) terminals`,
    );

    return {
      activePendingCount: activeLegacy.length,
      oldestActiveCreatedAt:
        activeLegacy.length > 0
          ? toIso(activeLegacy[0]!.created_at)
          : null,
      sampleTaskIds: activeLegacy
        .slice(0, 10)
        .map((row) => row.workflow_id || row.task_id),
      lastLegacyTerminalAt: toIso(terminal.rows[0]?.terminal_at ?? null),
    };
  }
}
