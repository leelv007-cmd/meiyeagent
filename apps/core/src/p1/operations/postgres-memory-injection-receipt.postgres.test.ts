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
import { MemoryFoundationModule } from './memory-foundation-module.js';
import { PostgresMemoryInjectionReceiptStore } from './postgres-memory-injection-receipt.js';
import {
  MemoryReuseMemoryRepository,
  ReuseMemoryError,
  ReuseMemoryService,
} from './reuse-memory-service.js';
import { PostgresReuseMemoryRepository } from './postgres-reuse-memory-repository.js';

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
    const triggerName = `memory_receipt_fail_${triggerSuffix}`;
    const functionName = `memory_receipt_fail_fn_${triggerSuffix}`;

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
      // The committed row's physical version, so the retry below can be shown
      // to have read it rather than rewritten it (put-once).
      const firstCommittedRow = await pool.query<{
        payload: unknown;
        row_version: string;
      }>(
        `SELECT payload, xmin::text AS row_version
         FROM p1_memory_injection_receipts
         WHERE task_id = $1`,
        [commitLostTaskId],
      );
      assert.deepEqual(firstCommittedRow.rows[0]?.payload, firstCommitted);
      retryClock = '2026-08-08T12:05:00.000Z';
      const recovered = await commitLostPlatform.recordInjectionReceipt({
        taskId: commitLostTaskId,
        runId: `${runId}-commit-lost`,
        harnessReleaseId: releaseId,
        entries,
      });
      assert.deepEqual(recovered, firstCommitted);
      const recoveredRow = await pool.query<{
        payload: unknown;
        row_version: string;
      }>(
        `SELECT payload, xmin::text AS row_version
         FROM p1_memory_injection_receipts
         WHERE task_id = $1`,
        [commitLostTaskId],
      );
      assert.deepEqual(recoveredRow.rows[0], firstCommittedRow.rows[0]);

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

      // V31-18 P1-7: the retired write-only "outbox" must be gone after migrate(),
      // including on databases that already had it.
      const retired = await pool.query<{ present: boolean }>(
        `SELECT to_regclass('p1_memory_injection_receipt_outbox') IS NOT NULL AS present`,
      );
      assert.equal(retired.rows[0]?.present, false);

      // Transaction cleanup, NOT cross-table atomicity — that property left with
      // the retired outbox, because save() now writes exactly one table.
      //
      // Be precise about which half has teeth: the trigger is BEFORE INSERT, so
      // the row never lands and the `receipt_count: '0'` below is true no matter
      // what save() does with its transaction. The assertion that bites is the
      // *retry succeeding* afterwards — if save() failed to ROLLBACK, the pooled
      // client would be handed back carrying an aborted transaction and the
      // retry would fail with 25P02 instead of committing.
      await pool.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'forced receipt failure';
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER ${triggerName}
          BEFORE INSERT ON p1_memory_injection_receipts
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
        /forced receipt failure/u,
      );
      const rolledBack = await pool.query<{ receipt_count: string }>(
        `SELECT count(*)::text AS receipt_count
           FROM p1_memory_injection_receipts WHERE task_id = $1`,
        [retryTaskId],
      );
      assert.deepEqual(rolledBack.rows[0], { receipt_count: '0' });
      await pool.query(`DROP TRIGGER ${triggerName} ON p1_memory_injection_receipts`);
      await pool.query(`DROP FUNCTION ${functionName}()`);
      const retried = await platform.recordInjectionReceipt({
        taskId: retryTaskId,
        runId: `${runId}-retry`,
        harnessReleaseId: releaseId,
        entries,
        injectedAt: now,
      });
      assert.equal(retried.taskId, retryTaskId);
      const committed = await pool.query<{ receipt_count: string }>(
        `SELECT count(*)::text AS receipt_count
           FROM p1_memory_injection_receipts WHERE task_id = $1`,
        [retryTaskId],
      );
      assert.deepEqual(committed.rows[0], { receipt_count: '1' });
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON p1_memory_injection_receipts`).catch(() => undefined);
      await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`).catch(() => undefined);
      await pool.query(
        `DELETE FROM p1_memory_injection_receipts WHERE task_id = ANY($1::text[])`,
        [[taskId, retryTaskId, commitLostTaskId]],
      );
      await pool.end();
    }
  },
);

