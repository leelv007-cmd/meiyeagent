/**
 * PostgreSQL MarketingPlanStore acceptance (V31-09 / V31-40 outbox).
 * Skips when TEST_DATABASE_URL is unset (no self-started Postgres).
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import {
  AgentSemanticEventProjector,
  PostgresAgentSemanticEventStore,
} from '../agent-semantic-events/index.js';
import { migratePostgresSchema } from '../../postgres-schema-migration.js';
import { MemoryMarketingPlanStore } from './memory-plan-store.js';
import { PostgresAgentSessionStore } from './postgres-agent-session-store.js';
import {
  createFixturePlanCompilerPorts,
  PlanCompiler,
} from './plan-compiler.js';
import { PlanEventOutboxDispatcher } from './plan-event-outbox-dispatcher.js';
import { planSemanticEventId } from './plan-semantic-event.js';
import { PostgresMarketingPlanStore } from './postgres-plan-store.js';

const connectionString = process.env.TEST_DATABASE_URL;
const skip = connectionString ? false : 'TEST_DATABASE_URL is not configured';
const TS = '2026-08-08T12:00:00.000Z';

test(
  'Postgres marketing plan store migrates cleanly and is append-only',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresMarketingPlanStore(pool);
    try {
      await migratePostgresSchema(pool, [store]);
      await migratePostgresSchema(pool, [store]);

      const columns = await pool.query<{ column_name: string }>(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'p1_marketing_plan_revisions'
          ORDER BY column_name`,
      );
      const names = columns.rows.map((row) => row.column_name);
      assert.ok(names.includes('plan_id'));
      assert.ok(names.includes('revision'));
      assert.ok(names.includes('payload'));
      assert.ok(names.includes('execution_plan'));
      assert.equal(names.includes('status'), false);
      assert.equal(names.includes('readiness'), false);

      const planId = `plan-pg-${randomUUID()}`;
      const compiler = new PlanCompiler({
        store,
        ports: createFixturePlanCompilerPorts(),
      });
      const first = await compiler.compile({
        workspaceId: 'ws-pg-1',
        threadId: 'thread-pg-1',
        planId,
        proposal: {
          goalNarrative: 'PG 验收方案',
          recommendedDeliverables: [
            { carrier: 'copy', quantity: 1, purpose: '文案' },
          ],
        },
        intentRevision: 1,
        contextBundleId: 'bundle-pg',
        contextRevision: '1',
        harnessReleaseId: 'release-pg',
        now: '2026-08-08T12:00:00.000Z',
      });
      assert.equal(first.revision.revision, 1);

      const second = await compiler.adjust({
        workspaceId: 'ws-pg-1',
        threadId: 'thread-pg-1',
        existingPlanId: planId,
        proposal: {
          goalNarrative: 'PG 验收方案',
          recommendedDeliverables: [
            { carrier: 'copy', quantity: 1, purpose: '文案' },
          ],
        },
        patch: {
          summary: '再自然一点',
          instructions: '语气软一点',
        },
        intentRevision: 1,
        contextBundleId: 'bundle-pg',
        contextRevision: '1',
        harnessReleaseId: 'release-pg',
        now: '2026-08-08T12:05:00.000Z',
      });
      assert.equal(second.revision.revision, 2);

      const refreshInput = {
        planId,
        expectedRevision: 2,
        quoteRef: { id: 'quote-pg-live', revision: 'quote-live-r2' },
        rightsRevisionRefs: ['rights-pg-live-r2'],
        factRevisionRefs: ['fact-pg-live-r2'],
        now: '2026-08-08T12:06:00.000Z',
        workspaceId: 'ws-pg-1',
      };
      const [refreshed, replayed] = await Promise.all([
        compiler.refreshLiveBindings(refreshInput),
        compiler.refreshLiveBindings(refreshInput),
      ]);
      assert.equal(refreshed.revision.revision, 3);
      assert.equal(replayed.revision.contentHash, refreshed.revision.contentHash);
      assert.deepEqual(refreshed.revision.quoteRef, refreshInput.quoteRef);
      assert.deepEqual(
        refreshed.revision.boundRevisions.rightsRevisionIds,
        refreshInput.rightsRevisionRefs,
      );
      assert.deepEqual(
        refreshed.revision.factUsages,
        [{ factRef: 'fact-pg-live-r2' }],
      );

      const listed = await store.listRevisions(planId);
      assert.equal(listed.length, 3);
      assert.equal(listed[0]!.contentHash, first.revision.contentHash);

      const reloaded = await store.getRevision(planId, 1);
      assert.ok(reloaded);
      assert.equal(reloaded!.revision.contentHash, first.revision.contentHash);
      assert.equal(
        reloaded!.executionPlan.schemaVersion,
        'compiled-execution-plan/v1',
      );
    } finally {
      await pool.query(
        `DELETE FROM p1_marketing_plan_revisions WHERE plan_id LIKE 'plan-pg-%'`,
      );
      await pool.end();
    }
  },
);

test('memory store sequence guard rejects non-monotonic revisions', async () => {
  const store = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store,
    ports: createFixturePlanCompilerPorts(),
  });
  await compiler.compile({
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    planId: 'plan-seq-1',
    proposal: {
      goalNarrative: 'seq',
      recommendedDeliverables: [{ carrier: 'copy', quantity: 1 }],
    },
    intentRevision: 1,
    contextBundleId: 'b',
    contextRevision: '1',
    harnessReleaseId: 'r',
    now: '2026-08-08T12:00:00.000Z',
  });

  await assert.rejects(async () => {
    const { marketingPlanRevisionSchema, compiledExecutionPlanSchema } =
      await import('@meiye/contracts');
    await store.append({
      revision: marketingPlanRevisionSchema.parse({
        schemaVersion: 'marketing-plan-revision/v1',
        planId: 'plan-seq-1',
        revision: 5,
        threadId: 'thread-1',
        goalIds: [],
        scope: 'single_work',
        intent: { summary: 'x' },
        goal: { summary: 'x', whyNow: null, desiredAction: 'y' },
        deliverables: [{ deliverableId: 'd1', kind: 'copy', quantity: 1 }],
        expression: {},
        factUsages: [],
        assetUsages: [],
        rightsSummary: {},
        complianceSummary: {},
        capabilitySummary: {},
        quoteRef: { id: 'q', revision: 1 },
        boundRevisions: {
          intentRevision: 1,
          contextBundleId: 'b',
          contextRevision: '1',
          recipeRevisionIds: [],
          catalogRevisionId: 'c',
          modelRevisionIds: [],
          sourceRevisionIds: [],
          rightsRevisionIds: [],
          harnessReleaseId: 'r',
        },
        contentHash: 'hash',
        expiresAt: '2026-08-08T13:00:00.000Z',
        createdAt: '2026-08-08T12:00:00.000Z',
      }),
      executionPlan: compiledExecutionPlanSchema.parse({
        schemaVersion: 'compiled-execution-plan/v1',
        units: [{ unitId: 'u1', unitType: 'copy.generate' }],
        dependencyGroups: [{ groupId: 'g1', unitIds: ['u1'] }],
        boundedRetry: {
          u1: {
            maxAttempts: 1,
            maxCostCents: 0,
            retry: { enabled: false },
          },
        },
      }),
    });
  }, /revision must be 2/u);
});

test(
  'V31-40: append creates outbox candidate in same transaction (no revision without outbox)',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresMarketingPlanStore(pool);
    const planId = `plan-outbox-atom-${randomUUID()}`;
    try {
      await migratePostgresSchema(pool, [store]);

      const compiler = new PlanCompiler({
        store,
        ports: createFixturePlanCompilerPorts(),
      });
      const first = await compiler.compile({
        workspaceId: 'ws-outbox-atom',
        threadId: 'thread-outbox-atom',
        planId,
        proposal: {
          goalNarrative: 'outbox 原子方案',
          recommendedDeliverables: [
            { carrier: 'copy', quantity: 1, purpose: '文案' },
          ],
        },
        intentRevision: 1,
        contextBundleId: 'bundle-outbox',
        contextRevision: '1',
        harnessReleaseId: 'release-outbox',
        now: '2026-08-08T12:00:00.000Z',
      });

      const eventId = planSemanticEventId(planId, first.revision.revision);
      const outbox = await pool.query<{
        event_id: string;
        dispatch_state: string;
        workspace_id: string;
        plan_id: string;
        revision: string;
      }>(
        `SELECT event_id, dispatch_state, workspace_id, plan_id, revision::text AS revision
           FROM p1_marketing_plan_event_outbox
          WHERE plan_id = $1 AND revision = $2`,
        [planId, first.revision.revision],
      );
      assert.equal(outbox.rows.length, 1);
      assert.equal(outbox.rows[0]!.event_id, eventId);
      assert.equal(outbox.rows[0]!.workspace_id, 'ws-outbox-atom');
      // emit marks dispatched when semantic sink is bound; without sink row stays pending.
      assert.equal(outbox.rows[0]!.dispatch_state, 'pending');

      const revisionCount = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM p1_marketing_plan_revisions WHERE plan_id = $1`,
        [planId],
      );
      const outboxCount = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM p1_marketing_plan_event_outbox WHERE plan_id = $1`,
        [planId],
      );
      assert.equal(revisionCount.rows[0]!.n, outboxCount.rows[0]!.n);
    } finally {
      await pool.query(
        `DELETE FROM p1_marketing_plan_event_outbox WHERE plan_id = $1`,
        [planId],
      );
      await pool.query(
        `DELETE FROM p1_marketing_plan_revisions WHERE plan_id = $1`,
        [planId],
      );
      await pool.end();
    }
  },
);

test(
  'V31-40: kill after commit before dispatch → restart projects once (idempotent)',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const planStore = new PostgresMarketingPlanStore(pool);
    const eventStore = new PostgresAgentSemanticEventStore(pool);
    const planId = `plan-outbox-kill-${randomUUID()}`;
    const workspaceId = `ws-outbox-kill-${randomUUID().slice(0, 8)}`;
    try {
      await migratePostgresSchema(pool, [planStore, eventStore]);

      // No semanticEvents sink: models "process killed after append, before emit".
      const compiler = new PlanCompiler({
        store: planStore,
        ports: createFixturePlanCompilerPorts(),
      });
      const compiled = await compiler.compile({
        workspaceId,
        threadId: 'thread-outbox-kill',
        planId,
        proposal: {
          goalNarrative: '崩溃恢复方案',
          recommendedDeliverables: [
            { carrier: 'copy', quantity: 1, purpose: '文案' },
          ],
        },
        intentRevision: 1,
        contextBundleId: 'bundle-kill',
        contextRevision: '1',
        harnessReleaseId: 'release-kill',
        now: '2026-08-08T12:00:00.000Z',
      });
      const eventId = planSemanticEventId(planId, compiled.revision.revision);

      const pendingBefore = await pool.query<{ event_id: string }>(
        `SELECT event_id
           FROM p1_marketing_plan_event_outbox
          WHERE dispatch_state = 'pending'`,
      );
      assert.ok(
        pendingBefore.rows.some((row) => row.event_id === eventId),
        'outbox candidate must exist after append without emit',
      );

      const projector = new AgentSemanticEventProjector(eventStore);
      const dispatcher = new PlanEventOutboxDispatcher(
        planStore,
        {
          project: (candidate) => projector.project(candidate),
          getByEventId: (input) => eventStore.getByEventId(input),
        },
        { batchSize: 100 },
      );

      // Restart after kill: drain until this row is dispatched.
      let dispatched = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await dispatcher.runOnce();
        const state = await pool.query<{ dispatch_state: string }>(
          `SELECT dispatch_state FROM p1_marketing_plan_event_outbox WHERE event_id = $1`,
          [eventId],
        );
        if (state.rows[0]?.dispatch_state === 'dispatched') {
          dispatched = true;
          break;
        }
      }
      assert.equal(dispatched, true, 'outbox row must reach dispatched');

      const events = await eventStore.listByThread({
        resourceId: workspaceId,
        threadId: 'thread-outbox-kill',
      });
      const planEvents = events.filter((event) => event.eventId === eventId);
      assert.equal(planEvents.length, 1);
      assert.equal(planEvents[0]?.eventType, 'plan.created');

      // Restart again: still exactly one projected event for this plan.
      await dispatcher.runOnce();
      const after = await eventStore.listByThread({
        resourceId: workspaceId,
        threadId: 'thread-outbox-kill',
      });
      assert.equal(
        after.filter((event) => event.eventId === eventId).length,
        1,
      );
    } finally {
      await pool.query(
        `DELETE FROM p1_marketing_plan_event_outbox WHERE plan_id = $1`,
        [planId],
      );
      await pool.query(
        `DELETE FROM p1_marketing_plan_revisions WHERE plan_id = $1`,
        [planId],
      );
      await pool.query(
        `DELETE FROM p1_agent_semantic_events WHERE resource_id = $1`,
        [workspaceId],
      );
      await pool.end();
    }
  },
);

test(
  'V31-40: dispatch is idempotent under duplicate claim',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const planStore = new PostgresMarketingPlanStore(pool);
    const eventStore = new PostgresAgentSemanticEventStore(pool);
    const planId = `plan-outbox-idem-${randomUUID()}`;
    const workspaceId = `ws-outbox-idem-${randomUUID().slice(0, 8)}`;
    try {
      await migratePostgresSchema(pool, [planStore, eventStore]);
      const compiler = new PlanCompiler({
        store: planStore,
        ports: createFixturePlanCompilerPorts(),
      });
      await compiler.compile({
        workspaceId,
        threadId: 'thread-outbox-idem',
        planId,
        proposal: {
          goalNarrative: '幂等派发方案',
          recommendedDeliverables: [
            { carrier: 'copy', quantity: 1, purpose: '文案' },
          ],
        },
        intentRevision: 1,
        contextBundleId: 'bundle-idem',
        contextRevision: '1',
        harnessReleaseId: 'release-idem',
        now: '2026-08-08T12:00:00.000Z',
      });
      const eventId = planSemanticEventId(planId, 1);
      const projector = new AgentSemanticEventProjector(eventStore);
      const dispatcher = new PlanEventOutboxDispatcher(
        planStore,
        {
          project: (candidate) => projector.project(candidate),
          getByEventId: (input) => eventStore.getByEventId(input),
        },
        { batchSize: 100 },
      );

      for (let attempt = 0; attempt < 20; attempt += 1) {
        await dispatcher.runOnce();
        const state = await pool.query<{ dispatch_state: string }>(
          `SELECT dispatch_state FROM p1_marketing_plan_event_outbox WHERE event_id = $1`,
          [eventId],
        );
        if (state.rows[0]?.dispatch_state === 'dispatched') break;
      }

      // Force pending again to simulate lost mark / concurrent re-claim.
      await pool.query(
        `UPDATE p1_marketing_plan_event_outbox
            SET dispatch_state = 'pending', dispatched_at = NULL
          WHERE event_id = $1`,
        [eventId],
      );
      const replay = await dispatcher.runOnce();
      assert.ok(replay.alreadyProjected >= 1);
      assert.equal(
        (
          await eventStore.listByThread({
            resourceId: workspaceId,
            threadId: 'thread-outbox-idem',
          })
        ).filter((event) => event.eventId === eventId).length,
        1,
      );
    } finally {
      await pool.query(
        `DELETE FROM p1_marketing_plan_event_outbox WHERE plan_id = $1`,
        [planId],
      );
      await pool.query(
        `DELETE FROM p1_marketing_plan_revisions WHERE plan_id = $1`,
        [planId],
      );
      await pool.query(
        `DELETE FROM p1_agent_semantic_events WHERE resource_id = $1`,
        [workspaceId],
      );
      await pool.end();
    }
  },
);

test(
  'V31-46: legacy outbox recovery uses the authoritative thread boundary and an already projected candidate',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const planStore = new PostgresMarketingPlanStore(pool);
    const eventStore = new PostgresAgentSemanticEventStore(pool);
    const sessions = new PostgresAgentSessionStore(pool);
    const planId = `plan-outbox-legacy-${randomUUID()}`;
    const workspaceId = `ws-outbox-legacy-${randomUUID().slice(0, 8)}`;
    const threadId = `thread-outbox-legacy-${randomUUID().slice(0, 8)}`;
    try {
      await migratePostgresSchema(pool, [sessions, planStore, eventStore]);
      await sessions.createThread({
        resourceId: workspaceId,
        threadId,
        title: 'legacy outbox boundary',
        now: TS,
      });
      const compiler = new PlanCompiler({
        store: planStore,
        ports: createFixturePlanCompilerPorts(),
      });
      const compiled = await compiler.compile({
        workspaceId,
        resourceId: workspaceId,
        threadId,
        planId,
        proposal: {
          goalNarrative: 'legacy candidate recovery',
          recommendedDeliverables: [{ carrier: 'copy', quantity: 1 }],
        },
        intentRevision: 1,
        contextBundleId: 'legacy-outbox-context',
        contextRevision: '1',
        harnessReleaseId: 'legacy-outbox-release',
        now: TS,
      });
      const eventId = planSemanticEventId(planId, compiled.revision.revision);
      const candidate = await planStore.getPlanEventOutboxCandidate(eventId);
      assert.ok(candidate);
      await eventStore.appendProjected(candidate!);

      // This is the old V31-40 loose shape, including the forbidden threadId
      // boundary fallback. It may only be repaired from authoritative rows.
      await pool.query(
        `UPDATE p1_marketing_plan_event_outbox
            SET workspace_id = thread_id,
                payload = $2::jsonb,
                dispatch_state = 'pending',
                dispatched_at = NULL,
                claim_token = NULL,
                lease_expires_at = NULL,
                next_attempt_at = clock_timestamp()
          WHERE event_id = $1`,
        [
          eventId,
          JSON.stringify({
            eventId,
            eventType: 'plan.created',
            planId,
            revision: compiled.revision.revision,
            threadId,
            workspaceId: threadId,
          }),
        ],
      );
      await planStore.migrate();

      const recovered = await pool.query<{
        workspace_id: string;
        dispatch_state: string;
        payload: unknown;
      }>(
        `SELECT workspace_id, dispatch_state, payload
           FROM p1_marketing_plan_event_outbox
          WHERE event_id = $1`,
        [eventId],
      );
      assert.deepEqual(recovered.rows[0], {
        workspace_id: workspaceId,
        dispatch_state: 'dispatched',
        payload: candidate,
      });
    } finally {
      await pool.query(
        `DELETE FROM p1_marketing_plan_event_outbox WHERE plan_id = $1`,
        [planId],
      );
      await pool.query(
        `DELETE FROM p1_marketing_plan_revisions WHERE plan_id = $1`,
        [planId],
      );
      await pool.query(
        `DELETE FROM p1_agent_semantic_events WHERE resource_id = $1`,
        [workspaceId],
      );
      await pool.query(
        `DELETE FROM p1_agent_threads WHERE thread_id = $1`,
        [threadId],
      );
      await pool.end();
    }
  },
);

test(
  'V31-46: PostgreSQL retries back off and poison or divergent candidates dead-letter',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const planStore = new PostgresMarketingPlanStore(pool);
    const eventStore = new PostgresAgentSemanticEventStore(pool);
    const workspaceId = `ws-outbox-state-${randomUUID().slice(0, 8)}`;
    const planIds: string[] = [];
    const append = async (suffix: string) => {
      const planId = `plan-outbox-state-${suffix}-${randomUUID()}`;
      planIds.push(planId);
      const compiler = new PlanCompiler({
        store: planStore,
        ports: createFixturePlanCompilerPorts(),
      });
      const compiled = await compiler.compile({
        workspaceId,
        resourceId: workspaceId,
        threadId: `thread-outbox-state-${suffix}`,
        planId,
        proposal: {
          goalNarrative: `outbox ${suffix}`,
          recommendedDeliverables: [{ carrier: 'copy', quantity: 1 }],
        },
        intentRevision: 1,
        contextBundleId: `outbox-state-${suffix}`,
        contextRevision: '1',
        harnessReleaseId: 'outbox-state-release',
        now: TS,
      });
      const eventId = planSemanticEventId(planId, compiled.revision.revision);
      const candidate = await planStore.getPlanEventOutboxCandidate(eventId);
      assert.ok(candidate);
      return { planId, eventId, candidate: candidate! };
    };
    try {
      await migratePostgresSchema(pool, [planStore, eventStore]);
      const retry = await append('retry');
      await pool.query(
        `UPDATE p1_marketing_plan_event_outbox
            SET created_at = '2000-01-01T00:00:00.000Z',
                next_attempt_at = clock_timestamp()
          WHERE event_id = $1`,
        [retry.eventId],
      );
      const retryDispatcher = new PlanEventOutboxDispatcher(
        planStore,
        {
          getByEventId: async () => null,
          project: async () => {
            throw new Error('temporary projector outage');
          },
        },
        { batchSize: 1 },
      );
      const retryResult = await retryDispatcher.runOnce();
      assert.equal(retryResult.retried, 1);
      const retryState = await pool.query<{
        dispatch_state: string;
        attempt_count: number;
        retry_is_deferred: boolean;
      }>(
        `SELECT dispatch_state, attempt_count,
                next_attempt_at > clock_timestamp() AS retry_is_deferred
           FROM p1_marketing_plan_event_outbox
          WHERE event_id = $1`,
        [retry.eventId],
      );
      assert.deepEqual(retryState.rows[0], {
        dispatch_state: 'pending',
        attempt_count: 1,
        retry_is_deferred: true,
      });

      const poison = await append('poison');
      await pool.query(
        `UPDATE p1_marketing_plan_event_outbox
            SET payload = '{"bad":true}'::jsonb,
                created_at = '1999-01-01T00:00:00.000Z',
                next_attempt_at = clock_timestamp()
          WHERE event_id = $1`,
        [poison.eventId],
      );
      const projector = new AgentSemanticEventProjector(eventStore);
      const dispatcher = new PlanEventOutboxDispatcher(
        planStore,
        {
          getByEventId: (input) => eventStore.getByEventId(input),
          project: (candidate) => projector.project(candidate),
        },
        { batchSize: 1 },
      );
      assert.equal((await dispatcher.runOnce()).deadLettered, 1);

      const mutation = await append('mutation');
      await eventStore.appendProjected({
        ...mutation.candidate,
        payload: {
          ...(mutation.candidate.payload as Record<string, unknown>),
          adjustmentSummary: 'different persisted content',
        },
      });
      await pool.query(
        `UPDATE p1_marketing_plan_event_outbox
            SET created_at = '1998-01-01T00:00:00.000Z',
                next_attempt_at = clock_timestamp()
          WHERE event_id = $1`,
        [mutation.eventId],
      );
      assert.equal((await dispatcher.runOnce()).deadLettered, 1);

      const states = await pool.query<{
        event_id: string;
        dispatch_state: string;
        last_error: string | null;
      }>(
        `SELECT event_id, dispatch_state, last_error
           FROM p1_marketing_plan_event_outbox
          WHERE event_id = ANY($1::text[])
          ORDER BY event_id`,
        [[poison.eventId, mutation.eventId]],
      );
      assert.equal(states.rows.length, 2);
      for (const row of states.rows) {
        assert.equal(row.dispatch_state, 'dead_letter');
      }
      assert.match(
        states.rows.find((row) => row.event_id === mutation.eventId)?.last_error ?? '',
        /AGENT_SEMANTIC_EVENT_CONFLICT/u,
      );
      const metrics = await planStore.getPlanEventOutboxMetrics();
      assert.ok(metrics.deadLettered >= 2);
      assert.ok(metrics.oldestActiveAgeMs === null || metrics.oldestActiveAgeMs >= 0);
    } finally {
      await pool.query(
        `DELETE FROM p1_marketing_plan_event_outbox WHERE plan_id = ANY($1::text[])`,
        [planIds],
      );
      await pool.query(
        `DELETE FROM p1_marketing_plan_revisions WHERE plan_id = ANY($1::text[])`,
        [planIds],
      );
      await pool.query(
        `DELETE FROM p1_agent_semantic_events WHERE resource_id = $1`,
        [workspaceId],
      );
      await pool.end();
    }
  },
);

test(
  'V31-46: compiler fast path projects the exact candidate stored in PostgreSQL',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const planStore = new PostgresMarketingPlanStore(pool);
    const eventStore = new PostgresAgentSemanticEventStore(pool);
    const planId = `plan-outbox-fast-canonical-${randomUUID()}`;
    const workspaceId = `ws-outbox-fast-${randomUUID().slice(0, 8)}`;
    const threadId = `thread-outbox-fast-${randomUUID().slice(0, 8)}`;
    try {
      await migratePostgresSchema(pool, [planStore, eventStore]);
      const projector = new AgentSemanticEventProjector(eventStore);
      const compiler = new PlanCompiler({
        store: planStore,
        ports: createFixturePlanCompilerPorts(),
        semanticEvents: projector,
      });
      const compiled = await compiler.compile({
        workspaceId,
        resourceId: workspaceId,
        threadId,
        planId,
        proposal: {
          goalNarrative: 'canonical fast path',
          recommendedDeliverables: [{ carrier: 'copy', quantity: 1 }],
        },
        intentRevision: 1,
        contextBundleId: 'fast-canonical-context',
        contextRevision: '1',
        harnessReleaseId: 'fast-canonical-release',
        now: TS,
      });
      const eventId = planSemanticEventId(planId, compiled.revision.revision);
      const candidate = await planStore.getPlanEventOutboxCandidate(eventId);
      assert.ok(candidate);
      const outbox = await pool.query<{
        payload: unknown;
        dispatch_state: string;
      }>(
        `SELECT payload, dispatch_state
           FROM p1_marketing_plan_event_outbox
          WHERE event_id = $1`,
        [eventId],
      );
      const projected = await eventStore.getByEventId({
        resourceId: workspaceId,
        eventId,
      });
      assert.deepEqual(outbox.rows[0], {
        payload: candidate,
        dispatch_state: 'dispatched',
      });
      assert.deepEqual(projected?.payload, candidate!.payload);
      assert.equal(projected?.occurredAt, candidate!.occurredAt);
    } finally {
      await pool.query(
        `DELETE FROM p1_marketing_plan_event_outbox WHERE plan_id = $1`,
        [planId],
      );
      await pool.query(
        `DELETE FROM p1_marketing_plan_revisions WHERE plan_id = $1`,
        [planId],
      );
      await pool.query(
        `DELETE FROM p1_agent_semantic_events WHERE resource_id = $1`,
        [workspaceId],
      );
      await pool.end();
    }
  },
);

test(
  'V31-46: orphan outbox conflict accepts only the exact eventId, revision, and candidate',
  { skip },
  async () => {
    const pool = new Pool({ connectionString });
    const planStore = new PostgresMarketingPlanStore(pool);
    const workspaceId = `ws-outbox-conflict-${randomUUID().slice(0, 8)}`;
    const planIds: string[] = [];
    const createOrphan = async (suffix: string) => {
      const planId = `plan-outbox-conflict-${suffix}-${randomUUID()}`;
      planIds.push(planId);
      const compiler = new PlanCompiler({
        store: planStore,
        ports: createFixturePlanCompilerPorts(),
      });
      const compiled = await compiler.compile({
        workspaceId,
        resourceId: workspaceId,
        threadId: `thread-outbox-conflict-${suffix}`,
        planId,
        proposal: {
          goalNarrative: `conflict ${suffix}`,
          recommendedDeliverables: [{ carrier: 'copy', quantity: 1 }],
        },
        intentRevision: 1,
        contextBundleId: `conflict-${suffix}`,
        contextRevision: '1',
        harnessReleaseId: 'conflict-release',
        now: TS,
      });
      const eventId = planSemanticEventId(planId, compiled.revision.revision);
      const candidate = await planStore.getPlanEventOutboxCandidate(eventId);
      assert.ok(candidate);
      await pool.query(
        `DELETE FROM p1_marketing_plan_revisions WHERE plan_id = $1`,
        [planId],
      );
      return { planId, compiled, eventId, candidate: candidate! };
    };
    try {
      await migratePostgresSchema(pool, [planStore]);
      const exact = await createOrphan('exact');
      await assert.rejects(
        () =>
          planStore.append({
            revision: exact.compiled.revision,
            executionPlan: exact.compiled.executionPlan,
            semanticEventCandidate: exact.candidate,
          }),
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'PLAN_EVENT_WORKSPACE_REQUIRED',
      );
      await planStore.append({
        revision: exact.compiled.revision,
        executionPlan: exact.compiled.executionPlan,
        workspaceId,
        semanticEventCandidate: exact.candidate,
      });
      assert.equal(
        (
          await pool.query<{ n: string }>(
            `SELECT count(*)::text AS n
               FROM p1_marketing_plan_revisions
              WHERE plan_id = $1`,
            [exact.planId],
          )
        ).rows[0]?.n,
        '1',
      );

      const divergent = await createOrphan('divergent');
      await pool.query(
        `UPDATE p1_marketing_plan_event_outbox
            SET payload = $2::jsonb
          WHERE event_id = $1`,
        [
          divergent.eventId,
          JSON.stringify({
            ...divergent.candidate,
            payload: {
              ...(divergent.candidate.payload as Record<string, unknown>),
              adjustmentSummary: 'conflicting durable candidate',
            },
          }),
        ],
      );
      await assert.rejects(
        () =>
          planStore.append({
            revision: divergent.compiled.revision,
            executionPlan: divergent.compiled.executionPlan,
            workspaceId,
            semanticEventCandidate: divergent.candidate,
          }),
        (error: unknown) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'PLAN_EVENT_OUTBOX_CONFLICT',
      );
      assert.equal(
        (
          await pool.query<{ n: string }>(
            `SELECT count(*)::text AS n
               FROM p1_marketing_plan_revisions
              WHERE plan_id = $1`,
            [divergent.planId],
          )
        ).rows[0]?.n,
        '0',
      );
    } finally {
      await pool.query(
        `DELETE FROM p1_marketing_plan_event_outbox WHERE plan_id = ANY($1::text[])`,
        [planIds],
      );
      await pool.query(
        `DELETE FROM p1_marketing_plan_revisions WHERE plan_id = ANY($1::text[])`,
        [planIds],
      );
      await pool.end();
    }
  },
);
