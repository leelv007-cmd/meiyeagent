import {
  confirmationCardTimeoutSecondsSchema,
  contentPackageSchema,
  harnessInteractionRequestSchema,
  observabilityAxisBindingSchema,
  observabilityEventSchema,
  observabilityDropEventSchema,
  questionCardSchema,
  structuredDecisionInputSchema,
  RECENTLY_COMPLETED_RESTORE_WINDOW_MINUTES,
  type ContentPackageRevisionDelivery,
  type CreativeRecommendationDecisionTrace,
  type HarnessInteractionRequest,
  type MarketingPackageEvidence,
  type ObservabilityDropEvent,
  type ObservabilityAxisBinding,
  type ProductUsageUnit,
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
import { isStoreFactActive } from '../operations/store-fact-ledger.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import {
  billingIdentityReservationFingerprint,
  billingPlanId,
  type BillingIdentity,
} from '../execution-spine/billing-identity.js';
import type { ModelSupplyPromptFallbackAuditEvent } from '../model-supply/route-contracts.js';
import type { TaskObservabilityContextPort } from '../creation-experience/observability-events.js';
import type { DailyRecommendationCandidateReader } from '../due-delivery/delivery-port.js';
import { merchantFailureReport } from './merchant-delivery-language.js';
import { buildCopyPlatformVariants } from './output-compiler.js';
import type { VisibleClaimExtraction } from './policy-gates.js';
import type {
  HarnessProductMetricRecorder,
  HarnessRecommendationReader,
  HarnessTaskAccess,
} from './application-service.js';
import type { HarnessWorkflowEventAccess } from './dbos-workflow-events.js';

import type {
  HarnessDecisionStore,
  HarnessPendingDecisionProjection,
  HarnessDecisionTrace,
} from './decision-service.js';
import {
  createHarnessInteractionPendingProjection,
  harnessInteractionPendingProjectionSchema,
  type HarnessInteractionSnapshot,
  type HarnessInteractionPendingProjection,
  type HarnessInteractionStore,
  type HarnessSystemDefaultCandidateStore,
} from './interaction-service.js';
import { isCurrentAskMerchantSemanticDefault } from './ask-merchant-timeout-authority.js';
import { interactionKind } from './interaction-resume.js';
import {
  executionPlanAdmissionWorkflowId,
  type HarnessExecutionAssemblyAuditPort,
  type HarnessPromptFallbackAuditPort,
  type HarnessTaskRequestRegistry,
  type HarnessWorkflowInput,
} from './task-admission.js';
import type {
  HarnessLangfuseOutboxItem,
  HarnessLangfuseOutboxStore,
} from './outbox-worker.js';
import type {
  HarnessReservationSweep,
  HarnessReservationSweepStore,
} from './reservation-sweeper.js';
import { MAX_RESERVATION_SWEEP_ATTEMPTS } from './reservation-sweeper.js';
import {
  DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG,
  HARNESS_TODAY_RECOMMENDATION_CONFIG_KEY,
  harnessTodayRecommendationConfigSchema,
  type AdminConfigRepository,
} from '../admin-config/foundation-module.js';
import { harnessLogicalId, harnessRuntimeId } from './workspace-scope.js';
import { LEGACY_REPLAY_ADMISSION_LOCK } from './legacy-replay-admission-lock.js';
import {
  isLegacyReplayAdmissionSealed,
  refuseUnarchivedLegacyDurableReplay,
} from './legacy-replay-admission-seal.js';
import {
  industryLabelFromStoreFactValue,
  projectTodayRecommendation,
  STORE_PROFILE_INDUSTRY_FACT_ID,
  STORE_PROFILE_INDUSTRY_KEY,
  type TodayRecommendationRecord,
} from './today-recommendation.js';
import type { HarnessWorkflowPersistence } from './dbos-workflow.js';
import type { HarnessRuntimeIdResolver } from './dbos-workflow.js';
import type { HarnessObservabilityReconciliationStore } from './observability-reconciliation.js';
import type { HarnessCopyDeliveryPort } from './production-stage-ports.js';

