import {
  confirmationCardTimeoutSecondsSchema,
  contentPackageSchema,
  questionCardSchema,
  structuredDecisionInputSchema,
  type ContentPackageRevisionDelivery,
  type CreativeRecommendationDecisionTrace,
  type MarketingPackageEvidence,
  type QuestionCard,
  type ReuseTaskSeed,
} from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import {
  migratePostgresSchema,
  type PostgresSchemaMigrator,
} from '../../postgres-schema-migration.js';

import { buildContentPackage } from '../operations/content-package.js';
import {
  insertContentPackageRow,
  updateContentPackageRow,
} from '../operations/postgres-content-package-write-adapter.js';
import { PostgresStoreFactLedger } from '../operations/postgres-store-fact-ledger.js';
import { TaskBlockingNodeConflictError } from '../operations/repository.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import type { ModelSupplyPromptFallbackAuditEvent } from '../model-supply/route-contracts.js';
import { buildCopyPlatformVariants } from './output-compiler.js';
import type { VisibleClaimExtraction } from './policy-gates.js';

import type {
  HarnessDecisionStore,
  HarnessPendingDecisionProjection,
  HarnessDecisionTrace,
} from './decision-service.js';
import type {
  HarnessTaskRequestRegistry,
  HarnessWorkflowInput,
} from './task-admission.js';
import type { HarnessLangfuseOutboxItem } from './outbox-worker.js';
import {
  DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG,
  HARNESS_TODAY_RECOMMENDATION_CONFIG_KEY,
  harnessTodayRecommendationConfigSchema,
  type AdminConfigRepository,
} from '../admin-config/foundation-module.js';
import { harnessLogicalId, harnessRuntimeId } from './workspace-scope.js';
import {
  projectTodayRecommendation,
  type TodayRecommendationRecord,
} from './today-recommendation.js';

export interface HarnessAuditEvent {
  workspaceId: string;
  id: string;
  workflowId: string;
  stage: string;
  eventType: string;
  payload: unknown;
}

export class HarnessDeliveryError extends Error {
  readonly status = 409;

  constructor(
    readonly code:
      | 'CONTENT_PACKAGE_ALREADY_EXISTS'
      | 'CONTENT_PACKAGE_NOT_FOUND'
      | 'CONTENT_PACKAGE_REVISION_CONFLICT'
      | 'REUSE_SOURCE_INVALID',
    message: string,
    readonly currentRevision?: number,
    readonly expectedRevision?: number,
    readonly packageId?: string,
  ) {
    super(message);
    this.name = 'HarnessDeliveryError';
  }
}

