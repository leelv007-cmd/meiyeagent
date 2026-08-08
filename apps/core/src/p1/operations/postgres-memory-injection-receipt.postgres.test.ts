/**
 * Postgres parity for MemoryInjectionReceipt (V31-18).
 * Skips when TEST_DATABASE_URL is unset — do not self-provision PG.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { AgentMemoryPlatform } from './agent-memory-platform.js';
import { PostgresMemoryInjectionReceiptStore } from './postgres-memory-injection-receipt.js';
import {
  MemoryReuseMemoryRepository,
  ReuseMemoryError,
  ReuseMemoryService,
} from './reuse-memory-service.js';

const connectionString = process.env.TEST_DATABASE_URL;

const now = '2026-08-08T12:00:00.000Z';
const context = { workspaceId: 'workspace-injection-pg', userId: 'owner-pg' };

test(
  'Postgres MemoryInjectionReceipt store is put-once and restart-readable',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresMemoryInjectionReceiptStore(pool);
    await store.migrate();

    const reuse = new ReuseMemoryService(
      new MemoryReuseMemoryRepository(),
      { async verifyCandidate() {}, async verifyRevision() {} },
      () => now,
    );
    const platform = new AgentMemoryPlatform(reuse, store, undefined, () => now);

    const taskId = `task-inj-${randomUUID()}`;
    const runId = `run-inj-${randomUUID()}`;
    const releaseId = `release-inj-${randomUUID()}`;

    try {
      const [candidate] = await platform.onExtracted({
        workspaceId: context.workspaceId,
        idempotencyPrefix: `pg-${taskId}`,
        items: [
          {
            itemId: 'item-1',
            kind: 'preference',
            semanticKey: 'tone.pg',
            proposedValue: '克制',
            defaultScope: { storeId: 'store-a' },
            decisionEventId: 'd-pg',
            taskId: 't-pg',
            source: {
              conversationId: 'c-pg',
              sourceTurnId: 'turn-pg',
              messageRange: { start: 0, end: 0 },
            },
            statement: '文案要克制',
          },
        ],
      });
      assert.ok(candidate);
      const preference = await platform.confirmMemoryCandidate(context, {
        candidateId: candidate.candidateId,
        preferenceId: `pref-${taskId}`,
        idempotencyKey: `confirm-${taskId}`,
      });
      const entries = await platform.retrieveForInjection({
        workspaceId: context.workspaceId,
        scope: { storeId: 'store-a' },
      });
      assert.equal(entries.length, 1);

      const receipt = await platform.recordInjectionReceipt({
        taskId,
        runId,
        harnessReleaseId: releaseId,
        entries,
        injectedAt: now,
      });
      assert.equal(receipt.taskId, taskId);
      assert.equal(receipt.runId, runId);
      assert.equal(receipt.harnessReleaseId, releaseId);
      assert.equal(receipt.entries[0]?.revision, preference.revision);

      // Idempotent same payload.
      const again = await platform.recordInjectionReceipt({
        taskId,
        runId,
        harnessReleaseId: releaseId,
        entries,
        injectedAt: now,
      });
      assert.deepEqual(again, receipt);

      // Divergent payload conflicts.
      await assert.rejects(
        platform.recordInjectionReceipt({
          taskId,
          runId,
          harnessReleaseId: `${releaseId}-other`,
          entries,
          injectedAt: now,
        }),
        (error: unknown) =>
          error instanceof ReuseMemoryError && error.code === 'CONFLICT',
      );

      // Restart-readable via a fresh store on the same pool.
      const restarted = new PostgresMemoryInjectionReceiptStore(pool);
      const byTask = await restarted.getByTask(taskId);
      assert.deepEqual(byTask, receipt);
      const byRun = await restarted.getByRun(runId);
      assert.deepEqual(byRun, receipt);
    } finally {
      await pool.query(
        `DELETE FROM p1_memory_injection_receipts WHERE task_id = $1`,
        [taskId],
      );
      await pool.end();
    }
  },
);
