/**
 * Postgres parity for MemoryInjectionReceipt (V31-18).
 * Skips when TEST_DATABASE_URL is unset — do not self-provision PG.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import {
  AgentMemoryPlatform,
  type MemoryInjectionReceiptStore,
} from './agent-memory-platform.js';
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
    const retryTaskId = `task-inj-retry-${randomUUID()}`;
    const commitLostTaskId = `task-inj-commit-lost-${randomUUID()}`;
    const runId = `run-inj-${randomUUID()}`;
    const releaseId = `release-inj-${randomUUID()}`;
    const triggerSuffix = randomUUID().replaceAll('-', '');
    const triggerName = `memory_outbox_fail_${triggerSuffix}`;
    const functionName = `memory_outbox_fail_fn_${triggerSuffix}`;

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

      // The transaction committed, but the caller lost the response. A retry
      // after the process clock advances must return the first durable receipt.
      let loseFirstCommittedResponse = true;
      let retryClock = now;
      const commitLostStore: MemoryInjectionReceiptStore = {
        async save(input) {
          const saved = await store.save(input);
          if (loseFirstCommittedResponse) {
            loseFirstCommittedResponse = false;
            throw new Error('response lost after commit');
          }
          return saved;
        },
        getByTask: (id) => store.getByTask(id),
        getByRun: (id) => store.getByRun(id),
      };
      const commitLostPlatform = new AgentMemoryPlatform(
        reuse,
        commitLostStore,
        undefined,
        () => retryClock,
      );
      await assert.rejects(
        commitLostPlatform.recordInjectionReceipt({
          taskId: commitLostTaskId,
          runId: `${runId}-commit-lost`,
          harnessReleaseId: releaseId,
          entries,
        }),
        /response lost after commit/u,
      );
      const firstCommitted = await store.getByTask(commitLostTaskId);
      assert.equal(firstCommitted?.injectedAt, now);
      const firstCommittedOutbox = await pool.query<{
        payload: unknown;
        row_version: string;
      }>(
        `SELECT payload, xmin::text AS row_version
         FROM p1_memory_injection_receipt_outbox
         WHERE task_id = $1`,
        [commitLostTaskId],
      );
      assert.deepEqual(firstCommittedOutbox.rows[0]?.payload, firstCommitted);
      retryClock = '2026-08-08T12:05:00.000Z';
      const recovered = await commitLostPlatform.recordInjectionReceipt({
        taskId: commitLostTaskId,
        runId: `${runId}-commit-lost`,
        harnessReleaseId: releaseId,
        entries,
      });
      assert.deepEqual(recovered, firstCommitted);
      const recoveredOutbox = await pool.query<{
        payload: unknown;
        row_version: string;
      }>(
        `SELECT payload, xmin::text AS row_version
         FROM p1_memory_injection_receipt_outbox
         WHERE task_id = $1`,
        [commitLostTaskId],
      );
      assert.deepEqual(recoveredOutbox.rows[0], firstCommittedOutbox.rows[0]);

      for (const divergentEntries of [
        entries.map((entry, index) =>
          index === 0
            ? {
                ...entry,
                memoryId: `${entry.memoryId}-other` as typeof entry.memoryId,
              }
            : entry,
        ),
        entries.map((entry, index) =>
          index === 0 ? { ...entry, revision: entry.revision + 1 } : entry,
        ),
        entries.map((entry, index) =>
          index === 0 ? { ...entry, statement: `${entry.statement}。` } : entry,
        ),
      ]) {
        await assert.rejects(
          commitLostPlatform.recordInjectionReceipt({
            taskId: commitLostTaskId,
            runId: `${runId}-commit-lost`,
            harnessReleaseId: releaseId,
            entries: divergentEntries,
          }),
          (error: unknown) =>
            error instanceof ReuseMemoryError && error.code === 'CONFLICT',
        );
      }

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

      const outbox = await pool.query<{ payload: unknown; status: string }>(
        `SELECT payload, status
         FROM p1_memory_injection_receipt_outbox
         WHERE task_id = $1`,
        [taskId],
      );
      assert.equal(outbox.rows[0]?.status, 'ready');
      assert.deepEqual(outbox.rows[0]?.payload, receipt);

      await pool.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'forced outbox failure';
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER ${triggerName}
          BEFORE INSERT ON p1_memory_injection_receipt_outbox
          FOR EACH ROW
          WHEN (NEW.task_id = '${retryTaskId}')
          EXECUTE FUNCTION ${functionName}();
      `);
      await assert.rejects(
        platform.recordInjectionReceipt({
          taskId: retryTaskId,
          runId: `${runId}-retry`,
          harnessReleaseId: releaseId,
          entries,
          injectedAt: now,
        }),
        /forced outbox failure/u,
      );
      const rolledBack = await pool.query<{ receipt_count: string; outbox_count: string }>(
        `SELECT
           (SELECT count(*) FROM p1_memory_injection_receipts WHERE task_id = $1)::text AS receipt_count,
           (SELECT count(*) FROM p1_memory_injection_receipt_outbox WHERE task_id = $1)::text AS outbox_count`,
        [retryTaskId],
      );
      assert.deepEqual(rolledBack.rows[0], {
        receipt_count: '0',
        outbox_count: '0',
      });
      await pool.query(`DROP TRIGGER ${triggerName} ON p1_memory_injection_receipt_outbox`);
      await pool.query(`DROP FUNCTION ${functionName}()`);
      const retried = await platform.recordInjectionReceipt({
        taskId: retryTaskId,
        runId: `${runId}-retry`,
        harnessReleaseId: releaseId,
        entries,
        injectedAt: now,
      });
      assert.equal(retried.taskId, retryTaskId);
      const committed = await pool.query<{ receipt_count: string; outbox_count: string }>(
        `SELECT
           (SELECT count(*) FROM p1_memory_injection_receipts WHERE task_id = $1)::text AS receipt_count,
           (SELECT count(*) FROM p1_memory_injection_receipt_outbox WHERE task_id = $1)::text AS outbox_count`,
        [retryTaskId],
      );
      assert.deepEqual(committed.rows[0], {
        receipt_count: '1',
        outbox_count: '1',
      });
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON p1_memory_injection_receipt_outbox`).catch(() => undefined);
      await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`).catch(() => undefined);
      await pool.query(
        `DELETE FROM p1_memory_injection_receipts WHERE task_id = ANY($1::text[])`,
        [[taskId, retryTaskId, commitLostTaskId]],
      );
      await pool.end();
    }
  },
);