export interface HarnessAuditEvent {
  workspaceId: string;
  id: string;
  workflowId: string;
  stage: string;
  eventType: string;
  payload: unknown;
  traceId?: string;
  traceContractVersion?: 'observability/v1';
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

class TaskRootObservabilityConflictError extends Error {
  constructor(readonly auditId: string) {
    super('Task root observability conflict.');
    this.name = 'TaskRootObservabilityConflictError';
  }
}

export class PostgresHarnessStore
  implements
    HarnessTaskRequestRegistry,
    HarnessTaskAccess,
    HarnessRecommendationReader,
    DailyRecommendationCandidateReader,
    HarnessWorkflowEventAccess,
    HarnessRuntimeIdResolver,
    TaskObservabilityContextPort,
    HarnessDecisionStore,
    HarnessInteractionStore,
    HarnessReservationSweepStore,
    HarnessSystemDefaultCandidateStore,
    HarnessWorkflowPersistence,
    HarnessPromptFallbackAuditPort,
    HarnessExecutionAssemblyAuditPort,
    HarnessLangfuseOutboxStore,
    HarnessObservabilityReconciliationStore,
    PostgresSchemaMigrator
{
  constructor(
    private readonly pool: Pool,
    private readonly factRevisions: Pick<
      PostgresStoreFactLedger,
      'currentRevision' | 'history' | 'listActive'
    > = new PostgresStoreFactLedger(pool),
    private readonly adminConfig?: Pick<AdminConfigRepository, 'get'>,
    private readonly clock: () => Date = () => new Date(),
  ) {
    bindAdapterMethods(this, new PostgresHarnessInteractionStore(pool, clock));
    bindAdapterMethods(this, new PostgresHarnessAuditStore(pool));
    bindAdapterMethods(this, new PostgresHarnessObservabilityStore(pool));
  }

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
        billing_identity jsonb,
        confirmation_request_id text,
        successor_task_id text,
        admission_state text not null default 'legacy'
          check (admission_state in ('legacy', 'awaiting_confirmation', 'admitted', 'superseded')),
        created_at timestamptz not null default now()
      );
      alter table harness_runtime.task_requests
        add column if not exists billing_identity jsonb;
      alter table harness_runtime.task_requests
        add column if not exists confirmation_request_id text;
      alter table harness_runtime.task_requests
        add column if not exists successor_task_id text;
      alter table harness_runtime.task_requests
        add column if not exists admission_state text not null default 'legacy'
          check (admission_state in ('legacy', 'awaiting_confirmation', 'admitted', 'superseded'));
      do $$
      declare constraint_name text;
      begin
        for constraint_name in
          select conname
            from pg_constraint
           where conrelid = 'harness_runtime.task_requests'::regclass
             and contype = 'c'
             and pg_get_constraintdef(oid) like '%admission_state%'
        loop
          if not exists (
            select 1 from pg_constraint
             where conrelid = 'harness_runtime.task_requests'::regclass
               and conname = constraint_name
               and pg_get_constraintdef(oid) like '%superseded%'
          ) then
            execute format(
              'alter table harness_runtime.task_requests drop constraint %I',
              constraint_name
            );
            alter table harness_runtime.task_requests
              add constraint task_requests_admission_state_check
              check (admission_state in ('legacy', 'awaiting_confirmation', 'admitted', 'superseded'));
          end if;
        end loop;
      end $$;

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
          check (resume_status in ('pending', 'sending', 'sent', 'waiting', 'invalid')),
        resume_claim_id text,
        resume_lease_expires_at timestamptz,
        resume_attempts integer not null default 0,
        created_at timestamptz not null default now(),
        unique (task_id, idempotency_key)
      );

      create table if not exists harness_runtime.decision_traces (
        id text primary key,
        task_id text not null,
        stage text not null,
        payload jsonb not null,
        trace_contract_version text,
        created_at timestamptz not null default now()
      );

      create table if not exists harness_runtime.audit_events (
        id text primary key,
        workflow_id text not null,
        trace_id text,
        trace_contract_version text,
        stage text not null,
        event_type text not null,
        payload jsonb not null,
        created_at timestamptz not null default now()
      );

      -- V31-26a: legacy replay admission seal. Lives here, beside the table
      -- claim() reads, so the gate never has to probe for schema presence.
      create table if not exists harness_runtime.legacy_replay_admission_seal (
        singleton boolean primary key default true check (singleton),
        deployment_id text not null,
        evidence_audit_id text not null,
        sealed_at timestamptz not null default now()
      );

      create or replace function harness_runtime.reject_legacy_replay_seal_mutation()
      returns trigger language plpgsql as $$
      begin
        raise exception 'legacy replay admission seal is append-only';
      end $$;

      drop trigger if exists legacy_replay_admission_seal_immutable
        on harness_runtime.legacy_replay_admission_seal;
      create trigger legacy_replay_admission_seal_immutable
        before update or delete on harness_runtime.legacy_replay_admission_seal
        for each row
        execute function harness_runtime.reject_legacy_replay_seal_mutation();

      create table if not exists harness_runtime.observability_root_claims (
        workflow_id text primary key,
        audit_id text not null unique,
        payload jsonb not null,
        created_at timestamptz not null default now()
      );

      create table if not exists harness_runtime.reservation_sweeps (
        workspace_id text not null,
        task_id text not null,
        billing_task_id text,
        runtime_id text not null,
        question_id text not null,
        quote_id text not null,
        quote_revision text not null,
        usage_reservation_id text not null,
        reserved_units jsonb not null,
        held_since timestamptz not null,
        reason text not null
          check (reason in ('hold_reservation_ttl_elapsed')),
        status text not null
          check (status in
            ('processing', 'failed', 'completed', 'dead_letter')),
        attempts integer not null default 1,
        next_attempt_at timestamptz not null default now(),
        last_error text,
        completed_at timestamptz,
        dead_lettered_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (workspace_id, task_id)
      );

      alter table harness_runtime.reservation_sweeps
        add column if not exists billing_task_id text;
      alter table harness_runtime.reservation_sweeps
        add column if not exists billing_identity jsonb;
      alter table harness_runtime.reservation_sweeps
        add column if not exists next_attempt_at timestamptz not null
          default now();
      alter table harness_runtime.reservation_sweeps
        add column if not exists dead_lettered_at timestamptz;
      alter table harness_runtime.reservation_sweeps
        drop constraint if exists reservation_sweeps_status_check;
      alter table harness_runtime.reservation_sweeps
        add constraint reservation_sweeps_status_check
        check (status in
          ('processing', 'failed', 'completed', 'dead_letter'));

      -- Legacy rows are eligible only when they already contain a complete
      -- frozen identity. Never reconstruct one from workflow/request fields.
      update harness_runtime.task_requests
         set billing_identity=request->'billingIdentity',
             confirmation_request_id=request->>'executionConfirmationRequestId',
             admission_state=case
               when request ? 'pendingExecutionPlanSnapshot'
                 then 'awaiting_confirmation'
               else 'admitted'
             end
       where billing_identity is null
         and jsonb_typeof(request->'billingIdentity')='object'
         and request#>>'{billingIdentity,workspaceId}' <> ''
         and request#>>'{billingIdentity,taskId}' <> ''
         and request#>>'{billingIdentity,workId}' <> ''
         and request#>>'{billingIdentity,workflowId}' <> ''
         and request#>>'{billingIdentity,quoteRef,id}' <> ''
         and request#>>'{billingIdentity,quoteRef,revision}' <> ''
         and request#>>'{billingIdentity,reservationId}' <> ''
         and request#>>'{billingIdentity,carrierUnitId}' <> ''
         and jsonb_typeof(request#>'{billingIdentity,carrierUnitIds}')='array'
         and jsonb_array_length(request#>'{billingIdentity,carrierUnitIds}') > 0
         and jsonb_typeof(request#>'{billingIdentity,carrierBillableUnits}')='number';

      create or replace function
        harness_runtime.enforce_task_request_billing_identity()
      returns trigger language plpgsql as $$
      begin
        if new.billing_identity is not null
          and new.request->'billingIdentity' is distinct from new.billing_identity
        then
          raise exception 'task request billing identity must match its frozen request';
        end if;
        if tg_op='UPDATE' and old.billing_identity is not null and (
          new.billing_identity is distinct from old.billing_identity
          or new.confirmation_request_id is distinct from old.confirmation_request_id
        ) then
          raise exception 'task request billing admission is immutable';
        end if;
        return new;
      end $$;
      drop trigger if exists task_requests_billing_identity_immutable
        on harness_runtime.task_requests;
      create trigger task_requests_billing_identity_immutable
        before insert or update on harness_runtime.task_requests
        for each row execute function
          harness_runtime.enforce_task_request_billing_identity();

      update harness_runtime.reservation_sweeps sweeps
         set billing_task_id=requests.billing_identity->>'taskId',
             billing_identity=requests.billing_identity
        from harness_runtime.task_requests requests
       where sweeps.billing_task_id is null
         and requests.runtime_id=sweeps.runtime_id
         and requests.billing_identity is not null
         and requests.billing_identity->>'workspaceId'=sweeps.workspace_id
         and requests.billing_identity->>'workflowId'=requests.workflow_id
         and requests.billing_identity->>'carrierUnitId' <> ''
         and jsonb_typeof(requests.billing_identity->'carrierUnitIds')='array'
         and jsonb_array_length(requests.billing_identity->'carrierUnitIds') > 0
         and jsonb_typeof(requests.billing_identity->'carrierBillableUnits')='number'
         and requests.billing_identity#>>'{quoteRef,id}'=sweeps.quote_id
         and requests.billing_identity#>>'{quoteRef,revision}'=sweeps.quote_revision;

      update harness_runtime.reservation_sweeps
         set status='dead_letter',
             dead_lettered_at=coalesce(dead_lettered_at, now()),
             last_error='Reservation sweep billing identity could not be migrated.',
             updated_at=now()
       where billing_task_id is null or billing_identity is null;
      alter table harness_runtime.reservation_sweeps
        drop constraint if exists reservation_sweeps_billing_task_id_check;
      alter table harness_runtime.reservation_sweeps
        add constraint reservation_sweeps_billing_task_id_check
        check (billing_task_id is not null or status='dead_letter');
      drop index if exists harness_runtime.harness_reservation_sweeps_status_idx;
      create index harness_reservation_sweeps_status_idx
        on harness_runtime.reservation_sweeps
          (status, next_attempt_at, updated_at, held_since);

      create table if not exists p1_operations_audit_events (
        workspace_id text not null,
        id text not null,
        payload jsonb not null,
        updated_at timestamptz not null,
        primary key (workspace_id, id)
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
        sent_at timestamptz,
        delivery_generation integer not null default 1,
        updated_at timestamptz not null default now()
      );

      create table if not exists harness_runtime.observability_drop_events (
        id bigserial primary key,
        audit_id text not null,
        delivery_generation integer not null,
        signal text not null check
          (signal in ('trace', 'log', 'metric', 'score', 'feedback')),
        reason text not null check
          (reason in ('permanent-config', 'transient')),
        count integer not null check (count > 0),
        source text not null check (length(trim(source)) > 0),
        occurred_at timestamptz not null,
        unique (
          audit_id, delivery_generation, signal, reason, source
        )
      );

      create table if not exists harness_runtime.observability_reconciliation_cutovers (
        contract_version text primary key,
        cutover_at timestamptz not null,
        activated_at timestamptz not null default clock_timestamp()
      );

      create table if not exists harness_runtime.observability_reconciliation_runs (
        id bigserial primary key,
        contract_version text not null,
        window_start timestamptz not null,
        window_end timestamptz not null,
        cutover_at timestamptz not null,
        business_event_count integer not null,
        trace_count integer not null,
        matched_count integer not null,
        missing_trace_count integer not null,
        orphan_trace_count integer not null,
        rating_event_count integer not null,
        action_usage_event_count integer not null,
        undelivered_event_count integer not null,
        completed_at timestamptz,
        created_at timestamptz not null default clock_timestamp(),
        unique (contract_version, window_start, window_end, cutover_at)
      );

      create index if not exists harness_langfuse_outbox_ready_idx
        on harness_runtime.langfuse_outbox (status, next_attempt_at);
      create index if not exists harness_observability_drop_occurred_idx
        on harness_runtime.observability_drop_events (occurred_at);

      alter table harness_runtime.decision_events
        add column if not exists resume_status text not null default 'pending';
      alter table harness_runtime.decision_events
        add column if not exists resume_claim_id text;
      alter table harness_runtime.decision_events
        add column if not exists resume_lease_expires_at timestamptz;
      alter table harness_runtime.decision_events
        add column if not exists resume_attempts integer not null default 0;
      update harness_runtime.decision_events
        set resume_lease_expires_at=clock_timestamp()
        where resume_status='sending' and resume_lease_expires_at is null;
      alter table harness_runtime.pending_questions
        add column if not exists pending_projection jsonb not null
          default '{}'::jsonb;
      alter table harness_runtime.langfuse_outbox
        add column if not exists dead_lettered_at timestamptz;
      alter table harness_runtime.langfuse_outbox
        add column if not exists sent_at timestamptz;
      alter table harness_runtime.langfuse_outbox
        add column if not exists delivery_generation integer not null default 1;

      update harness_runtime.langfuse_outbox
        set sent_at=updated_at
        where status='sent' and sent_at is null;
      alter table harness_runtime.audit_events
        add column if not exists trace_id text;
      alter table harness_runtime.audit_events
        add column if not exists trace_contract_version text;
      alter table harness_runtime.decision_traces
        add column if not exists trace_contract_version text;
      alter table harness_runtime.observability_reconciliation_runs
        add column if not exists rating_event_count integer not null default 0;
      alter table harness_runtime.observability_reconciliation_runs
        add column if not exists action_usage_event_count integer not null
          default 0;
      alter table harness_runtime.observability_reconciliation_runs
        add column if not exists undelivered_event_count integer not null
          default 0;
      alter table harness_runtime.observability_reconciliation_runs
        add column if not exists completed_at timestamptz;
      alter table harness_runtime.langfuse_outbox
        drop constraint if exists langfuse_outbox_status_check;
      alter table harness_runtime.langfuse_outbox
        add constraint langfuse_outbox_status_check
        check (status in
          ('queued', 'sending', 'failed', 'sent', 'dead_letter', 'discarded'));
      update harness_runtime.langfuse_outbox
        set status='dead_letter'
        where status='failed' and dead_lettered_at is not null;

      update harness_runtime.observability_root_claims claim
      set payload=jsonb_build_object(
        'taskId', audit.payload->'taskId',
        'workspaceId', audit.payload->'workspaceId',
        'axisScope', audit.payload->'axisScope',
        'skillRevision', audit.payload->'skillRevision',
        'promptVersion', audit.payload->'promptVersion',
        'catalogRevision', audit.payload->'catalogRevision',
        'scene', audit.payload->'scene'
      )
      from harness_runtime.audit_events audit
      where claim.audit_id=audit.id
        and audit.stage='observability_event_ingest'
        and audit.event_type='agent_primitive.lifecycle'
        and audit.payload->>'axisScope'='task_root'
        and audit.payload#>>'{payload,primitiveId}' in (
          'harness-assembly:task_pin',
          'harness-assembly:event_persistence'
        );

      insert into harness_runtime.observability_root_claims
        (workflow_id, audit_id, payload, created_at)
      select distinct on (workflow_id)
        workflow_id,
        id,
        jsonb_build_object(
          'taskId', payload->'taskId',
          'workspaceId', payload->'workspaceId',
          'axisScope', payload->'axisScope',
          'skillRevision', payload->'skillRevision',
          'promptVersion', payload->'promptVersion',
          'catalogRevision', payload->'catalogRevision',
          'scene', payload->'scene'
        ),
        created_at
      from harness_runtime.audit_events
      where stage='observability_event_ingest'
        and event_type='agent_primitive.lifecycle'
        and payload->>'axisScope'='task_root'
        and payload#>>'{payload,primitiveId}' in (
          'harness-assembly:task_pin',
          'harness-assembly:event_persistence'
        )
      order by workflow_id, created_at, id
      on conflict (workflow_id) do nothing;

      insert into harness_runtime.observability_drop_events
        (audit_id, delivery_generation, signal, reason, count, source,
         occurred_at)
      select audit.id,
             coalesce(outbox.delivery_generation, 1),
             'trace',
             'permanent-config',
             1,
             'task-root-observability-conflict',
             clock_timestamp()
      from harness_runtime.audit_events audit
      join harness_runtime.observability_root_claims claim
        on claim.workflow_id=audit.workflow_id
      left join harness_runtime.langfuse_outbox outbox
        on outbox.audit_id=audit.id
      where audit.stage='observability_event_ingest'
        and audit.event_type='agent_primitive.lifecycle'
        and audit.payload->>'axisScope'='task_root'
        and audit.payload#>>'{payload,primitiveId}' in (
          'harness-assembly:task_pin',
          'harness-assembly:event_persistence'
        )
        and audit.id<>claim.audit_id
        and jsonb_build_object(
          'taskId', audit.payload->'taskId',
          'workspaceId', audit.payload->'workspaceId',
          'axisScope', audit.payload->'axisScope',
          'skillRevision', audit.payload->'skillRevision',
          'promptVersion', audit.payload->'promptVersion',
          'catalogRevision', audit.payload->'catalogRevision',
          'scene', audit.payload->'scene'
        )<>claim.payload
      on conflict (
        audit_id, delivery_generation, signal, reason, source
      ) do nothing;

      update harness_runtime.langfuse_outbox outbox
      set status='discarded', updated_at=clock_timestamp()
      from harness_runtime.audit_events audit,
           harness_runtime.observability_root_claims claim
      where outbox.audit_id=audit.id
        and claim.workflow_id=audit.workflow_id
        and audit.stage='observability_event_ingest'
        and audit.event_type='agent_primitive.lifecycle'
        and audit.payload->>'axisScope'='task_root'
        and audit.payload#>>'{payload,primitiveId}' in (
          'harness-assembly:task_pin',
          'harness-assembly:event_persistence'
        )
        and audit.id<>claim.audit_id
        and outbox.status in ('queued', 'sending', 'failed', 'dead_letter');

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
        check (resume_status in ('pending', 'sending', 'sent', 'waiting', 'invalid'));

      alter table harness_runtime.task_requests
        add column if not exists runtime_id text;
      alter table harness_runtime.task_requests
        add column if not exists billing_identity jsonb;
      alter table harness_runtime.task_requests
        add column if not exists confirmation_request_id text;
      alter table harness_runtime.task_requests
        add column if not exists successor_task_id text;
      alter table harness_runtime.task_requests
        add column if not exists admission_state text not null default 'legacy'
          check (admission_state in ('legacy', 'awaiting_confirmation', 'admitted', 'superseded'));
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
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await this.claimWithClient(client, input);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async claimInConfirmationTransaction(input: {
    transactionClient: PoolClient | null;
    taskId: string;
    fingerprint: string;
    request: HarnessWorkflowInput;
  }) {
    if (!input.transactionClient) {
      throw new Error(
        'Paid task admission requires a PostgreSQL confirmation transaction.',
      );
    }
    return this.claimWithClient(input.transactionClient, input);
  }

  private async claimWithClient(
    client: PoolClient,
    input: { taskId: string; fingerprint: string; request: HarnessWorkflowInput },
  ) {
    const runtimeTaskId = harnessRuntimeId(input.request.workspaceId, input.taskId);
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [
      LEGACY_REPLAY_ADMISSION_LOCK,
    ]);
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
      // U14: old snapshot-less durable replay is archived fail-closed.
      // Fingerprint match on a non-legacy request still resumes.
      refuseUnarchivedLegacyDurableReplay(
        row.request as HarnessWorkflowInput,
      );
      // The pre-factScope fingerprint fallback for migrated legacy runtime
      // identities retired with V31-26b (2026-08-12): no deployment ever held
      // legacy in-flight tasks (user-confirmed 2026-08-09), and the resume it
      // enabled had been red (REQUEST_FINGERPRINT_CONFLICT) since before the
      // V3.1 wave.
      return row.fingerprint === input.fingerprint
        ? { kind: 'existing' as const, workflowId: row.workflow_id, runtimeId: row.runtime_id, request: row.request as HarnessWorkflowInput }
        : { kind: 'conflict' as const };
    }
    refuseUnarchivedLegacyDurableReplay(input.request);
    if (await isLegacyReplayAdmissionSealed(client)) {
      const snapshotWorkflowId = executionPlanAdmissionWorkflowId(input.taskId, input.request);
      const admitted = await client.query<{ admitted: boolean }>(
        `select exists (
           select 1 from p1_execution_plan_snapshots snapshots
            where snapshots.workflow_id=$1 and snapshots.workspace_id=$2
              and snapshots.snapshot_hash=$3 and snapshots.payload=$4::jsonb
         ) as admitted`,
        [snapshotWorkflowId, input.request.workspaceId,
          input.request.executionPlanSnapshot?.snapshotHash ?? null,
          JSON.stringify(input.request.executionPlanSnapshot ?? null)],
      );
      if (!admitted.rows[0]?.admitted) {
        throw new Error('Legacy replay admission is closed by the recorded installation seal.');
      }
    }
    const billingIdentity = input.request.billingIdentity ?? null;
    const confirmationRequestId = input.request.executionConfirmationRequestId ?? null;
    const admissionState = input.request.pendingExecutionPlanSnapshot
      ? 'awaiting_confirmation'
      : 'admitted';
    if (input.request.pendingExecutionPlanSnapshot && (!billingIdentity || !confirmationRequestId)) {
      throw new Error('Paid task admission requires persisted billing identity and confirmation request id.');
    }
    await client.query(
      `insert into harness_runtime.task_requests
         (task_id, workflow_id, runtime_id, fingerprint, request, billing_identity,
          confirmation_request_id, admission_state)
       values ($1, $2, $1, $3, $4, $5::jsonb, $6, $7)`,
      [runtimeTaskId, input.taskId, input.fingerprint, JSON.stringify(input.request),
        billingIdentity ? JSON.stringify(billingIdentity) : null,
        confirmationRequestId, admissionState],
    );
    return { kind: 'created' as const };
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
    refuseUnarchivedLegacyDurableReplay(row.request as HarnessWorkflowInput);
    // Same V31-26b retirement as claimWithClient: exact fingerprint only.
    return row.fingerprint === input.fingerprint
      ? {
          kind: 'existing' as const,
          workflowId: row.workflow_id,
          runtimeId: row.runtime_id,
          request: row.request as HarnessWorkflowInput,
        }
      : { kind: 'conflict' as const };
  }

  async taskBelongsToWorkspace(taskId: string, workspaceId: string) {
    return (await workflowRuntimeId(this.pool, workspaceId, taskId)) !== null;
  }

  async workflowRuntimeId(workspaceId: string, workflowId: string) {
    const result = await this.pool.query<{ runtime_id: string }>(
      `select runtime_id from harness_runtime.task_requests
       where request->>'workspaceId'=$1
         and (task_id=$2 or workflow_id=$3 or request->>'sourceTaskId'=$3)
       order by created_at desc, task_id desc
       limit 1`,
      [workspaceId, harnessRuntimeId(workspaceId, workflowId), workflowId],
    );
    return result.rows[0]?.runtime_id ?? null;
  }

  async readTaskRootAxes(
    workspaceId: string,
    taskId: string,
  ): Promise<ObservabilityAxisBinding | null> {
    const result = await this.pool.query<{ root_axes: unknown }>(
      `select request#>'{executionAssembly,rootAxes}' as root_axes
       from harness_runtime.task_requests
       where request->>'workspaceId'=$1
         and (task_id=$2 or workflow_id=$3 or runtime_id=$2)
       order by created_at, task_id
       limit 1`,
      [workspaceId, harnessRuntimeId(workspaceId, taskId), taskId],
    );
    const rootAxes = result.rows[0]?.root_axes;
    if (rootAxes === undefined || rootAxes === null) return null;
    const parsed = observabilityAxisBindingSchema.parse(rootAxes);
    if (parsed.axisScope !== 'task_root') {
      throw new Error(
        'Frozen task observability axes must use task_root scope.',
      );
    }
    return parsed;
  }

  async deliveryBelongsToTask(
    workspaceId: string,
    taskId: string,
    delivery: {
      packageId: string;
      versionId: string;
      revision: number;
    },
  ) {
    const result = await this.pool.query<{ payload: unknown }>(
      `select delivered.payload
       from harness_runtime.task_requests requests
       join harness_runtime.audit_events delivered
         on delivered.workflow_id=requests.task_id
        and delivered.event_type='package_delivered'
       where requests.request->>'workspaceId'=$1
         and (requests.task_id=$2 or requests.workflow_id=$3
              or requests.runtime_id=$2)
       order by delivered.created_at desc
       limit 1`,
      [workspaceId, harnessRuntimeId(workspaceId, taskId), taskId],
    );
    const payload = result.rows[0]?.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return false;
    }
    const value = payload as Record<string, unknown>;
    return (
      value.packageId === delivery.packageId &&
      value.versionId === delivery.versionId &&
      value.revision === delivery.revision
    );
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
           where events.workflow_id in (
                   requests.task_id,
                   requests.workflow_id,
                   requests.runtime_id
                 )
             and events.event_type in (
               'package_delivered', 'workflow_failed', 'revision_conflict'
             )
         )
         and not exists (
           select 1 from harness_runtime.decision_events decisions
           where decisions.task_id=requests.task_id
             and decisions.resolution_source='core_hold_expired'
         )
         and not exists (
           select 1 from p1_creative_works works
           where works.workspace_id = requests.request->>'workspaceId'
             and works.id = requests.request->'executionSnapshot'->'work'->>'id'
             and works.payload->>'status' in ('failed', 'completed')
         )
       order by requests.created_at desc
       limit 20`,
      [workspaceId],
    );
    return result.rows.flatMap((row) => {
      const workId = row.request?.executionSnapshot?.work.id;
      const merchantText = row.request?.rawInput?.trim();
      const agentThreadId = row.request?.agentThreadId?.trim();
      const agentRunId = row.request?.agentRunId?.trim();
      const executionConfirmationRequestId =
        row.request?.executionConfirmationRequestId?.trim();
      // A run with no Composer snapshot has no conversation to return to.
      if (!workId || !merchantText) return [];
      return [
        {
          taskId: row.task_id,
          workId,
          packageId: row.request.packageId,
          ...(agentThreadId ? { agentThreadId } : {}),
          ...(agentThreadId && agentRunId ? { agentRunId } : {}),
          ...(executionConfirmationRequestId
            ? { executionConfirmationRequestId }
            : {}),
          merchantText,
          submittedAt: new Date(row.created_at).toISOString(),
        },
      ];
    });
  }

  /**
   * V31-105 §12 — the second 时间桥 handle: runs that already finished.
   *
   * `listActiveTasks` above answers "still running", which makes the recovery
   * window the run's own lifetime. A fixture video lives about six seconds, and
   * a real one is not much kinder to a merchant who reopened the tab a moment
   * late: the run left the list and no later read could ever bring it back.
   *
   * This returns the same handle for a run whose end the server recorded inside
   * `RECENTLY_COMPLETED_RESTORE_WINDOW_MINUTES`, plus which end it reached, so
   * the browser can reopen the conversation on its delivered or failed card.
   *
   * The window is measured from the *end*, not the submission: a long run that
   * finished a minute ago is exactly the one a merchant is coming back for.
   * Cancellation keeps its own exclusion for the same reason it has one above —
   * a 确认卡 whose hold expired settles as a refund and returns normally, so it
   * is not a card anyone should be handed back.
   */
  async listRecentlyCompletedTasks(workspaceId: string) {
    const result = await this.pool.query<{
      task_id: string;
      request: HarnessWorkflowInput;
      created_at: Date | string;
      event_type: string;
      completed_at: Date | string;
      payload: Record<string, unknown> | null;
    }>(
      `select requests.workflow_id as task_id,
              requests.request,
              requests.created_at,
              terminal.event_type,
              terminal.completed_at,
              terminal.payload
       from harness_runtime.task_requests requests
       join lateral (
         select events.event_type,
                events.created_at as completed_at,
                events.payload
         from harness_runtime.audit_events events
         where events.workflow_id in (
                 requests.task_id,
                 requests.workflow_id,
                 requests.runtime_id
               )
           and events.event_type in (
             'package_delivered', 'workflow_failed', 'revision_conflict'
           )
         order by events.created_at desc
         limit 1
       ) terminal on true
       where requests.request->>'workspaceId'=$1
         and requests.created_at > now() - interval '24 hours'
         and terminal.completed_at > now() - make_interval(mins => $2::int)
         and not exists (
           select 1 from harness_runtime.decision_events decisions
           where decisions.task_id=requests.task_id
             and decisions.resolution_source='core_hold_expired'
         )
       order by terminal.completed_at desc
       limit 20`,
      [workspaceId, RECENTLY_COMPLETED_RESTORE_WINDOW_MINUTES],
    );
    return result.rows.flatMap((row) => {
      const workId = row.request?.executionSnapshot?.work.id;
      const merchantText = row.request?.rawInput?.trim();
      const agentThreadId = row.request?.agentThreadId?.trim();
      const agentRunId = row.request?.agentRunId?.trim();
      const executionConfirmationRequestId =
        row.request?.executionConfirmationRequestId?.trim();
      // A run with no Composer snapshot has no conversation to return to.
      if (!workId || !merchantText) return [];
      return [
        {
          taskId: row.task_id,
          workId,
          packageId: row.request.packageId,
          ...(agentThreadId ? { agentThreadId } : {}),
          ...(agentThreadId && agentRunId ? { agentRunId } : {}),
          ...(executionConfirmationRequestId
            ? { executionConfirmationRequestId }
            : {}),
          merchantText,
          submittedAt: new Date(row.created_at).toISOString(),
          outcome:
            row.event_type === 'package_delivered'
              ? ('delivered' as const)
              : ('failed' as const),
          completedAt: new Date(row.completed_at).toISOString(),
          ...(row.event_type !== 'package_delivered' && row.payload
            ? { merchantReport: merchantFailureReport(row.payload) }
            : {}),
        },
      ];
    });
  }

  /**
   * V31-63 §37.4-E: same-thread projection source for a reprice successor's
   * pending confirmation. The browser keeps polling the original task id, so
   * the successor (a reserved admission with no suspended workflow and no
   * pending_questions row) is resolved through the durable predecessor chain:
   * superseded task request → successor_task_id → next task request, until the
   * live 'awaiting_confirmation' admission, joined to its confirmation
   * authority row. If the poll already names the successor (workflow id or
   * its own sourceTaskId — listActiveTasks returns workflow_id), resolve that
   * awaiting row directly. Decided requests are still returned (with their
   * status) so the answer path can route an already-decided confirmation to
   * its explicit start; the read path filters to 'pending'.
   */
  async readPendingSuccessorConfirmation(workspaceId: string, taskId: string) {
    const result = await this.pool.query<{
      successor_workflow_id: string;
      request: HarnessWorkflowInput;
      confirmation_status: 'pending' | 'decided';
    }>(
      `with recursive successor_chain as (
         select requests.successor_task_id, 1 as depth
         from harness_runtime.task_requests requests
         where requests.request->>'workspaceId'=$1
           and (requests.task_id=$2 or requests.workflow_id=$3
                or requests.request->>'sourceTaskId'=$3)
           and requests.admission_state='superseded'
           and requests.successor_task_id is not null
         union all
         select next.successor_task_id, chain.depth+1
         from successor_chain chain
         join harness_runtime.task_requests next
           -- V31-63: supersession stores the successor's WORKFLOW id; the
           -- registry claim namespaces task_id/runtime_id (harness.v1:…), so
           -- resolving the chain through task_id never matches a real row.
           on next.workflow_id=chain.successor_task_id
          and next.request->>'workspaceId'=$1
         where next.admission_state='superseded'
           and next.successor_task_id is not null
           and chain.depth < 8
       ),
       projected as (
         select successor.workflow_id as successor_workflow_id,
                successor.request,
                confirmation.status as confirmation_status,
                1 as prefer
         from successor_chain chain
         join harness_runtime.task_requests successor
           on successor.workflow_id=chain.successor_task_id
          and successor.request->>'workspaceId'=$1
         join p1_execution_confirmation_requests confirmation
           on confirmation.request_id=successor.confirmation_request_id
          and confirmation.workspace_id=$1
         where successor.admission_state='awaiting_confirmation'
           and confirmation.status in ('pending','decided')
         union all
         select successor.workflow_id,
                successor.request,
                confirmation.status,
                2 as prefer
         from harness_runtime.task_requests successor
         join p1_execution_confirmation_requests confirmation
           on confirmation.request_id=successor.confirmation_request_id
          and confirmation.workspace_id=$1
         where successor.request->>'workspaceId'=$1
           and successor.admission_state='awaiting_confirmation'
           and (successor.task_id=$2 or successor.workflow_id=$3
                or successor.request->>'sourceTaskId'=$3)
           and confirmation.status in ('pending','decided')
       )
       select successor_workflow_id, request, confirmation_status
       from projected
       order by prefer
       limit 1`,
      [workspaceId, harnessRuntimeId(workspaceId, taskId), taskId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const successorTaskId = row.request?.executionSnapshot?.task.id;
    const planRevision =
      row.request?.pendingExecutionPlanSnapshot?.content.planRevision;
    if (!successorTaskId || typeof planRevision !== 'number') return null;
    return {
      successorWorkflowId: row.successor_workflow_id,
      successorTaskId,
      planRevision,
      confirmationStatus: row.confirmation_status,
      request: row.request,
    };
  }

  async readTerminalFailure(workspaceId: string, workflowId: string) {
    const runtimeWorkflowId = await workflowRuntimeId(
      this.pool,
      workspaceId,
      workflowId,
    );
    const result = await this.pool.query<{ payload: Record<string, unknown> }>(
      `select payload
       from harness_runtime.audit_events
       where workflow_id = any($1::text[])
         and event_type in ('workflow_failed', 'revision_conflict')
       order by created_at desc
       limit 1`,
      [[runtimeWorkflowId, workflowId].filter((id): id is string => Boolean(id))],
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
    await new PostgresHarnessAuditStore(this.pool).appendAudit({
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
    return this.readRecommendation(workspaceId, at);
  }

  async readDailyRecommendationCandidate(workspaceId: string, at: string) {
    const timestamp = new Date(at);
    if (Number.isNaN(timestamp.getTime())) {
      throw new Error('Daily recommendation candidate time is invalid.');
    }
    const deliveredAt = timestamp.toISOString();
    return this.readRecommendation(workspaceId, deliveredAt, deliveredAt);
  }

  private async readRecommendation(
    workspaceId: string,
    at: string,
    deliveredAtOverride?: string,
  ) {
    const currentFactsRevision =
      await this.factRevisions.currentRevision(workspaceId);
    const deliveryResult = await this.pool.query<{
      task_id: string;
      request: unknown;
      delivery: unknown;
      delivered_at: Date | string;
      content_package: unknown;
    }>(
      `select coalesce(requests.runtime_id, delivery.workflow_id) as task_id,
              requests.request,
              delivery.payload as delivery,
              delivery.created_at as delivered_at,
              packages.payload as content_package
       from harness_runtime.audit_events delivery
       join p1_content_packages packages
         on packages.workspace_id=$1
        and packages.id=delivery.payload->>'packageId'
       left join harness_runtime.task_requests requests
         on requests.request->>'workspaceId'=$1
        and (
          delivery.workflow_id=requests.task_id
          or delivery.workflow_id=requests.runtime_id
        )
       where delivery.event_type='package_delivered'
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
    // D-174: the industry layer's source of truth. Reading it off the fact
    // ledger rather than the Product profile row is deliberate — the ledger is
    // the profile's canonical Core-side projection, and it is the same revision
    // the staleness check above is keyed on, so editing the industry invalidates
    // yesterday's card instead of silently re-labelling it.
    const storeIndustry = await this.readStoreProfileIndustry(workspaceId, at);
    // D-174 empty/unmapped must still hit platform then weekday. Missing
    // admin-config wiring used to drop the whole configured layer and fall
    // through to the generic winner reason.
    const recommendationRules = harnessTodayRecommendationConfigSchema.parse(
      this.adminConfig
        ? (
            await this.adminConfig.get(
              'global',
              '__global__',
              HARNESS_TODAY_RECOMMENDATION_CONFIG_KEY,
            )
          )?.value ?? DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG
        : DEFAULT_HARNESS_TODAY_RECOMMENDATION_CONFIG,
    );
    const recommendationRecord: TodayRecommendationRecord = {
      taskId: delivery.task_id,
      rawInput:
        typeof request?.rawInput === 'string'
          ? request.rawInput
          : delivery.task_id,
      deliveredAt:
        deliveredAtOverride ??
        (delivery.delivered_at instanceof Date
          ? delivery.delivered_at.toISOString()
          : new Date(delivery.delivered_at).toISOString()),
      delivery: delivery.delivery,
      contentPackage: delivery.content_package,
      intent: request?.intent,
      ...(storeIndustry ? { storeIndustry } : {}),
      recommendationRules,
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

  /**
   * The store-wide industry the merchant stated on their profile (D-174),
   * projected onto the fact ledger under `store.profile.industry`.
   *
   * Store-scoped on purpose: a service-scoped revision of this key would
   * describe one project rather than the store, and the industry layer's copy
   * ("结合本店…") speaks for the store.
   */
  private async readStoreProfileIndustry(workspaceId: string, at: string) {
    const active = await this.factRevisions.listActive({
      workspaceId,
      scope: { storeId: workspaceId },
      at,
    });
    const scoped = industryLabelFromStoreFactValue(
      active.find((fact) => fact.key === STORE_PROFILE_INDUSTRY_KEY)?.value,
    );
    if (scoped) return scoped;
    // Canonical fact id is store-wide. Read it even when the written storeId
    // is not the workspace id — otherwise a stated industry silently misses
    // the layer and the card falls through to platform/weekday/generic.
    const history = await this.factRevisions.history(
      workspaceId,
      STORE_PROFILE_INDUSTRY_FACT_ID,
    );
    const current = history
      .filter((fact) => isStoreFactActive(fact, at))
      .sort((left, right) => right.revision - left.revision)[0];
    return industryLabelFromStoreFactValue(current?.value);
  }
}

