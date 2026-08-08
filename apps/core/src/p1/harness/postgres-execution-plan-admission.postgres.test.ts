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
      units: [
        {
          unitId: 'unit-1',
          unitType: 'copy.generate',
          primitive: 'generate',
        },
      ],
      dependencyGroups: [{ groupId: 'g1', unitIds: ['unit-1'] }],
      boundedRetry: {
        'unit-1': {
          maxAttempts: 1,
          maxCostCents: 0,
          retry: { enabled: false },
        },
      },
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
