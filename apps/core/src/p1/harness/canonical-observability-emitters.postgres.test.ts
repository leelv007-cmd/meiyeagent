import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type {
  ObservabilityEvent,
  ProductQuoteSnapshot,
  ProductUsageRecord,
} from '@meiye/contracts';
import { Pool } from 'pg';

import {
  canonicalObservabilityEvent,
  HarnessObservabilityEventAudit,
} from '../creation-experience/observability-events.js';
import { CreationExperienceFoundationModule } from '../creation-experience/foundation-module.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import { HarnessProductBillingSettlementExecutor } from './product-billing-settlement.js';
import { PostgresHarnessStore } from './postgres-store.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import { harnessRuntimeId } from './workspace-scope.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'real PostgreSQL atomically persists canonical emitter outputs once',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const suffix = randomUUID();
    const workspaceId = `workspace-observability-${suffix}`;
    const taskId = `task-observability-${suffix}`;
    const runtimeId = harnessRuntimeId(workspaceId, taskId);
    const packageId = `package-observability-${suffix}`;
    const delivery = {
      packageId,
      versionId: `version-observability-${suffix}`,
      revision: 1,
    };
    const binding = {
      axisScope: 'task_root' as const,
      skillRevision: { kind: 'absent' as const },
      promptVersion: { kind: 'bound' as const, value: 'copy@v4' },
      catalogRevision: {
        kind: 'bound' as const,
        value: 'catalog-observability-r1',
      },
      scene: { kind: 'bound' as const, value: '夏日护理活动' },
    };
    const request: HarnessWorkflowInput = {
      actorId: 'owner-observability',
      workspaceId,
      packageId,
      expectedRevision: 0,
      workflowRevision: 1,
      creationMode: 'customized',
      rawInput: '制作夏日护理活动内容',
      intent: {
        context: {
          workId: `work-observability-${suffix}`,
          intent: '制作夏日护理活动内容',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
      executionAssembly: {
        schemaVersion: 'harness-execution-assembly/v1',
        workflowId: taskId,
        skillStages: {
          intent_naming: [],
          context_injection: [],
          brief_compilation: [],
          execution_selection: [],
          assembly_delivery: [],
        },
        frozenRouteSnapshotDigest: 'fixture-digest',
        promptRevisionRefs: {},
        rootAxes: binding,
      },
    };
    const events = new HarnessObservabilityEventAudit(store);

    try {
      await store.applySchema();
      await pool.query(
        `insert into harness_runtime.task_requests
           (task_id, workflow_id, runtime_id, fingerprint, request)
         values ($1,$2,$1,$3,$4)`,
        [runtimeId, taskId, fingerprintValue(request), JSON.stringify(request)],
      );
      await pool.query(
        `insert into harness_runtime.audit_events
           (id, workflow_id, stage, event_type, payload)
         values ($1,$2,'assembly_delivery','package_delivered',$3)`,
        [
          `delivery-observability-${suffix}`,
          runtimeId,
          JSON.stringify(delivery),
        ],
      );

      const rating = new CreationExperienceFoundationModule(
        undefined,
        undefined,
        { observabilityEvents: events, taskObservability: store },
      );
      const appendRating = () =>
        rating.execute({
          context: {
            workspaceId,
            userId: 'owner-observability',
            correlationId: `rating-${suffix}`,
            actor: 'owner',
          },
          idempotencyKey: `rating-${suffix}`,
          input: {
            action: 'event_append',
            payload: {
              eventType: 'delivery_rating.recorded',
              taskId,
              payload: { ...delivery, verdict: 'up' },
            },
          },
        });

      const usage = productUsage(workspaceId, taskId, suffix);
      const settlement = new HarnessProductBillingSettlementExecutor(
        {
          async getQuote() {
            return productQuote(workspaceId, taskId, suffix);
          },
          async settleTask() {},
          async getUsage() {
            return usage;
          },
        },
        {
          async refundUsageOperation() {
            return [];
          },
        },
        undefined,
        { events, context: store },
      );

      const boundedSuspended = canonicalObservabilityEvent({
        taskId,
        binding,
        eventType: 'bounded_execution.suspended',
        payload: {
          snapshot: boundedSnapshot('suspended'),
          currentBest: { candidateId: 'candidate-1' },
          unmetExplanation: 'One more iteration is required.',
          resumable: true,
        },
      });
      const boundedResumed = canonicalObservabilityEvent({
        taskId,
        binding,
        eventType: 'bounded_execution.resumed',
        payload: {
          previousSnapshot: boundedSnapshot('suspended'),
          snapshot: boundedSnapshot('resumed'),
          decisionId: `bounded-decision-${suffix}`,
        },
      });
      const note = canonicalObservabilityEvent({
        taskId,
        binding,
        eventType: 'note_page_regenerated',
        payload: {
          auditRef: `note-audit-${suffix}`,
          imagePoints: 0,
          pageId: 'page-1',
          reason: 'Exact text mismatch.',
          side: 'text',
          trigger: 'check_violation',
        },
      });
      const taskRoot = {
        eventType: 'agent_primitive.lifecycle' as const,
        taskId,
        workspaceId,
        actorId: `ref:${'a'.repeat(64)}`,
        actorKind: 'worker' as const,
        idempotencyKey: `task-root-${suffix}`,
        axisScope: 'task_root' as const,
        skillRevision: null,
        promptVersion: null,
        catalogRevision: binding.catalogRevision.value,
        scene: binding.scene.value,
        payload: {
          primitiveId: 'harness-assembly:task_pin',
          phase: 'succeeded' as const,
          billing: { kind: 'not_billed' as const },
        },
      };

      for (let replay = 0; replay < 2; replay += 1) {
        await appendRating();
        await settlement.commit({
          workspaceId,
          taskId,
          billingTaskId: taskId,
          billingIdentity: {
            workspaceId,
            taskId,
            workId: 'work-observability',
            workflowId: taskId,
            quoteRef: { id: usage.quoteId, revision: 'quote-r1' },
            reservationId: 'consume:task:task-observability',
            carrierUnitId: 'single',
            carrierUnitIds: ['single'],
            carrierBillableUnits: 1,
          },
          quoteId: usage.quoteId,
          quoteRevision: 'quote-r1',
        });
        await events.append(
          workspaceId,
          boundedSuspended,
          `bounded:${taskId}:0:suspended`,
        );
        await events.append(
          workspaceId,
          boundedResumed,
          `bounded:${taskId}:decision:resumed`,
        );
        await events.append(
          workspaceId,
          note,
          `note-regenerated:${taskId}:note-audit-${suffix}`,
        );
      }
      await Promise.all([
        events.append(workspaceId, taskRoot, taskRoot.idempotencyKey),
        events.append(
          workspaceId,
          { ...taskRoot, idempotencyKey: `task-root-replay-${suffix}` },
          `task-root-replay-${suffix}`,
        ),
      ]);
      await assert.rejects(
        events.append(
          workspaceId,
          {
            ...taskRoot,
            idempotencyKey: `task-root-conflict-${suffix}`,
            scene: 'different-scene',
          },
          `task-root-conflict-${suffix}`,
        ),
        /Task root observability conflict/u,
      );
      const rootConflictAuditId = harnessRuntimeId(
        workspaceId,
        `observability-task-root-conflict-${suffix}`,
      );
      const runtimeConflictDrop = await pool.query<{
        audit_id: string;
        signal: string;
        reason: string;
        count: number;
        source: string;
      }>(
        `select audit_id, signal, reason, count, source
         from harness_runtime.observability_drop_events
         where audit_id=$1`,
        [rootConflictAuditId],
      );
      assert.deepEqual(runtimeConflictDrop.rows, [
        {
          audit_id: rootConflictAuditId,
          signal: 'trace',
          reason: 'permanent-config',
          count: 1,
          source: 'task-root-observability-conflict',
        },
      ]);

      await assertConcurrentTaskRootClaim({
        events,
        pool,
        request,
        suffix,
        taskRoot,
        workspaceId,
      });
      await assertLegacyTaskRootMigration({
        pool,
        suffix,
        taskRoot,
        workspaceId,
      });

      const persisted = await pool.query<{
        event_type: string;
        outbox_count: number;
      }>(
        `select audit.event_type,
                count(outbox.audit_id)::int as outbox_count
         from harness_runtime.audit_events audit
         join harness_runtime.langfuse_outbox outbox
           on outbox.audit_id=audit.id
         where audit.workflow_id=$1
           and audit.stage='observability_event_ingest'
         group by audit.event_type
         order by audit.event_type`,
        [runtimeId],
      );
      assert.deepEqual(persisted.rows, [
        { event_type: 'action_usage.recorded', outbox_count: 1 },
        { event_type: 'agent_primitive.lifecycle', outbox_count: 1 },
        { event_type: 'bounded_execution.resumed', outbox_count: 1 },
        { event_type: 'bounded_execution.suspended', outbox_count: 1 },
        { event_type: 'delivery_rating.recorded', outbox_count: 1 },
        { event_type: 'note_page_regenerated', outbox_count: 1 },
      ]);
    } finally {
      const concurrentTaskId = `task-root-concurrent-${suffix}`;
      const concurrentRuntimeId = harnessRuntimeId(
        workspaceId,
        concurrentTaskId,
      );
      const legacyRuntimeId = `legacy-root-runtime-${suffix}`;
      const cleanupAuditIds = [
        harnessRuntimeId(
          workspaceId,
          `observability-task-root-conflict-${suffix}`,
        ),
        harnessRuntimeId(
          workspaceId,
          `observability-task-root-concurrent-a-${suffix}`,
        ),
        harnessRuntimeId(
          workspaceId,
          `observability-task-root-concurrent-b-${suffix}`,
        ),
        `legacy-root-first-${suffix}`,
        `legacy-root-duplicate-${suffix}`,
        `legacy-root-conflict-${suffix}`,
      ];
      await pool.query(
        `delete from harness_runtime.observability_drop_events
         where audit_id=any($1::text[])`,
        [cleanupAuditIds],
      );
      await pool.query(
        `delete from harness_runtime.observability_root_claims
         where workflow_id=any($1::text[])`,
        [[runtimeId, concurrentRuntimeId, legacyRuntimeId]],
      );
      await pool.query(
        `delete from harness_runtime.audit_events
         where workflow_id=any($1::text[])`,
        [[runtimeId, concurrentRuntimeId, legacyRuntimeId]],
      );
      await pool.query(
        `delete from harness_runtime.task_requests
         where task_id=any($1::text[])`,
        [[runtimeId, concurrentRuntimeId]],
      );
      await pool.end();
    }
  },
);