test(
  'Postgres receipt projection serves live revoke and source-deletion authority without deleting memory',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const memoryRepository = new PostgresReuseMemoryRepository(pool);
    const receiptStore = new PostgresMemoryInjectionReceiptStore(pool);
    const workspaceId = `memory-receipt-projection-${randomUUID()}`;
    const taskBefore = `task-before-${randomUUID()}`;
    const taskAfter = `task-after-${randomUUID()}`;
    const context = { workspaceId, userId: 'owner-pg' };
    const moduleContext = {
      actor: 'owner' as const,
      correlationId: 'memory-receipt-projection',
      userId: context.userId,
      workspaceId,
    };

    await memoryRepository.migrate();
    await receiptStore.migrate();
    try {
      const reuse = new ReuseMemoryService(
        memoryRepository,
        { async verifyCandidate() {}, async verifyRevision() {} },
        () => now,
      );
      const platform = new AgentMemoryPlatform(
        reuse,
        receiptStore,
        undefined,
        () => now,
      );
      const module = new MemoryFoundationModule(reuse, platform);
      await reuse.saveMemorySourceConversation({
        workspaceId,
        conversationId: 'conversation-source',
        turnId: 'turn-source',
        observedAt: now,
        messages: [{ index: 0, text: '以后每次都先说明门店位置' }],
      });
      const candidates = await platform.onExtracted({
        workspaceId,
        idempotencyPrefix: 'projection',
        items: [
          {
            itemId: 'revoke',
            kind: 'preference',
            semanticKey: 'tone.revoke-one',
            proposedValue: '克制',
            defaultScope: { storeId: 'store-a' },
            decisionEventId: 'decision-revoke',
            taskId: 'task-source-revoke',
            source: {
              conversationId: 'conversation-source',
              sourceTurnId: 'turn-source',
              messageRange: { start: 0, end: 0 },
            },
            statement: '语气保持克制',
          },
          {
            itemId: 'survivor',
            kind: 'preference',
            semanticKey: 'structure.survivor',
            proposedValue: '先说明门店位置',
            defaultScope: { storeId: 'store-a' },
            decisionEventId: 'decision-survivor',
            taskId: 'task-source-survivor',
            source: {
              conversationId: 'conversation-source',
              sourceTurnId: 'turn-source',
              messageRange: { start: 0, end: 0 },
            },
            statement: '先说明门店位置',
          },
        ],
      });
      const revoked = await platform.confirmMemoryCandidate(context, {
        candidateId: candidates[0]!.candidateId,
        preferenceId: 'preference-revoke',
        idempotencyKey: 'confirm-revoke',
      });
      await platform.confirmMemoryCandidate(context, {
        candidateId: candidates[1]!.candidateId,
        preferenceId: 'preference-survivor',
        idempotencyKey: 'confirm-survivor',
      });

      await platform.retrieveForInjection({
        workspaceId,
        scope: { storeId: 'store-a' },
        injectionContext: {
          taskId: taskBefore,
          runId: `run-before-${workspaceId}`,
          harnessReleaseId: 'release-projection',
        },
      });
      const before = (await module.query({
        context: moduleContext,
        input: { action: 'injection_receipt', payload: { taskId: taskBefore } },
      })) as {
        receipt: {
          entries: Array<{
            memoryId: string;
            currentStatus?: string;
            source?: { preview?: string; observedAt?: string; deleted: boolean };
          }>;
        };
      };
      assert.deepEqual(
        before.receipt.entries.map((entry) => entry.currentStatus),
        ['confirmed', 'confirmed'],
      );
      assert.deepEqual(before.receipt.entries[0]?.source, {
        preview: '以后每次都先说明门店位置',
        observedAt: now,
        deleted: false,
      });

      await platform.revokeMemory(context, {
        preferenceId: revoked.preferenceId,
        expectedRevision: revoked.revision,
        idempotencyKey: 'revoke-one',
      });
      const afterRevoke = await platform.retrieveForInjection({
        workspaceId,
        scope: { storeId: 'store-a' },
        injectionContext: {
          taskId: taskAfter,
          runId: `run-after-${workspaceId}`,
          harnessReleaseId: 'release-projection',
        },
      });
      assert.deepEqual(
        afterRevoke.map((entry) => entry.memoryId),
        ['preference-survivor'],
      );
      const historical = (await module.query({
        context: moduleContext,
        input: { action: 'injection_receipt', payload: { taskId: taskBefore } },
      })) as {
        receipt: { entries: Array<{ memoryId: string; currentStatus?: string }> };
      };
      assert.equal(
        historical.receipt.entries.find(
          (entry) => entry.memoryId === 'preference-revoke',
        )?.currentStatus,
        'revoked',
      );
      assert.equal(
        historical.receipt.entries.find(
          (entry) => entry.memoryId === 'preference-survivor',
        )?.currentStatus,
        'confirmed',
      );

      await reuse.deleteMemorySourceConversation(moduleContext, 'conversation-source');
      const afterSourceDeletion = (await module.query({
        context: moduleContext,
        input: { action: 'injection_receipt', payload: { taskId: taskBefore } },
      })) as {
        receipt: { entries: Array<{ source?: unknown }> };
      };
      assert.deepEqual(
        afterSourceDeletion.receipt.entries.map((entry) => entry.source),
        [{ deleted: true }, { deleted: true }],
      );
      assert.deepEqual(
        (
          await platform.retrieveForInjection({
            workspaceId,
            scope: { storeId: 'store-a' },
          })
        ).map((entry) => entry.memoryId),
        ['preference-survivor'],
      );
    } finally {
      await memoryRepository.deleteWorkspaceForTest(workspaceId);
      await pool.query(
        `DELETE FROM p1_memory_injection_receipts WHERE task_id = ANY($1::text[])`,
        [[taskBefore, taskAfter]],
      );
      await pool.end();
    }
  },
);
