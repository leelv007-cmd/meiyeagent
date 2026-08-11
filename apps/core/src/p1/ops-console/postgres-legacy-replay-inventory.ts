/**
 * Postgres inventory for U14 legacy replay archive gate (V31-26a).
 *
 * Production-only. Memory inventory is test-only (see legacy-replay-archive-gate.ts).
 */

import { createHash } from 'node:crypto';

import { EXECUTION_PLAN_SNAPSHOT_SCHEMA_VERSION } from '@meiye/contracts';
import type { Pool } from 'pg';
import { LEGACY_REPLAY_ADMISSION_LOCK } from '../harness/legacy-replay-admission-lock.js';
import {
  isLegacyReplayAdmissionSealed,
  LEGACY_REPLAY_ADMISSION_SEAL_AUDIT_EVENT_TYPE,
  LEGACY_REPLAY_ADMISSION_SEAL_DEPLOYMENT_ID,
  LEGACY_REPLAY_ADMISSION_SEAL_TABLE,
} from '../harness/legacy-replay-admission-seal.js';

import type {
  LegacyReplayInventoryPort,
  LegacyReplayInventorySnapshot,
} from './legacy-replay-archive-gate.js';

const LEGACY_REPLAY_LEDGER_DEPLOYMENT_ID = 'v31-26a-legacy-replay-ledger-v1';
const LEGACY_REPLAY_LEDGER_CHECKSUM = createHash('sha256')
  .update(LEGACY_REPLAY_LEDGER_DEPLOYMENT_ID)
  .digest('hex');

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function admittedSnapshotAuthoritySql(requestsAlias: string): string {
  return `exists (
    select 1 from p1_execution_plan_snapshots snapshots
     where snapshots.workspace_id=${requestsAlias}.request->>'workspaceId'
       and (
         (
           snapshots.workflow_id=
             ${requestsAlias}.workflow_id || ':plan:' ||
             (${requestsAlias}.request->'executionPlanSnapshot'->>'planRevision') || ':' ||
             (${requestsAlias}.request->'executionPlanSnapshot'->>'snapshotHash')
           and snapshots.payload=${requestsAlias}.request->'executionPlanSnapshot'
         )
         or (
           snapshots.workflow_id=
             ${requestsAlias}.workflow_id || ':plan:' ||
             (snapshots.payload->>'planRevision') || ':' ||
             (snapshots.payload->>'snapshotHash')
           and snapshots.snapshot_hash=snapshots.payload->>'snapshotHash'
           and snapshots.payload->>'schemaVersion'=
             '${EXECUTION_PLAN_SNAPSHOT_SCHEMA_VERSION}'
           and nullif(snapshots.payload->>'confirmationDecisionRef', '') is not null
           and snapshots.payload->>'planId'=
             ${requestsAlias}.request->'pendingExecutionPlanSnapshot'->'content'->>'planId'
         )
       )
       and (
         not (${requestsAlias}.request ? 'pendingExecutionPlanSnapshot')
         or (
           ${requestsAlias}.admission_state='awaiting_confirmation'
           and jsonb_typeof(${requestsAlias}.billing_identity)='object'
           and ${requestsAlias}.request->'billingIdentity'=${requestsAlias}.billing_identity
           and nullif(${requestsAlias}.confirmation_request_id, '') is not null
           and ${requestsAlias}.request->>'executionConfirmationRequestId'=
               ${requestsAlias}.confirmation_request_id
           and ${requestsAlias}.billing_identity->>'workspaceId'=
               ${requestsAlias}.request->>'workspaceId'
           and ${requestsAlias}.billing_identity->>'workflowId'=
               ${requestsAlias}.workflow_id
           and ${requestsAlias}.billing_identity->>'taskId'=
               ${requestsAlias}.request->>'billingTaskId'
           and ${requestsAlias}.billing_identity->>'workId' <> ''
           and ${requestsAlias}.billing_identity->>'reservationId'=
               ${requestsAlias}.request->>'executionConfirmationReservationIdempotencyKey'
           and ${requestsAlias}.billing_identity->>'planId'=
               ${requestsAlias}.request#>>'{pendingExecutionPlanSnapshot,content,planId}'
           and ${requestsAlias}.billing_identity->>'planRevision'=
               ${requestsAlias}.request#>>'{pendingExecutionPlanSnapshot,content,planRevision}'
           and ${requestsAlias}.billing_identity->>'snapshotHash'=
               ${requestsAlias}.request#>>'{pendingExecutionPlanSnapshot,snapshotHash}'
           and ${requestsAlias}.billing_identity#>>'{quoteRef,id}'=
               ${requestsAlias}.request#>>'{pendingExecutionPlanSnapshot,content,quoteRef,id}'
           and ${requestsAlias}.billing_identity#>>'{quoteRef,revision}'=
               ${requestsAlias}.request#>>'{pendingExecutionPlanSnapshot,content,quoteRef,revision}'
           and nullif(${requestsAlias}.billing_identity->>'carrierUnitId', '') is not null
           and jsonb_typeof(${requestsAlias}.billing_identity->'carrierUnitIds')='array'
           and jsonb_array_length(${requestsAlias}.billing_identity->'carrierUnitIds') > 0
           and ${requestsAlias}.billing_identity->'carrierUnitIds' ?
               (${requestsAlias}.billing_identity->>'carrierUnitId')
           and jsonb_typeof(${requestsAlias}.billing_identity->'carrierBillableUnits')='number'
         )
       )
  )`;
}

