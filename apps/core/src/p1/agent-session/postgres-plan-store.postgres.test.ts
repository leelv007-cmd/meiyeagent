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
import {
  createFixturePlanCompilerPorts,
  PlanCompiler,
} from './plan-compiler.js';
import { PlanEventOutboxDispatcher } from './plan-event-outbox-dispatcher.js';
import { planSemanticEventId } from './plan-semantic-event.js';
import { PostgresMarketingPlanStore } from './postgres-plan-store.js';

const connectionString = process.env.TEST_DATABASE_URL;
const skip = connectionString ? false : 'TEST_DATABASE_URL is not configured';

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

      const pendingBefore = await planStore.claimPendingPlanEventOutbox({
        limit: 100,
      });
      assert.ok(
        pendingBefore.some((row) => row.eventId === eventId),
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
