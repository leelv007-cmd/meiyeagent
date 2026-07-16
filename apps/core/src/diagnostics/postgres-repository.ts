import type { DiagnosticRun } from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';
import type { DiagnosticIdentity, DiagnosticRepository } from './repository.js';

interface DiagnosticRow {
  id: string;
  correlation_id: string;
  status: DiagnosticRun['status'];
  events: string[];
  result: DiagnosticRun['result'] | null;
  evidence: DiagnosticRun['evidence'] | null;
}

function toRun(row: DiagnosticRow): DiagnosticRun {
  return {
    id: row.id,
    correlationId: row.correlation_id,
    status: row.status,
    events: row.events,
    ...(row.result ? { result: row.result } : {}),
    ...(row.evidence ? { evidence: row.evidence } : {}),
  };
}

export class PostgresDiagnosticRepository implements DiagnosticRepository {
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      create table if not exists diagnostic_runs (
        id text primary key,
        correlation_id text not null,
        user_id text not null,
        workspace_id text not null,
        idempotency_key text not null,
        status text not null check (status in ('waiting_for_user', 'completed')),
        events jsonb not null,
        result jsonb,
        evidence jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      alter table diagnostic_runs add column if not exists user_id text;
      alter table diagnostic_runs add column if not exists workspace_id text;
      alter table diagnostic_runs add column if not exists evidence jsonb;
      alter table diagnostic_runs
        drop constraint if exists diagnostic_runs_status_check;
      alter table diagnostic_runs
        add constraint diagnostic_runs_status_check
        check (status in ('waiting_for_user', 'completed', 'failed'));
      alter table diagnostic_runs
        drop constraint if exists diagnostic_runs_idempotency_key_key;
      drop index if exists diagnostic_runs_identity_idempotency_idx;
      create unique index if not exists diagnostic_runs_workspace_idempotency_idx
        on diagnostic_runs (workspace_id, idempotency_key)
    `);
  }

  async create(
    run: DiagnosticRun,
    idempotencyKey: string,
    identity: DiagnosticIdentity
  ) {
    const inserted = await this.pool.query<DiagnosticRow>(
      `insert into diagnostic_runs
        (id, correlation_id, user_id, workspace_id, idempotency_key, status, events, result, evidence)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
       on conflict (workspace_id, idempotency_key) do nothing
       returning id, correlation_id, status, events, result, evidence`,
      [
        run.id,
        run.correlationId,
        identity.userId,
        identity.workspaceId,
        idempotencyKey,
        run.status,
        JSON.stringify(run.events),
        JSON.stringify(run.result ?? null),
        JSON.stringify(run.evidence ?? null),
      ]
    );
    if (inserted.rows[0]) return toRun(inserted.rows[0]);
    const existing = await this.pool.query<DiagnosticRow>(
      `select id, correlation_id, status, events, result, evidence
       from diagnostic_runs
       where workspace_id = $1 and user_id = $2 and idempotency_key = $3`,
      [identity.workspaceId, identity.userId, idempotencyKey]
    );
    return existing.rows[0] ? toRun(existing.rows[0]) : null;
  }

  async get(id: string, identity: DiagnosticIdentity) {
    const result = await this.pool.query<DiagnosticRow>(
      `select id, correlation_id, status, events, result, evidence
       from diagnostic_runs
       where id = $1 and workspace_id = $2 and user_id = $3`,
      [id, identity.workspaceId, identity.userId]
    );
    return result.rows[0] ? toRun(result.rows[0]) : null;
  }

  async save(run: DiagnosticRun, identity: DiagnosticIdentity) {
    const result = await this.pool.query<DiagnosticRow>(
      `update diagnostic_runs
       set status = $2, events = $3::jsonb, result = $4::jsonb,
           evidence = $7::jsonb, updated_at = now()
       where id = $1 and workspace_id = $5 and user_id = $6
       returning id, correlation_id, status, events, result, evidence`,
      [
        run.id,
        run.status,
        JSON.stringify(run.events),
        JSON.stringify(run.result ?? null),
        identity.workspaceId,
        identity.userId,
        JSON.stringify(run.evidence ?? null),
      ]
    );
    const saved = result.rows[0];
    if (!saved) throw new Error(`Diagnostic run ${run.id} was not found.`);
    return toRun(saved);
  }
}
