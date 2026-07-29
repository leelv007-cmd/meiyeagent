import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { LangfuseHttpSender } from './langfuse-sender.js';
import { HarnessLangfuseOutboxWorker } from './outbox-worker.js';
import { PostgresHarnessStore } from './postgres-store.js';
import { harnessRuntimeId } from './workspace-scope.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'real PostgreSQL keeps dead-letter drops independent, atomic, generational, and queryable',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const suffix = randomUUID();
    const auditId = `observability-drop-${suffix}`;
    const rollbackAuditId = `observability-drop-rollback-${suffix}`;
    const dropSource = `langfuse_ingestion_${suffix}`;
    const triggerName = `reject_observability_drop_${suffix.replaceAll('-', '')}`;
    const functionName = `${triggerName}_fn`;
    try {
      await store.applySchema();
      await insertOutboxFixture(pool, auditId);
      const [claimed] = await store.claimLangfuseBatch(1);
      assert.equal(claimed?.auditId, auditId);
      await store.markLangfuseFailed(
        auditId,
        'temporary outage',
        new Date(Date.now() - 1_000),
      );
      assert.equal(await dropCount(pool, auditId), 0);

      const [retried] = await store.claimLangfuseBatch(1);
      assert.equal(retried?.auditId, auditId);
      await store.markLangfuseDeadLetter(auditId, 'retry exhausted', [
        {
          signal: 'trace',
          reason: 'transient',
          count: 2,
          source: dropSource,
        },
        {
          signal: 'feedback',
          reason: 'transient',
          count: 1,
          source: dropSource,
        },
      ]);
      assert.equal(await dropCount(pool, auditId), 2);
      await store.markLangfuseDeadLetter(auditId, 'duplicate finalize', [
        {
          signal: 'trace',
          reason: 'transient',
          count: 2,
          source: dropSource,
        },
      ]);
      assert.equal(await dropCount(pool, auditId), 2);

      assert.equal(await store.replayLangfuseDeadLetter(auditId), true);
      const [replayed] = await store.claimLangfuseBatch(1);
      assert.equal(replayed?.auditId, auditId);
      await store.markLangfuseDeadLetter(auditId, 'second generation', [
        {
          signal: 'trace',
          reason: 'transient',
          count: 2,
          source: dropSource,
        },
      ]);
      assert.equal(await dropCount(pool, auditId), 3);
      const dropSummary = await store.readObservabilityDropSummary({
        windowStart: new Date(0),
        windowEnd: new Date(Date.now() + 60_000),
      });
      assert.deepEqual(
        dropSummary.filter(({ source }) => source === dropSource),
        [
          {
            signal: 'feedback',
            reason: 'transient',
            source: dropSource,
            count: 1,
          },
          {
            signal: 'trace',
            reason: 'transient',
            source: dropSource,
            count: 4,
          },
        ],
      );
      assert.equal(await store.discardLangfuseDeadLetter(auditId), true);
      assert.equal(await dropCount(pool, auditId), 3);

      await insertOutboxFixture(pool, rollbackAuditId);
      const [rollbackClaim] = await store.claimLangfuseBatch(1);
      assert.equal(rollbackClaim?.auditId, rollbackAuditId);
      await pool.query(
        `create function harness_runtime.${functionName}()
           returns trigger language plpgsql as $$
         begin
           raise exception 'forced independent drop failure';
         end
         $$`,
      );
      await pool.query(
        `create trigger ${triggerName}
           before insert on harness_runtime.observability_drop_events
           for each row execute function harness_runtime.${functionName}()`,
      );
      await assert.rejects(
        store.markLangfuseDeadLetter(rollbackAuditId, 'invalid config', [
          {
            signal: 'trace',
            reason: 'permanent-config',
            count: 1,
            source: dropSource,
          },
        ]),
        /forced independent drop failure/u,
      );
      const rolledBack = await pool.query<{ status: string }>(
        `select status
         from harness_runtime.langfuse_outbox
         where audit_id=$1`,
        [rollbackAuditId],
      );
      assert.equal(rolledBack.rows[0]?.status, 'sending');
    } finally {
      await pool.query(`drop trigger if exists ${triggerName}
        on harness_runtime.observability_drop_events`);
      await pool.query(
        `drop function if exists harness_runtime.${functionName}()`,
      );
      await pool.query(
        `delete from harness_runtime.observability_drop_events
         where audit_id=any($1::text[])`,
        [[auditId, rollbackAuditId]],
      );
      await pool.query(
        `delete from harness_runtime.audit_events
         where id=any($1::text[])`,
        [[auditId, rollbackAuditId]],
      );
      await pool.end();
    }
  },
);