export class PostgresHarnessStore
  implements
    HarnessTaskRequestRegistry,
    HarnessDecisionStore,
    PostgresSchemaMigrator
{
  constructor(
    private readonly pool: Pool,
    private readonly factRevisions: Pick<
      PostgresStoreFactLedger,
      'currentRevision'
    > = new PostgresStoreFactLedger(pool),
    private readonly adminConfig?: Pick<AdminConfigRepository, 'get'>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async applySchema() {
    await migratePostgresSchema(this.pool, [this]);
  }

  async migrate(client: PoolClient) {
    await client.query(`
      create schema if not exists harness_runtime;

      create table if not exists harness_runtime.task_requests (
        task_id text primary key,
        workflow_id text not null,
        runtime_id text not null,
        fingerprint text not null,
        request jsonb not null,
        created_at timestamptz not null default now()
      );

      create table if not exists harness_runtime.pending_questions (
        task_id text primary key,
        question_id text not null,
        workflow_revision bigint not null,
        payload jsonb not null,
        pending_projection jsonb not null default '{}'::jsonb,
        status text not null check (status in ('pending', 'resolved')),
        updated_at timestamptz not null default now()
      );

      create table if not exists harness_runtime.decision_events (
        id text primary key,
        task_id text not null,
        question_id text not null,
        workflow_revision bigint not null,
        idempotency_key text not null,
        payload_fingerprint text not null,
        payload jsonb not null,
        resolution_source text not null default 'decision',
        resume_status text not null default 'pending'
          check (resume_status in ('pending', 'sending', 'sent')),
        created_at timestamptz not null default now(),
        unique (task_id, idempotency_key)
      );

      create table if not exists harness_runtime.decision_traces (
        id text primary key,
        task_id text not null,
        stage text not null,
        payload jsonb not null,
        created_at timestamptz not null default now()
      );

      create table if not exists harness_runtime.audit_events (
        id text primary key,
        workflow_id text not null,
        stage text not null,
        event_type text not null,
        payload jsonb not null,
        created_at timestamptz not null default now()
      );

      create table if not exists harness_runtime.langfuse_outbox (
        audit_id text primary key references harness_runtime.audit_events(id)
          on delete cascade,
        status text not null check (status in
          ('queued', 'sending', 'failed', 'sent', 'dead_letter', 'discarded')),
        attempts integer not null default 0,
        next_attempt_at timestamptz not null default now(),
        last_error text,
        dead_lettered_at timestamptz,
        updated_at timestamptz not null default now()
      );

      create index if not exists harness_langfuse_outbox_ready_idx
        on harness_runtime.langfuse_outbox (status, next_attempt_at);

      alter table harness_runtime.decision_events
        add column if not exists resume_status text not null default 'pending';
      alter table harness_runtime.pending_questions
        add column if not exists pending_projection jsonb not null
          default '{}'::jsonb;
      alter table harness_runtime.langfuse_outbox
        add column if not exists dead_lettered_at timestamptz;
      alter table harness_runtime.langfuse_outbox
        drop constraint if exists langfuse_outbox_status_check;
      alter table harness_runtime.langfuse_outbox
        add constraint langfuse_outbox_status_check
        check (status in
          ('queued', 'sending', 'failed', 'sent', 'dead_letter', 'discarded'));
      update harness_runtime.langfuse_outbox
        set status='dead_letter'
        where status='failed' and dead_lettered_at is not null;
      alter table harness_runtime.decision_events
        add column if not exists resolution_source text;
      update harness_runtime.decision_events
        set resolution_source=case
          when idempotency_key like '%:core_timeout' then 'core_timeout'
          when idempotency_key like '%:core_hold_expired' then 'core_hold_expired'
          when idempotency_key like '%:late_answer' then 'late_answer'
          else 'decision'
        end
        where resolution_source is null;
      alter table harness_runtime.decision_events
        alter column resolution_source set default 'decision';
      alter table harness_runtime.decision_events
        alter column resolution_source set not null;
      alter table harness_runtime.decision_events
        drop constraint if exists decision_events_resume_status_check;
      alter table harness_runtime.decision_events
        add constraint decision_events_resume_status_check
        check (resume_status in ('pending', 'sending', 'sent'));

      alter table harness_runtime.task_requests
        add column if not exists runtime_id text;
      update harness_runtime.task_requests
        set runtime_id=task_id where runtime_id is null;
      alter table harness_runtime.task_requests
        alter column runtime_id set not null;
      create unique index if not exists harness_task_requests_runtime_id_idx
        on harness_runtime.task_requests (runtime_id);
    `);
  }

  async claim(input: {
    taskId: string;
    fingerprint: string;
    request: HarnessWorkflowInput;
  }) {
    const runtimeTaskId = harnessRuntimeId(
      input.request.workspaceId,
      input.taskId,
    );
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        runtimeTaskId,
      ]);
      const existing = await client.query<{
        workflow_id: string;
        runtime_id: string;
        fingerprint: string;
        request: unknown;
      }>(
        `select workflow_id, runtime_id, fingerprint, request
         from harness_runtime.task_requests
         where request->>'workspaceId'=$1
           and (task_id=$2 or workflow_id=$3)
         order by created_at, task_id
         limit 1`,
        [input.request.workspaceId, runtimeTaskId, input.taskId],
      );
      const row = existing.rows[0];
      if (row) {
        await client.query('commit');
        const { factScope: _factScope, ...legacyRequest } = input.request;
        const legacyScopeCompatible =
          input.request.factScope?.storeId === input.request.workspaceId &&
          input.request.factScope.serviceId === undefined &&
          input.request.factScope.personaId === undefined &&
          input.request.factScope.platform === undefined;
        return row.fingerprint === input.fingerprint ||
          (legacyScopeCompatible &&
            row.fingerprint === fingerprintValue(legacyRequest))
          ? {
              kind: 'existing' as const,
              workflowId: row.workflow_id,
              runtimeId: row.runtime_id,
              request: row.request as HarnessWorkflowInput,
            }
          : { kind: 'conflict' as const };
      }
      await client.query(
        `insert into harness_runtime.task_requests
           (task_id, workflow_id, runtime_id, fingerprint, request)
         values ($1, $2, $1, $3, $4)`,
        [
          runtimeTaskId,
          input.taskId,
          input.fingerprint,
          JSON.stringify(input.request),
        ],
      );
      await client.query('commit');
      return { kind: 'created' as const };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async lookup(input: {
    taskId: string;
    fingerprint: string;
    request: HarnessWorkflowInput;
  }) {
    const runtimeTaskId = harnessRuntimeId(
      input.request.workspaceId,
      input.taskId,
    );
    const existing = await this.pool.query<{
      workflow_id: string;
      runtime_id: string;
      fingerprint: string;
      request: unknown;
    }>(
      `select workflow_id, runtime_id, fingerprint, request
       from harness_runtime.task_requests
       where request->>'workspaceId'=$1
         and (task_id=$2 or workflow_id=$3)
       order by created_at, task_id
       limit 1`,
      [input.request.workspaceId, runtimeTaskId, input.taskId],
    );
    const row = existing.rows[0];
    if (!row) return null;
    const { factScope: _factScope, ...legacyRequest } = input.request;
    const legacyScopeCompatible =
      input.request.factScope?.storeId === input.request.workspaceId &&
      input.request.factScope.serviceId === undefined &&
      input.request.factScope.personaId === undefined &&
      input.request.factScope.platform === undefined;
    return row.fingerprint === input.fingerprint ||
      (legacyScopeCompatible &&
        row.fingerprint === fingerprintValue(legacyRequest))
      ? {
          kind: 'existing' as const,
          workflowId: row.workflow_id,
          runtimeId: row.runtime_id,
          request: row.request as HarnessWorkflowInput,
        }
      : { kind: 'conflict' as const };
  }

  async taskBelongsToWorkspace(taskId: string, workspaceId: string) {
    return (await this.workflowRuntimeId(workspaceId, taskId)) !== null;
  }

  async workflowRuntimeId(workspaceId: string, workflowId: string) {
    const result = await this.pool.query<{ runtime_id: string }>(
      `select runtime_id from harness_runtime.task_requests
       where request->>'workspaceId'=$1
         and (task_id=$2 or workflow_id=$3)
       order by created_at, task_id
       limit 1`,
      [workspaceId, harnessRuntimeId(workspaceId, workflowId), workflowId],
    );
    return result.rows[0]?.runtime_id ?? null;
  }

  /**
   * 时间桥把手 (D-145). Runs that are still on the server for this workspace:
   * admitted, not yet delivered, not yet failed, not cancelled. The browser asks
   * this on mount so closing the tab stops being a way to lose the run — the
   * handle comes back from the server and the transcript comes back from the
   * event replay.
   *
   * Cancellation needs its own exclusion: a 确认卡 whose hold expired settles as
   * a refund and returns normally, so it writes no `workflow_failed` audit event
   * and would otherwise be dragged back into the composer on every mount for a
   * whole day.
   *
   * Bounded to the same 24 hours the browser handle used to live for: a run
   * older than that is not something a merchant is still waiting on.
   */
  async listActiveTasks(workspaceId: string) {
    const result = await this.pool.query<{
      task_id: string;
      request: HarnessWorkflowInput;
      created_at: Date | string;
    }>(
      `select requests.workflow_id as task_id,
              requests.request,
              requests.created_at
       from harness_runtime.task_requests requests
       where requests.request->>'workspaceId'=$1
         and requests.created_at > now() - interval '24 hours'
         and not exists (
           select 1 from harness_runtime.audit_events events
           where events.workflow_id=requests.task_id
             and events.event_type in (
               'package_delivered', 'workflow_failed', 'revision_conflict'
             )
         )
         and not exists (
           select 1 from harness_runtime.decision_events decisions
           where decisions.task_id=requests.task_id
             and decisions.resolution_source='core_hold_expired'
         )
       order by requests.created_at desc
       limit 20`,
      [workspaceId],
    );
    return result.rows.flatMap((row) => {
      const workId = row.request?.executionSnapshot?.work.id;
      const merchantText = row.request?.rawInput?.trim();
      // A run with no Composer snapshot has no conversation to return to.
      if (!workId || !merchantText) return [];
      return [
        {
          taskId: row.task_id,
          workId,
          packageId: row.request.packageId,
          merchantText,
          submittedAt: new Date(row.created_at).toISOString(),
        },
      ];
    });
  }

  async readTerminalFailure(workspaceId: string, workflowId: string) {
    const runtimeWorkflowId = await this.workflowRuntimeId(
      workspaceId,
      workflowId,
    );
    if (!runtimeWorkflowId) return null;
    const result = await this.pool.query<{ payload: Record<string, unknown> }>(
      `select payload
       from harness_runtime.audit_events
       where workflow_id=$1
         and event_type in ('workflow_failed', 'revision_conflict')
       order by created_at desc
       limit 1`,
      [runtimeWorkflowId],
    );
    return result.rows[0]
      ? {
          code: 'CONTENT_PACKAGE_REVISION_CONFLICT',
          ...result.rows[0].payload,
        }
      : null;
  }

  async recordTerminalFailure(input: {
    workspaceId: string;
    workflowId: string;
    failure: Record<string, unknown>;
  }) {
    await this.appendAudit({
      workspaceId: input.workspaceId,
      id: `audit-${input.workflowId}-workflow-failed`,
      workflowId: input.workflowId,
      stage: 'workflow',
      eventType: 'workflow_failed',
      payload: input.failure,
    });
  }

  async readTodayRecommendation(workspaceId: string) {
    const at = this.clock().toISOString();
    const currentFactsRevision = await this.factRevisions.currentRevision(
      workspaceId,
    );
    const deliveryResult = await this.pool.query<{
      task_id: string;
      request: unknown;
      delivery: unknown;
      delivered_at: Date | string;
      content_package: unknown;
    }>(
      `select requests.runtime_id as task_id,
              requests.request,
              delivery.payload as delivery,
              delivery.created_at as delivered_at,
              packages.payload as content_package
       from harness_runtime.task_requests requests
       join harness_runtime.audit_events delivery
         on delivery.workflow_id=requests.task_id
        and delivery.event_type='package_delivered'
       join p1_content_packages packages
         on packages.workspace_id=$1
        and packages.id=delivery.payload->>'packageId'
       where requests.request->>'workspaceId'=$1
       order by delivery.created_at desc
       limit 1`,
      [workspaceId],
    );
    const delivery = deliveryResult.rows[0];
    if (!delivery) {
      return projectTodayRecommendation(
        workspaceId,
        currentFactsRevision,
        null,
        at,
      );
    }
    const traceResult = await this.pool.query<{
      stage: string;
      payload: unknown;
    }>(
      `select stage, payload
       from harness_runtime.decision_traces
       where task_id=$1
         and stage in ('context_injection','brief_compilation','execution_selection')
       order by created_at desc`,
      [delivery.task_id],
    );
    const traces = new Map<string, unknown>();
    for (const row of traceResult.rows) {
      if (
        row.stage === 'context_injection' &&
        !record(row.payload)?.sourceRevisions
      ) {
        continue;
      }
      if (!traces.has(row.stage)) traces.set(row.stage, row.payload);
    }
    const request = record(delivery.request);
    const recommendationRules = this.adminConfig
      ? harnessTodayRecommendationConfigSchema.parse(
          (
            await this.adminConfig.get(
              'global',
              '__global__',
              HARNESS_TODAY_RECOMMENDATION_CONFIG_KEY,
            )
          )?.value ?? DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG,
        )
      : undefined;
    const recommendationRecord: TodayRecommendationRecord = {
      taskId: delivery.task_id,
      rawInput:
        typeof request?.rawInput === 'string' ? request.rawInput : delivery.task_id,
      deliveredAt:
        delivery.delivered_at instanceof Date
          ? delivery.delivered_at.toISOString()
          : new Date(delivery.delivered_at).toISOString(),
      delivery: delivery.delivery,
      contentPackage: delivery.content_package,
      intent: request?.intent,
      ...(recommendationRules ? { recommendationRules } : {}),
      contextTrace: traces.get('context_injection'),
      briefTrace: traces.get('brief_compilation'),
      selectionTrace: traces.get('execution_selection'),
    };
    return projectTodayRecommendation(
      workspaceId,
      currentFactsRevision,
      recommendationRecord,
      at,
    );
  }

  async registerPending(
    workspaceId: string,
    question: QuestionCard,
    projection?: HarnessPendingDecisionProjection,
  ) {
    const parsed = questionCardSchema.parse(question);
    const proposedTimeoutSeconds =
      projection === undefined
        ? undefined
        : projection.timeoutSeconds === null
          ? null
          : confirmationCardTimeoutSecondsSchema.parse(
              projection.timeoutSeconds,
            );
    const runtimeTaskId = await this.requireWorkflowRuntimeId(
      workspaceId,
      parsed.workflowId,
    );
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `${workspaceId}:${parsed.workflowId}`,
      ]);
      const existing = await client.query<{
        pending_projection: unknown;
        question_id: string;
        workflow_revision: string;
      }>(
        `select question_id,
                workflow_revision::text as workflow_revision,
                pending_projection
           from harness_runtime.pending_questions
          where task_id=$1 and status='pending'`,
        [runtimeTaskId],
      );
      const pending = existing.rows[0];
      let frozenTimeoutSeconds = pending
        ? pendingDecisionTimeoutSeconds(pending.pending_projection)
        : proposedTimeoutSeconds;
      if (
        pending &&
        (pending.question_id !== parsed.questionId ||
          Number(pending.workflow_revision) !== parsed.workflowRevision)
      ) {
        throw new TaskBlockingNodeConflictError(parsed.workflowId);
      }
      const approval = await client.query(
        `select 1
           from p1_content_packages packages
           cross join lateral jsonb_array_elements(
             coalesce(packages.payload->'approvalRequests', '[]'::jsonb)
           ) request
          where packages.workspace_id=$1
            and request->>'taskId'=$2
            and request->>'status'='pending'
          limit 1`,
        [workspaceId, parsed.workflowId],
      );
      if (approval.rowCount === 1) {
        throw new TaskBlockingNodeConflictError(parsed.workflowId);
      }
      if (
        pending &&
        frozenTimeoutSeconds === undefined &&
        proposedTimeoutSeconds !== undefined
      ) {
        await client.query(
          `update harness_runtime.pending_questions
              set pending_projection=$2::jsonb,
                  updated_at=now()
            where task_id=$1 and status='pending'`,
          [
            runtimeTaskId,
            JSON.stringify({ timeoutSeconds: proposedTimeoutSeconds }),
          ],
        );
        frozenTimeoutSeconds = proposedTimeoutSeconds;
      }
      if (!pending) {
        await client.query(
          `insert into harness_runtime.pending_questions
             (task_id, question_id, workflow_revision, payload,
              pending_projection, status)
           values ($1,$2,$3,$4,$5,'pending')
           on conflict (task_id) do update set
             question_id=excluded.question_id,
             workflow_revision=excluded.workflow_revision,
             payload=excluded.payload,
             pending_projection=excluded.pending_projection,
             status='pending',
             updated_at=now()`,
          [
            runtimeTaskId,
            parsed.questionId,
            parsed.workflowRevision,
            JSON.stringify(parsed),
            JSON.stringify(
              proposedTimeoutSeconds === undefined
                ? {}
                : { timeoutSeconds: proposedTimeoutSeconds },
            ),
          ],
        );
      }
      await client.query('commit');
      return frozenTimeoutSeconds === undefined
        ? undefined
        : { timeoutSeconds: frozenTimeoutSeconds };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async readPending(
    workspaceId: string,
    taskId: string,
    options?: { includeResolved?: boolean },
  ) {
    const runtimeTaskId = await this.workflowRuntimeId(workspaceId, taskId);
    if (!runtimeTaskId) return null;
    const result = await this.pool.query<{ payload: unknown }>(
      `select payload from harness_runtime.pending_questions
       where task_id=$1 and ($2::boolean or status='pending')`,
      [runtimeTaskId, options?.includeResolved === true],
    );
    return result.rows[0]
      ? questionCardSchema.parse(result.rows[0].payload)
      : null;
  }

  async readDecisionTarget(workspaceId: string, taskId: string) {
    const runtimeTaskId = await this.workflowRuntimeId(workspaceId, taskId);
    if (!runtimeTaskId) return null;
    const result = await this.pool.query<{
      pending_projection: unknown;
      payload: unknown;
      request: HarnessWorkflowInput;
      resolution_source:
        | 'decision'
        | 'core_timeout'
        | 'core_hold_expired'
        | 'late_answer'
        | null;
      status: 'pending' | 'resolved';
    }>(
      `select questions.payload,
              questions.pending_projection,
              questions.status,
              requests.request,
              (
                select events.resolution_source
                  from harness_runtime.decision_events events
                 where events.task_id=questions.task_id
                   and events.question_id=questions.question_id
                   and events.resolution_source<>'late_answer'
                 order by events.created_at, events.id
                 limit 1
              ) as resolution_source
         from harness_runtime.pending_questions questions
         join harness_runtime.task_requests requests
           on requests.task_id=questions.task_id
        where questions.task_id=$1`,
      [runtimeTaskId],
    );
    const row = result.rows[0];
    const timeoutSeconds = row
      ? pendingDecisionTimeoutSeconds(row.pending_projection)
      : undefined;
    return row
      ? {
          question: questionCardSchema.parse(row.payload),
          request: row.request,
          resolutionSource: row.resolution_source,
          status: row.status,
          ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
        }
      : null;
  }

  async listPendingQuestions(workspaceId: string) {
    const result = await this.pool.query<{
      payload: unknown;
      task_id: string;
      updated_at: Date | string;
    }>(
      `select questions.payload,
              requests.workflow_id as task_id,
              questions.updated_at
         from harness_runtime.pending_questions questions
         join harness_runtime.task_requests requests
           on requests.runtime_id=questions.task_id
        where requests.request->>'workspaceId'=$1
          and questions.status='pending'
        order by questions.updated_at, requests.workflow_id, questions.question_id`,
      [workspaceId],
    );
    return result.rows.map((row) => ({
      createdAt:
        row.updated_at instanceof Date
          ? row.updated_at.toISOString()
          : new Date(row.updated_at).toISOString(),
      question: questionCardSchema.parse(row.payload),
      taskId: row.task_id,
    }));
  }

  async submit(
    input: Parameters<HarnessDecisionStore['submit']>[0],
  ): ReturnType<HarnessDecisionStore['submit']> {
    const runtimeTaskId = await this.requireWorkflowRuntimeId(
      input.workspaceId,
      input.taskId,
    );
    const runtimeEventId = this.runtimeObjectId(
      input.workspaceId,
      input.taskId,
      runtimeTaskId,
      input.event.id,
    );
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `${runtimeTaskId}:${input.command.idempotencyKey}`,
      ]);
      const existing = await client.query<{
        payload: unknown;
        payload_fingerprint: string;
        resume_status: string;
      }>(
        `select payload, payload_fingerprint, resume_status
         from harness_runtime.decision_events
         where task_id=$1 and idempotency_key=$2`,
        [runtimeTaskId, input.command.idempotencyKey],
      );
      if (existing.rows[0]) {
        await client.query('commit');
        return {
          outcome:
            input.mode === 'late_answer' ||
            existing.rows[0].payload_fingerprint === input.event.payloadFingerprint
              ? 'replayed'
              : 'idempotency_conflict',
          ...(input.mode === 'late_answer'
            ? { command: commandFromDecisionEvent(existing.rows[0].payload) }
            : {}),
          resumeRequired: existing.rows[0].resume_status !== 'sent',
        };
      }

      const pending = await client.query<{
        question_id: string;
        workflow_revision: string;
        status: string;
      }>(
        `select question_id, workflow_revision, status
         from harness_runtime.pending_questions
         where task_id=$1 for update`,
        [runtimeTaskId],
      );
      const node = pending.rows[0];
      const lateAnswerSource =
        input.mode === 'late_answer'
          ? await client.query(
              `select 1
                 from harness_runtime.decision_events
                where task_id=$1
                  and question_id=$2
                  and resolution_source in ('core_timeout','core_hold_expired')
                  and payload->'decision'->>'state'='ignored'
                limit 1`,
              [runtimeTaskId, input.command.questionId],
            )
          : null;
      const acceptsLateAnswer =
        input.mode === 'late_answer' &&
        node?.status === 'resolved' &&
        lateAnswerSource?.rowCount === 1;
      if (
        !node ||
        (node.status !== 'pending' && !acceptsLateAnswer) ||
        node.question_id !== input.command.questionId
      ) {
        await client.query('rollback');
        return { outcome: 'stale_question', resumeRequired: false };
      }
      if (Number(node.workflow_revision) !== input.command.workflowRevision) {
        await client.query('rollback');
        return { outcome: 'stale_revision', resumeRequired: false };
      }

      await client.query(
        `insert into harness_runtime.decision_events
          (id, task_id, question_id, workflow_revision, idempotency_key,
           payload_fingerprint, payload, resolution_source, resume_status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          runtimeEventId,
          runtimeTaskId,
          input.command.questionId,
          input.command.workflowRevision,
          input.command.idempotencyKey,
          input.event.payloadFingerprint,
          JSON.stringify(input.event),
          input.mode ?? 'decision',
          input.mode === 'core_timeout' ||
          input.mode === 'core_hold_expired'
            ? 'sent'
            : 'pending',
        ],
      );
      await this.writeDecisionTrace(
        client,
        input.workspaceId,
        runtimeTaskId,
        input.trace,
      );
      const audit: HarnessAuditEvent = {
        workspaceId: input.workspaceId,
        id: `audit-${input.event.id}`,
        workflowId: input.taskId,
        stage: 'intent_naming',
        eventType: 'structured_decision_recorded',
        payload: {
          eventId: input.event.id,
          questionId: input.command.questionId,
          resolutionSource: input.mode ?? 'decision',
          workflowRevision: input.command.workflowRevision,
        },
      };
      await this.writeAuditAndOutbox(client, audit, runtimeTaskId);
      if (!acceptsLateAnswer) {
        await client.query(
          `update harness_runtime.pending_questions
           set status='resolved', updated_at=now()
           where task_id=$1`,
          [runtimeTaskId],
        );
      }
      await client.query('commit');
      return {
        outcome: 'created',
        command: input.command,
        resumeRequired:
          input.mode !== 'core_timeout' &&
          input.mode !== 'core_hold_expired',
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async markDecisionResumed(
    workspaceId: string,
    taskId: string,
    eventId: string,
  ) {
    const runtimeTaskId = await this.requireWorkflowRuntimeId(
      workspaceId,
      taskId,
    );
    await this.pool.query(
      `update harness_runtime.decision_events
       set resume_status='sent'
       where id=$1 and resume_status='sending'`,
      [this.runtimeObjectId(workspaceId, taskId, runtimeTaskId, eventId)],
    );
  }

  async claimDecisionResume(
    workspaceId: string,
    taskId: string,
    eventId: string,
  ) {
    const runtimeTaskId = await this.requireWorkflowRuntimeId(
      workspaceId,
      taskId,
    );
    const result = await this.pool.query(
      `update harness_runtime.decision_events
       set resume_status='sending'
       where id=$1 and resume_status='pending'
       returning id`,
      [this.runtimeObjectId(workspaceId, taskId, runtimeTaskId, eventId)],
    );
    return result.rowCount === 1;
  }

  async releaseDecisionResume(
    workspaceId: string,
    taskId: string,
    eventId: string,
  ) {
    const runtimeTaskId = await this.requireWorkflowRuntimeId(
      workspaceId,
      taskId,
    );
    await this.pool.query(
      `update harness_runtime.decision_events
       set resume_status='pending'
       where id=$1 and resume_status='sending'`,
      [this.runtimeObjectId(workspaceId, taskId, runtimeTaskId, eventId)],
    );
  }

  async appendAudit(event: HarnessAuditEvent) {
    const runtimeWorkflowId = await this.requireWorkflowRuntimeId(
      event.workspaceId,
      event.workflowId,
    );
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await this.writeAuditAndOutbox(client, event, runtimeWorkflowId);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async appendPromptAudit(event: ModelSupplyPromptFallbackAuditEvent) {
    const runtimeWorkflowId = harnessRuntimeId(
      event.workspaceId,
      event.workflowId,
    );
    const safeEvent: HarnessAuditEvent = {
      workspaceId: event.workspaceId,
      id: event.id,
      workflowId: event.workflowId,
      stage: 'prompt_resolution',
      eventType: 'langfuse_prompt_fallback',
      payload: {
        promptKey: event.payload.promptKey,
        prompt: {
          name: event.payload.prompt.name,
          version: event.payload.prompt.version,
          contentHash: event.payload.prompt.contentHash,
          label: event.payload.prompt.label,
          source: event.payload.prompt.source,
          isFallback: true,
          ...(event.payload.prompt.fallbackReason
            ? { fallbackReason: event.payload.prompt.fallbackReason }
            : {}),
        },
        ...(event.payload.operation
          ? { operation: event.payload.operation }
          : {}),
      },
    };
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await this.writeAuditAndOutbox(client, safeEvent, runtimeWorkflowId);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordStageTrace(input: {
    workspaceId: string;
    id: string;
    taskId: string;
    stage: string;
    payload: unknown;
  }) {
    const runtimeTaskId = await this.requireWorkflowRuntimeId(
      input.workspaceId,
      input.taskId,
    );
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into harness_runtime.decision_traces
           (id, task_id, stage, payload)
         values ($1,$2,$3,$4)
         on conflict (id) do nothing`,
        [
          this.runtimeObjectId(
            input.workspaceId,
            input.taskId,
            runtimeTaskId,
            input.id,
          ),
          runtimeTaskId,
          input.stage,
          JSON.stringify(input.payload),
        ],
      );
      await this.writeAuditAndOutbox(
        client,
        {
          workspaceId: input.workspaceId,
          id: `audit-${input.id}`,
          workflowId: input.taskId,
          stage: input.stage,
          eventType: 'stage_decision_recorded',
          payload: { traceId: input.id },
        },
        runtimeTaskId,
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async deliverCopyRevision(input: {
    workflowId: string;
    workspaceId: string;
    packageId: string;
    expectedRevision: number;
    platform?: 'xiaohongshu' | 'douyin' | 'video_account';
    occurredAt: string;
    workflowRevision: number;
    winner: {
      candidateId: string;
      title: string;
      body: string;
      conversionHook: string;
    };
    candidates: Array<{
      candidateId: string;
      title: string;
      body: string;
      conversionHook: string;
      score: number;
    }>;
    recommendation: Omit<CreativeRecommendationDecisionTrace, 'deliverables'>;
    claimExtraction: VisibleClaimExtraction;
    marketing?: MarketingPackageEvidence;
    assetIds?: string[];
    reuseSeed?: ReuseTaskSeed;
  }): Promise<ContentPackageRevisionDelivery> {
    const runtimeWorkflowId = await this.requireWorkflowRuntimeId(
      input.workspaceId,
      input.workflowId,
    );
    const deliveryAuditId = this.runtimeObjectId(
      input.workspaceId,
      input.workflowId,
      runtimeWorkflowId,
      `audit-${input.workflowId}-package-delivered`,
    );
    const client = await this.pool.connect();
    let conflictRevision: number | undefined;
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        input.workspaceId,
      ]);
      const receipt = await client.query<{ payload: unknown }>(
        `select payload from harness_runtime.audit_events
         where id=$1 and event_type='package_delivered'`,
        [deliveryAuditId],
      );
      if (receipt.rows[0]) {
        const delivery = receipt.rows[0].payload as Partial<
          ContentPackageRevisionDelivery & {
            workspaceId: string;
            expectedRevision: number;
            requestFingerprint: string;
          }
        >;
        const validDeliveryIdentity =
          typeof delivery.packageId === 'string' &&
          delivery.packageId === input.packageId &&
          typeof delivery.versionId === 'string' &&
          typeof delivery.revision === 'number' &&
          Number.isInteger(delivery.revision);
        const validBoundReceipt =
          validDeliveryIdentity &&
          delivery.workspaceId === input.workspaceId &&
          delivery.expectedRevision === input.expectedRevision &&
          delivery.requestFingerprint === deliveryRequestFingerprint(input);
        const validLegacyReceipt =
          validDeliveryIdentity &&
          !validBoundReceipt &&
          (await this.isValidLegacyDeliveryReceipt(
            client,
            input,
            runtimeWorkflowId,
            delivery as ContentPackageRevisionDelivery & {
              workspaceId?: string;
              expectedRevision?: number;
              requestFingerprint?: string;
            },
          ));
        if (!validBoundReceipt && !validLegacyReceipt) {
          throw new Error('Stored harness delivery receipt is invalid.');
        }
        const persistedDelivery = delivery as ContentPackageRevisionDelivery;
        await client.query('commit');
        return {
          packageId: persistedDelivery.packageId,
          versionId: persistedDelivery.versionId,
          revision: persistedDelivery.revision,
        };
      }
      const current = await client.query<{
        payload: unknown;
        revision: string;
      }>(
        `select payload, revision::text as revision
         from p1_content_packages
         where workspace_id=$1 and id=$2
         for update`,
        [input.workspaceId, input.packageId],
      );
      const row = current.rows[0];
      if (!row && !input.reuseSeed) {
        throw new HarnessDeliveryError(
          'CONTENT_PACKAGE_NOT_FOUND',
          'The ContentPackage was not found.',
        );
      }
      if (row && input.reuseSeed) {
        throw new HarnessDeliveryError(
          'CONTENT_PACKAGE_ALREADY_EXISTS',
          'A reuse Task cannot overwrite an existing ContentPackage.',
        );
      }
      const currentRevision = row ? Number(row.revision) : 0;
      if (!input.reuseSeed && currentRevision !== input.expectedRevision) {
        conflictRevision = currentRevision;
        await client.query('rollback');
      } else {
        let contentPackage;
        if (input.reuseSeed) {
          if (input.expectedRevision !== 0) {
            throw new HarnessDeliveryError(
              'REUSE_SOURCE_INVALID',
              'A new reuse ContentPackage must begin at revision zero.',
            );
          }
          const source = await client.query<{
            payload: unknown;
            revision: string;
          }>(
            `select payload, revision::text as revision
               from p1_content_packages
              where workspace_id=$1 and id=$2
              for share`,
            [input.workspaceId, input.reuseSeed.sourcePackageId],
          );
          const sourceRow = source.rows[0];
          const sourcePackage = sourceRow
            ? contentPackageSchema.parse(sourceRow.payload)
            : null;
          if (
            !sourcePackage ||
            Number(sourceRow?.revision ?? -1) <
              input.reuseSeed.sourcePackageRevision ||
            !['accepted', 'review_ready'].includes(sourcePackage.status) ||
            sourcePackage.rights.state !== 'authorized' ||
            !sourcePackage.versions.some(
              (version) => version.id === input.reuseSeed?.sourceVersionId,
            )
          ) {
            throw new HarnessDeliveryError(
              'REUSE_SOURCE_INVALID',
              'The exact reuse source is no longer available.',
            );
          }
          contentPackage = contentPackageSchema.parse({
            ...buildContentPackage({
              id: input.packageId,
              workspaceId: input.workspaceId,
              kind: 'image_text',
              source: { assetIds: [...new Set(input.assetIds ?? [])] },
              timestamp: input.occurredAt,
            }),
            lineage: {
              reusedFromPackageId: input.reuseSeed.sourcePackageId,
            },
          });
        } else {
          contentPackage = contentPackageSchema.parse(row!.payload);
        }
        if (contentPackage.kind !== 'image_text') {
          throw new TypeError('The copy tracer requires an image-text ContentPackage.');
        }
        const candidateVersions = input.candidates.map((candidate) => ({
          id: copyVersionId(input, candidate),
          title: candidate.title,
          body: candidate.body,
          conversionHook: candidate.conversionHook,
          harnessCandidateId: candidate.candidateId,
          harnessScore: candidate.score,
          orderedAssetIds: [...new Set(input.assetIds ?? [])],
          topics: [],
          createdAt: input.occurredAt,
          createdBy: `harness-${input.workflowId}`,
          source: 'ai_generated' as const,
        }));
        const winnerVersion = candidateVersions.find(
          ({ harnessCandidateId }) =>
            harnessCandidateId === input.winner.candidateId,
        );
        if (!winnerVersion) {
          throw new TypeError('The Harness winner must be a delivered candidate.');
        }
        const versionId = winnerVersion.id;
        const nextRevision = currentRevision + 1;
        const delivery = {
          packageId: input.packageId,
          versionId,
          revision: nextRevision,
        };
        const updated = contentPackageSchema.parse({
          ...contentPackage,
          ...(input.marketing ? { marketing: input.marketing } : {}),
          harnessSelection: {
            recommendedCandidateId: input.winner.candidateId,
          },
          currentVersionId: versionId,
          revision: nextRevision,
          source: {
            ...contentPackage.source,
            ...(input.platform ? { targetPlatform: input.platform } : {}),
            workflowId: input.workflowId,
            workflowRevision: input.workflowRevision,
          },
          status: 'review_ready',
          updatedAt: input.occurredAt,
          variants: buildCopyPlatformVariants({
            currentVersionId: versionId,
            packageId: input.packageId,
            versions: candidateVersions,
          }),
          versions: [...contentPackage.versions, ...candidateVersions],
        });
        const written = input.reuseSeed
          ? await insertContentPackageRow(client, {
              id: input.packageId,
              payload: updated,
              revision: nextRevision,
              updatedAt: input.occurredAt,
              workspaceId: input.workspaceId,
            })
          : await updateContentPackageRow(client, {
              expectedRevision: input.expectedRevision,
              id: input.packageId,
              payload: updated,
              revision: nextRevision,
              updatedAt: input.occurredAt,
              workspaceId: input.workspaceId,
            });
        if (!written) {
          throw new Error('ContentPackage CAS failed while holding the workspace lock.');
        }
        await this.writeGeneralTrace(
          client,
          runtimeWorkflowId,
          {
            workspaceId: input.workspaceId,
            id: `trace-${input.workflowId}-assembly_delivery`,
            taskId: input.workflowId,
            stage: 'assembly_delivery',
            payload: {
              delivery,
              ...(input.reuseSeed ? { reuse: input.reuseSeed } : {}),
              recommendation: {
                recommendedCandidateId: input.winner.candidateId,
                decisionTrace: {
                  ...input.recommendation,
                  deliverables: [`copy_revision:${nextRevision}`],
                },
              },
              ...(input.marketing ? { marketing: input.marketing } : {}),
              claimExtraction: input.claimExtraction,
            },
          },
        );
        await this.writeAuditAndOutbox(
          client,
          {
            workspaceId: input.workspaceId,
            id: `audit-${input.workflowId}-package-delivered`,
            workflowId: input.workflowId,
            stage: 'assembly_delivery',
            eventType: 'package_delivered',
            payload: {
              workspaceId: input.workspaceId,
              expectedRevision: input.expectedRevision,
              requestFingerprint: deliveryRequestFingerprint(input),
              claimExtraction: input.claimExtraction,
              packageId: input.packageId,
              versionId,
              revision: nextRevision,
              ...(input.reuseSeed ? { reuse: input.reuseSeed } : {}),
            },
          },
          runtimeWorkflowId,
        );
        await client.query('commit');
        return delivery;
      }
    } catch (error) {
      if (conflictRevision === undefined) await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }

    await this.appendAudit({
      workspaceId: input.workspaceId,
      id: `audit-${input.workflowId}-revision-conflict-${input.expectedRevision}`,
      workflowId: input.workflowId,
      stage: 'assembly_delivery',
      eventType: 'revision_conflict',
      payload: {
        packageId: input.packageId,
        expectedRevision: input.expectedRevision,
        currentRevision: conflictRevision,
      },
    });
    throw new HarnessDeliveryError(
      'CONTENT_PACKAGE_REVISION_CONFLICT',
      `ContentPackage expected revision ${input.expectedRevision}, current revision is ${conflictRevision}.`,
      conflictRevision,
      input.expectedRevision,
      input.packageId,
    );
  }

  async claimLangfuseBatch(
    limit: number,
    leaseSeconds = 300,
    maxAttempts = 8,
  ): Promise<HarnessLangfuseOutboxItem[]> {
    const result = await this.pool.query<{
      audit_id: string;
      workflow_id: string;
      stage: string;
      event_type: string;
      payload: unknown;
      created_at: Date | string;
      attempts: number;
    }>(
      `with over_limit as (
         update harness_runtime.langfuse_outbox
         set status='dead_letter', dead_lettered_at=coalesce(dead_lettered_at, now()),
             last_error=coalesce(last_error, 'Langfuse outbox attempt limit reached.'),
             updated_at=now()
         where status in ('queued','failed','sending')
           and dead_lettered_at is null
           and attempts >= $3
           and next_attempt_at <= now()
       ), ready as (
         select audit_id
         from harness_runtime.langfuse_outbox
         where status in ('queued','failed','sending')
           and dead_lettered_at is null
           and attempts < $3
           and next_attempt_at <= now()
         order by next_attempt_at, audit_id
         for update skip locked
         limit $1
       ), claimed as (
         update harness_runtime.langfuse_outbox o
         set status='sending', attempts=o.attempts+1,
             next_attempt_at=now()+($2 * interval '1 second'), updated_at=now()
         from ready
         where o.audit_id=ready.audit_id
         returning o.audit_id, o.attempts
       )
       select c.audit_id, c.attempts, a.workflow_id, a.stage,
              a.event_type, a.payload, a.created_at
       from claimed c
       join harness_runtime.audit_events a on a.id=c.audit_id
       order by c.audit_id`,
      [limit, leaseSeconds, maxAttempts],
    );
    if (result.rows.length === 0) return [];
    const workflowIds = [...new Set(result.rows.map((row) => row.workflow_id))];
    const traceRows = (
      await this.pool.query<{
        id: string;
        task_id: string;
        stage: string;
        payload: unknown;
      }>(
        `select id, task_id, stage, payload
         from harness_runtime.decision_traces
         where task_id=any($1::text[])
         order by created_at, id`,
        [workflowIds],
      )
    ).rows;
    const exactTraces = new Map(
      traceRows.map((row) => [
        `${row.task_id}:${harnessLogicalId(row.id)}`,
        row.payload,
      ]),
    );
    const latestStageTraces = new Map(
      traceRows.map((row) => [
        `${row.task_id}:${row.stage}`,
        row.payload,
      ]),
    );
    return result.rows.map((row) => {
      const traceId = String(record(row.payload)?.traceId ?? '');
      const decisionTrace =
        exactTraces.get(`${row.workflow_id}:${traceId}`) ??
        latestStageTraces.get(`${row.workflow_id}:${row.stage}`);
      return {
        auditId: row.audit_id,
        workflowId: row.workflow_id,
        stage: row.stage,
        eventType: row.event_type,
        occurredAt: new Date(row.created_at).toISOString(),
        payload: row.payload,
        ...(decisionTrace === undefined ? {} : { decisionTrace }),
        attempts: row.attempts,
      };
    });
  }

  async markLangfuseSent(auditId: string) {
    await this.pool.query(
      `update harness_runtime.langfuse_outbox
       set status='sent', last_error=null, updated_at=now()
       where audit_id=$1 and status='sending'`,
      [auditId],
    );
  }

  async markLangfuseFailed(auditId: string, error: string, retryAt: Date) {
    await this.pool.query(
      `update harness_runtime.langfuse_outbox
       set status='failed', last_error=$2, next_attempt_at=$3, updated_at=now()
       where audit_id=$1 and status='sending'`,
      [auditId, error.slice(0, 2_000), retryAt.toISOString()],
    );
  }

  async markLangfuseDeadLetter(auditId: string, error: string) {
    await this.pool.query(
      `update harness_runtime.langfuse_outbox
       set status='dead_letter', last_error=$2, dead_lettered_at=now(),
           updated_at=now()
       where audit_id=$1 and status='sending'`,
      [auditId, error.slice(0, 2_000)],
    );
  }

  async replayLangfuseDeadLetter(auditId: string) {
    const result = await this.pool.query(
      `update harness_runtime.langfuse_outbox
       set status='queued', attempts=0, next_attempt_at=now(),
           last_error=null, dead_lettered_at=null, updated_at=now()
       where audit_id=$1 and status='dead_letter'
       returning audit_id`,
      [auditId],
    );
    return result.rowCount === 1;
  }

  async discardLangfuseDeadLetter(auditId: string) {
    const result = await this.pool.query(
      `update harness_runtime.langfuse_outbox
       set status='discarded', updated_at=now()
       where audit_id=$1 and status='dead_letter'
       returning audit_id`,
      [auditId],
    );
    return result.rowCount === 1;
  }

  private async writeDecisionTrace(
    client: PoolClient,
    workspaceId: string,
    runtimeTaskId: string,
    trace: HarnessDecisionTrace,
  ) {
    await client.query(
      `insert into harness_runtime.decision_traces
         (id, task_id, stage, payload)
       values ($1,$2,$3,$4)`,
      [
        this.runtimeObjectId(
          workspaceId,
          trace.taskId,
          runtimeTaskId,
          trace.id,
        ),
        runtimeTaskId,
        trace.stage,
        JSON.stringify(trace),
      ],
    );
  }

  private async writeGeneralTrace(
    client: PoolClient,
    runtimeTaskId: string,
    input: {
      workspaceId: string;
      id: string;
      taskId: string;
      stage: string;
      payload: unknown;
    },
  ) {
    await client.query(
      `insert into harness_runtime.decision_traces
         (id, task_id, stage, payload)
       values ($1,$2,$3,$4)
       on conflict (id) do nothing`,
      [
        this.runtimeObjectId(
          input.workspaceId,
          input.taskId,
          runtimeTaskId,
          input.id,
        ),
        runtimeTaskId,
        input.stage,
        JSON.stringify(input.payload),
      ],
    );
  }

  private async writeAuditAndOutbox(
    client: PoolClient,
    event: HarnessAuditEvent,
    runtimeWorkflowId: string,
  ) {
    const auditId = this.runtimeObjectId(
      event.workspaceId,
      event.workflowId,
      runtimeWorkflowId,
      event.id,
    );
    await client.query(
      `insert into harness_runtime.audit_events
         (id, workflow_id, stage, event_type, payload)
       values ($1,$2,$3,$4,$5)
       on conflict (id) do nothing`,
      [
        auditId,
        runtimeWorkflowId,
        event.stage,
        event.eventType,
        JSON.stringify(event.payload),
      ],
    );
    await client.query(
      `insert into harness_runtime.langfuse_outbox (audit_id, status)
       values ($1,'queued') on conflict (audit_id) do nothing`,
      [auditId],
    );
  }

  private async requireWorkflowRuntimeId(
    workspaceId: string,
    workflowId: string,
  ) {
    const runtimeId = await this.workflowRuntimeId(workspaceId, workflowId);
    if (!runtimeId) {
      throw new Error('Harness workflow runtime identity was not found.');
    }
    return runtimeId;
  }

  private async isValidLegacyDeliveryReceipt(
    client: PoolClient,
    input: {
      workflowId: string;
      workspaceId: string;
      packageId: string;
      expectedRevision: number;
    },
    runtimeWorkflowId: string,
    delivery: ContentPackageRevisionDelivery & {
      workspaceId?: string;
      expectedRevision?: number;
      requestFingerprint?: string;
    },
  ) {
    if (
      runtimeWorkflowId !== input.workflowId ||
      delivery.workspaceId !== undefined ||
      delivery.expectedRevision !== undefined ||
      delivery.requestFingerprint !== undefined ||
      delivery.revision !== input.expectedRevision + 1
    ) {
      return false;
    }
    const claim = await client.query<{ request: unknown }>(
      `select request from harness_runtime.task_requests
       where task_id=$1 and workflow_id=$1 and runtime_id=$1
       limit 1`,
      [runtimeWorkflowId],
    );
    const request = claim.rows[0]?.request as
      | {
          workspaceId?: unknown;
          packageId?: unknown;
          expectedRevision?: unknown;
        }
      | undefined;
    if (
      request?.workspaceId !== input.workspaceId ||
      request.packageId !== input.packageId ||
      request.expectedRevision !== input.expectedRevision
    ) {
      return false;
    }
    const target = await client.query<{
      payload: unknown;
      revision: string;
    }>(
      `select payload, revision::text as revision
       from p1_content_packages
       where workspace_id=$1 and id=$2`,
      [input.workspaceId, input.packageId],
    );
    const contentPackage = contentPackageSchema.safeParse(
      target.rows[0]?.payload,
    );
    return (
      contentPackage.success &&
      Number(target.rows[0]?.revision ?? -1) >= delivery.revision &&
      contentPackage.data.versions.some(
        (version) => version.id === delivery.versionId,
      )
    );
  }

  private runtimeObjectId(
    workspaceId: string,
    logicalWorkflowId: string,
    runtimeWorkflowId: string,
    logicalObjectId: string,
  ) {
    return runtimeWorkflowId === logicalWorkflowId
      ? logicalObjectId
      : harnessRuntimeId(workspaceId, logicalObjectId);
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function pendingDecisionTimeoutSeconds(value: unknown) {
  const projection = record(value);
  if (
    !projection ||
    !Object.prototype.hasOwnProperty.call(projection, 'timeoutSeconds')
  ) {
    return undefined;
  }
  return projection.timeoutSeconds === null
    ? null
    : confirmationCardTimeoutSecondsSchema.parse(
        projection.timeoutSeconds,
      );
}

function commandFromDecisionEvent(value: unknown) {
  const event = record(value);
  return structuredDecisionInputSchema.parse({
    idempotencyKey: event?.idempotencyKey,
    questionId: event?.questionId,
    workflowRevision: event?.workflowRevision,
    patch: event?.patch,
    decision: event?.decision,
  });
}

function copyVersionId(
  input: {
    workflowId: string;
    packageId: string;
  },
  candidate: { candidateId: string; title: string; body: string },
) {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        workflowId: input.workflowId,
        candidateId: candidate.candidateId,
        title: candidate.title,
        body: candidate.body,
      }),
    )
    .digest('hex')
    .slice(0, 16);
  return `${input.packageId}-harness-${digest}`;
}

