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
      active_count: string;
      oldest_created_at: Date | string | null;
      sample_task_ids: string[];
    }>(
      `with active_legacy as (
         select requests.task_id, requests.workflow_id, requests.created_at
         from harness_runtime.task_requests requests
         where (
           requests.request->'executionPlanSnapshot' is null
           or jsonb_typeof(requests.request->'executionPlanSnapshot') = 'null'
         )
         and not exists (
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
       )
       select count(*)::text as active_count,
              min(created_at) as oldest_created_at,
              array(
                select coalesce(workflow_id, task_id)
                from active_legacy
                order by created_at asc
                limit 10
              ) as sample_task_ids
       from active_legacy`,
    );
    const activeRow = active.rows[0];
    const activePendingCount = Number(activeRow?.active_count ?? 0);

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
      activePendingCount,
      oldestActiveCreatedAt: toIso(activeRow?.oldest_created_at),
      sampleTaskIds: activeRow?.sample_task_ids ?? [],
      lastLegacyTerminalAt: toIso(terminal.rows[0]?.terminal_at ?? null),
      noHistoryProofAuditId: null,
    };
  }
}