async function assertConcurrentTaskRootClaim(input: {
  events: HarnessObservabilityEventAudit;
  pool: Pool;
  request: HarnessWorkflowInput;
  suffix: string;
  taskRoot: Extract<
    ObservabilityEvent,
    { eventType: 'agent_primitive.lifecycle' }
  >;
  workspaceId: string;
}) {
  const taskId = `task-root-concurrent-${input.suffix}`;
  const runtimeId = harnessRuntimeId(input.workspaceId, taskId);
  const request = structuredClone(input.request);
  request.packageId = `package-root-concurrent-${input.suffix}`;
  request.executionAssembly = {
    ...request.executionAssembly!,
    workflowId: taskId,
  };
  await input.pool.query(
    `insert into harness_runtime.task_requests
       (task_id, workflow_id, runtime_id, fingerprint, request)
     values ($1,$2,$1,$3,$4)`,
    [
      runtimeId,
      taskId,
      fingerprintValue(request),
      JSON.stringify(request),
    ],
  );
  const candidates = [
    {
      ...input.taskRoot,
      taskId,
      idempotencyKey: `task-root-concurrent-a-${input.suffix}`,
      scene: 'concurrent-scene-a',
    },
    {
      ...input.taskRoot,
      taskId,
      idempotencyKey: `task-root-concurrent-b-${input.suffix}`,
      scene: 'concurrent-scene-b',
    },
  ] as const;
  const settled = await Promise.allSettled(
    candidates.map((event) =>
      input.events.append(
        input.workspaceId,
        event,
        event.idempotencyKey,
      ),
    ),
  );
  assert.deepEqual(
    settled.map((result) => result.status).sort(),
    ['fulfilled', 'rejected'],
  );
  const persisted = await input.pool.query<{
    audit_count: number;
    outbox_count: number;
  }>(
    `select count(distinct audit.id)::int as audit_count,
            count(distinct outbox.audit_id)::int as outbox_count
     from harness_runtime.audit_events audit
     left join harness_runtime.langfuse_outbox outbox
       on outbox.audit_id=audit.id
     where audit.workflow_id=$1
       and audit.stage='observability_event_ingest'
       and audit.event_type='agent_primitive.lifecycle'
       and audit.payload->>'axisScope'='task_root'`,
    [runtimeId],
  );
  assert.deepEqual(persisted.rows, [{ audit_count: 1, outbox_count: 1 }]);
  const attemptedAuditIds = candidates.map((event) =>
    harnessRuntimeId(
      input.workspaceId,
      `observability-${event.idempotencyKey}`,
    ),
  );
  const drops = await input.pool.query<{ audit_id: string }>(
    `select audit_id
     from harness_runtime.observability_drop_events
     where audit_id=any($1::text[])
       and signal='trace'
       and reason='permanent-config'
       and source='task-root-observability-conflict'`,
    [attemptedAuditIds],
  );
  assert.equal(drops.rowCount, 1);
}