function deliveryRequestFingerprint(input: {
  workspaceId: string;
  workflowId: string;
  packageId: string;
  expectedRevision: number;
  platform?: 'xiaohongshu' | 'douyin' | 'video_account';
  workflowRevision: number;
  winner: {
    candidateId: string;
    title: string;
    body: string;
    conversionHook: string;
  };
  candidates: Array<{
    candidateId: string;
    title: string;
    body: string;
    conversionHook: string;
    score: number;
  }>;
  recommendation: Omit<CreativeRecommendationDecisionTrace, 'deliverables'>;
  claimExtraction: VisibleClaimExtraction;
  marketing?: MarketingPackageEvidence;
  assetIds?: string[];
  reuseSeed?: ReuseTaskSeed;
}) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        workspaceId: input.workspaceId,
        workflowId: input.workflowId,
        packageId: input.packageId,
        expectedRevision: input.expectedRevision,
        platform: input.platform,
        workflowRevision: input.workflowRevision,
        winner: input.winner,
        candidates: input.candidates,
        recommendation: input.recommendation,
        claimExtraction: input.claimExtraction,
        marketing: input.marketing ?? null,
        assetIds: [...new Set(input.assetIds ?? [])],
        reuseSeed: input.reuseSeed ?? null,
      }),
    )
    .digest('hex');
}
