import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresDueDeliveryRepository } from './postgres-repository.js';
import { TaskRecallDueProducer } from './task-recall-producer.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'PostgreSQL replays one stable task recall due for a terminal success',
  { skip: !connectionString },
  async (t) => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresDueDeliveryRepository(pool);
    const producer = new TaskRecallDueProducer(repository);
    const workspaceId = `recall-workspace-${randomUUID()}`;
    const sourceTaskId = `source-task-${randomUUID()}`;
    const completedAt = '1900-03-01T01:02:03.000Z';
    const taskId = `task-recall_${workspaceId}_${sourceTaskId}`;

    t.after(async () => {
      await pool.query(
        'DELETE FROM p1_due_delivery_runs WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_due_delivery_items WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.end();
    });

    await repository.migrate();
    const input = { completedAt, sourceTaskId, workspaceId };
    const first = await producer.produce(input);
    const replay = await producer.produce(input);
    assert.equal(first.id, replay.id);
    assert.equal(first.taskId, taskId);

    const claims = await repository.claimBatch({
      claimToken: 'recall-claim',
      leaseMs: 60_000,
      limit: 100,
      now: new Date('1900-03-01T01:03:00.000Z'),
      workerId: 'recall-worker',
    });
    const local = claims.filter((claim) => claim.workspaceId === workspaceId);
    assert.equal(local.length, 1);
    assert.deepEqual(local[0], {
      attemptCount: 1,
      claimToken: 'recall-claim',
      dueAt: completedAt,
      id: first.id,
      payload: {
        nextStep: '回到任务查看已完成内容',
        schemaVersion: 'task-recall/v1',
        taskId: sourceTaskId,
        title: '你的内容已完成',
      },
      taskId,
      type: 'task_recall',
      workspaceId,
    });
  },
);
