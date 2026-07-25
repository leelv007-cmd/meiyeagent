import {
  contentPackageSchema,
  questionCardSchema,
  type ContentPackageRevisionDelivery,
  type CreativeRecommendationDecisionTrace,
  type MarketingPackageEvidence,
  type QuestionCard,
  type ReuseTaskSeed,
} from '@meiye/contracts';
import type { Pool, PoolClient } from 'pg';
import { createHash } from 'node:crypto';

import { buildContentPackage } from '../operations/content-package.js';
import {
  insertContentPackageRow,
  updateContentPackageRow,
} from '../operations/postgres-content-package-write-adapter.js';
import { PostgresStoreFactLedger } from '../operations/postgres-store-fact-ledger.js';
import { TaskBlockingNodeConflictError } from '../operations/repository.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import { buildCopyPlatformVariants } from './output-compiler.js';
import type { VisibleClaimExtraction } from './policy-gates.js';

import type {
  HarnessDecisionStore,
  HarnessDecisionTrace,
} from './decision-service.js';
import type {
  HarnessTaskRequestRegistry,
  HarnessWorkflowInput,
} from './task-admission.js';
import type { HarnessLangfuseOutboxItem } from './outbox-worker.js';
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
  implements HarnessTaskRequestRegistry, HarnessDecisionStore
{
  constructor(
    private readonly pool: Pool,
    private readonly factRevisions: Pick<
      PostgresStoreFactLedger,
      'currentRevision'
    > = new PostgresStoreFactLedger(pool),
  ) {}

  async applySchema() {
    await this.pool.query(`
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
        status text not null check (status in ('queued', 'sending', 'failed', 'sent')),
        attempts integer not null default 0,
        next_attempt_at timestamptz not null default now(),
        last_error text,
        updated_at timestamptz not null default now()
      );

      create index if not exists harness_langfuse_outbox_ready_idx
        on harness_runtime.langfuse_outbox (status, next_attempt_at);

      alter table harness_runtime.decision_events
        add column if not exists resume_status text not null default 'pending';
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
      return projectTodayRecommendation(workspaceId, currentFactsRevision, null);
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
      if (!traces.has(row.stage)) traces.set(row.stage, row.payload);
    }
    const request = record(delivery.request);
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
      contextTrace: traces.get('context_injection'),
      briefTrace: traces.get('brief_compilation'),
      selectionTrace: traces.get('execution_selection'),
    };
    return projectTodayRecommendation(
      workspaceId,
      currentFactsRevision,
      recommendationRecord,
    );
  }

  async registerPending(workspaceId: string, question: QuestionCard) {
    const parsed = questionCardSchema.parse(question);
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
        question_id: string;
        workflow_revision: string;
      }>(
        `select question_id, workflow_revision::text as workflow_revision
           from harness_runtime.pending_questions
          where task_id=$1 and status='pending'`,
        [runtimeTaskId],
      );
      const pending = existing.rows[0];
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
      if (!pending) {
        await client.query(
          `insert into harness_runtime.pending_questions
             (task_id, question_id, workflow_revision, payload, status)
           values ($1,$2,$3,$4,'pending')
           on conflict (task_id) do update set
             question_id=excluded.question_id,
             workflow_revision=excluded.workflow_revision,
             payload=excluded.payload,
             status='pending',
             updated_at=now()`,
          [
            runtimeTaskId,
            parsed.questionId,
            parsed.workflowRevision,
            JSON.stringify(parsed),
          ],
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

  async readPending(workspaceId: string, taskId: string) {
    const runtimeTaskId = await this.workflowRuntimeId(workspaceId, taskId);
    if (!runtimeTaskId) return null;
    const result = await this.pool.query<{ payload: unknown }>(
      `select payload from harness_runtime.pending_questions
       where task_id=$1 and status='pending'`,
      [runtimeTaskId],
    );
    return result.rows[0]
      ? questionCardSchema.parse(result.rows[0].payload)
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
        payload_fingerprint: string;
        resume_status: string;
      }>(
        `select payload_fingerprint, resume_status
         from harness_runtime.decision_events
         where task_id=$1 and idempotency_key=$2`,
        [runtimeTaskId, input.command.idempotencyKey],
      );
      if (existing.rows[0]) {
        await client.query('commit');
        return {
          outcome:
            existing.rows[0].payload_fingerprint ===
            input.event.payloadFingerprint
              ? 'replayed'
              : 'idempotency_conflict',
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
      if (
        !node ||
        node.status !== 'pending' ||
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
           payload_fingerprint, payload)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          runtimeEventId,
          runtimeTaskId,
          input.command.questionId,
          input.command.workflowRevision,
          input.command.idempotencyKey,
          input.event.payloadFingerprint,
          JSON.stringify(input.event),
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
          workflowRevision: input.command.workflowRevision,
        },
      };
      await this.writeAuditAndOutbox(client, audit, runtimeTaskId);
      await client.query(
        `update harness_runtime.pending_questions
         set status='resolved', updated_at=now()
         where task_id=$1`,
        [runtimeTaskId],
      );
      await client.query('commit');
      return { outcome: 'created', resumeRequired: true };
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

  async claimLangfuseBatch(limit: number): Promise<HarnessLangfuseOutboxItem[]> {
    const result = await this.pool.query<{
      audit_id: string;
      workflow_id: string;
      stage: string;
      event_type: string;
      payload: unknown;
      created_at: Date | string;
      attempts: number;
    }>(
      `with ready as (
         select audit_id
         from harness_runtime.langfuse_outbox
         where status in ('queued','failed','sending')
           and next_attempt_at <= now()
         order by next_attempt_at, audit_id
         for update skip locked
         limit $1
       ), claimed as (
         update harness_runtime.langfuse_outbox o
         set status='sending', attempts=o.attempts+1,
             next_attempt_at=now()+interval '5 minutes', updated_at=now()
         from ready
         where o.audit_id=ready.audit_id
         returning o.audit_id, o.attempts
       )
       select c.audit_id, c.attempts, a.workflow_id, a.stage,
              a.event_type, a.payload, a.created_at
       from claimed c
       join harness_runtime.audit_events a on a.id=c.audit_id
       order by c.audit_id`,
      [limit],
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