async function assertLegacyTaskRootMigration(input: {
  pool: Pool;
  suffix: string;
  taskRoot: Extract<
    ObservabilityEvent,
    { eventType: 'agent_primitive.lifecycle' }
  >;
  workspaceId: string;
}) {
  const workflowId = `legacy-root-runtime-${input.suffix}`;
  const audits = [
    {
      id: `legacy-root-first-${input.suffix}`,
      createdAt: '2026-07-30T00:00:00.000Z',
      payload: {
        ...input.taskRoot,
        taskId: `legacy-root-task-${input.suffix}`,
        idempotencyKey: `legacy-root-first-${input.suffix}`,
        scene: 'legacy-scene-a',
        payload: {
          ...input.taskRoot.payload,
          primitiveId: 'harness-assembly:event_persistence',
        },
      },
    },
    {
      id: `legacy-root-duplicate-${input.suffix}`,
      createdAt: '2026-07-30T00:00:01.000Z',
      payload: {
        ...input.taskRoot,
        taskId: `legacy-root-task-${input.suffix}`,
        idempotencyKey: `legacy-root-duplicate-${input.suffix}`,
        scene: 'legacy-scene-a',
        payload: {
          ...input.taskRoot.payload,
          primitiveId: 'harness-assembly:event_persistence',
        },
      },
    },
    {
      id: `legacy-root-conflict-${input.suffix}`,
      createdAt: '2026-07-30T00:00:02.000Z',
      payload: {
        ...input.taskRoot,
        taskId: `legacy-root-task-${input.suffix}`,
        idempotencyKey: `legacy-root-conflict-${input.suffix}`,
        scene: 'legacy-scene-b',
        payload: {
          ...input.taskRoot.payload,
          primitiveId: 'harness-assembly:event_persistence',
        },
      },
    },
  ] as const;
  await input.pool.query(
    `insert into harness_runtime.audit_events
       (id, workflow_id, stage, event_type, payload, created_at)
     select row.id,
            $1,
            'observability_event_ingest',
            'agent_primitive.lifecycle',
            row.payload,
            row.created_at
     from jsonb_to_recordset($2::jsonb) as row(
       id text, payload jsonb, created_at timestamptz
     )`,
    [
      workflowId,
      JSON.stringify(
        audits.map((audit) => ({
          id: audit.id,
          payload: audit.payload,
          created_at: audit.createdAt,
        })),
      ),
    ],
  );
  await input.pool.query(
    `insert into harness_runtime.langfuse_outbox (audit_id, status)
     select id, 'queued'
     from harness_runtime.audit_events
     where workflow_id=$1`,
    [workflowId],
  );
  await input.pool.query(
    `update harness_runtime.langfuse_outbox
     set status='dead_letter', dead_lettered_at=clock_timestamp()
     where audit_id=$1`,
    [audits[2].id],
  );
  await input.pool.query(`
    alter table harness_runtime.langfuse_outbox
      drop constraint langfuse_outbox_status_check;
    alter table harness_runtime.langfuse_outbox
      add constraint langfuse_outbox_status_check
      check (status in (
        'queued', 'sending', 'failed', 'sent', 'dead_letter'
      )) not valid
  `);
  await new PostgresHarnessStore(input.pool).applySchema();

  const claim = await input.pool.query<{ audit_id: string }>(
    `select audit_id
     from harness_runtime.observability_root_claims
     where workflow_id=$1`,
    [workflowId],
  );
  assert.deepEqual(claim.rows, [{ audit_id: audits[0].id }]);
  const outboxes = await input.pool.query<{
    audit_id: string;
    status: string;
  }>(
    `select audit_id, status
     from harness_runtime.langfuse_outbox
     where audit_id=any($1::text[])
     order by audit_id`,
    [audits.map((audit) => audit.id)],
  );
  assert.deepEqual(outboxes.rows, [
    { audit_id: audits[2].id, status: 'discarded' },
    { audit_id: audits[1].id, status: 'discarded' },
    { audit_id: audits[0].id, status: 'queued' },
  ]);
  const drops = await input.pool.query<{
    audit_id: string;
    reason: string;
    source: string;
  }>(
    `select audit_id, reason, source
     from harness_runtime.observability_drop_events
     where audit_id=any($1::text[])
     order by audit_id`,
    [audits.map((audit) => audit.id)],
  );
  assert.deepEqual(drops.rows, [
    {
      audit_id: audits[2].id,
      reason: 'permanent-config',
      source: 'task-root-observability-conflict',
    },
  ]);
}

