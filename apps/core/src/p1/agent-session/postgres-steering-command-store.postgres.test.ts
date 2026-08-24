/**
 * PostgreSQL acceptance for p1_make_steering_commands (V31-16).
 * Skips without TEST_DATABASE_URL — Memory store covers unit seams.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresSteeringCommandStore } from './postgres-steering-command-store.js';
import { SteeringService } from './steering-service.js';

const connectionString = process.env.TEST_DATABASE_URL;

const describePg = connectionString ? test : test.skip;

describePg('PostgresSteeringCommandStore migrates and persists commands', async () => {
  assert.ok(connectionString);
  const pool = new Pool({ connectionString });
  const store = new PostgresSteeringCommandStore(pool);
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `ws-steer-${suffix}`;
  const commandId = `steer-pg-${suffix}`;
  const taskId = `task-steer-${suffix}`;
  const threadId = `thread-steer-${suffix}`;

  try {
    await store.migrate();
    const again = store.migrate();
    await assert.doesNotReject(again);

    const table = await pool.query(
      `SELECT 1 AS ok
         FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'p1_make_steering_commands'`,
    );
    assert.equal(table.rows.length, 1);

    const svc = new SteeringService({
      store,
      now: () => '2026-08-08T12:00:00.000Z',
      idFactory: () => commandId,
    });
    const submitted = await svc.submit({
      commandId,
      workspaceId,
      threadId,
      taskId,
      actorId: 'actor-1',
      instruction: '第二页少点字',
      sourcePlanRevision: 5,
      snapshotHash: 'snap-pg-5',
      sourceContentVersionIds: ['v1'],
      units: [
        { unitId: 'unit-1', status: 'pending', label: '封面', pageIndex: 0 },
        { unitId: 'unit-2', status: 'pending', label: '第2页', pageIndex: 1 },
      ],
      applyImmediately: true,
    });
    assert.equal(submitted.command.snapshotHash, 'snap-pg-5');
    assert.equal(submitted.command.sourcePlanRevision, 5);
    assert.equal(submitted.applicationStatus, 'accepted');

    const restarted = new PostgresSteeringCommandStore(pool);
    const loaded = await restarted.getById(commandId);
    assert.ok(loaded);
    assert.equal(loaded.command.taskId, taskId);
    assert.equal(loaded.command.snapshotHash, 'snap-pg-5');
    assert.equal(loaded.applicationStatus, 'accepted');

    const listed = await restarted.listByTask({ workspaceId, taskId });
    assert.equal(listed.length, 1);
  } finally {
    await pool.query(
      'DELETE FROM p1_make_steering_commands WHERE workspace_id = $1',
      [workspaceId],
    );
    await pool.end();
  }
});

describePg('V31-107 progress rows persist label/page_index and drive cover billing', async () => {
  assert.ok(connectionString);
  const pool = new Pool({ connectionString });
  const store = new PostgresSteeringCommandStore(pool);
  const suffix = randomUUID().slice(0, 8);
  const workspaceId = `ws-steer-107-${suffix}`;
  const harnessTaskId = `composer-task:${suffix}:plan-r1`;
  const bareTaskId = `composer-task:${suffix}`;

  try {
    await store.migrate();
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'p1_make_steering_task_progress'
          AND column_name IN ('label', 'page_index')
        ORDER BY column_name`,
    );
    assert.deepEqual(
      columns.rows.map((row) => row.column_name),
      ['label', 'page_index'],
    );

    await store.recordTaskProgress({
      workspaceId,
      taskId: harnessTaskId,
      cursor: {
        justCompletedUnitId: 'page-1',
        remainingUnitIds: ['page-2', 'page-3'],
        allUnitsTerminal: false,
        units: [
          { unitId: 'page-1', label: '封面', pageIndex: 0 },
          { unitId: 'page-2', label: '第2页', pageIndex: 1 },
          { unitId: 'page-3', label: '第3页', pageIndex: 2 },
        ],
      },
    });

    const progress = await store.getTaskProgress({
      workspaceId,
      taskId: bareTaskId,
    });
    assert.deepEqual(progress, [
      { unitId: 'page-1', status: 'completed', label: '封面', pageIndex: 0 },
      { unitId: 'page-2', status: 'pending', label: '第2页', pageIndex: 1 },
      { unitId: 'page-3', status: 'pending', label: '第3页', pageIndex: 2 },
    ]);

    const billed = new SteeringService({
      store,
      now: () => '2026-08-25T00:00:00.000Z',
      idFactory: () => `steer-107-billed-${suffix}`,
      previewDerivedQuote: async ({ alreadyInvokedCount }) => ({
        creditCost: 12 * alreadyInvokedCount,
      }),
    });
    const cover = await billed.submit({
      workspaceId,
      threadId: `thread-107-${suffix}`,
      taskId: bareTaskId,
      actorId: 'actor-1',
      instruction: '封面不要写最后两个名额',
      sourcePlanRevision: 1,
      snapshotHash: 'snap-107',
      units: progress.map((row) => ({
        unitId: row.unitId,
        status: row.status,
        ...(row.label ? { label: row.label } : {}),
        ...(typeof row.pageIndex === 'number' ? { pageIndex: row.pageIndex } : {}),
      })),
    });
    assert.equal(cover.classification.kind, 'derived_revision');
    assert.deepEqual(cover.affectedUnitIds, ['page-1']);
    assert.doesNotMatch(cover.impactSummary, /整篇/u);
    assert.equal(cover.impact.rebilled, true);
    assert.match(cover.impact.feeNote, /并计 12 积分/u);
    assert.doesNotMatch(cover.impact.feeNote, /成本|上游|token|USD|\$/iu);

    const pending = await billed.submit({
      commandId: `steer-107-pending-${suffix}`,
      workspaceId,
      threadId: `thread-107-${suffix}`,
      taskId: `${bareTaskId}-pending`,
      actorId: 'actor-1',
      instruction: '封面不要写最后两个名额',
      sourcePlanRevision: 1,
      snapshotHash: 'snap-107',
      units: progress.map((row) => ({
        unitId: row.unitId,
        status: 'pending' as const,
        ...(row.label ? { label: row.label } : {}),
        ...(typeof row.pageIndex === 'number' ? { pageIndex: row.pageIndex } : {}),
      })),
    });
    assert.equal(pending.classification.kind, 'future_step_patch');
    assert.equal(pending.impact.rebilled, false);
    assert.match(pending.impact.feeNote, /不额外算积分/u);

    const stripped = await billed.submit({
      commandId: `steer-107-stripped-${suffix}`,
      workspaceId,
      threadId: `thread-107-${suffix}`,
      taskId: `${bareTaskId}-stripped`,
      actorId: 'actor-1',
      instruction: '封面不要写最后两个名额',
      sourcePlanRevision: 1,
      snapshotHash: 'snap-107',
      units: progress.map((row) => ({
        unitId: row.unitId,
        status: 'completed' as const,
      })),
    });
    assert.notDeepEqual(stripped.affectedUnitIds, ['page-1']);
    assert.match(stripped.impactSummary, /整篇/u);
  } finally {
    await pool.query(
      'DELETE FROM p1_make_steering_task_progress WHERE workspace_id = $1',
      [workspaceId],
    );
    await pool.query(
      'DELETE FROM p1_make_steering_commands WHERE workspace_id = $1',
      [workspaceId],
    );
    await pool.end();
  }
});