type PostgresHarnessInteractionStoreSurface = Pick<
  PostgresHarnessInteractionStore,
  keyof PostgresHarnessInteractionStore
>;
type PostgresHarnessAuditStoreSurface = Pick<
  PostgresHarnessAuditStore,
  keyof PostgresHarnessAuditStore
>;
type PostgresHarnessObservabilityStoreSurface = Pick<
  PostgresHarnessObservabilityStore,
  keyof PostgresHarnessObservabilityStore
>;

export interface PostgresHarnessStore
  extends
    PostgresHarnessInteractionStoreSurface,
    PostgresHarnessAuditStoreSurface,
    PostgresHarnessObservabilityStoreSurface {}

export class PostgresHarnessInteractionStore
  implements
    HarnessDecisionStore,
    HarnessInteractionStore,
    HarnessReservationSweepStore,
    HarnessSystemDefaultCandidateStore,
    HarnessWorkflowPersistence
{
  constructor(
    private readonly pool: Pool,
    private readonly clock: () => Date = () => new Date(),
  ) {}

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
    const interactionRequest = projection?.interactionRequest
      ? harnessInteractionRequestSchema.parse(projection.interactionRequest)
      : undefined;
    if (
      interactionRequest &&
      (interactionRequest.requestId !== parsed.questionId ||
        interactionRequest.runId !== parsed.workflowId ||
        interactionRequest.revision !== parsed.workflowRevision)
    ) {
      throw new Error(
        'Typed interaction identity must match the canonical QuestionCard.',
      );
    }
    if (
      interactionRequest?.kind === 'ask_merchant' &&
      interactionRequest.timeoutPolicy?.kind === 'semantic_default' &&
      !isCurrentAskMerchantSemanticDefault(interactionRequest)
    ) {
      throw new Error('The semantic default authority is not current.');
    }
    const proposedInteractionProjection = interactionRequest
      ? createHarnessInteractionPendingProjection(
          interactionRequest,
          'unknown',
          this.clock(),
        )
      : undefined;
    const runtimeTaskId = await requireWorkflowRuntimeId(
      this.pool,
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
      const pendingInteractionProjection = pending
        ? harnessInteractionPendingProjectionSchema.safeParse(
            pending.pending_projection,
          )
        : null;
      let frozenTimeoutSeconds =
        pendingInteractionProjection?.success === true
          ? pendingInteractionProjection.data.timer.kind === 'armed'
            ? pendingInteractionProjection.data.timer.timeoutSeconds
            : null
          : pending
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
        pendingInteractionProjection?.success !== true &&
        !proposedInteractionProjection &&
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
      if (pending && proposedInteractionProjection) {
        if (
          pendingInteractionProjection?.success &&
          fingerprintValue(pendingInteractionProjection.data.request) !==
            fingerprintValue(interactionRequest)
        ) {
          throw new TaskBlockingNodeConflictError(parsed.workflowId);
        }
        if (!pendingInteractionProjection?.success) {
          await client.query(
            `update harness_runtime.pending_questions
                set pending_projection=$2::jsonb,
                    updated_at=now()
              where task_id=$1 and status='pending'`,
            [runtimeTaskId, JSON.stringify(proposedInteractionProjection)],
          );
          frozenTimeoutSeconds =
            proposedInteractionProjection.timer.kind === 'armed'
              ? proposedInteractionProjection.timer.timeoutSeconds
              : null;
        }
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
              proposedInteractionProjection ??
                (proposedTimeoutSeconds === undefined
                  ? {}
                  : { timeoutSeconds: proposedTimeoutSeconds }),
            ),
          ],
        );
      }
      await client.query('commit');
      const frozenInteractionRequest =
        pendingInteractionProjection?.success === true
          ? pendingInteractionProjection.data.request
          : proposedInteractionProjection?.request;
      return frozenTimeoutSeconds === undefined
        ? undefined
        : {
            timeoutSeconds: frozenTimeoutSeconds,
            ...(frozenInteractionRequest
              ? { interactionRequest: frozenInteractionRequest }
              : {}),
          };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async advanceInteraction(
    workspaceId: string,
    request: HarnessInteractionRequest,
  ): ReturnType<HarnessInteractionStore['advanceInteraction']> {
    const parsed = harnessInteractionRequestSchema.parse(request);
    const runtimeTaskId = await requireWorkflowRuntimeId(
      this.pool,
      workspaceId,
      parsed.runId,
    );
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `${runtimeTaskId}:interaction`,
      ]);
      const existing = await client.query<{
        pending_projection: unknown;
        status: 'pending' | 'resolved';
      }>(
        `select pending_projection, status
           from harness_runtime.pending_questions
          where task_id=$1
          for update`,
        [runtimeTaskId],
      );
      const current = existing.rows[0];
      const currentProjection = current
        ? harnessInteractionPendingProjectionSchema.safeParse(
            current.pending_projection,
          )
        : null;
      if (
        current?.status === 'pending' &&
        currentProjection?.success &&
        fingerprintValue(currentProjection.data.request) ===
          fingerprintValue(parsed)
      ) {
        await client.query('commit');
        return { outcome: 'replayed' };
      }
      if (
        current?.status === 'pending' &&
        (!currentProjection?.success ||
          currentProjection.data.request.requestId !== parsed.requestId ||
          currentProjection.data.request.runId !== parsed.runId ||
          parsed.revision !== currentProjection.data.request.revision + 1)
      ) {
        await client.query('rollback');
        return { outcome: 'conflict' };
      }
      if (!currentProjection?.success || current?.status !== 'pending') {
        await client.query('rollback');
        return { outcome: 'conflict' };
      }
      const advancedAt = (
        await client.query<{ advanced_at: Date }>(
          'select clock_timestamp() as advanced_at',
        )
      ).rows[0]!.advanced_at;
      const advancedProjection = createHarnessInteractionPendingProjection(
        parsed,
        'unknown',
        advancedAt,
      );
      await client.query(
        `update harness_runtime.pending_questions
            set workflow_revision=$2,
                pending_projection=$3::jsonb,
                updated_at=now()
          where task_id=$1 and status='pending'`,
        [runtimeTaskId, parsed.revision, JSON.stringify(advancedProjection)],
      );
      await client.query('commit');
      return { outcome: 'advanced' };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async readPendingInteraction(
    workspaceId: string,
    runId: string,
    options?: { includeResolved?: boolean },
  ) {
    const runtimeTaskId = await workflowRuntimeId(
      this.pool,
      workspaceId,
      runId,
    );
    if (!runtimeTaskId) return null;
    const result = await this.pool.query<{ pending_projection: unknown }>(
      `select pending_projection
         from harness_runtime.pending_questions
        where task_id=$1
          and (
            $2::boolean
            or (
              status='pending'
              and coalesce(
                pending_projection->>'waitingState',
                'answer'
              ) <> 'merchant_message'
            )
          )`,
      [runtimeTaskId, options?.includeResolved === true],
    );
    const parsed = harnessInteractionPendingProjectionSchema.safeParse(
      result.rows[0]?.pending_projection,
    );
    return parsed.success ? parsed.data.request : null;
  }

  async readInteractionSnapshot(
    workspaceId: string,
    runId: string,
  ): Promise<HarnessInteractionSnapshot> {
    const runtimeTaskId = await workflowRuntimeId(
      this.pool,
      workspaceId,
      runId,
    );
    if (!runtimeTaskId) {
      return {
        request: null,
        resolutionSource: null,
        status: 'absent' as const,
      };
    }
    const result = await this.pool.query<{
      pending_projection: unknown;
      resolution_source: string | null;
      status: 'pending' | 'resolved';
    }>(
      `select questions.pending_projection,
              questions.status,
              (
                select events.resolution_source
                  from harness_runtime.decision_events events
                 where events.task_id=questions.task_id
                   and events.question_id=questions.question_id
                   and events.resolution_source in ('decision','system_default')
                 order by events.created_at, events.id
                 limit 1
              ) as resolution_source
         from harness_runtime.pending_questions questions
        where questions.task_id=$1`,
      [runtimeTaskId],
    );
    const row = result.rows[0];
    const parsed = harnessInteractionPendingProjectionSchema.safeParse(
      row?.pending_projection,
    );
    if (!row || !parsed.success) {
      return {
        request: null,
        resolutionSource: null,
        status: 'absent' as const,
      };
    }
    const resolutionSource =
      row.resolution_source === 'decision' ||
      row.resolution_source === 'system_default'
        ? row.resolution_source
        : null;
    return {
      request: parsed.data.request,
      resolutionSource: row.status === 'resolved' ? resolutionSource : null,
      status: row.status,
    };
  }

  async readWaitingInteraction(workspaceId: string, runId: string) {
    const runtimeTaskId = await workflowRuntimeId(
      this.pool,
      workspaceId,
      runId,
    );
    if (!runtimeTaskId) return null;
    const result = await this.pool.query<{ pending_projection: unknown }>(
      `select pending_projection
         from harness_runtime.pending_questions
        where task_id=$1
          and status='pending'
          and pending_projection->>'waitingState'='merchant_message'`,
      [runtimeTaskId],
    );
    const parsed = harnessInteractionPendingProjectionSchema.safeParse(
      result.rows[0]?.pending_projection,
    );
    return parsed.success ? parsed.data.request : null;
  }

  async listSystemDefaultCandidates(limit: number) {
    const result = await this.pool.query<{
      run_id: string;
      workspace_id: string;
    }>(
      `select requests.workflow_id as run_id,
              requests.request->>'workspaceId' as workspace_id
         from harness_runtime.pending_questions pending
         join harness_runtime.task_requests requests
           on requests.runtime_id=pending.task_id
        where pending.status='pending'
          and pending.pending_projection->>'kind'='harness_interaction'
          and pending.pending_projection->>'version'='2'
          and pending.pending_projection->>'waitingState'='answer'
          and pending.pending_projection->>'rendererCapability'='available'
          and pending.pending_projection#>>'{timer,kind}'='armed'
          and (
            pending.pending_projection#>>'{timer,editingStartedAt}' is null
            or (
              coalesce(
                (
                  pending.pending_projection#>>'{timer,editingLeaseExpiresAt}'
                )::timestamptz,
                (
                  pending.pending_projection#>>'{timer,editingStartedAt}'
                )::timestamptz + interval '30 seconds'
              ) <= clock_timestamp()
            )
          )
          and (
            case
              when pending.pending_projection#>>'{timer,editingStartedAt}'
                is null
              then (
                pending.pending_projection#>>'{timer,deadlineAt}'
              )::timestamptz
              else (
                pending.pending_projection#>>'{timer,deadlineAt}'
              )::timestamptz + (
                (
                  coalesce(
                    (
                      pending.pending_projection#>>'{timer,editingLeaseExpiresAt}'
                    )::timestamptz,
                    (
                      pending.pending_projection#>>'{timer,editingStartedAt}'
                    )::timestamptz + interval '30 seconds'
                  )
                ) - (
                  pending.pending_projection#>>'{timer,editingStartedAt}'
                )::timestamptz
              )
            end
          ) <= clock_timestamp()
          and coalesce(requests.request->>'workspaceId', '') <> ''
        order by pending.updated_at, pending.task_id
        limit $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      runId: row.run_id,
      workspaceId: row.workspace_id,
    }));
  }

  async resolveInteraction(
    input: Parameters<HarnessInteractionStore['resolveInteraction']>[0],
  ): ReturnType<HarnessInteractionStore['resolveInteraction']> {
    const runtimeTaskId = await requireWorkflowRuntimeId(
      this.pool,
      input.workspaceId,
      input.answer.resume.runId,
    );
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [
        `${runtimeTaskId}:interaction:${input.answer.idempotencyKey}`,
      ]);
      const existing = await client.query<{
        id: string;
        payload_fingerprint: string;
        resume_status: 'pending' | 'sending' | 'sent' | 'waiting' | 'invalid';
      }>(
        `select id, payload_fingerprint, resume_status
           from harness_runtime.decision_events
          where task_id=$1 and idempotency_key=$2`,
        [runtimeTaskId, input.answer.idempotencyKey],
      );
      if (existing.rows[0]) {
        await client.query('commit');
        if (existing.rows[0].resume_status === 'invalid') {
          return { outcome: 'unknown_state', resumeRequired: false };
        }
        return {
          outcome:
            existing.rows[0].payload_fingerprint === input.payloadFingerprint
              ? 'replayed'
              : 'idempotency_conflict',
          resumeRequired:
            existing.rows[0].resume_status !== 'sent' &&
            existing.rows[0].resume_status !== 'waiting',
          eventId: existing.rows[0].id,
        };
      }
      const pending = await client.query<{
        question_id: string;
        pending_projection: unknown;
        status: 'pending' | 'resolved';
        workflow_revision: string;
      }>(
        `select question_id, workflow_revision::text as workflow_revision,
                pending_projection, status
           from harness_runtime.pending_questions
          where task_id=$1
          for update`,
        [runtimeTaskId],
      );
      const node = pending.rows[0];
      if (
        !node ||
        node.status !== 'pending' ||
        node.question_id !== input.answer.requestId
      ) {
        await client.query('rollback');
        return { outcome: 'stale_request', resumeRequired: false };
      }
      if (Number(node.workflow_revision) !== input.answer.revision) {
        await client.query('rollback');
        return { outcome: 'stale_revision', resumeRequired: false };
      }
      if (input.trigger === 'system_default') {
        const projection = harnessInteractionPendingProjectionSchema.safeParse(
          node.pending_projection,
        );
        if (!projection.success) {
          await client.query('rollback');
          return { outcome: 'unknown_state', resumeRequired: false };
        }
        const timeoutPolicy =
          projection.data.request.kind === 'ask_merchant'
            ? projection.data.request.timeoutPolicy
            : projection.data.request.frozen.timeoutPolicy;
        if (
          timeoutPolicy?.kind !== 'semantic_default' ||
          projection.data.request.kind !== 'ask_merchant' ||
          !isCurrentAskMerchantSemanticDefault(projection.data.request) ||
          fingerprintValue(input.answer.response) !==
            timeoutPolicy.eligibility.defaultResponseFingerprint
        ) {
          await client.query('rollback');
          return { outcome: 'ineligible', resumeRequired: false };
        }
        if (projection.data.timer.kind !== 'armed') {
          await client.query('rollback');
          return { outcome: 'ineligible', resumeRequired: false };
        }
        if (projection.data.rendererCapability !== 'available') {
          await client.query('rollback');
          return {
            outcome: 'renderer_unavailable',
            resumeRequired: false,
          };
        }
        const databaseNow = (
          await client.query<{ current_time: Date }>(
            'select clock_timestamp() as current_time',
          )
        ).rows[0]!.current_time;
        if (projection.data.timer.editingStartedAt !== null) {
          const editingStartedAt = Date.parse(
            projection.data.timer.editingStartedAt,
          );
          const leaseExpiresAt =
            projection.data.timer.editingLeaseExpiresAt ??
            new Date(editingStartedAt + 30_000).toISOString();
          if (databaseNow.getTime() < Date.parse(leaseExpiresAt)) {
            await client.query('rollback');
            return { outcome: 'editing', resumeRequired: false };
          }
          const pausedFor =
            Date.parse(leaseExpiresAt) -
            Date.parse(projection.data.timer.editingStartedAt);
          if (!Number.isFinite(pausedFor) || pausedFor < 0) {
            await client.query('rollback');
            return { outcome: 'unknown_state', resumeRequired: false };
          }
          projection.data.timer.deadlineAt = new Date(
            Date.parse(projection.data.timer.deadlineAt) + pausedFor,
          ).toISOString();
          projection.data.timer.editingStartedAt = null;
          projection.data.timer.editingLeaseExpiresAt = null;
          projection.data.timer.editingSessionId = null;
          await client.query(
            `update harness_runtime.pending_questions
                set pending_projection=$2::jsonb,
                    updated_at=now()
              where task_id=$1 and status='pending'`,
            [runtimeTaskId, JSON.stringify(projection.data)],
          );
        }
        if (
          databaseNow.getTime() < Date.parse(projection.data.timer.deadlineAt)
        ) {
          await client.query('rollback');
          return { outcome: 'not_due', resumeRequired: false };
        }
      }
      const typedProjection =
        harnessInteractionPendingProjectionSchema.safeParse(
          node.pending_projection,
        );
      if (
        input.trigger === 'merchant_message' &&
        (!typedProjection.success ||
          typedProjection.data.waitingState !== 'merchant_message' ||
          typedProjection.data.request.kind !== 'execution_confirmation' ||
          typedProjection.data.request.requestId !== input.answer.requestId ||
          typedProjection.data.request.revision !== input.answer.revision ||
          typedProjection.data.request.step !== input.answer.resume.step ||
          input.carrier === undefined ||
          !(
            typedProjection.data.request.presentation
              .carriers as readonly string[]
          ).includes(input.carrier))
      ) {
        await client.query('rollback');
        return { outcome: 'unknown_state', resumeRequired: false };
      }
      if (
        input.trigger === 'merchant' &&
        typedProjection.success &&
        typedProjection.data.waitingState === 'merchant_message'
      ) {
        await client.query('rollback');
        return { outcome: 'unknown_state', resumeRequired: false };
      }
      const logicalEventId = `interaction-event-${input.answer.idempotencyKey}`;
      const runtimeEventId = runtimeObjectId(
        input.workspaceId,
        input.answer.resume.runId,
        runtimeTaskId,
        logicalEventId,
      );
      await client.query(
        `insert into harness_runtime.decision_events
           (id, task_id, question_id, workflow_revision, idempotency_key,
            payload_fingerprint, payload, resolution_source, resume_status)
         values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
        [
          runtimeEventId,
          runtimeTaskId,
          input.answer.requestId,
          input.answer.revision,
          input.answer.idempotencyKey,
          input.payloadFingerprint,
          JSON.stringify({
            kind: 'harness_interaction_resolution',
            schemaVersion: 'v1',
            interactionKind: interactionKind(input.answer),
            answer: input.answer,
            resumeData: input.resumeData,
            resolutionSource: input.resolutionSource,
          }),
          input.resolutionSource,
          input.resumeDisposition === 'wait' ? 'waiting' : 'pending',
        ],
      );
      await writeAuditAndOutbox(
        client,
        {
          workspaceId: input.workspaceId,
          id: `audit-${logicalEventId}`,
          workflowId: input.answer.resume.runId,
          stage: input.answer.resume.step,
          eventType: 'harness_interaction_resolved',
          payload: {
            requestId: input.answer.requestId,
            resolutionSource: input.resolutionSource,
            revision: input.answer.revision,
          },
        },
        runtimeTaskId,
      );
      await client.query(
        `update harness_runtime.pending_questions
            set status=case when $2='wait' then 'pending' else 'resolved' end,
                pending_projection=case
                  when $2='wait' then jsonb_set(
                    pending_projection,
                    '{waitingState}',
                    '"merchant_message"'::jsonb,
                    true
                  )
                  else pending_projection
                end,
                updated_at=now()
          where task_id=$1`,
        [runtimeTaskId, input.resumeDisposition],
      );
      await client.query('commit');
      return {
        outcome: 'created',
        resumeRequired: input.resumeDisposition === 'resume',
        eventId: runtimeEventId,
      };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async transitionInteractionEditing(
    workspaceId: string,
    runId: string,
    input: Parameters<
      HarnessInteractionStore['transitionInteractionEditing']
    >[2],
  ): ReturnType<HarnessInteractionStore['transitionInteractionEditing']> {
    const runtimeTaskId = await workflowRuntimeId(
      this.pool,
      workspaceId,
      runId,
    );
    if (!runtimeTaskId) return 'stale';
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await client.query<{ pending_projection: unknown }>(
        `select pending_projection
           from harness_runtime.pending_questions
          where task_id=$1 and status='pending'
          for update`,
        [runtimeTaskId],
      );
      const projection = harnessInteractionPendingProjectionSchema.safeParse(
        result.rows[0]?.pending_projection,
      );
      if (!projection.success) {
        await client.query('rollback');
        return result.rows[0] ? 'unknown_state' : 'stale';
      }
      if (
        projection.data.request.requestId !== input.requestId ||
        projection.data.request.revision !== input.revision ||
        projection.data.request.step !== input.step ||
        !(
          projection.data.request.presentation.carriers as readonly string[]
        ).includes(input.carrier)
      ) {
        await client.query('rollback');
        return 'stale';
      }
      const timeoutPolicy =
        projection.data.request.kind === 'ask_merchant'
          ? projection.data.request.timeoutPolicy
          : projection.data.request.frozen.timeoutPolicy;
      if (timeoutPolicy?.kind !== 'semantic_default') {
        await client.query('commit');
        return 'replayed';
      }
      if (projection.data.timer.kind !== 'armed') {
        await client.query('rollback');
        return 'unknown_state';
      }
      const current = projection.data.timer.editingStartedAt;
      if (!input.editing && current === null) {
        await client.query('commit');
        return 'replayed';
      }
      const transitionAt = (
        await client.query<{ transition_at: Date }>(
          'select clock_timestamp() as transition_at',
        )
      ).rows[0]!.transition_at.getTime();
      const editingStartedAt = current === null ? null : Date.parse(current);
      const leaseExpiresAt =
        projection.data.timer.editingLeaseExpiresAt === undefined ||
        projection.data.timer.editingLeaseExpiresAt === null
          ? editingStartedAt === null || !Number.isFinite(editingStartedAt)
            ? null
            : editingStartedAt + 30_000
          : Date.parse(projection.data.timer.editingLeaseExpiresAt);
      if (input.editing) {
        if (
          current !== null &&
          leaseExpiresAt !== null &&
          leaseExpiresAt > transitionAt &&
          projection.data.timer.editingSessionId !== input.editingSessionId
        ) {
          await client.query('rollback');
          return 'stale';
        }
        if (
          current === null ||
          leaseExpiresAt === null ||
          leaseExpiresAt <= transitionAt
        ) {
          if (
            current !== null &&
            editingStartedAt !== null &&
            leaseExpiresAt !== null
          ) {
            projection.data.timer.deadlineAt = new Date(
              Date.parse(projection.data.timer.deadlineAt) +
                leaseExpiresAt -
                editingStartedAt,
            ).toISOString();
          }
          projection.data.timer.editingStartedAt = new Date(
            transitionAt,
          ).toISOString();
          projection.data.timer.editingSessionId = input.editingSessionId;
        }
        projection.data.timer.editingLeaseExpiresAt = new Date(
          transitionAt + 30_000,
        ).toISOString();
      } else {
        if (projection.data.timer.editingSessionId !== input.editingSessionId) {
          await client.query('rollback');
          return 'stale';
        }
        const editingStartedAt = Date.parse(current!);
        const deadlineAt = Date.parse(projection.data.timer.deadlineAt);
        const pauseEndedAt =
          leaseExpiresAt === null
            ? transitionAt
            : Math.min(transitionAt, leaseExpiresAt);
        if (
          !Number.isFinite(editingStartedAt) ||
          !Number.isFinite(deadlineAt) ||
          pauseEndedAt < editingStartedAt
        ) {
          await client.query('rollback');
          return 'unknown_state';
        }
        projection.data.timer.deadlineAt = new Date(
          deadlineAt + pauseEndedAt - editingStartedAt,
        ).toISOString();
        projection.data.timer.editingStartedAt = null;
        projection.data.timer.editingLeaseExpiresAt = null;
        projection.data.timer.editingSessionId = null;
      }
      await client.query(
        `update harness_runtime.pending_questions
            set pending_projection=$2::jsonb,
                updated_at=now()
          where task_id=$1 and status='pending'`,
        [runtimeTaskId, JSON.stringify(projection.data)],
      );
      await client.query('commit');
      return 'updated';
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async ackInteractionRenderer(
    workspaceId: string,
    runId: string,
    acknowledgement: Parameters<
      HarnessInteractionStore['ackInteractionRenderer']
    >[2],
  ) {
    const runtimeTaskId = await workflowRuntimeId(
      this.pool,
      workspaceId,
      runId,
    );
    if (!runtimeTaskId) return 'stale' as const;
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const current = await client.query<{
        pending_projection: unknown;
        status: string;
      }>(
        `select pending_projection, status
           from harness_runtime.pending_questions
          where task_id=$1 for update`,
        [runtimeTaskId],
      );
      const row = current.rows[0];
      if (!row || row.status !== 'pending') {
        await client.query('rollback');
        return 'stale' as const;
      }
      const projection = harnessInteractionPendingProjectionSchema.safeParse(
        row.pending_projection,
      );
      if (!projection.success) {
        await client.query('rollback');
        return 'unknown_state' as const;
      }
      if (
        projection.data.request.requestId !== acknowledgement.requestId ||
        projection.data.request.revision !== acknowledgement.revision ||
        projection.data.request.step !== acknowledgement.step ||
        !(
          projection.data.request.presentation.carriers as readonly string[]
        ).includes(acknowledgement.carrier)
      ) {
        await client.query('rollback');
        return 'stale' as const;
      }
      if (projection.data.rendererCapability === 'available') {
        await client.query('commit');
        return 'replayed' as const;
      }
      if (projection.data.rendererCapability !== 'unknown') {
        await client.query('rollback');
        return 'unknown_state' as const;
      }
      const acknowledgedAt = (
        await client.query<{ acknowledged_at: Date }>(
          'select clock_timestamp() as acknowledged_at',
        )
      ).rows[0]!.acknowledged_at;
      projection.data.rendererCapability = 'available';
      projection.data.rendererAckedAt = acknowledgedAt.toISOString();
      if (projection.data.timer.kind === 'armed') {
        projection.data.timer.deadlineAt = new Date(
          acknowledgedAt.getTime() +
            projection.data.timer.timeoutSeconds * 1_000,
        ).toISOString();
        if (projection.data.timer.editingStartedAt !== null) {
          projection.data.timer.editingStartedAt = acknowledgedAt.toISOString();
          projection.data.timer.editingLeaseExpiresAt = new Date(
            acknowledgedAt.getTime() + 30_000,
          ).toISOString();
        }
      }
      await client.query(
        `update harness_runtime.pending_questions
            set pending_projection=$2::jsonb,
                updated_at=now()
          where task_id=$1 and status='pending'`,
        [runtimeTaskId, JSON.stringify(projection.data)],
      );
      await client.query('commit');
      return 'acked' as const;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async expireUnrenderedInteraction(
    workspaceId: string,
    runId: string,
    identity: Parameters<
      HarnessInteractionStore['expireUnrenderedInteraction']
    >[2],
  ) {
    const runtimeTaskId = await workflowRuntimeId(
      this.pool,
      workspaceId,
      runId,
    );
    if (!runtimeTaskId) return 'stale' as const;
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const current = await client.query<{
        pending_projection: unknown;
        status: 'pending' | 'resolved';
      }>(
        `select pending_projection, status
           from harness_runtime.pending_questions
          where task_id=$1
          for update`,
        [runtimeTaskId],
      );
      const row = current.rows[0];
      if (!row) {
        await client.query('rollback');
        return 'stale' as const;
      }
      const projection = harnessInteractionPendingProjectionSchema.safeParse(
        row.pending_projection,
      );
      if (!projection.success) {
        await client.query('rollback');
        return 'unknown_state' as const;
      }
      if (
        projection.data.request.requestId !== identity.requestId ||
        projection.data.request.revision !== identity.revision ||
        projection.data.request.step !== identity.step
      ) {
        await client.query('rollback');
        return 'stale' as const;
      }
      if (row.status === 'resolved') {
        await client.query('commit');
        return projection.data.rendererCapability === 'unavailable'
          ? ('replayed' as const)
          : ('stale' as const);
      }
      if (projection.data.rendererCapability === 'available') {
        await client.query('commit');
        return 'available' as const;
      }
      if (projection.data.rendererCapability !== 'unknown') {
        await client.query('rollback');
        return 'unknown_state' as const;
      }

      projection.data.rendererCapability = 'unavailable';
      projection.data.rendererAckedAt = null;
      await client.query(
        `update harness_runtime.pending_questions
            set status='resolved',
                pending_projection=$2::jsonb,
                updated_at=now()
          where task_id=$1 and status='pending'`,
        [runtimeTaskId, JSON.stringify(projection.data)],
      );
      await writeAuditAndOutbox(
        client,
        {
          workspaceId,
          id: `audit-${identity.requestId}-renderer-expired-r${identity.revision}`,
          workflowId: runId,
          stage: identity.step,
          eventType: 'harness_interaction_renderer_expired',
          payload: {
            requestId: identity.requestId,
            revision: identity.revision,
          },
        },
        runtimeTaskId,
      );
      await client.query('commit');
      return 'expired' as const;
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
    const runtimeTaskId = await workflowRuntimeId(
      this.pool,
      workspaceId,
      taskId,
    );
    if (!runtimeTaskId) return null;
    const result = await this.pool.query<{ payload: unknown }>(
      `select payload from harness_runtime.pending_questions
       where task_id=$1 and ($2::boolean or status='pending')`,
      [runtimeTaskId, options?.includeResolved === true],
    );
    return result.rows[0] ? pendingQuestionCard(result.rows[0].payload) : null;
  }

  async readDecisionTarget(workspaceId: string, taskId: string) {
    const runtimeTaskId = await workflowRuntimeId(
      this.pool,
      workspaceId,
      taskId,
    );
    if (!runtimeTaskId) return null;
    const result = await this.pool.query<{
      pending_projection: unknown;
      payload: unknown;
      request: HarnessWorkflowInput;
      reservation_released: boolean;
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
                exists (
                  select 1
                    from harness_runtime.reservation_sweeps sweeps
                   where sweeps.workspace_id=$2
                     and sweeps.task_id=requests.workflow_id
                     and sweeps.status='completed'
                )
                -- Post-refund crash window: billing already left 'reserved'
                -- but the sweep row has not reached 'completed' yet. The
                -- resume fence must match the reconciler's derivation.
                or exists (
                  select 1
                    from p1_product_billing_usage usage
                   where usage.workspace_id=$2
                     and usage.task_id=requests.billing_identity->>'taskId'
                     and usage.status<>'reserved'
                )
              ) as reservation_released,
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
      [runtimeTaskId, workspaceId],
    );
    const row = result.rows[0];
    const interactionProjection = row
      ? harnessInteractionPendingProjectionSchema.safeParse(
          row.pending_projection,
        )
      : null;
    if (
      interactionProjection?.success &&
      interactionProjection.data.request.kind !== 'execution_confirmation'
    ) {
      return null;
    }
    const timeoutSeconds = row
      ? pendingDecisionTimeoutSeconds(row.pending_projection)
      : undefined;
    return row
      ? {
          question: questionCardSchema.parse(row.payload),
          request: row.request,
          resolutionSource: row.resolution_source,
          reservationReleased: row.reservation_released,
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
          and coalesce(
                questions.pending_projection
                  #>>'{request,presentation,notification}',
                questions.payload->'presentation'->>'notification',
                ''
              ) <> 'none'
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

  async claimBatch(input: {
    expiresBefore: string;
    limit: number;
    taskId?: string;
    workspaceId?: string;
  }): Promise<HarnessReservationSweep[]> {
    const hasWorkspace = input.workspaceId !== undefined;
    const hasTask = input.taskId !== undefined;
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      !Number.isFinite(Date.parse(input.expiresBefore)) ||
      hasWorkspace !== hasTask ||
      (hasWorkspace &&
        (!input.workspaceId?.trim() || !input.taskId?.trim()))
    ) {
      throw new Error(
        'Reservation sweep claim requires a valid limit and timestamp.',
      );
    }
    const result = await this.pool.query<{
      attempts: number;
      billing_identity: unknown;
      billing_task_id: string;
      held_since: Date | string;
      question_id: string;
      quote_id: string;
      quote_revision: string;
      reserved_units: unknown;
      task_id: string;
      usage_reservation_id: string;
      workspace_id: string;
    }>(
      `with valid_stale as (
         select sweeps.workspace_id, sweeps.task_id
           from harness_runtime.reservation_sweeps sweeps
           join harness_runtime.task_requests requests
             on requests.runtime_id=sweeps.runtime_id
            and requests.workflow_id=sweeps.task_id
            and requests.request->>'workspaceId'=sweeps.workspace_id
            and requests.request#>>'{usageReservation,id}'=
                  sweeps.usage_reservation_id
            and requests.billing_identity->>'taskId'=sweeps.billing_task_id
           join p1_product_billing_usage usage
             on usage.workspace_id=sweeps.workspace_id
            and usage.usage_id=sweeps.usage_reservation_id
            and usage.task_id=sweeps.billing_task_id
            and usage.quote_id=sweeps.quote_id
           join p1_product_billing_quotes quotes
             on quotes.workspace_id=usage.workspace_id
            and quotes.quote_id=usage.quote_id
            and quotes.task_id=usage.task_id
            and quotes.payload->>'revision'=sweeps.quote_revision
          where requests.billing_identity#>>'{quoteRef,id}'=sweeps.quote_id
            and requests.billing_identity#>>'{quoteRef,revision}'=sweeps.quote_revision
       ), orphan_candidates as (
         select sweeps.workspace_id, sweeps.task_id
           from harness_runtime.reservation_sweeps sweeps
          where (
                  (
                    sweeps.status='processing'
                    and sweeps.updated_at < now() - interval '1 minute'
                  )
                  or (
                    sweeps.status='failed'
                    and sweeps.next_attempt_at <= now()
                  )
                )
            and (
              $4::text is null
              or (sweeps.workspace_id=$4 and sweeps.task_id=$5)
            )
            and not exists (
              select 1
                from valid_stale valid
               where valid.workspace_id=sweeps.workspace_id
                 and valid.task_id=sweeps.task_id
            )
          order by sweeps.updated_at, sweeps.task_id
          limit $2
          for update skip locked
       ), orphaned_stale as (
         update harness_runtime.reservation_sweeps sweeps
            set status='dead_letter',
                dead_lettered_at=coalesce(dead_lettered_at, now()),
                last_error='Reservation sweep workflow authority is unavailable.',
                updated_at=now()
           from orphan_candidates candidates
          where sweeps.workspace_id=candidates.workspace_id
            and sweeps.task_id=candidates.task_id
         returning sweeps.workspace_id, sweeps.task_id,
                   sweeps.billing_task_id, sweeps.question_id,
                   sweeps.quote_id, sweeps.usage_reservation_id,
                   sweeps.attempts
       ), orphan_audit as (
         insert into p1_operations_audit_events
           (workspace_id, id, payload, updated_at)
         select orphaned.workspace_id,
                'product_usage.reservation_release_orphan_dead_letter:'
                  || orphaned.task_id,
                jsonb_build_object(
                  'action',
                    'product_usage.reservation_release_orphan_dead_letter',
                  'actorId', 'reservation-sweeper',
                  'correlationId', 'reservation-sweep:' || orphaned.task_id,
                  'createdAt', now(),
                  'details', jsonb_build_object(
                    'attempts', orphaned.attempts,
                    'billingTaskId', orphaned.billing_task_id,
                    'error',
                      'Reservation sweep workflow authority is unavailable.',
                    'questionId', orphaned.question_id,
                    'quoteId', orphaned.quote_id,
                    'usageReservationId', orphaned.usage_reservation_id
                  ),
                  'entityId', orphaned.task_id,
                  'entityType', 'product_usage_reservation',
                  'id',
                    'product_usage.reservation_release_orphan_dead_letter:'
                      || orphaned.task_id,
                  'workspaceId', orphaned.workspace_id
                ),
                now()
           from orphaned_stale orphaned
         on conflict (workspace_id, id) do nothing
         returning id
       ), new_ready as (
         select requests.request->>'workspaceId' as workspace_id,
                requests.workflow_id as task_id,
                usage.task_id as billing_task_id,
                requests.runtime_id,
                questions.question_id,
                questions.updated_at as held_since,
                quotes.quote_id,
                quotes.payload->>'revision' as quote_revision,
                usage.usage_id as usage_reservation_id,
                coalesce(
                  usage.payload->'reservedUnits',
                  jsonb_build_array(jsonb_build_object(
                    'resource', usage.payload->>'resource',
                    'quantity', (usage.payload->>'reservedQuantity')::integer
                  ))
                ) as reserved_units,
                requests.billing_identity as billing_identity
           from harness_runtime.pending_questions questions
           join harness_runtime.task_requests requests
             on requests.runtime_id=questions.task_id
           join p1_product_billing_usage usage
             on usage.workspace_id=requests.request->>'workspaceId'
            and usage.usage_id=nullif(
              requests.request#>>'{usageReservation,id}',
              ''
            )
            and usage.task_id=requests.billing_identity->>'taskId'
            and usage.quote_id=requests.billing_identity#>>'{quoteRef,id}'
           join p1_product_billing_quotes quotes
             on quotes.workspace_id=usage.workspace_id
            and quotes.quote_id=usage.quote_id
            and quotes.task_id=usage.task_id
            and quotes.payload->>'revision'=requests.billing_identity#>>'{quoteRef,revision}'
           left join harness_runtime.reservation_sweeps sweeps
             on sweeps.workspace_id=usage.workspace_id
            and sweeps.task_id=requests.workflow_id
          where questions.status='pending'
            and coalesce(questions.payload->>'unattended', 'hold')='hold'
            and questions.updated_at <= $1::timestamptz
            and (
              $4::text is null
              or (
                usage.workspace_id=$4
                and requests.workflow_id=$5
              )
            )
            and requests.request ? 'usageReservation'
            and requests.admission_state='awaiting_confirmation'
            and requests.billing_identity is not null
            and usage.status='reserved'
            and quotes.lifecycle_status='reserved'
            and (
              sweeps.task_id is null
              or (
                sweeps.status='failed'
                and sweeps.billing_task_id=usage.task_id
                and sweeps.attempts < $3
                and sweeps.next_attempt_at <= now()
              )
            )
          order by questions.updated_at, requests.workflow_id
          limit $2
          for update of questions skip locked
       ), stale_ready as (
         select sweeps.workspace_id, sweeps.task_id, sweeps.billing_task_id,
                sweeps.runtime_id, sweeps.question_id, sweeps.held_since,
                sweeps.quote_id, sweeps.quote_revision,
                sweeps.usage_reservation_id, sweeps.reserved_units,
                sweeps.billing_identity
           from harness_runtime.reservation_sweeps sweeps
          where sweeps.status='processing'
            and sweeps.updated_at < now() - interval '1 minute'
            and (
              $4::text is null
              or (sweeps.workspace_id=$4 and sweeps.task_id=$5)
            )
            and exists (
              select 1
                from valid_stale valid
               where valid.workspace_id=sweeps.workspace_id
                 and valid.task_id=sweeps.task_id
            )
          order by sweeps.updated_at, sweeps.task_id
          limit $2
          for update skip locked
       ), ready as (
         select * from new_ready
         union all
         select * from stale_ready
         order by held_since, task_id
         limit $2
       ), claimed as (
         insert into harness_runtime.reservation_sweeps
           (workspace_id, task_id, billing_task_id, runtime_id, question_id,
            quote_id, quote_revision, usage_reservation_id, reserved_units,
            billing_identity, held_since, reason, status)
         select workspace_id, task_id, billing_task_id, runtime_id, question_id,
                quote_id, quote_revision, usage_reservation_id, reserved_units,
                billing_identity, held_since, 'hold_reservation_ttl_elapsed',
                'processing'
           from ready
         on conflict (workspace_id, task_id) do update
           set status='processing',
               attempts=harness_runtime.reservation_sweeps.attempts+1,
               last_error=null,
               updated_at=now()
         where harness_runtime.reservation_sweeps.status in ('processing','failed')
           and (
             (
               harness_runtime.reservation_sweeps.status='processing'
               and harness_runtime.reservation_sweeps.updated_at
                 < now() - interval '1 minute'
             )
             or (
               harness_runtime.reservation_sweeps.status='failed'
               and harness_runtime.reservation_sweeps.attempts < $3
               and harness_runtime.reservation_sweeps.next_attempt_at <= now()
             )
           )
         returning workspace_id, task_id, billing_task_id, runtime_id,
                   question_id, quote_id, quote_revision,
                   usage_reservation_id, reserved_units, billing_identity,
                   held_since, attempts
        )
       select * from claimed order by held_since, task_id`,
      [
        input.expiresBefore,
        input.limit,
        MAX_RESERVATION_SWEEP_ATTEMPTS,
        input.workspaceId ?? null,
        input.taskId ?? null,
      ],
    );
    const sweeps: HarnessReservationSweep[] = [];
    for (const row of result.rows) {
      try {
        const billingIdentity = parseSweepBillingIdentity(row.billing_identity);
        assertSweepBillingIdentityMatchesRow(row, billingIdentity);
        sweeps.push({
          workspaceId: row.workspace_id,
          taskId: row.task_id,
          billingTaskId: row.billing_task_id,
          billingIdentity,
          quoteId: row.quote_id,
          quoteRevision: row.quote_revision,
          questionId: row.question_id,
          usageReservationId: row.usage_reservation_id,
          reservedUnits: reservationUnits(row.reserved_units),
          heldSince:
            row.held_since instanceof Date
              ? row.held_since.toISOString()
              : new Date(row.held_since).toISOString(),
          reason: 'hold_reservation_ttl_elapsed',
          attempts: row.attempts,
        });
      } catch (error) {
        await this.deadLetterMalformedReservationSweep(
          row.workspace_id,
          row.task_id,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    return sweeps;
  }

  private async deadLetterMalformedReservationSweep(
    workspaceId: string,
    taskId: string,
    error: string,
  ) {
    await this.pool.query(
      `update harness_runtime.reservation_sweeps
          set status='dead_letter',
              dead_lettered_at=coalesce(dead_lettered_at, now()),
              last_error=$3,
              updated_at=now()
        where workspace_id=$1 and task_id=$2 and status='processing'`,
      [workspaceId, taskId, error.slice(0, 2_000)],
    );
  }

  async markCompleted(input: HarnessReservationSweep) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const updated = await client.query(
        `update harness_runtime.reservation_sweeps
            set status='completed',
                completed_at=coalesce(completed_at, now()),
                last_error=null,
                updated_at=now()
          where workspace_id=$1 and task_id=$2
            and status in ('processing', 'completed')
          returning runtime_id`,
        [input.workspaceId, input.taskId],
      );
      const runtimeId = (updated.rows[0] as { runtime_id?: string } | undefined)
        ?.runtime_id;
      if (!runtimeId) {
        throw new Error('Reservation sweep claim was not found.');
      }
      await writeAuditAndOutbox(
        client,
        {
          workspaceId: input.workspaceId,
          id: `audit-${input.taskId}-reservation-released`,
          workflowId: input.taskId,
          stage: 'product_billing',
          eventType: 'product_usage_reservation_released',
          payload: {
            attempts: input.attempts,
            heldSince: input.heldSince,
            holdStillPending: true,
            questionId: input.questionId,
            quoteId: input.quoteId,
            reason: input.reason,
            reservedUnits: input.reservedUnits,
            usageReservationId: input.usageReservationId,
          },
        },
        runtimeId,
      );
      const operationsAuditId = `product_usage.reservation_released:${input.taskId}`;
      const occurredAt = new Date().toISOString();
      await client.query(
        `insert into p1_operations_audit_events
           (workspace_id, id, payload, updated_at)
         values ($1,$2,$3::jsonb,$4::timestamptz)
         on conflict (workspace_id, id) do nothing`,
        [
          input.workspaceId,
          operationsAuditId,
          JSON.stringify({
            action: 'product_usage.reservation_released',
            actorId: 'reservation-sweeper',
            correlationId: `reservation-sweep:${input.taskId}`,
            createdAt: occurredAt,
            details: {
              attempts: input.attempts,
              heldSince: input.heldSince,
              holdStillPending: true,
              questionId: input.questionId,
              quoteId: input.quoteId,
              reason: input.reason,
              reservedUnits: input.reservedUnits,
              usageReservationId: input.usageReservationId,
            },
            entityId: input.taskId,
            entityType: 'product_usage_reservation',
            id: operationsAuditId,
            workspaceId: input.workspaceId,
          }),
          occurredAt,
        ],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async markFailed(
    input: HarnessReservationSweep,
    error: string,
    phase: 'completion' | 'refund',
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const updated = await client.query<{ status: string }>(
        `update harness_runtime.reservation_sweeps
            set status=case
                  when $4='refund'
                   and exists (
                     select 1
                       from p1_product_billing_usage usage
                       join p1_product_billing_quotes quotes
                         on quotes.workspace_id=usage.workspace_id
                        and quotes.quote_id=usage.quote_id
                      where usage.workspace_id=$1
                        and usage.task_id=$6
                        and usage.status='reserved'
                        and quotes.lifecycle_status='reserved'
                   )
                  then case
                    when attempts >= $5 then 'dead_letter'
                    else 'failed'
                  end
                  else 'processing'
                end,
                next_attempt_at=case
                  when $4='refund'
                   and attempts < $5
                   and exists (
                     select 1
                       from p1_product_billing_usage usage
                       join p1_product_billing_quotes quotes
                         on quotes.workspace_id=usage.workspace_id
                        and quotes.quote_id=usage.quote_id
                      where usage.workspace_id=$1
                        and usage.task_id=$6
                        and usage.status='reserved'
                        and quotes.lifecycle_status='reserved'
                   )
                  then now() + (
                    least(3600, 60 * power(2, greatest(attempts - 1, 0)))
                    * interval '1 second'
                  )
                  else next_attempt_at
                end,
                dead_lettered_at=case
                  when $4='refund'
                   and attempts >= $5
                   and exists (
                     select 1
                       from p1_product_billing_usage usage
                       join p1_product_billing_quotes quotes
                         on quotes.workspace_id=usage.workspace_id
                        and quotes.quote_id=usage.quote_id
                      where usage.workspace_id=$1
                        and usage.task_id=$6
                        and usage.status='reserved'
                        and quotes.lifecycle_status='reserved'
                   )
                  then coalesce(dead_lettered_at, now())
                  else dead_lettered_at
                end,
                last_error=$3,
                updated_at=now()
          where workspace_id=$1 and task_id=$2 and status='processing'
          returning status`,
        [
          input.workspaceId,
          input.taskId,
          error.slice(0, 2_000),
          phase,
          MAX_RESERVATION_SWEEP_ATTEMPTS,
          input.billingTaskId,
        ],
      );
      if (updated.rows[0]?.status === 'dead_letter') {
        const operationsAuditId = `product_usage.reservation_release_dead_letter:${input.taskId}`;
        const occurredAt = new Date().toISOString();
        await client.query(
          `insert into p1_operations_audit_events
             (workspace_id, id, payload, updated_at)
           values ($1,$2,$3::jsonb,$4::timestamptz)
           on conflict (workspace_id, id) do nothing`,
          [
            input.workspaceId,
            operationsAuditId,
            JSON.stringify({
              action: 'product_usage.reservation_release_dead_letter',
              actorId: 'reservation-sweeper',
              correlationId: `reservation-sweep:${input.taskId}`,
              createdAt: occurredAt,
              details: {
                attempts: input.attempts,
                error: error.slice(0, 2_000),
                phase,
                questionId: input.questionId,
                quoteId: input.quoteId,
                usageReservationId: input.usageReservationId,
              },
              entityId: input.taskId,
              entityType: 'product_usage_reservation',
              id: operationsAuditId,
              workspaceId: input.workspaceId,
            }),
            occurredAt,
          ],
        );
      }
      await client.query('commit');
    } catch (failure) {
      await client.query('rollback');
      throw failure;
    } finally {
      client.release();
    }
  }

  async submit(
    input: Parameters<HarnessDecisionStore['submit']>[0],
  ): ReturnType<HarnessDecisionStore['submit']> {
    const runtimeTaskId = await requireWorkflowRuntimeId(
      this.pool,
      input.workspaceId,
      input.taskId,
    );
    const runtimeEventId = runtimeObjectId(
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
            existing.rows[0].payload_fingerprint ===
              input.event.payloadFingerprint
              ? 'replayed'
              : 'idempotency_conflict',
          ...(input.mode === 'late_answer'
            ? { command: commandFromDecisionEvent(existing.rows[0].payload) }
            : {}),
          resumeRequired: existing.rows[0].resume_status !== 'sent',
        };
      }

      const pending = await client.query<{
        pending_projection: unknown;
        question_id: string;
        workflow_revision: string;
        status: string;
      }>(
        `select pending_projection, question_id, workflow_revision, status
         from harness_runtime.pending_questions
         where task_id=$1 for update`,
        [runtimeTaskId],
      );
      const node = pending.rows[0];
      const interactionProjection = node
        ? harnessInteractionPendingProjectionSchema.safeParse(
            node.pending_projection,
          )
        : null;
      if (
        interactionProjection?.success &&
        !(
          interactionProjection.data.request.kind ===
            'execution_confirmation' &&
          input.mode === 'core_hold_expired'
        )
      ) {
        await client.query('rollback');
        return { outcome: 'stale_question', resumeRequired: false };
      }
      const lateAnswerSource =
        input.mode === 'late_answer'
          ? await client.query(
              `select 1
                 from harness_runtime.decision_events
                where task_id=$1
                  and question_id=$2
                  and resolution_source in ('core_timeout','core_hold_expired')
                  and payload->'decision'->>'state'='ignored'
                union all
               select 1
                 from harness_runtime.reservation_sweeps
                where workspace_id=$3
                  and task_id=$4
                  and question_id=$2
                  and status='completed'
                limit 1`,
              [
                runtimeTaskId,
                input.command.questionId,
                input.workspaceId,
                input.taskId,
              ],
            )
          : null;
      const acceptsLateAnswer =
        input.mode === 'late_answer' && lateAnswerSource?.rowCount === 1;
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
          (input.mode === 'core_hold_expired' && input.resumeWorkflow !== true)
            ? 'sent'
            : 'pending',
        ],
      );
      const runtimeTraceId = await writeDecisionTrace(
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
        traceId: runtimeTraceId,
        traceContractVersion: 'observability/v1',
        payload: {
          eventId: input.event.id,
          questionId: input.command.questionId,
          resolutionSource: input.mode ?? 'decision',
          workflowRevision: input.command.workflowRevision,
        },
      };
      await writeAuditAndOutbox(client, audit, runtimeTaskId);
      if (node.status === 'pending') {
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
          (input.mode !== 'core_hold_expired' || input.resumeWorkflow === true),
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
    claimId: string,
  ) {
    const runtimeTaskId = await requireWorkflowRuntimeId(
      this.pool,
      workspaceId,
      taskId,
    );
    const result = await this.pool.query(
      `update harness_runtime.decision_events
       set resume_status='sent',
           resume_claim_id=null,
           resume_lease_expires_at=null
       where id=$1
         and resume_status='sending'
         and resume_claim_id=$2`,
      [runtimeObjectId(workspaceId, taskId, runtimeTaskId, eventId), claimId],
    );
    return result.rowCount === 1;
  }

  async claimDecisionResume(
    workspaceId: string,
    taskId: string,
    eventId: string,
    claimId: string,
  ) {
    const runtimeTaskId = await requireWorkflowRuntimeId(
      this.pool,
      workspaceId,
      taskId,
    );
    const result = await this.pool.query(
      `update harness_runtime.decision_events
       set resume_status='sending',
           resume_claim_id=$2,
           resume_lease_expires_at=clock_timestamp() + interval '5 minutes',
           resume_attempts=resume_attempts + 1
       where id=$1
         and (
           resume_status='pending'
           or (
             resume_status='sending'
             and (
               resume_lease_expires_at is null
               or resume_lease_expires_at <= clock_timestamp()
             )
           )
         )
       returning id`,
      [runtimeObjectId(workspaceId, taskId, runtimeTaskId, eventId), claimId],
    );
    return result.rowCount === 1;
  }

  async releaseDecisionResume(
    workspaceId: string,
    taskId: string,
    eventId: string,
    claimId: string,
  ) {
    const runtimeTaskId = await requireWorkflowRuntimeId(
      this.pool,
      workspaceId,
      taskId,
    );
    await this.pool.query(
      `update harness_runtime.decision_events
       set resume_status='pending',
           resume_claim_id=null,
           resume_lease_expires_at=null
       where id=$1
         and resume_status='sending'
         and resume_claim_id=$2`,
      [runtimeObjectId(workspaceId, taskId, runtimeTaskId, eventId), claimId],
    );
  }

  recordStageTrace(input: {
    workspaceId: string;
    id: string;
    taskId: string;
    stage: string;
    payload: unknown;
  }) {
    return new PostgresHarnessAuditStore(this.pool).recordStageTrace(input);
  }

  recordTerminalFailure(input: {
    workspaceId: string;
    workflowId: string;
    failure: Record<string, unknown>;
  }) {
    return new PostgresHarnessAuditStore(this.pool).appendAudit({
      workspaceId: input.workspaceId,
      id: `audit-${input.workflowId}-workflow-failed`,
      workflowId: input.workflowId,
      stage: 'workflow',
      eventType: 'workflow_failed',
      payload: input.failure,
    });
  }
}

export class PostgresHarnessAuditStore
  implements
    HarnessPromptFallbackAuditPort,
    HarnessExecutionAssemblyAuditPort,
    HarnessCopyDeliveryPort,
    HarnessProductMetricRecorder
{
  constructor(private readonly pool: Pool) {}

  async appendAudit(event: HarnessAuditEvent) {
    const runtimeWorkflowId = await requireWorkflowRuntimeId(
      this.pool,
      event.workspaceId,
      event.workflowId,
    );
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await writeAuditAndOutbox(client, event, runtimeWorkflowId);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async appendAuditIdempotently(event: HarnessAuditEvent) {
    const runtimeWorkflowId = await requireWorkflowRuntimeId(
      this.pool,
      event.workspaceId,
      event.workflowId,
    );
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await writeAuditAndOutboxIdempotently(client, event, runtimeWorkflowId);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      if (error instanceof TaskRootObservabilityConflictError) {
        await recordTaskRootObservabilityConflict(client, error.auditId);
      }
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
      await writeAuditAndOutbox(client, safeEvent, runtimeWorkflowId);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * V31-23: enqueue eval layer result into audit_events + langfuse_outbox.
   * Same detached pattern as appendPromptAudit (no task_requests row required).
   * Enqueue success transfers delivery to the existing outbox worker.
   */
  async appendEvalLayerAudit(event: HarnessAuditEvent) {
    const runtimeWorkflowId = harnessRuntimeId(
      event.workspaceId,
      event.workflowId,
    );
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await writeAuditAndOutbox(client, event, runtimeWorkflowId);
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
    const runtimeTaskId = await requireWorkflowRuntimeId(
      this.pool,
      input.workspaceId,
      input.taskId,
    );
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const runtimeTraceId = runtimeObjectId(
        input.workspaceId,
        input.taskId,
        runtimeTaskId,
        input.id,
      );
      await client.query(
        `insert into harness_runtime.decision_traces
           (id, task_id, stage, payload, trace_contract_version)
         values ($1,$2,$3,$4,'observability/v1')
         on conflict (id) do nothing`,
        [
          runtimeTraceId,
          runtimeTaskId,
          input.stage,
          JSON.stringify(input.payload),
        ],
      );
      await writeAuditAndOutbox(
        client,
        {
          workspaceId: input.workspaceId,
          id: `audit-${input.id}`,
          workflowId: input.taskId,
          stage: input.stage,
          eventType: 'stage_decision_recorded',
          traceId: runtimeTraceId,
          traceContractVersion: 'observability/v1',
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
    const runtimeWorkflowId = await requireWorkflowRuntimeId(
      this.pool,
      input.workspaceId,
      input.workflowId,
    );
    const deliveryAuditId = runtimeObjectId(
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
          (await isValidLegacyDeliveryReceipt(
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
          throw new TypeError(
            'The copy tracer requires an image-text ContentPackage.',
          );
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
          throw new TypeError(
            'The Harness winner must be a delivered candidate.',
          );
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
          throw new Error(
            'ContentPackage CAS failed while holding the workspace lock.',
          );
        }
        const runtimeTraceId = await writeGeneralTrace(
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
        await writeAuditAndOutbox(
          client,
          {
            workspaceId: input.workspaceId,
            id: `audit-${input.workflowId}-package-delivered`,
            workflowId: input.workflowId,
            stage: 'assembly_delivery',
            eventType: 'package_delivered',
            traceId: runtimeTraceId,
            traceContractVersion: 'observability/v1',
            payload: {
              workspaceId: input.workspaceId,
              expectedRevision: input.expectedRevision,
              requestFingerprint: deliveryRequestFingerprint(input),
              claimExtraction: input.claimExtraction,
              packageId: input.packageId,
              versionId,
              revision: nextRevision,
              ...(input.recommendation?.factReferences?.length
                ? { factRefs: input.recommendation.factReferences }
                : {}),
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
}

export class PostgresHarnessObservabilityStore
  implements HarnessLangfuseOutboxStore, HarnessObservabilityReconciliationStore
{
  constructor(private readonly pool: Pool) {}

  async claimLangfuseBatch(
    limit: number,
    leaseSeconds = 300,
    _maxAttempts = 8,
  ): Promise<HarnessLangfuseOutboxItem[]> {
    const result = await this.pool.query<{
      audit_id: string;
      workflow_id: string;
      stage: string;
      event_type: string;
      payload: unknown;
      created_at: Date | string;
      attempts: number;
      trace_id: string | null;
      trace_contract_version: string | null;
      post_contract: boolean;
    }>(
      `with ready as (
         select audit_id
         from harness_runtime.langfuse_outbox
         where status in ('queued','failed','sending')
           and dead_lettered_at is null
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
       select c.audit_id, c.attempts, a.workflow_id, a.trace_id,
              a.trace_contract_version, a.stage, a.event_type, a.payload,
              a.created_at,
              (
                cutover.cutover_at is not null
                and a.created_at >= cutover.cutover_at
                and a.event_type in (
                  'structured_decision_recorded',
                  'stage_decision_recorded',
                  'package_delivered'
                )
              ) as post_contract
       from claimed c
       join harness_runtime.audit_events a on a.id=c.audit_id
       left join harness_runtime.observability_reconciliation_cutovers cutover
         on cutover.contract_version='observability/v1'
       order by c.audit_id`,
      [limit, leaseSeconds],
    );
    if (result.rows.length === 0) return [];
    const workflowIds = [...new Set(result.rows.map((row) => row.workflow_id))];
    const traceRows = (
      await this.pool.query<{
        id: string;
        task_id: string;
        stage: string;
        payload: unknown;
        trace_contract_version: string | null;
      }>(
        `select id, task_id, stage, payload, trace_contract_version
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
    const physicalTraces = new Map(
      traceRows
        .filter(
          ({ trace_contract_version }) =>
            trace_contract_version === 'observability/v1',
        )
        .map((row) => [`${row.task_id}:${row.id}`, row.payload]),
    );
    const latestStageTraces = new Map(
      traceRows.map((row) => [`${row.task_id}:${row.stage}`, row.payload]),
    );
    return result.rows.map((row) => {
      const legacyTraceId = String(record(row.payload)?.traceId ?? '');
      const decisionTrace = row.post_contract
        ? row.trace_id
          ? physicalTraces.get(`${row.workflow_id}:${row.trace_id}`)
          : undefined
        : (exactTraces.get(`${row.workflow_id}:${legacyTraceId}`) ??
          latestStageTraces.get(`${row.workflow_id}:${row.stage}`));
      return {
        auditId: row.audit_id,
        workflowId: row.workflow_id,
        ...(row.post_contract
          ? { traceContractVersion: 'observability/v1' as const }
          : {}),
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
       set status='sent', last_error=null, sent_at=now(), updated_at=now()
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

  async markLangfuseDeadLetter(
    auditId: string,
    error: string,
    drops: ObservabilityDropEvent[],
  ) {
    const parsedDrops = observabilityDropEventSchema
      .array()
      .min(1)
      .parse(drops);
    await this.pool.query(
      `with transitioned as (
         update harness_runtime.langfuse_outbox
         set status='dead_letter', last_error=$2, dead_lettered_at=now(),
             updated_at=now()
         where audit_id=$1 and status='sending'
         returning audit_id, delivery_generation, dead_lettered_at
       ), inserted as (
         insert into harness_runtime.observability_drop_events
           (audit_id, delivery_generation, signal, reason, count, source,
            occurred_at)
         select transitioned.audit_id, transitioned.delivery_generation,
                drop_event.signal, drop_event.reason, drop_event.count,
                drop_event.source, transitioned.dead_lettered_at
         from transitioned
         cross join jsonb_to_recordset($3::jsonb) as drop_event(
           signal text, reason text, count integer, source text
         )
         on conflict (
           audit_id, delivery_generation, signal, reason, source
         ) do nothing
       )
       select count(*)::int as transitioned_count from transitioned`,
      [auditId, error.slice(0, 2_000), JSON.stringify(parsedDrops)],
    );
  }

  async readObservabilityDeliveryHealth(input: { now: Date }) {
    const result = await this.pool.query<{
      last_success_at: Date | null;
      oldest_queued_at: Date | null;
    }>(
      `select
         max(outbox.sent_at) filter (where outbox.status='sent')
           as last_success_at,
         min(audit.created_at) filter (
           where outbox.status in ('queued','failed','sending')
         ) as oldest_queued_at
       from harness_runtime.langfuse_outbox outbox
       join harness_runtime.audit_events audit on audit.id=outbox.audit_id`,
    );
    const lastSuccessAt = result.rows[0]?.last_success_at ?? null;
    const oldestQueuedAt = result.rows[0]?.oldest_queued_at ?? null;
    return {
      lastSuccessAt,
      oldestQueuedAt,
      queueAgeMs:
        oldestQueuedAt === null
          ? null
          : Math.max(0, input.now.getTime() - oldestQueuedAt.getTime()),
    };
  }

  async readObservabilityReconciliationBoundary(input: { intervalMs: number }) {
    const result = await this.pool.query<{ window_end: Date }>(
      `select to_timestamp(
         floor(
           extract(epoch from clock_timestamp())
           / ($1::double precision / 1000)
         )
         * ($1::double precision / 1000)
         - ($1::double precision / 1000)
       ) as window_end`,
      [input.intervalMs],
    );
    const windowEnd = result.rows[0]?.window_end;
    if (!windowEnd) {
      throw new Error('Observability reconciliation boundary is unavailable.');
    }
    return windowEnd;
  }

  async readObservabilityReconciliationCursor(
    contractVersion = 'observability/v1',
  ) {
    const result = await this.pool.query<{ cursor_at: Date | null }>(
      `select coalesce(
         (
           select max(run.window_end)
           from harness_runtime.observability_reconciliation_runs run
           where run.contract_version=$1
             and run.completed_at is not null
         ),
         (
           select cutover.cutover_at
           from harness_runtime.observability_reconciliation_cutovers cutover
           where cutover.contract_version=$1
         )
       ) as cursor_at`,
      [contractVersion],
    );
    return result.rows[0]?.cursor_at ?? null;
  }

  async completeObservabilityReconciliationWindow(
    input: { windowStart: Date; windowEnd: Date },
    contractVersion = 'observability/v1',
  ) {
    assertObservabilityWindow(input.windowStart, input.windowEnd);
    const result = await this.pool.query(
      `update harness_runtime.observability_reconciliation_runs
       set completed_at=coalesce(completed_at, clock_timestamp())
       where contract_version=$1
         and window_start=$2::timestamptz
         and window_end=$3::timestamptz
       returning id`,
      [
        contractVersion,
        input.windowStart.toISOString(),
        input.windowEnd.toISOString(),
      ],
    );
    if (result.rowCount !== 1) {
      throw new Error(
        'Observability reconciliation window cannot be completed.',
      );
    }
  }

  async readObservabilityDropSummary(input: {
    windowStart: Date;
    windowEnd: Date;
  }) {
    assertObservabilityWindow(input.windowStart, input.windowEnd);
    const result = await this.pool.query<{
      signal: ObservabilityDropEvent['signal'];
      reason: ObservabilityDropEvent['reason'];
      source: string;
      count: number;
    }>(
      `select signal, reason, source, sum(count)::int as count
       from harness_runtime.observability_drop_events
       where occurred_at >= $1::timestamptz
         and occurred_at < $2::timestamptz
       group by signal, reason, source
       order by signal, reason, source`,
      [input.windowStart.toISOString(), input.windowEnd.toISOString()],
    );
    return result.rows.map((row) => observabilityDropEventSchema.parse(row));
  }

  async activateObservabilityReconciliationCutover(
    contractVersion = 'observability/v1',
  ) {
    const result = await this.pool.query<{ cutover_at: Date }>(
      `insert into harness_runtime.observability_reconciliation_cutovers
         (contract_version, cutover_at)
       values ($1, clock_timestamp())
       on conflict (contract_version) do update
         set contract_version=excluded.contract_version
       returning cutover_at`,
      [contractVersion],
    );
    const cutoverAt = result.rows[0]?.cutover_at;
    if (!cutoverAt) {
      throw new Error(
        'Observability reconciliation cutover was not activated.',
      );
    }
    return cutoverAt;
  }

  async reconcileBusinessEventsToTraces(input: {
    windowStart: Date;
    windowEnd: Date;
    contractVersion?: string;
  }) {
    assertObservabilityWindow(input.windowStart, input.windowEnd);
    const contractVersion = input.contractVersion ?? 'observability/v1';
    const result = await this.pool.query<{
      action_usage_event_count: number;
      business_event_count: number;
      cutover_at: Date;
      matched_count: number;
      missing_trace_count: number;
      orphan_trace_count: number;
      rating_event_count: number;
      trace_count: number;
      undelivered_event_count: number;
    }>(
      `with cutover as (
         select cutover_at
         from harness_runtime.observability_reconciliation_cutovers
         where contract_version=$1
       ), eligible_events as (
         select event.id, event.workflow_id, event.trace_id,
                event.trace_contract_version
         from harness_runtime.audit_events event, cutover
         where event.event_type in (
             'structured_decision_recorded',
             'stage_decision_recorded',
             'package_delivered'
           )
           and event.created_at >= greatest($2::timestamptz, cutover.cutover_at)
           and event.created_at < $3::timestamptz
       ), eligible_traces as (
         select trace.id, trace.task_id
         from harness_runtime.decision_traces trace, cutover
         where trace.trace_contract_version=$1
           and trace.created_at >= greatest($2::timestamptz, cutover.cutover_at)
           and trace.created_at < $3::timestamptz
       ), canonical_events as (
         select event.id, event.event_type,
                exists (
                  select 1
                  from harness_runtime.observability_drop_events drop_event
                  where drop_event.audit_id=event.id
                ) as dropped,
                exists (
                  select 1
                  from harness_runtime.langfuse_outbox outbox
                  where outbox.audit_id=event.id
                ) as has_outbox
         from harness_runtime.audit_events event
         cross join cutover
         where event.stage='observability_event_ingest'
           and event.event_type in (
             'delivery_rating.recorded',
             'delivery_rating.withdrawn',
             'action_usage.recorded',
             'bounded_execution.suspended',
             'bounded_execution.resumed',
             'note_page_regenerated',
             'agent_primitive.lifecycle'
           )
           and event.created_at >= greatest(
             $2::timestamptz, cutover.cutover_at
           )
           and event.created_at < $3::timestamptz
       ), event_facts as (
         select event.id,
                trace.id is not null as matched
         from eligible_events event
         left join harness_runtime.decision_traces trace
           on trace.id=event.trace_id
          and trace.task_id=event.workflow_id
          and trace.trace_contract_version=$1
          and event.trace_contract_version=$1
       ), trace_facts as (
         select trace.id,
                event.id is not null as matched
         from eligible_traces trace
         left join harness_runtime.audit_events event
           on event.trace_id=trace.id
          and event.workflow_id=trace.task_id
          and event.trace_contract_version=$1
          and event.event_type in (
            'structured_decision_recorded',
            'stage_decision_recorded',
            'package_delivered'
          )
       ), counts as (
         select
           (select count(*)::int from event_facts)
             as business_event_count,
           (select count(*)::int from trace_facts)
             as trace_count,
           (select count(*)::int from event_facts where matched)
             as matched_count,
           (select count(*)::int from event_facts where not matched)
             as missing_trace_count,
           (select count(*)::int from trace_facts where not matched)
             as orphan_trace_count,
           (select count(*)::int from canonical_events
             where event_type in (
               'delivery_rating.recorded', 'delivery_rating.withdrawn'
             )) as rating_event_count,
           (select count(*)::int from canonical_events
             where event_type='action_usage.recorded')
             as action_usage_event_count,
           (select count(*)::int from canonical_events
             where dropped or not has_outbox)
             as undelivered_event_count,
           cutover.cutover_at
         from cutover
       ), persisted as (
         insert into harness_runtime.observability_reconciliation_runs as run
           (contract_version, window_start, window_end, cutover_at,
            business_event_count, trace_count, matched_count,
            missing_trace_count, orphan_trace_count, rating_event_count,
            action_usage_event_count, undelivered_event_count)
         select $1, $2, $3, cutover_at, business_event_count, trace_count,
                matched_count, missing_trace_count, orphan_trace_count,
                rating_event_count, action_usage_event_count,
                undelivered_event_count
         from counts
         on conflict (contract_version, window_start, window_end, cutover_at)
         do update set
           business_event_count=excluded.business_event_count,
           trace_count=excluded.trace_count,
           matched_count=excluded.matched_count,
           missing_trace_count=excluded.missing_trace_count,
           orphan_trace_count=excluded.orphan_trace_count,
           rating_event_count=excluded.rating_event_count,
           action_usage_event_count=excluded.action_usage_event_count,
           undelivered_event_count=excluded.undelivered_event_count
         where run.completed_at is null
         returning 1
       )
       select counts.business_event_count, counts.trace_count,
              counts.matched_count, counts.missing_trace_count,
              counts.orphan_trace_count, counts.rating_event_count,
              counts.action_usage_event_count,
              counts.undelivered_event_count, counts.cutover_at
       from counts, persisted`,
      [
        contractVersion,
        input.windowStart.toISOString(),
        input.windowEnd.toISOString(),
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `Observability reconciliation window is unavailable for ${contractVersion}.`,
      );
    }
    return {
      businessEventCount: row.business_event_count,
      traceCount: row.trace_count,
      matchedCount: row.matched_count,
      missingTraceCount: row.missing_trace_count,
      orphanTraceCount: row.orphan_trace_count,
      ratingEventCount: row.rating_event_count,
      actionUsageEventCount: row.action_usage_event_count,
      undeliveredEventCount: row.undelivered_event_count,
      cutoverAt: row.cutover_at,
    };
  }

  async replayLangfuseDeadLetter(auditId: string) {
    const result = await this.pool.query(
      `update harness_runtime.langfuse_outbox
       set status='queued', attempts=0, next_attempt_at=now(),
           last_error=null, dead_lettered_at=null,
           delivery_generation=delivery_generation+1, updated_at=now()
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
}

async function workflowRuntimeId(
  pool: Pool,
  workspaceId: string,
  workflowId: string,
) {
  const result = await pool.query<{ runtime_id: string }>(
    `select runtime_id from harness_runtime.task_requests
     where request->>'workspaceId'=$1
       and (task_id=$2 or workflow_id=$3 or request->>'sourceTaskId'=$3)
     order by created_at desc, task_id desc
     limit 1`,
    [workspaceId, harnessRuntimeId(workspaceId, workflowId), workflowId],
  );
  return result.rows[0]?.runtime_id ?? null;
}

async function writeDecisionTrace(
  client: PoolClient,
  workspaceId: string,
  runtimeTaskId: string,
  trace: HarnessDecisionTrace,
) {
  const runtimeTraceId = runtimeObjectId(
    workspaceId,
    trace.taskId,
    runtimeTaskId,
    trace.id,
  );
  await client.query(
    `insert into harness_runtime.decision_traces
         (id, task_id, stage, payload, trace_contract_version)
       values ($1,$2,$3,$4,'observability/v1')`,
    [runtimeTraceId, runtimeTaskId, trace.stage, JSON.stringify(trace)],
  );
  return runtimeTraceId;
}

async function writeGeneralTrace(
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
  const runtimeTraceId = runtimeObjectId(
    input.workspaceId,
    input.taskId,
    runtimeTaskId,
    input.id,
  );
  await client.query(
    `insert into harness_runtime.decision_traces
         (id, task_id, stage, payload, trace_contract_version)
       values ($1,$2,$3,$4,'observability/v1')
       on conflict (id) do nothing`,
    [runtimeTraceId, runtimeTaskId, input.stage, JSON.stringify(input.payload)],
  );
  return runtimeTraceId;
}

async function writeAuditAndOutbox(
  client: PoolClient,
  event: HarnessAuditEvent,
  runtimeWorkflowId: string,
) {
  const auditId = runtimeObjectId(
    event.workspaceId,
    event.workflowId,
    runtimeWorkflowId,
    event.id,
  );
  await client.query(
    `insert into harness_runtime.audit_events
         (id, workflow_id, trace_id, trace_contract_version, stage,
          event_type, payload)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (id) do nothing`,
    [
      auditId,
      runtimeWorkflowId,
      event.traceId ?? null,
      event.traceContractVersion ?? null,
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

async function writeAuditAndOutboxIdempotently(
  client: PoolClient,
  event: HarnessAuditEvent,
  runtimeWorkflowId: string,
) {
  const auditId = runtimeObjectId(
    event.workspaceId,
    event.workflowId,
    runtimeWorkflowId,
    event.id,
  );
  const rootClaim = taskRootObservabilityClaim(event.payload);
  if (rootClaim) {
    const claim = await client.query<{ audit_id: string }>(
      `insert into harness_runtime.observability_root_claims as existing
           (workflow_id, audit_id, payload)
         values ($1,$2,$3)
         on conflict (workflow_id) do update set workflow_id=excluded.workflow_id
         where existing.payload=excluded.payload
         returning audit_id`,
      [runtimeWorkflowId, auditId, JSON.stringify(rootClaim)],
    );
    if (claim.rowCount !== 1) {
      throw new TaskRootObservabilityConflictError(auditId);
    }
    if (claim.rows[0]?.audit_id !== auditId) return;
  }
  const result = await client.query(
    `insert into harness_runtime.audit_events as existing
         (id, workflow_id, trace_id, trace_contract_version, stage,
          event_type, payload)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (id) do update set id=excluded.id
       where existing.workflow_id=excluded.workflow_id
         and existing.trace_id is not distinct from excluded.trace_id
         and existing.trace_contract_version
           is not distinct from excluded.trace_contract_version
         and existing.stage=excluded.stage
         and existing.event_type=excluded.event_type
         and existing.payload=excluded.payload
       returning id`,
    [
      auditId,
      runtimeWorkflowId,
      event.traceId ?? null,
      event.traceContractVersion ?? null,
      event.stage,
      event.eventType,
      JSON.stringify(event.payload),
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error('Observability idempotency conflict.');
  }
  await client.query(
    `insert into harness_runtime.langfuse_outbox (audit_id, status)
       values ($1,'queued') on conflict (audit_id) do nothing`,
    [auditId],
  );
}

async function recordTaskRootObservabilityConflict(
  client: PoolClient,
  auditId: string,
) {
  await client.query(
    `insert into harness_runtime.observability_drop_events
         (audit_id, delivery_generation, signal, reason, count, source,
          occurred_at)
       values (
         $1, 1, 'trace', 'permanent-config', 1,
         'task-root-observability-conflict', clock_timestamp()
       )
       on conflict (
         audit_id, delivery_generation, signal, reason, source
       ) do nothing`,
    [auditId],
  );
}

async function requireWorkflowRuntimeId(
  pool: Pool,
  workspaceId: string,
  workflowId: string,
) {
  const runtimeId = await workflowRuntimeId(pool, workspaceId, workflowId);
  if (!runtimeId) {
    throw new Error('Harness workflow runtime identity was not found.');
  }
  return runtimeId;
}

async function isValidLegacyDeliveryReceipt(
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

function runtimeObjectId(
  workspaceId: string,
  logicalWorkflowId: string,
  runtimeWorkflowId: string,
  logicalObjectId: string,
) {
  return runtimeWorkflowId === logicalWorkflowId
    ? logicalObjectId
    : harnessRuntimeId(workspaceId, logicalObjectId);
}

function taskRootObservabilityClaim(payload: unknown) {
  const parsed = observabilityEventSchema.safeParse(payload);
  if (
    !parsed.success ||
    parsed.data.eventType !== 'agent_primitive.lifecycle' ||
    parsed.data.axisScope !== 'task_root' ||
    (parsed.data.payload.primitiveId !== 'harness-assembly:task_pin' &&
      parsed.data.payload.primitiveId !== 'harness-assembly:event_persistence')
  ) {
    return;
  }
  return {
    taskId: parsed.data.taskId,
    workspaceId: parsed.data.workspaceId,
    axisScope: parsed.data.axisScope,
    skillRevision: parsed.data.skillRevision,
    promptVersion: parsed.data.promptVersion,
    catalogRevision: parsed.data.catalogRevision,
    scene: parsed.data.scene,
  };
}

function bindAdapterMethods(target: object, adapter: object) {
  for (const name of Object.getOwnPropertyNames(
    Object.getPrototypeOf(adapter),
  )) {
    if (name === 'constructor') continue;
    const method = (adapter as Record<string, unknown>)[name];
    if (typeof method === 'function') {
      Object.defineProperty(target, name, {
        configurable: true,
        value: method.bind(adapter),
      });
    }
  }
}

function assertObservabilityWindow(windowStart: Date, windowEnd: Date) {
  if (
    !Number.isFinite(windowStart.getTime()) ||
    !Number.isFinite(windowEnd.getTime()) ||
    windowEnd.getTime() <= windowStart.getTime()
  ) {
    throw new Error(
      'Observability reconciliation window end must follow its start.',
    );
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
    : confirmationCardTimeoutSecondsSchema.parse(projection.timeoutSeconds);
}

function pendingQuestionCard(value: unknown): QuestionCard {
  const legacy = questionCardSchema.safeParse(value);
  if (legacy.success) return legacy.data;
  const interaction = harnessInteractionRequestSchema.parse(value);
  if (interaction.kind !== 'ask_merchant') {
    throw new Error(
      'Execution confirmation cannot be projected as a legacy question.',
    );
  }
  const question = interaction.questions[0]!;
  return questionCardSchema.parse({
    questionId: interaction.requestId,
    workflowId: interaction.runId,
    workflowRevision: interaction.revision,
    question: question.question,
    options: (question.options ?? []).map((option, index) => ({
      id: `${question.itemId}:${index}`,
      label: option.label,
      ...(option.description ? { description: option.description } : {}),
    })),
    freeText: { enabled: true },
    response: {
      field: question.itemId,
      reason: 'The merchant answer is required by the pending workflow.',
    },
    unattended: 'hold',
    scope: 'current_task',
  });
}

/**
 * R-P0-05: validate the sweep's frozen billing identity. A malformed or
 * missing identity fails closed here (sweep refund will refuse) rather than
 * guessing one from the row.
 */
function parseSweepBillingIdentity(input: unknown): BillingIdentity {
  if (!input || typeof input !== 'object') {
    throw new Error('Reservation sweep is missing its frozen billing identity.');
  }
  const candidate = input as Record<string, unknown>;
  const quoteRef = candidate.quoteRef;
  if (
    typeof candidate.workspaceId !== 'string' ||
    typeof candidate.taskId !== 'string' ||
    typeof candidate.workId !== 'string' ||
    typeof candidate.workflowId !== 'string' ||
    typeof candidate.reservationId !== 'string' ||
    typeof candidate.carrierUnitId !== 'string' ||
    !candidate.carrierUnitId.trim() ||
    !Array.isArray(candidate.carrierUnitIds) ||
    candidate.carrierUnitIds.length === 0 ||
    candidate.carrierUnitIds.some(
      (carrier) => typeof carrier !== 'string' || !carrier.trim(),
    ) ||
    new Set(candidate.carrierUnitIds).size !== candidate.carrierUnitIds.length ||
    !candidate.carrierUnitIds.includes(candidate.carrierUnitId) ||
    typeof candidate.carrierBillableUnits !== 'number' ||
    !Number.isSafeInteger(candidate.carrierBillableUnits) ||
    candidate.carrierBillableUnits < 1 ||
    !quoteRef ||
    typeof quoteRef !== 'object' ||
    typeof (quoteRef as Record<string, unknown>).id !== 'string' ||
    typeof (quoteRef as Record<string, unknown>).revision !== 'string'
  ) {
    throw new Error('Reservation sweep billing identity is incomplete.');
  }
  const quote = quoteRef as Record<string, unknown>;
  const optionalString = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value : undefined;
  const optionalInteger = (value: unknown) =>
    typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
  const planId = optionalString(candidate.planId);
  const planRevision = optionalInteger(candidate.planRevision);
  const snapshotHash = optionalString(candidate.snapshotHash);
  const identity: BillingIdentity = {
    workspaceId: candidate.workspaceId,
    taskId: candidate.taskId,
    workId: candidate.workId,
    workflowId: candidate.workflowId,
    reservationId: candidate.reservationId,
    quoteRef: { id: quote.id as string, revision: quote.revision as string },
    carrierUnitId: candidate.carrierUnitId,
    carrierUnitIds: candidate.carrierUnitIds as string[],
    carrierBillableUnits: candidate.carrierBillableUnits,
    ...(optionalString(candidate.creditHoldOperationId)
      ? { creditHoldOperationId: optionalString(candidate.creditHoldOperationId) }
      : {}),
    ...(optionalString(candidate.creditUsageOperationId)
      ? { creditUsageOperationId: optionalString(candidate.creditUsageOperationId) }
      : {}),
    ...(optionalString(candidate.productUsageReservationId)
      ? {
          productUsageReservationId: optionalString(
            candidate.productUsageReservationId,
          ),
        }
      : {}),
    ...(planId ? { planId: billingPlanId(planId) } : {}),
    ...(planRevision !== undefined ? { planRevision } : {}),
    ...(snapshotHash ? { snapshotHash } : {}),
  };
  billingIdentityReservationFingerprint(identity);
  return identity;
}

function assertSweepBillingIdentityMatchesRow(
  row: {
    workspace_id: string;
    task_id: string;
    billing_task_id: string;
    quote_id: string;
    quote_revision: string;
  },
  identity: BillingIdentity,
) {
  if (
    identity.workspaceId !== row.workspace_id ||
    identity.workflowId !== row.task_id ||
    identity.taskId !== row.billing_task_id ||
    identity.quoteRef.id !== row.quote_id ||
    identity.quoteRef.revision !== row.quote_revision
  ) {
    throw new Error(
      'Reservation sweep billing identity does not match its durable settlement coordinates.',
    );
  }
}

function reservationUnits(input: unknown): ProductUsageUnit[] {
  if (!Array.isArray(input)) {
    throw new Error('Reservation sweep is missing reserved units.');
  }
  return input.map((candidate) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      !('resource' in candidate) ||
      (candidate.resource !== 'copy' &&
        candidate.resource !== 'image' &&
        candidate.resource !== 'video' &&
        candidate.resource !== 'audio') ||
      !('quantity' in candidate) ||
      typeof candidate.quantity !== 'number' ||
      !Number.isSafeInteger(candidate.quantity) ||
      candidate.quantity < 1
    ) {
      throw new Error('Reservation sweep contains invalid reserved units.');
    }
    return {
      resource: candidate.resource,
      quantity: candidate.quantity,
    };
  });
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
