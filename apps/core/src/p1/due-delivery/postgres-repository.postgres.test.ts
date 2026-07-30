import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';
import type { TodayRecommendationState } from '@meiye/contracts';

import { PostgresDueDeliveryRepository } from './postgres-repository.js';
import { DueAwareHarnessRecommendationReader } from './recommendation-reader.js';
import {
  DueDeliveryWorker,
  type DueDeliveryClaim,
  type DueDeliveryPort,
  type DueDeliveryRepository,
} from './worker.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'PostgreSQL atomically settles a delivered recommendation run and enqueues the next day',
  { skip: !connectionString },
  async (t) => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresDueDeliveryRepository(pool);
    const suffix = randomUUID();
    const workspaceId = `due-workspace-${suffix}`;
    const taskId = `daily-rec_${workspaceId}_2000-01-01`;

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
    assert.equal(
      await repository.readLatestDelivered(
        workspaceId,
        'daily_recommendation',
      ),
      null,
    );
    const due = await repository.enqueue({
      businessDate: '2000-01-01',
      dueAt: '2000-01-01T00:00:00.000Z',
      payload: {
        businessDate: '2000-01-01',
        schemaVersion: 'daily-recommendation/v1',
      },
      taskId,
      type: 'daily_recommendation',
      workspaceId,
    });
    const claimed = await repository.claimBatch({
      claimToken: 'claim-1',
      leaseMs: 60_000,
      limit: 10,
      now: new Date(),
      workerId: 'worker-1',
    });
    const claim = claimed.find((item) => item.id === due.id);
    assert.ok(claim);

    const run = await repository.beginDelivery({
      identity: {
        claimToken: claim.claimToken,
        dueId: claim.id,
        workspaceId,
      },
      taskId,
      type: 'daily_recommendation',
    });
    assert.ok(run);
    assert.equal(
      await repository.settleDelivered({
        identity: {
          claimToken: claim.claimToken,
          dueId: claim.id,
          workspaceId,
        },
        nextDue: {
          businessDate: '2000-01-02',
          dueAt: '2000-01-02T00:00:00.000Z',
          payload: {
            businessDate: '2000-01-02',
            schemaVersion: 'daily-recommendation/v1',
          },
          taskId: `daily-rec_${workspaceId}_2000-01-02`,
        },
        output: {
          packageId: 'package-1',
          schemaVersion: 'daily-recommendation-delivery/v1',
          versionId: 'version-1',
        },
        runId: run.runId,
      }),
      true,
    );

    const delivered = await repository.readLatestDelivered(
      workspaceId,
      'daily_recommendation',
    );
    assert.ok(delivered);
    assert.equal(delivered.taskId, taskId);
    assert.equal(delivered.businessDate, '2000-01-01');
    assert.equal(delivered.runId, run.runId);
    assert.deepEqual(delivered.output, {
      packageId: 'package-1',
      schemaVersion: 'daily-recommendation-delivery/v1',
      versionId: 'version-1',
    });
    assert.ok(Number.isFinite(Date.parse(delivered.completedAt)));

    const nextClaims = await repository.claimBatch({
      claimToken: 'claim-next',
      leaseMs: 60_000,
      limit: 10,
      now: new Date('2000-01-02T00:01:00.000Z'),
      workerId: 'worker-1',
    });
    assert.equal(nextClaims.length, 1);
    assert.equal(
      nextClaims[0]?.taskId,
      `daily-rec_${workspaceId}_2000-01-02`,
    );
    assert.equal(nextClaims[0]?.businessDate, '2000-01-02');
  },
);