export class PostgresLegacyReplayInventory implements LegacyReplayInventoryPort {
  constructor(private readonly pool: Pool) {}

  async migrateInstallationLedger(): Promise<void> {
    await this.pool.query(
      `create table if not exists p1_legacy_replay_installation_ledger (
         singleton boolean primary key default true check (singleton),
         deployment_id text not null,
         migration_checksum text not null,
         installed_at timestamptz not null default now(),
         initial_legacy_count bigint not null check (initial_legacy_count=0)
       );
       create or replace function p1_reject_legacy_replay_ledger_mutation()
       returns trigger language plpgsql as $$
       begin
         raise exception 'legacy replay installation ledger is immutable';
       end $$;
       drop trigger if exists p1_legacy_replay_ledger_immutable
         on p1_legacy_replay_installation_ledger;
       create trigger p1_legacy_replay_ledger_immutable
         before update or delete on p1_legacy_replay_installation_ledger
         for each row execute function p1_reject_legacy_replay_ledger_mutation()`,
    );
    const client = await this.pool.connect();
    try {
      await client.query('begin isolation level serializable');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        LEGACY_REPLAY_ADMISSION_LOCK,
      ]);
      const initial = await client.query<{ legacy_count: string }>(
        `select count(*)::text as legacy_count
           from harness_runtime.task_requests requests
          where not ${admittedSnapshotAuthoritySql('requests')}`,
      );
      if (initial.rows[0]?.legacy_count === '0') {
        await client.query(
          `insert into p1_legacy_replay_installation_ledger
             (singleton, deployment_id, migration_checksum, initial_legacy_count)
           values (true, $1, $2, 0)
           on conflict (singleton) do nothing`,
          [LEGACY_REPLAY_LEDGER_DEPLOYMENT_ID, LEGACY_REPLAY_LEDGER_CHECKSUM],
        );
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * V31-26a / P0-B: close the legacy replay admission branch explicitly.
   *
   * Never implied by schema presence. The seal row is written only when an
   * operator-recorded `legacy_replay_admission_seal` audit row backs it, which
   * the runtime request path cannot produce. Sealing deliberately does *not*
   * require zero legacy history: stopping new legacy admissions is how an
   * installation drains its remaining legacy tasks before U14 archive, so that
   * condition belongs to the archive gate, not here. Append-only: a second call
   * is a no-op and the trigger rejects update/delete.
   */
  async sealLegacyReplayAdmission(input: {
    evidenceAuditId: string;
  }): Promise<void> {
    if (!input.evidenceAuditId.trim()) {
      throw new Error(
        'Legacy replay admission seal requires an audited proof id.',
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query('begin isolation level serializable');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        LEGACY_REPLAY_ADMISSION_LOCK,
      ]);
      const already = await client.query<{ sealed: boolean }>(
        `select exists (
           select 1 from ${LEGACY_REPLAY_ADMISSION_SEAL_TABLE}
            where singleton=true and deployment_id=$1
         ) as sealed`,
        [LEGACY_REPLAY_ADMISSION_SEAL_DEPLOYMENT_ID],
      );
      if (already.rows[0]?.sealed === true) {
        await client.query('commit');
        return;
      }
      const proof = await client.query<{ audited: boolean }>(
        `select exists (
           select 1 from harness_runtime.audit_events
            where id=$1 and event_type=$2
         ) as audited`,
        [input.evidenceAuditId, LEGACY_REPLAY_ADMISSION_SEAL_AUDIT_EVENT_TYPE],
      );
      if (proof.rows[0]?.audited !== true) {
        throw new Error(
          `Legacy replay admission seal requires an audited ${LEGACY_REPLAY_ADMISSION_SEAL_AUDIT_EVENT_TYPE} proof row; ${input.evidenceAuditId} does not qualify.`,
        );
      }
      await client.query(
        `insert into ${LEGACY_REPLAY_ADMISSION_SEAL_TABLE}
           (singleton, deployment_id, evidence_audit_id)
         values (true, $1, $2)
         on conflict (singleton) do nothing`,
        [LEGACY_REPLAY_ADMISSION_SEAL_DEPLOYMENT_ID, input.evidenceAuditId],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  /** True only when the explicit seal row exists (see the seal module). */
  async legacyReplayAdmissionSealed(): Promise<boolean> {
    return isLegacyReplayAdmissionSealed(this.pool);
  }

  async installationEvidence(): Promise<string | null> {
    const result = await this.pool.query<{
      deployment_id: string;
      migration_checksum: string;
      installed_at: Date | string;
      initial_legacy_count: string;
      legacy_terminal_audit_count: string;
    }>(
      `select deployment_id, migration_checksum, installed_at,
              initial_legacy_count::text,
              (select count(*)::text
                 from harness_runtime.task_requests requests
                 join harness_runtime.audit_events events
                   on events.workflow_id=requests.task_id
                  and events.event_type in (
                    'package_delivered', 'workflow_failed', 'revision_conflict'
                  )
                where events.created_at >= ledger.installed_at
                  and not ${admittedSnapshotAuthoritySql('requests')}) as legacy_terminal_audit_count
         from p1_legacy_replay_installation_ledger ledger
        where singleton=true`,
    );
    const row = result.rows[0];
    if (
      !row ||
      row.deployment_id !== LEGACY_REPLAY_LEDGER_DEPLOYMENT_ID ||
      row.migration_checksum !== LEGACY_REPLAY_LEDGER_CHECKSUM ||
      row.initial_legacy_count !== '0' ||
      row.legacy_terminal_audit_count !== '0'
    ) {
      return null;
    }
    return JSON.stringify({
      deploymentId: row.deployment_id,
      migrationChecksum: row.migration_checksum,
      installedAt: toIso(row.installed_at),
      initialLegacyCount: 0,
      legacyTerminalAuditCount: 0,
    });
  }

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
         where not ${admittedSnapshotAuthoritySql('requests')}
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
         where not ${admittedSnapshotAuthoritySql('requests')}
         union all
         select decisions.created_at as terminal_at
         from harness_runtime.task_requests requests
         join harness_runtime.decision_events decisions
           on decisions.task_id = requests.task_id
          and decisions.resolution_source = 'core_hold_expired'
         where not ${admittedSnapshotAuthoritySql('requests')}
       ) terminals`,
    );

    return {
      activePendingCount,
      oldestActiveCreatedAt: toIso(activeRow?.oldest_created_at),
      sampleTaskIds: activeRow?.sample_task_ids ?? [],
      lastLegacyTerminalAt: toIso(terminal.rows[0]?.terminal_at ?? null),
    };
  }
}
