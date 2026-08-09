/**
 * V31-14 Postgres InterruptStore contract.
 * Skips when TEST_DATABASE_URL is unset (local rule).
 *
 * Covers:
 * - CAS rejects stale revision
 * - duplicate resume is idempotent (replay)
 * - restart-readable: second store instance sees pending rows
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import {
  interruptPayloadSchema,
  resumeInterruptCommandSchema,
} from '@meiye/contracts';

import {
  InterruptProtocolService,
} from './interrupt-protocol.js';
import { PostgresInterruptStore } from './postgres-interrupt-store.js';

const connectionString = process.env.TEST_DATABASE_URL;

function payload(overrides: Record<string, unknown> = {}) {
  return interruptPayloadSchema.parse({
    schemaVersion: 'interrupt-payload/v1',
    interruptId: 'int-pg-1',
    threadId: 'thread-1',
    runId: 'run-1',
    workflowId: 'wf-1',
    step: 'execution_selection',
    revision: 3,
    action: 'confirm_paid_execution',
    args: { quoteId: 'q1' },
    config: {
      allowAccept: true,
      allowEdit: false,
      allowReject: true,
      allowRespond: false,
    },
    description: '确认执行付费生成',
    resourceId: 'ws-pg-1',
    ...overrides,
  });
}

function resume(overrides: Record<string, unknown> = {}) {
  return resumeInterruptCommandSchema.parse({
    schemaVersion: 'interrupt-payload/v1',
    interruptId: 'int-pg-1',
    revision: 3,
    type: 'accept',
    idempotencyKey: 'resume-pg-1',
    ...overrides,
  });
}

async function createFixture() {
  const schema = `interrupt_${randomUUID().replaceAll('-', '')}`;
  const pool = new Pool({ connectionString });
  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`SET search_path TO ${schema}`);

  const store = new PostgresInterruptStore(pool);
  await store.migrate();

  const membership = {
    async hasMembership(userId: string, workspaceId: string) {
      return userId === 'user-1' && workspaceId === 'ws-pg-1';
    },
  };

  return {
    pool,
    store,
    schema,
    service: new InterruptProtocolService(store, membership, () =>
      '2026-08-08T12:00:00.000Z',
    ),
    async cleanup() {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
      await pool.end();
    },
  };
}

test(
  'Postgres interrupt CAS rejects stale revision; duplicate resume is replay; second instance reads pending',
  {
    skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    const fixture = await createFixture();
    const { pool, store, service, schema, cleanup } = fixture;
    try {
      // ── restart-readable pending ──────────────────────────────────────────
      const requested = await service.request({
        workspaceId: 'ws-pg-1',
        payload: payload(),
      });
      assert.equal(requested.replayed, false);
      assert.equal(requested.record.status, 'pending');

      // Second store instance (simulates process restart on same DB).
      await pool.query(`SET search_path TO ${schema}`);
      const restartedStore = new PostgresInterruptStore(pool);
      const pendingFromRestart = await restartedStore.listPending({
        workspaceId: 'ws-pg-1',
        resourceId: 'ws-pg-1',
      });
      assert.equal(pendingFromRestart.length, 1);
      assert.equal(pendingFromRestart[0]?.payload.interruptId, 'int-pg-1');
      assert.equal(pendingFromRestart[0]?.payload.revision, 3);
      assert.equal(pendingFromRestart[0]?.status, 'pending');

      // ── stale CAS ─────────────────────────────────────────────────────────
      const stale = await store.resolveCas({
        interruptId: 'int-pg-1',
        expectedRevision: 1,
        command: resume({ revision: 1 }),
        fingerprint: 'stale-fp',
        resolvedAt: '2026-08-08T12:01:00.000Z',
      });
      assert.equal(stale.outcome, 'stale');
      assert.equal(
        (await store.getById('int-pg-1'))?.status,
        'pending',
        'stale CAS must not resolve the row',
      );

      // ── applied once ──────────────────────────────────────────────────────
      const first = await service.resume({
        userId: 'user-1',
        workspaceId: 'ws-pg-1',
        command: resume(),
      });
      assert.equal(first.outcome, 'applied');
      assert.equal(first.record.status, 'resolved');

      // ── duplicate resume idempotent ───────────────────────────────────────
      const second = await service.resume({
        userId: 'user-1',
        workspaceId: 'ws-pg-1',
        command: resume(),
      });
      assert.equal(second.outcome, 'replayed');
      assert.equal(second.record.status, 'resolved');

      // Pending list empty after resolve (also via restarted store).
      assert.deepEqual(
        await restartedStore.listPending({
          workspaceId: 'ws-pg-1',
          resourceId: 'ws-pg-1',
        }),
        [],
      );

      // Conflicting resume after resolve fails closed.
      await assert.rejects(
        () =>
          service.resume({
            userId: 'user-1',
            workspaceId: 'ws-pg-1',
            command: resume({ type: 'reject', idempotencyKey: 'other' }),
          }),
        (error: unknown) =>
          error instanceof Error &&
          error.name === 'InterruptProtocolError' &&
          (error as { code?: string }).code === 'IDEMPOTENCY_CONFLICT',
      );

      // CAS and bridge delivery are two durable steps. A restarted worker can
      // recover the exact command without another merchant HTTP request.
      const recoveryPayload = payload({
        interruptId: 'int-pg-recovery',
        revision: 8,
      });
      let bridgeAvailable = false;
      const deliveries: string[] = [];
      const crashWindowService = new InterruptProtocolService(
        store,
        {
          async hasMembership(userId, workspaceId) {
            return userId === 'user-1' && workspaceId === 'ws-pg-1';
          },
        },
        () => '2026-08-08T12:02:00.000Z',
        {
          async deliver(input) {
            if (!bridgeAvailable) throw new Error('DBOS unavailable');
            deliveries.push(input.command.interruptId);
          },
        },
      );
      await crashWindowService.request({
        workspaceId: 'ws-pg-1',
        payload: recoveryPayload,
      });
      const recoveryCommand = resume({
        interruptId: recoveryPayload.interruptId,
        revision: recoveryPayload.revision,
        idempotencyKey: 'resume-pg-recovery',
      });
      await assert.rejects(() =>
        crashWindowService.resume({
          userId: 'user-1',
          workspaceId: 'ws-pg-1',
          command: recoveryCommand,
        }),
      );

      const afterCrash = await restartedStore.getById(
        recoveryPayload.interruptId,
      );
      assert.equal(afterCrash?.status, 'resolved');
      assert.equal(afterCrash?.resumeDeliveryStatus, 'pending');

      bridgeAvailable = true;
      const restartedService = new InterruptProtocolService(
        restartedStore,
        {
          async hasMembership() {
            return true;
          },
        },
        () => '2026-08-08T12:03:00.000Z',
        {
          async deliver(input) {
            deliveries.push(input.command.interruptId);
          },
        },
      );
      assert.deepEqual(await restartedService.recoverUndelivered(), {
        delivered: 1,
        failed: 0,
      });
      assert.deepEqual(deliveries, [recoveryPayload.interruptId]);
      assert.equal(
        (await restartedStore.getById(recoveryPayload.interruptId))
          ?.resumeDeliveryStatus,
        'sent',
      );
    } finally {
      await cleanup();
    }
  },
);
