/**
 * V31-12 Postgres seam: one-shot snapshot admit + at-least-once replay.
 * Skips when TEST_DATABASE_URL is unset (local rule).
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { COMPILED_EXECUTION_PLAN_SCHEMA_VERSION } from '@meiye/contracts';

import {
  ExecutionPlanAdmissionError,
  ExecutionPlanAdmissionService,
  freezeExecutionPlanContent,
  type ExecutionPlanFrozenContent,
} from './execution-plan-admission.js';
import { PostgresExecutionPlanAdmissionMigration } from './postgres-execution-plan-admission-store.js';

const connectionString = process.env.TEST_DATABASE_URL;

const BOUNDED = {
  schemaVersion: 'bounded-execution-snapshot/v1' as const,
  maxIterations: 10,
  maxCostCents: 100,
  maxWallClockMs: 60_000,
  maxDelegations: 2,
  requiredLimits: ['maxIterations', 'maxCostCents'] as const,
  consumption: {
    iterations: 0,
    costCents: 0,
    wallClockMs: 0,
    delegations: 0,
  },
  stopReason: null,
  triggeredLimit: null,
};

function frozenContent(
  overrides: Partial<ExecutionPlanFrozenContent> = {},
): ExecutionPlanFrozenContent {
  return {
    planId: `plan-${randomUUID().slice(0, 8)}`,
    planRevision: 1,
    intentDeclaration: { summary: 'pg snapshot admit' },
    contextBundleRef: {
      bundleId: 'bundle-pg',
      revision: 1,
      hash: 'ctx-pg',
    },
    executionPlan: {
      schemaVersion: COMPILED_EXECUTION_PLAN_SCHEMA_VERSION,
      executionCapabilities: {
        scheduling: 'serial',
        retry: 'none',
        cache: 'none',
      },
      units: [
        {
          unitId: 'unit-1',
          unitType: 'copy.generate',
          primitive: 'generate',
        },
      ],
      dependencyGroups: [{ groupId: 'g1', unitIds: ['unit-1'] }],
      boundedRetry: {},
    },
    deliverables: [{ deliverableId: 'd1', kind: 'copy', quantity: 1 }],
    promptRevisionRefs: {},
    skillManifestRefs: {},
    routeRequirements: [],
    quoteRef: { id: 'quote-pg', revision: 1 },
    rightsRevisionRefs: [],
    factRevisionRefs: [],
    boundedExecution: {
      ...BOUNDED,
      requiredLimits: ['maxIterations', 'maxCostCents'],
    },
    harnessReleaseId: 'release-pg',
    approvalBasis: 'policy_exempt_copy',
    ...overrides,
  } as unknown as ExecutionPlanFrozenContent;
}

async function createFixture() {
  const pool = new Pool({ connectionString });
  const migration = new PostgresExecutionPlanAdmissionMigration(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await migration.migrate(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
    throw error;
  }
  client.release();
  const service = new ExecutionPlanAdmissionService(migration.store);
  return {
    service,
    store: migration.store,
    pool,
    async cleanup() {
      await pool.end();
    },
  };
}

test(
  'Postgres snapshot admit is one-shot and at-least-once replay safe',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const { service, cleanup } = fixture;
    try {
      const content = frozenContent();
      const { snapshotHash } = freezeExecutionPlanContent(content);
      const workflowId = `wf-pg-${randomUUID().slice(0, 8)}`;

      const first = await service.admit({
        workflowId,
        workspaceId: 'ws-pg',
        content,
        snapshotHash,
        admittedAt: '2026-08-08T12:00:00.000Z',
      });
      assert.equal(first.replayed, false);
      assert.equal(first.admitted.snapshot.snapshotHash, snapshotHash);

      const second = await service.admit({
        workflowId,
        workspaceId: 'ws-pg',
        content,
        snapshotHash,
        admittedAt: '2026-08-08T12:00:05.000Z',
      });
      assert.equal(second.replayed, true);
      assert.equal(second.admitted.admittedAt, first.admitted.admittedAt);

      await assert.rejects(
        () =>
          service.admit({
            workflowId: `wf-pg-other-${randomUUID().slice(0, 8)}`,
            workspaceId: 'ws-pg',
            content,
            snapshotHash,
          }),
        (error: unknown) =>
          error instanceof ExecutionPlanAdmissionError &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );

      const verified = await service.verifyAdmittedForDbos({ workflowId });
      assert.equal(verified.ok, true);
      assert.equal(verified.snapshotHash, snapshotHash);
    } finally {
      await cleanup();
    }
  },
);

test(
  // V31-55: a snapshot carrying an explicitly-undefined optional key (e.g.
  // intentDeclaration.assumptions, plan-compiler.ts:438) used to fail the
  // idempotent-replay comparison against its own freshly-inserted row —
  // JSONB storage drops the undefined key, isDeepStrictEqual does not treat
  // that as equal to an absent key — so the very first, sole admission
  // attempt self-rejected as "already bound to a different admission row".
  'Postgres snapshot admit is not fooled by an explicitly-undefined optional key into rejecting itself',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const { service, cleanup } = fixture;
    try {
      const content = frozenContent({
        intentDeclaration: {
          summary: 'undefined-key replay guard',
          assumptions: undefined,
        },
      } as Partial<ExecutionPlanFrozenContent>);
      const { snapshotHash } = freezeExecutionPlanContent(content);
      const workflowId = `wf-pg-undef-${randomUUID().slice(0, 8)}`;

      // ① Fresh admission of a snapshot carrying the explicit-undefined key
      // must succeed on the first attempt — no prior row exists to conflict
      // with.
      const first = await service.admit({
        workflowId,
        workspaceId: 'ws-pg',
        content,
        snapshotHash,
      });
      assert.equal(first.replayed, false);
      assert.equal(first.admitted.snapshot.snapshotHash, snapshotHash);

      // ② Replaying the exact same (hash, workflowId, payload) must be a
      // no-op that returns the persisted row, not a conflict.
      const second = await service.admit({
        workflowId,
        workspaceId: 'ws-pg',
        content,
        snapshotHash,
      });
      assert.equal(second.replayed, true);
      assert.equal(second.admitted.admittedAt, first.admitted.admittedAt);

      // ③ A genuine conflict — same hash, different workflowId — must still
      // be rejected. Normalizing the comparison must not loosen the real
      // conflict gate.
      await assert.rejects(
        () =>
          service.admit({
            workflowId: `wf-pg-undef-other-${randomUUID().slice(0, 8)}`,
            workspaceId: 'ws-pg',
            content,
            snapshotHash,
          }),
        (error: unknown) =>
          error instanceof ExecutionPlanAdmissionError &&
          error.code === 'IDEMPOTENCY_CONFLICT',
      );
    } finally {
      await cleanup();
    }
  },
);

test(
  // V31-90: mid-run steering only ever holds the merchant's bare task id, and
  // no exact-id probe built from it can reach the admitted row — the harness
  // admits `${taskId}:plan-r<n>` (composerPreparedAttemptId) with
  // `:plan:<revision>:<snapshotHash>` appended
  // (executionPlanAdmissionWorkflowId). The first two assertions are the
  // defect itself, pinned so the family lookup cannot quietly regress back to
  // an exact-id probe.
  'the admitted snapshot of a prepared attempt is reachable from the bare task id',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const { service, store, cleanup } = fixture;
    try {
      const workspaceId = `ws-v31-90-${randomUUID()}`;
      const taskId = `composer-task:${randomUUID()}`;
      const content = frozenContent();
      const { snapshotHash } = freezeExecutionPlanContent(content);
      const workflowId = `${taskId}:plan-r1:plan:1:${snapshotHash}`;
      await service.admit({
        workflowId,
        workspaceId,
        content,
        snapshotHash,
        admittedAt: '2026-08-23T01:00:00.000Z',
      });

      assert.equal(
        await store.getByWorkflowId(taskId),
        null,
        'the bare task id is not the admitted workflow id',
      );
      assert.equal(
        await store.getByWorkflowId(`${taskId}:plan-r1`),
        null,
        'neither is the prepared attempt id without its snapshot segment',
      );

      const resolved = await store.getLatestForTask({ workspaceId, taskId });
      assert.equal(resolved?.workflowId, workflowId);
      assert.equal(resolved?.snapshot.snapshotHash, snapshotHash);
    } finally {
      await cleanup();
    }
  },
);

test(
  'the task-family lookup stays inside its own task and workspace',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const { service, store, cleanup } = fixture;
    try {
      const workspaceId = `ws-v31-90-${randomUUID()}`;
      // A sibling whose id extends this one without the `:` separator must
      // never be adopted: `task-1` is not `task-12`'s admission.
      const taskId = `composer-task:${randomUUID()}`;
      const siblingTaskId = `${taskId}9`;
      const siblingContent = frozenContent();
      const sibling = freezeExecutionPlanContent(siblingContent);
      await service.admit({
        workflowId: `${siblingTaskId}:plan-r1:plan:1:${sibling.snapshotHash}`,
        workspaceId,
        content: siblingContent,
        snapshotHash: sibling.snapshotHash,
        admittedAt: '2026-08-23T01:00:00.000Z',
      });
      assert.equal(
        await store.getLatestForTask({ workspaceId, taskId }),
        null,
        'a longer sibling task id must not answer for this task',
      );

      const ownContent = frozenContent();
      const own = freezeExecutionPlanContent(ownContent);
      await service.admit({
        workflowId: `${taskId}:plan-r1:plan:1:${own.snapshotHash}`,
        workspaceId,
        content: ownContent,
        snapshotHash: own.snapshotHash,
        admittedAt: '2026-08-23T01:01:00.000Z',
      });
      assert.equal(
        (await store.getLatestForTask({ workspaceId, taskId }))?.snapshot
          .snapshotHash,
        own.snapshotHash,
      );
      assert.equal(
        await store.getLatestForTask({
          workspaceId: `${workspaceId}-other`,
          taskId,
        }),
        null,
        'another workspace must not read this admission',
      );
    } finally {
      await cleanup();
    }
  },
);

test(
  // A repriced successor admits a second attempt for the same task; the steer
  // must bind to the plan the merchant is actually watching.
  'the task-family lookup answers with the newest plan revision',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const { service, store, cleanup } = fixture;
    try {
      const workspaceId = `ws-v31-90-${randomUUID()}`;
      const taskId = `composer-task:${randomUUID()}`;
      const first = frozenContent();
      const firstFrozen = freezeExecutionPlanContent(first);
      await service.admit({
        workflowId: `${taskId}:plan-r1:plan:1:${firstFrozen.snapshotHash}`,
        workspaceId,
        content: first,
        snapshotHash: firstFrozen.snapshotHash,
        admittedAt: '2026-08-23T01:00:00.000Z',
      });
      const second = frozenContent({ planRevision: 2 });
      const secondFrozen = freezeExecutionPlanContent(second);
      await service.admit({
        workflowId: `${taskId}:plan-r2:plan:2:${secondFrozen.snapshotHash}`,
        workspaceId,
        content: second,
        snapshotHash: secondFrozen.snapshotHash,
        admittedAt: '2026-08-23T01:02:00.000Z',
      });

      const resolved = await store.getLatestForTask({ workspaceId, taskId });
      assert.equal(resolved?.snapshot.planRevision, 2);
      assert.equal(resolved?.snapshot.snapshotHash, secondFrozen.snapshotHash);
    } finally {
      await cleanup();
    }
  },
);