test(
  'PostgreSQL refuses to begin delivery after the claim lease expires',
  { skip: !connectionString },
  async (t) => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresDueDeliveryRepository(pool);
    const suffix = randomUUID();
    const workspaceId = `due-expired-begin-${suffix}`;
    const taskId = `task-recall_${workspaceId}_source-1`;

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
    const due = await repository.enqueue({
      dueAt: new Date(Date.now() - 180_000).toISOString(),
      payload: {
        schemaVersion: 'task-recall/v1',
        taskId: 'source-1',
        title: '你的内容已完成',
      },
      taskId,
      type: 'task_recall',
      workspaceId,
    });
    const claims = await repository.claimBatch({
      claimToken: 'expired-begin-claim',
      leaseMs: 60_000,
      limit: 1,
      now: new Date(Date.now() - 120_000),
      workerId: 'expired-begin-worker',
    });
    assert.equal(claims.length, 1);

    assert.equal(
      await repository.beginDelivery({
        identity: {
          claimToken: claims[0]!.claimToken,
          dueId: due.id,
          workspaceId,
        },
        taskId,
        type: 'task_recall',
      }),
      null,
    );
  },
);

test(
  'PostgreSQL rejects a whitespace-only task recall next step before enqueue',
  { skip: !connectionString },
  async (t) => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresDueDeliveryRepository(pool);
    const workspaceId = `due-invalid-recall-${randomUUID()}`;

    t.after(async () => {
      await pool.query(
        'DELETE FROM p1_due_delivery_items WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.end();
    });

    await repository.migrate();
    await assert.rejects(
      repository.enqueue({
        dueAt: new Date().toISOString(),
        payload: {
          nextStep: '   ',
          schemaVersion: 'task-recall/v1',
          taskId: 'source-1',
          title: '你的内容已完成',
        },
        taskId: `task-recall_${workspaceId}_source-1`,
        type: 'task_recall',
        workspaceId,
      }),
      /payload schema is invalid/u,
    );
  },
);

