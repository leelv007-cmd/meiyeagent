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