test(
  'real PostgreSQL records a Langfuse outage and updates delivery health after recovery',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const auditId = `observability-recovery-${randomUUID()}`;
    const windowStart = new Date(Date.now() - 1_000);
    let available = false;
    let requests = 0;
    const sender = new LangfuseHttpSender({
      baseUrl: 'https://langfuse.test',
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      async fetch() {
        requests += 1;
        return new Response(
          JSON.stringify(
            available
              ? { successes: [] }
              : { error: 'temporarily unavailable' },
          ),
          {
            headers: { 'content-type': 'application/json' },
            status: available ? 200 : 503,
          },
        );
      },
    });
    const worker = new HarnessLangfuseOutboxWorker(store, sender, {
      maxAttempts: 1,
    });
    try {
      await store.applySchema();
      await insertOutboxFixture(pool, auditId);

      assert.deepEqual(await worker.runOnce(), {
        sent: 0,
        failed: 1,
        deadLettered: 1,
      });
      const drops = await store.readObservabilityDropSummary({
        windowStart,
        windowEnd: new Date(Date.now() + 1_000),
      });
      assert.deepEqual(
        drops.filter(
          ({ reason, source }) =>
            reason === 'transient' && source === 'langfuse_ingestion',
        ),
        [
          {
            signal: 'trace',
            reason: 'transient',
            source: 'langfuse_ingestion',
            count: 2,
          },
        ],
      );

      assert.equal(await store.replayLangfuseDeadLetter(auditId), true);
      const healthBeforeRecovery =
        await store.readObservabilityDeliveryHealth({
          now: new Date(),
        });
      const recoveryClock = await pool.query<{ current_time: Date }>(
        'select clock_timestamp() as current_time',
      );
      const recoveryStartedAt = recoveryClock.rows[0]?.current_time;
      assert.ok(recoveryStartedAt);
      available = true;
      assert.deepEqual(await worker.runOnce(), {
        sent: 1,
        failed: 0,
        deadLettered: 0,
      });
      const health = await store.readObservabilityDeliveryHealth({
        now: new Date(),
      });
      assert.ok(health.lastSuccessAt);
      assert.ok(
        health.lastSuccessAt.getTime() >= recoveryStartedAt.getTime(),
      );
      if (healthBeforeRecovery.lastSuccessAt) {
        assert.ok(
          health.lastSuccessAt.getTime() >
            healthBeforeRecovery.lastSuccessAt.getTime(),
        );
      }
      assert.equal(requests, 2);
    } finally {
      await pool.query(
        `delete from harness_runtime.observability_drop_events
         where audit_id=$1`,
        [auditId],
      );
      await pool.query(
        `delete from harness_runtime.audit_events where id=$1`,
        [auditId],
      );
      await pool.end();
    }
  },
);