test(
  'PostgreSQL refuses to settle a delivery after the claim lease expires',
  { skip: !connectionString },
  async (t) => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresDueDeliveryRepository(pool);
    const suffix = randomUUID();
    const workspaceId = `due-expired-settle-${suffix}`;
    const taskId = `task-recall_${workspaceId}_source-1`;

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
    const due = await repository.enqueue({
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      payload: {
        schemaVersion: 'task-recall/v1',
        taskId: 'source-1',
        title: '你的内容已完成',
      },
      taskId,
      type: 'task_recall',
      workspaceId,
    });
    const claims = await repository.claimBatch({
      claimToken: 'expired-settle-claim',
      leaseMs: 60_000,
      limit: 1,
      now: new Date(),
      workerId: 'expired-settle-worker',
    });
    assert.equal(claims.length, 1);
    const identity = {
      claimToken: claims[0]!.claimToken,
      dueId: due.id,
      workspaceId,
    };
    const run = await repository.beginDelivery({
      identity,
      taskId,
      type: 'task_recall',
    });
    assert.ok(run);

    await pool.query(
      `UPDATE p1_due_delivery_items
          SET lease_expires_at = now() - interval '1 second'
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, due.id],
    );

    assert.equal(
      await repository.settleDelivered({
        identity,
        output: { schemaVersion: 'task-recall-delivery/v1' },
        runId: run.runId,
      }),
      false,
    );
  },
);

test(
  'PostgreSQL purge removes only expired terminal due items and runs',
  { skip: !connectionString },
  async (t) => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresDueDeliveryRepository(pool);
    const suffix = randomUUID();
    const workspaceId = `due-purge-${suffix}`;
    let sequence = 0;

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
    const enqueueRecall = async (label: string, dueAt = '2026-01-01T00:00:00.000Z') =>
      repository.enqueue({
        dueAt,
        payload: {
          schemaVersion: 'task-recall/v1',
          taskId: `source-${label}-${suffix}`,
          title: `Recall ${label}`,
        },
        taskId: `recall-${label}-${suffix}`,
        type: 'task_recall',
        workspaceId,
      });
    const claimOne = async () => {
      sequence += 1;
      const claims = await repository.claimBatch({
        claimToken: `purge-claim-${sequence}`,
        leaseMs: 60_000,
        limit: 1,
        now: new Date(),
        workerId: 'purge-worker',
      });
      assert.equal(claims.length, 1);
      return claims[0]!;
    };
    const identity = (claim: DueDeliveryClaim) => ({
      claimToken: claim.claimToken,
      dueId: claim.id,
      workspaceId,
    });

    await enqueueRecall('delivered');
    const delivered = await claimOne();
    const deliveredRun = await repository.beginDelivery({
      identity: identity(delivered),
      taskId: delivered.taskId,
      type: delivered.type,
    });
    assert.ok(deliveredRun);
    assert.equal(
      await repository.settleDelivered({
        identity: identity(delivered),
        output: { schemaVersion: 'task-recall-delivery/v1' },
        runId: deliveredRun.runId,
      }),
      true,
    );

    await enqueueRecall('suppressed');
    const suppressed = await claimOne();
    assert.equal(
      await repository.settleSuppressed({
        identity: identity(suppressed),
        reason: 'workspace_inactive',
        suppressedAt: new Date('2026-07-29T00:00:00.000Z'),
      }),
      true,
    );

    await enqueueRecall('dead-letter');
    const deadLetter = await claimOne();
    const deadLetterRun = await repository.beginDelivery({
      identity: identity(deadLetter),
      taskId: deadLetter.taskId,
      type: deadLetter.type,
    });
    assert.ok(deadLetterRun);
    assert.equal(
      await repository.settleFailed({
        deadLetter: true,
        error: 'terminal failure',
        failedAt: new Date('2026-07-29T00:00:00.000Z'),
        identity: identity(deadLetter),
        retryAt: new Date('2026-07-29T00:00:00.000Z'),
        runId: deadLetterRun.runId,
      }),
      true,
    );

    await enqueueRecall('retry');
    const retry = await claimOne();
    assert.equal(
      await repository.settleFailed({
        deadLetter: false,
        error: 'retry later',
        failedAt: new Date('2026-07-29T00:00:00.000Z'),
        identity: identity(retry),
        retryAt: new Date('2100-01-01T00:00:00.000Z'),
      }),
      true,
    );

    await enqueueRecall('started');
    const started = await claimOne();
    assert.ok(
      await repository.beginDelivery({
        identity: identity(started),
        taskId: started.taskId,
        type: started.type,
      }),
    );

    await enqueueRecall('claimed');
    await claimOne();
    await enqueueRecall('pending', '2100-01-01T00:00:00.000Z');
    await pool.query(
      `UPDATE p1_due_delivery_items
          SET created_at = '1900-01-01T00:00:00.000Z',
              retain_until = CASE
                WHEN status IN ('delivered', 'suppressed', 'dead_letter')
                  THEN '2000-01-01T00:00:00.000Z'
                ELSE retain_until
              END
        WHERE workspace_id = $1
          AND status IN (
            'pending',
            'claimed',
            'retry',
            'delivered',
            'suppressed',
            'dead_letter'
          )`,
      [workspaceId],
    );
    await pool.query(
      `UPDATE p1_due_delivery_runs
          SET retain_until = '2000-01-01T00:00:00.000Z'
        WHERE workspace_id = $1
          AND status IN ('delivered', 'dead_letter')`,
      [workspaceId],
    );

    assert.deepEqual(
      await repository.purgeExpired(
        new Date('2001-01-01T00:00:00.000Z'),
        100,
      ),
      { deletedItems: 3, deletedRuns: 2 },
    );
    const remainingItems = await pool.query<{ status: string }>(
      `SELECT status
         FROM p1_due_delivery_items
        WHERE workspace_id = $1
        ORDER BY status`,
      [workspaceId],
    );
    assert.deepEqual(
      remainingItems.rows.map((row) => row.status),
      ['claimed', 'claimed', 'pending', 'retry'],
    );
    const remainingRuns = await pool.query<{ status: string }>(
      `SELECT status
         FROM p1_due_delivery_runs
        WHERE workspace_id = $1`,
      [workspaceId],
    );
    assert.deepEqual(remainingRuns.rows, [{ status: 'started' }]);
  },
);

test(
  'PostgreSQL terminal retention defaults to 90 days and hot-reads the global override',
  { skip: !connectionString },
  async (t) => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const defaultWorkspaceId = `due-retention-default-${suffix}`;
    const overrideWorkspaceId = `due-retention-override-${suffix}`;
    let configReads = 0;
    const defaultRepository = new PostgresDueDeliveryRepository(pool);
    const overrideRepository = new PostgresDueDeliveryRepository(pool, {
      async get(scope, workspaceId, key) {
        configReads += 1;
        assert.equal(scope, 'global');
        assert.equal(workspaceId, '__global__');
        assert.equal(key, 'due_delivery.retention_days');
        return {
          actorId: 'platform-admin',
          correlationId: 'due-retention-test',
          createdAt: new Date().toISOString(),
          key,
          reason: 'test override',
          revision: 1,
          rolledBackToRevision: null,
          scope,
          status: 'applied',
          value: 7,
          workspaceId,
        };
      },
    });

    t.after(async () => {
      await pool.query(
        'DELETE FROM p1_due_delivery_runs WHERE workspace_id = ANY($1::text[])',
        [[defaultWorkspaceId, overrideWorkspaceId]],
      );
      await pool.query(
        'DELETE FROM p1_due_delivery_items WHERE workspace_id = ANY($1::text[])',
        [[defaultWorkspaceId, overrideWorkspaceId]],
      );
      await pool.end();
    });

    await defaultRepository.migrate();
    const settleRecall = async (
      repository: PostgresDueDeliveryRepository,
      workspaceId: string,
      claimToken: string,
    ) => {
      const taskId = `task-recall_${workspaceId}_source-1`;
      const due = await repository.enqueue({
        dueAt: new Date(Date.now() - 60_000).toISOString(),
        payload: {
          schemaVersion: 'task-recall/v1',
          taskId: 'source-1',
          title: '你的内容已完成',
        },
        taskId,
        type: 'task_recall',
        workspaceId,
      });
      const claim = (
        await repository.claimBatch({
          claimToken,
          leaseMs: 60_000,
          limit: 1,
          now: new Date(),
          workerId: 'retention-worker',
        })
      ).find((candidate) => candidate.id === due.id);
      assert.ok(claim);
      const identity = {
        claimToken: claim.claimToken,
        dueId: due.id,
        workspaceId,
      };
      const run = await repository.beginDelivery({
        identity,
        taskId,
        type: 'task_recall',
      });
      assert.ok(run);
      assert.equal(
        await repository.settleDelivered({
          identity,
          output: { schemaVersion: 'task-recall-delivery/v1' },
          runId: run.runId,
        }),
        true,
      );
      const retained = await pool.query<{
        item_days: string;
        run_days: string;
      }>(
        `SELECT EXTRACT(EPOCH FROM (
                  item.retain_until - item.completed_at
                )) / 86400 AS item_days,
                EXTRACT(EPOCH FROM (
                  run.retain_until - run.completed_at
                )) / 86400 AS run_days
           FROM p1_due_delivery_items item
           JOIN p1_due_delivery_runs run
             ON run.workspace_id = item.workspace_id
            AND run.due_id = item.id
          WHERE item.workspace_id = $1 AND item.id = $2`,
        [workspaceId, due.id],
      );
      return {
        itemDays: Number(retained.rows[0]?.item_days),
        runDays: Number(retained.rows[0]?.run_days),
      };
    };

    assert.deepEqual(
      await settleRecall(
        defaultRepository,
        defaultWorkspaceId,
        'retention-default-claim',
      ),
      { itemDays: 90, runDays: 90 },
    );
    assert.deepEqual(
      await settleRecall(
        overrideRepository,
        overrideWorkspaceId,
        'retention-override-claim',
      ),
      { itemDays: 7, runDays: 7 },
    );
    assert.equal(configReads, 1);
  },
);

test(
  'first Dashboard reads seed one due and consume its delivered state',
  { skip: !connectionString },
  async (t) => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresDueDeliveryRepository(pool);
    const workspaceId = `due-dashboard-${randomUUID()}`;
    const businessDate = '2000-02-01';
    const taskId = `daily-rec_${workspaceId}_${businessDate}`;
    const runId = `delivery-run:${taskId}`;
    const legacy = dashboardRecommendationState(workspaceId, 'legacy-task');
    const delivered = dashboardRecommendationState(workspaceId, taskId);
    let baseReads = 0;
    const reader = new DueAwareHarnessRecommendationReader(
      {
        async readTodayRecommendation() {
          baseReads += 1;
          return legacy;
        },
      },
      repository,
      () => new Date('2000-02-01T01:00:00.000Z'),
    );

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
    assert.deepEqual(
      await reader.readTodayRecommendation(workspaceId),
      { ...legacy, recommendation: null },
    );
    assert.deepEqual(
      await reader.readTodayRecommendation(workspaceId),
      { ...legacy, recommendation: null },
    );

    const claims = await repository.claimBatch({
      claimToken: 'dashboard-claim',
      leaseMs: 60_000,
      limit: 10,
      now: new Date(),
      workerId: 'dashboard-worker',
    });
    const localClaims = claims.filter(
      (claim) => claim.workspaceId === workspaceId,
    );
    assert.equal(localClaims.length, 1);
    assert.equal(localClaims[0]?.taskId, taskId);
    const claim = localClaims[0]!;
    const run = await repository.beginDelivery({
      identity: {
        claimToken: claim.claimToken,
        dueId: claim.id,
        workspaceId,
      },
      taskId,
      type: 'daily_recommendation',
    });
    assert.deepEqual(run, { runId });
    assert.equal(
      await repository.settleDelivered({
        identity: {
          claimToken: claim.claimToken,
          dueId: claim.id,
          workspaceId,
        },
        output: {
          schemaVersion: 'daily-recommendation-delivery/v1',
          source: {
            actorId: 'system:due-scanner',
            businessDate,
            generationRequested: false,
            runId,
            taskId,
          },
          state: delivered,
        },
        runId,
      }),
      true,
    );

    assert.deepEqual(
      await reader.readTodayRecommendation(workspaceId),
      delivered,
    );
    assert.equal(baseReads, 2);
  },
);

test(
  'PostgreSQL runOnce catches up each due business day once and leaves the next day queued',
  { skip: !connectionString },
  async (t) => {
    const pool = new Pool({ connectionString });
    const repository = new PostgresDueDeliveryRepository(pool);
    const suffix = randomUUID();
    const workspaceId = `due-catch-up-${suffix}`;

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
    await repository.enqueue({
      businessDate: '2026-07-27',
      dueAt: '2026-07-27T00:00:00.000Z',
      payload: {
        businessDate: '2026-07-27',
        schemaVersion: 'daily-recommendation/v1',
      },
      taskId: `daily-rec_${workspaceId}_2026-07-27`,
      type: 'daily_recommendation',
      workspaceId,
    });

    const deliveries: Array<{
      businessDate: string | undefined;
      idempotencyKey: string;
      runId: string;
      taskId: string;
    }> = [];
    const worker = new DueDeliveryWorker(
      repository,
      {
        async evaluate() {
          return { isRestDay: false, workspaceActive: true };
        },
      },
      {
        async deliver(input) {
          deliveries.push({
            businessDate: input.businessDate,
            idempotencyKey: input.idempotencyKey,
            runId: input.runId,
            taskId: input.taskId,
          });
          return { output: {} };
        },
      },
      {
        claimToken: () => randomUUID(),
        clock: () => new Date('2026-07-29T09:00:00.000Z'),
      },
    );

    assert.deepEqual(await worker.runOnce('catch-up-worker'), {
      claimed: 3,
      deadLettered: 0,
      delivered: 3,
      lost: 0,
      retried: 0,
      suppressed: 0,
    });
    assert.deepEqual(
      deliveries,
      ['2026-07-27', '2026-07-28', '2026-07-29'].map((businessDate) => {
        const taskId = `daily-rec_${workspaceId}_${businessDate}`;
        const runId = `delivery-run:${taskId}`;
        return { businessDate, idempotencyKey: runId, runId, taskId };
      }),
    );

    const nextClaims = await repository.claimBatch({
      claimToken: 'claim-next-day',
      leaseMs: 60_000,
      limit: 10,
      now: new Date('2026-07-30T00:01:00.000Z'),
      workerId: 'next-day-worker',
    });
    assert.equal(nextClaims.length, 1);
    assert.equal(nextClaims[0]?.businessDate, '2026-07-30');
    assert.equal(
      nextClaims[0]?.taskId,
      `daily-rec_${workspaceId}_2026-07-30`,
    );
  },
);

test(
  'PostgreSQL retry survives a repository restart and reuses one idempotent delivery run',
  { skip: !connectionString },
  async (t) => {
    const pool = new Pool({ connectionString });
    const firstRepository = new PostgresDueDeliveryRepository(pool);
    const suffix = randomUUID();
    const workspaceId = `due-restart-${suffix}`;
    const firstAttemptAt = new Date('2026-07-29T09:00:00.000Z');
    const taskId = `daily-rec_${workspaceId}_2026-07-29`;

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

    await firstRepository.migrate();
    await firstRepository.enqueue({
      businessDate: '2026-07-29',
      dueAt: '2026-07-29T00:00:00.000Z',
      payload: {
        businessDate: '2026-07-29',
        schemaVersion: 'daily-recommendation/v1',
      },
      taskId,
      type: 'daily_recommendation',
      workspaceId,
    });

    const attempts: Array<{
      idempotencyKey: unknown;
      runId: string;
    }> = [];
    const observedClaims: DueDeliveryClaim[] = [];
    const delivery: DueDeliveryPort = {
      async deliver(input) {
        attempts.push({
          idempotencyKey: input.idempotencyKey,
          runId: input.runId,
        });
        if (attempts.length === 1) throw new Error('consumer unavailable');
        return {
          output: {
            packageId: 'package-retry',
            schemaVersion: 'daily-recommendation-delivery/v1',
            versionId: 'version-retry',
          },
        };
      },
    };
    const eligibility = {
      async evaluate() {
        return { isRestDay: false, workspaceActive: true };
      },
    };
    const firstWorker = new DueDeliveryWorker(
      observeClaims(firstRepository, observedClaims),
      eligibility,
      delivery,
      {
        claimToken: () => 'claim-before-restart',
        clock: () => firstAttemptAt,
        retryDelayMs: 1_000,
      },
    );
    assert.equal((await firstWorker.runOnce('worker-before')).retried, 1);
    assert.equal(observedClaims[0]?.businessDate, '2026-07-29');

    const restartedRepository = new PostgresDueDeliveryRepository(pool);
    const restartedWorker = new DueDeliveryWorker(
      observeClaims(restartedRepository, observedClaims),
      eligibility,
      delivery,
      {
        claimToken: () => 'claim-after-restart',
        clock: () => new Date(firstAttemptAt.getTime() + 1_000),
        retryDelayMs: 1_000,
      },
    );
    const restartedSummary = await restartedWorker.runOnce('worker-after');
    assert.deepEqual(restartedSummary, {
      claimed: 1,
      deadLettered: 0,
      delivered: 1,
      lost: 0,
      retried: 0,
      suppressed: 0,
    });

    const expectedRunId = `delivery-run:${taskId}`;
    assert.deepEqual(attempts, [
      { idempotencyKey: expectedRunId, runId: expectedRunId },
      { idempotencyKey: expectedRunId, runId: expectedRunId },
    ]);
    assert.equal(
      (
        await pool.query(
          'SELECT 1 FROM p1_due_delivery_runs WHERE workspace_id = $1',
          [workspaceId],
        )
      ).rowCount,
      1,
    );
  },
);

function observeClaims(
  repository: DueDeliveryRepository,
  observed: DueDeliveryClaim[],
): DueDeliveryRepository {
  return {
    beginDelivery: (input) => repository.beginDelivery(input),
    async claimBatch(input) {
      const claims = await repository.claimBatch(input);
      observed.push(...claims);
      return claims;
    },
    settleDelivered: (input) => repository.settleDelivered(input),
    settleFailed: (input) => repository.settleFailed(input),
    settleSuppressed: (input) => repository.settleSuppressed(input),
  };
}

function dashboardRecommendationState(
  workspaceId: string,
  taskId: string,
): TodayRecommendationState {
  return {
    currentFactsRevision: 1,
    recommendation: {
      body: '今天可以沿用这份已交付内容。',
      createdAt: '2000-02-01T01:00:00.000Z',
      customerAction: '打开 Composer 继续编辑',
      factReferences: ['store_fact:service-1:1'],
      factsRevision: 1,
      packageId: 'package-1',
      sourceLabel: '已交付内容',
      taskId,
      title: '今日推荐',
      versionId: 'version-1',
      whyNow: '适合今天继续使用',
      workspaceId,
    },
    stale: false,
    workspaceId,
  };
}

test(
  'PostgreSQL lease reclaim fences the stale claimant and derives one run from the locked due row',
  { skip: !connectionString },
  async (t) => {
    const pool = new Pool({ connectionString });
    const firstRepository = new PostgresDueDeliveryRepository(pool);
    const secondRepository = new PostgresDueDeliveryRepository(pool);
    const suffix = randomUUID();
    const workspaceId = `due-fencing-${suffix}`;
    const taskId = `daily-rec_${workspaceId}_2026-07-29`;

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

    await firstRepository.migrate();
    const due = await firstRepository.enqueue({
      businessDate: '2026-07-29',
      dueAt: '2026-07-29T00:00:00.000Z',
      payload: {
        businessDate: '2026-07-29',
        schemaVersion: 'daily-recommendation/v1',
      },
      taskId,
      type: 'daily_recommendation',
      workspaceId,
    });
    const firstClaimAt = new Date(Date.now() - 2_000);
    const firstClaim = (
      await firstRepository.claimBatch({
        claimToken: 'claim-a',
        leaseMs: 1_000,
        limit: 1,
        now: firstClaimAt,
        workerId: 'worker-a',
      })
    )[0]!;
    const secondClaim = (
      await secondRepository.claimBatch({
        claimToken: 'claim-b',
        leaseMs: 60_000,
        limit: 1,
        now: new Date(),
        workerId: 'worker-b',
      })
    )[0]!;
    assert.equal(firstClaim.id, due.id);
    assert.equal(secondClaim.id, due.id);

    const staleIdentity = {
      claimToken: firstClaim.claimToken,
      dueId: firstClaim.id,
      workspaceId,
    };
    assert.equal(
      await firstRepository.beginDelivery({
        identity: staleIdentity,
        taskId,
        type: 'daily_recommendation',
      }),
      null,
    );
    assert.equal(
      await firstRepository.settleSuppressed({
        identity: staleIdentity,
        reason: 'workspace_inactive',
        suppressedAt: new Date('2026-07-29T00:05:01.000Z'),
      }),
      false,
    );
    assert.equal(
      (
        await pool.query(
          'SELECT 1 FROM p1_due_delivery_runs WHERE workspace_id = $1',
          [workspaceId],
        )
      ).rowCount,
      0,
    );

    const currentIdentity = {
      claimToken: secondClaim.claimToken,
      dueId: secondClaim.id,
      workspaceId,
    };
    assert.equal(
      await secondRepository.beginDelivery({
        identity: currentIdentity,
        taskId: `${taskId}-forged`,
        type: 'task_recall',
      }),
      null,
    );
    const run = await secondRepository.beginDelivery({
      identity: currentIdentity,
      taskId,
      type: 'daily_recommendation',
    });
    assert.ok(run);
    assert.deepEqual(
      await secondRepository.beginDelivery({
        identity: currentIdentity,
        taskId,
        type: 'daily_recommendation',
      }),
      run,
    );
    assert.equal(
      (
        await pool.query(
          'SELECT 1 FROM p1_due_delivery_runs WHERE workspace_id = $1',
          [workspaceId],
        )
      ).rowCount,
      1,
    );
  },
);
