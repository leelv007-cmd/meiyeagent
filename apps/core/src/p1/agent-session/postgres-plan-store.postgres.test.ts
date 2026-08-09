/**
 * PostgreSQL MarketingPlanStore acceptance (V31-09).
 * Skips when TEST_DATABASE_URL is unset (no self-started Postgres).
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { migratePostgresSchema } from '../../postgres-schema-migration.js';
import { MemoryMarketingPlanStore } from './memory-plan-store.js';
import {
  createFixturePlanCompilerPorts,
  PlanCompiler,
} from './plan-compiler.js';
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