function productQuote(
  workspaceId: string,
  taskId: string,
  suffix: string,
): ProductQuoteSnapshot {
  return {
    quoteId: `quote-${suffix}`,
    workspaceId,
    taskId,
    revision: 'quote-r1',
    lifecycleStatus: 'dispatched',
  } as ProductQuoteSnapshot;
}

function productUsage(
  workspaceId: string,
  taskId: string,
  suffix: string,
): ProductUsageRecord {
  return {
    id: `usage-${suffix}`,
    quoteId: `quote-${suffix}`,
    taskId,
    workspaceId,
    status: 'committed',
    reservedQuantity: 1,
    settledQuantity: 1,
    refundedQuantity: 0,
    billingMode: 'per_request',
    settlementStatus: 'reconciled',
    resource: 'copy',
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
}

function boundedSnapshot(state: 'suspended' | 'resumed') {
  return {
    schemaVersion: 'bounded-execution-snapshot/v1' as const,
    maxIterations: state === 'suspended' ? 1 : 2,
    maxCostCents: 'unset' as const,
    maxWallClockMs: 'unset' as const,
    maxDelegations: 'unset' as const,
    requiredLimits: ['maxIterations' as const],
    consumption: {
      iterations: 1,
      costCents: 0,
      wallClockMs: 0,
      delegations: 0,
    },
    stopReason: state === 'suspended' ? ('limit_reached' as const) : null,
    triggeredLimit: state === 'suspended' ? ('maxIterations' as const) : null,
  };
}