test(
  'real PostgreSQL health and cutover reconciliation distinguish matched, missing, orphan, and legacy facts',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const suffix = randomUUID();
    const workspaceId = `observability-workspace-${suffix}`;
    const taskId = `observability-task-${suffix}`;
    const runtimeTaskId = harnessRuntimeId(workspaceId, taskId);
    const cleanupPattern = `%${suffix}%`;
    const reconciliationContractVersion = `observability/test/${suffix}`;
    let reconciliationWindow:
      | { start: Date; end: Date }
      | undefined;
    try {
      await store.applySchema();
      const cutoverAt =
        await store.activateObservabilityReconciliationCutover(
          reconciliationContractVersion,
        );
      await pool.query(
        `insert into harness_runtime.task_requests
           (task_id, workflow_id, runtime_id, fingerprint, request)
         values ($1,$1,$2,'fixture',$3::jsonb)`,
        [taskId, runtimeTaskId, JSON.stringify({ workspaceId })],
      );
      await store.recordStageTrace({
        workspaceId,
        id: `trace-writer-${suffix}`,
        taskId,
        stage: 'execution_selection',
        payload: { winnerCandidateId: 'candidate-1' },
      });
      const writerPair = await pool.query<{
        audit_trace_id: string;
        audit_version: string;
        trace_id: string;
        trace_version: string;
      }>(
        `select audit.trace_id as audit_trace_id,
                audit.trace_contract_version as audit_version,
                trace.id as trace_id,
                trace.trace_contract_version as trace_version
         from harness_runtime.audit_events audit
         join harness_runtime.decision_traces trace
           on trace.id=audit.trace_id and trace.task_id=audit.workflow_id
         where audit.workflow_id=$1
           and audit.event_type='stage_decision_recorded'`,
        [runtimeTaskId],
      );
      assert.deepEqual(writerPair.rows[0], {
        audit_trace_id: writerPair.rows[0]?.trace_id,
        audit_version: 'observability/v1',
        trace_id: writerPair.rows[0]?.trace_id,
        trace_version: 'observability/v1',
      });

      await store.appendAudit({
        workspaceId,
        id: `canonical-${suffix}`,
        workflowId: taskId,
        stage: 'observability_event_ingest',
        eventType: 'delivery_rating.recorded',
        payload: {},
      });
      const canonical = await pool.query<{
        trace_contract_version: string | null;
        trace_id: string | null;
      }>(
        `select trace_id, trace_contract_version
         from harness_runtime.audit_events
         where workflow_id=$1 and stage='observability_event_ingest'`,
        [runtimeTaskId],
      );
      assert.deepEqual(canonical.rows[0], {
        trace_id: null,
        trace_contract_version: null,
      });

      const start = new Date(cutoverAt.getTime() + 10_000);
      const end = new Date(cutoverAt.getTime() + 20_000);
      reconciliationWindow = { start, end };
      const before = new Date(start.getTime() - 1_000);
      const inside = new Date(start.getTime() + 1_000);
      const after = new Date(end.getTime() + 1_000);
      const ratingAuditId = `rating-aggregate-${suffix}`;
      const usageAuditId = `usage-aggregate-${suffix}`;
      const missingOutboxAuditId = `rating-missing-outbox-${suffix}`;
      const suspendedAuditId = `bounded-suspended-${suffix}`;
      const resumedAuditId = `bounded-resumed-${suffix}`;
      const noteAuditId = `note-regenerated-${suffix}`;
      const primitiveAuditId = `primitive-lifecycle-${suffix}`;
      await pool.query(
        `insert into harness_runtime.audit_events
           (id, workflow_id, stage, event_type, payload, created_at)
         values
           ($1,$1,'observability_event_ingest','delivery_rating.recorded',
            '{}'::jsonb,$3),
           ($2,$2,'observability_event_ingest','action_usage.recorded',
            '{}'::jsonb,$3),
           ($4,$4,'observability_event_ingest','delivery_rating.withdrawn',
            '{}'::jsonb,$3),
           ($5,$5,'observability_event_ingest','bounded_execution.suspended',
            '{}'::jsonb,$3),
           ($6,$6,'observability_event_ingest','bounded_execution.resumed',
            '{}'::jsonb,$3),
           ($7,$7,'observability_event_ingest','note_page_regenerated',
            '{}'::jsonb,$3),
           ($8,$8,'observability_event_ingest','agent_primitive.lifecycle',
            '{}'::jsonb,$3)`,
        [
          ratingAuditId,
          usageAuditId,
          inside,
          missingOutboxAuditId,
          suspendedAuditId,
          resumedAuditId,
          noteAuditId,
          primitiveAuditId,
        ],
      );
      await pool.query(
        `insert into harness_runtime.langfuse_outbox
           (audit_id, status, dead_lettered_at, sent_at)
         values
           ($1,'dead_letter',$3,null),
           ($2,'sent',null,$3)`,
        [ratingAuditId, usageAuditId, inside],
      );
      await pool.query(
        `insert into harness_runtime.observability_drop_events
           (audit_id, delivery_generation, signal, reason, count, source,
            occurred_at)
         values ($1,1,'score','transient',1,'langfuse_ingestion',$2)`,
        [ratingAuditId, inside],
      );
      await insertReconciliationTrace(
        pool,
        `trace-matched-${suffix}`,
        `task-matched-${suffix}`,
        inside,
        reconciliationContractVersion,
      );
      await insertReconciliationEvent(
        pool,
        `event-matched-${suffix}`,
        `task-matched-${suffix}`,
        `trace-matched-${suffix}`,
        inside,
        reconciliationContractVersion,
      );
      await insertReconciliationEvent(
        pool,
        `event-missing-${suffix}`,
        `task-missing-${suffix}`,
        `trace-does-not-exist-${suffix}`,
        inside,
        reconciliationContractVersion,
      );
      await insertReconciliationEventWithoutTrace(
        pool,
        `event-missing-link-${suffix}`,
        `task-missing-link-${suffix}`,
        inside,
      );
      await insertReconciliationTrace(
        pool,
        `trace-wrong-workflow-${suffix}`,
        `task-other-${suffix}`,
        inside,
        reconciliationContractVersion,
      );
      await insertReconciliationEvent(
        pool,
        `event-wrong-workflow-${suffix}`,
        `task-wrong-${suffix}`,
        `trace-wrong-workflow-${suffix}`,
        inside,
        reconciliationContractVersion,
      );
      await insertReconciliationTrace(
        pool,
        `trace-orphan-${suffix}`,
        `task-orphan-${suffix}`,
        inside,
        reconciliationContractVersion,
      );
      await insertReconciliationTrace(
        pool,
        `trace-before-${suffix}`,
        `task-cross-event-${suffix}`,
        before,
        reconciliationContractVersion,
      );
      await insertReconciliationEvent(
        pool,
        `event-cross-trace-${suffix}`,
        `task-cross-event-${suffix}`,
        `trace-before-${suffix}`,
        inside,
        reconciliationContractVersion,
      );
      await insertReconciliationTrace(
        pool,
        `trace-cross-event-${suffix}`,
        `task-cross-trace-${suffix}`,
        inside,
        reconciliationContractVersion,
      );
      await insertReconciliationEvent(
        pool,
        `event-after-${suffix}`,
        `task-cross-trace-${suffix}`,
        `trace-cross-event-${suffix}`,
        after,
        reconciliationContractVersion,
      );
      await pool.query(
        `delete from harness_runtime.observability_reconciliation_runs
         where contract_version=$3
           and window_start=$1
           and window_end=$2`,
        [start, end, reconciliationContractVersion],
      );

      const result = await store.reconcileBusinessEventsToTraces({
        windowStart: start,
        windowEnd: end,
        contractVersion: reconciliationContractVersion,
      });
      assert.deepEqual(
        {
          businessEventCount: result.businessEventCount,
          traceCount: result.traceCount,
          matchedCount: result.matchedCount,
          missingTraceCount: result.missingTraceCount,
          orphanTraceCount: result.orphanTraceCount,
          ratingEventCount: result.ratingEventCount,
          actionUsageEventCount: result.actionUsageEventCount,
          undeliveredEventCount: result.undeliveredEventCount,
        },
        {
          businessEventCount: 5,
          traceCount: 4,
          matchedCount: 2,
          missingTraceCount: 3,
          orphanTraceCount: 2,
          ratingEventCount: 2,
          actionUsageEventCount: 1,
          undeliveredEventCount: 6,
        },
      );
      await store.reconcileBusinessEventsToTraces({
        windowStart: start,
        windowEnd: end,
        contractVersion: reconciliationContractVersion,
      });
      const runs = await pool.query<{ count: number }>(
        `select count(*)::int as count
         from harness_runtime.observability_reconciliation_runs
         where window_start=$1 and window_end=$2 and contract_version=$3`,
        [start, end, reconciliationContractVersion],
      );
      assert.equal(runs.rows[0]?.count, 1);
      await store.completeObservabilityReconciliationWindow(
        {
          windowStart: start,
          windowEnd: end,
        },
        reconciliationContractVersion,
      );
      await assert.rejects(
        store.reconcileBusinessEventsToTraces({
          windowStart: start,
          windowEnd: end,
          contractVersion: reconciliationContractVersion,
        }),
        /window is unavailable/u,
      );
      assert.equal(
        (
          await store.readObservabilityReconciliationCursor(
            reconciliationContractVersion,
          )
        )?.toISOString(),
        end.toISOString(),
      );
      const boundary = await store.readObservabilityReconciliationBoundary({
        intervalMs: 5 * 60_000,
      });
      const databaseClock = await pool.query<{ current_time: Date }>(
        'select clock_timestamp() as current_time',
      );
      const currentTime = databaseClock.rows[0]?.current_time;
      assert.ok(currentTime);
      assert.ok(currentTime.getTime() - boundary.getTime() >= 5 * 60_000);
      assert.ok(currentTime.getTime() - boundary.getTime() < 10 * 60_000);
      assert.equal(boundary.getUTCMinutes() % 5, 0);
      assert.equal(boundary.getUTCSeconds(), 0);
      assert.equal(boundary.getUTCMilliseconds(), 0);

      const healthBefore = await store.readObservabilityDeliveryHealth({
        now: new Date(),
      });
      assert.ok(healthBefore.oldestQueuedAt);
      assert.ok(healthBefore.queueAgeMs !== null);
      const queued = await pool.query<{ audit_id: string }>(
        `select outbox.audit_id
         from harness_runtime.langfuse_outbox outbox
         join harness_runtime.audit_events audit on audit.id=outbox.audit_id
         where audit.workflow_id=$1 and outbox.status='queued'
         order by audit.created_at
         limit 1`,
        [runtimeTaskId],
      );
      const queuedAuditId = queued.rows[0]?.audit_id;
      assert.ok(queuedAuditId);
      const claimed = await store.claimLangfuseBatch(100);
      const own = claimed.find(({ auditId }) => auditId === queuedAuditId);
      assert.ok(own);
      await store.markLangfuseSent(queuedAuditId);
      const healthAfter = await store.readObservabilityDeliveryHealth({
        now: new Date(),
      });
      assert.ok(healthAfter.lastSuccessAt);
    } finally {
      if (reconciliationWindow) {
        await pool.query(
          `delete from harness_runtime.observability_reconciliation_runs
           where contract_version=$3
             and window_start=$1
             and window_end=$2`,
          [
            reconciliationWindow.start,
            reconciliationWindow.end,
            reconciliationContractVersion,
          ],
        );
      }
      await pool.query(
        `delete from harness_runtime.observability_reconciliation_cutovers
         where contract_version=$1`,
        [reconciliationContractVersion],
      );
      await pool.query(
        `delete from harness_runtime.observability_drop_events
         where audit_id like $1`,
        [cleanupPattern],
      );
      await pool.query(
        `delete from harness_runtime.audit_events
         where id like $1 or workflow_id=$2`,
        [cleanupPattern, runtimeTaskId],
      );
      await pool.query(
        `delete from harness_runtime.decision_traces
         where id like $1 or task_id=$2`,
        [cleanupPattern, runtimeTaskId],
      );
      await pool.query(
        `delete from harness_runtime.task_requests where task_id=$1`,
        [taskId],
      );
      await pool.end();
    }
  },
);

async function insertOutboxFixture(pool: Pool, auditId: string) {
  await pool.query(
    `insert into harness_runtime.audit_events
       (id, workflow_id, stage, event_type, payload)
     values ($1,$1,'observability_event_ingest','fixture','{}'::jsonb)`,
    [auditId],
  );
  await pool.query(
    `insert into harness_runtime.langfuse_outbox (audit_id, status)
     values ($1,'queued')`,
    [auditId],
  );
}

async function dropCount(pool: Pool, auditId: string) {
  const result = await pool.query<{ count: number }>(
    `select count(*)::int as count
     from harness_runtime.observability_drop_events
     where audit_id=$1`,
    [auditId],
  );
  return result.rows[0]?.count;
}

async function insertReconciliationTrace(
  pool: Pool,
  id: string,
  taskId: string,
  createdAt: Date,
  contractVersion: string,
) {
  await pool.query(
    `insert into harness_runtime.decision_traces
       (id, task_id, stage, payload, trace_contract_version, created_at)
     values ($1,$2,'fixture','{}'::jsonb,$4,$3)`,
    [id, taskId, createdAt, contractVersion],
  );
}

async function insertReconciliationEvent(
  pool: Pool,
  id: string,
  workflowId: string,
  traceId: string,
  createdAt: Date,
  contractVersion: string,
) {
  await pool.query(
    `insert into harness_runtime.audit_events
       (id, workflow_id, trace_id, trace_contract_version, stage, event_type,
        payload, created_at)
     values (
       $1,$2,$3,$5,'fixture','stage_decision_recorded','{}'::jsonb,$4
     )`,
    [id, workflowId, traceId, createdAt, contractVersion],
  );
}

async function insertReconciliationEventWithoutTrace(
  pool: Pool,
  id: string,
  workflowId: string,
  createdAt: Date,
) {
  await pool.query(
    `insert into harness_runtime.audit_events
       (id, workflow_id, stage, event_type, payload, created_at)
     values (
       $1,$2,'fixture','stage_decision_recorded','{}'::jsonb,$3
     )`,
    [id, workflowId, createdAt],
  );
}
