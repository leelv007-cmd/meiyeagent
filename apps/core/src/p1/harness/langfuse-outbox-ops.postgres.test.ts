import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { PostgresHarnessStore } from './postgres-store.js';
import { harnessRuntimeId } from './workspace-scope.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'real outbox operations replay, discard, reject invalid states, and isolate runtime ids',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresHarnessStore(pool);
    const suffix = randomUUID();
    const workspaceA = `outbox-ops-a-${suffix}`;
    const workspaceB = `outbox-ops-b-${suffix}`;
    const workflowId = `outbox-ops-workflow-${suffix}`;
    const sharedAuditId = `audit-shared-${suffix}`;
    const discardAuditId = `audit-discard-${suffix}`;
    const queuedAuditId = `audit-queued-${suffix}`;
    const runtimeSharedA = harnessRuntimeId(workspaceA, sharedAuditId);
    const runtimeSharedB = harnessRuntimeId(workspaceB, sharedAuditId);
    const runtimeDiscard = harnessRuntimeId(workspaceA, discardAuditId);
    const runtimeQueued = harnessRuntimeId(workspaceA, queuedAuditId);
    await store.applySchema();

    const append = async (workspaceId: string, auditId: string) => {
      await store.appendPromptAudit({
        workspaceId,
        id: auditId,
        workflowId,
        stage: 'prompt_resolution',
        eventType: 'langfuse_prompt_fallback',
        payload: {
          promptKey: 'textResponse',
          prompt: {
            name: 'harness/text-response',
            version: 'builtin-v1',
            contentHash: 'd'.repeat(64),
            label: 'production',
            source: 'builtin',
            isFallback: true,
            fallbackReason: 'http_503',
          },
        },
      });
    };
    const appendDeadLetter = async (
      workspaceId: string,
      auditId: string,
      runtimeAuditId: string,
    ) => {
      await append(workspaceId, auditId);
      const claimed = await store.claimLangfuseBatch(1);
      assert.equal(claimed[0]?.auditId, runtimeAuditId);
      await store.markLangfuseDeadLetter(
        runtimeAuditId,
        'operator acceptance fixture',
      );
    };

    try {
      await appendDeadLetter(workspaceA, sharedAuditId, runtimeSharedA);
      await appendDeadLetter(workspaceB, sharedAuditId, runtimeSharedB);
      await appendDeadLetter(workspaceA, discardAuditId, runtimeDiscard);
      await append(workspaceA, queuedAuditId);

      assert.notEqual(runtimeSharedA, runtimeSharedB);
      assert.equal(await store.replayLangfuseDeadLetter(runtimeSharedA), true);
      assert.equal(await store.discardLangfuseDeadLetter(runtimeDiscard), true);

      assert.equal(await store.replayLangfuseDeadLetter(runtimeSharedA), false);
      assert.equal(await store.discardLangfuseDeadLetter(runtimeQueued), false);
      assert.equal(await store.replayLangfuseDeadLetter(sharedAuditId), false);

      const states = await pool.query<{
        audit_id: string;
        attempts: number;
        dead_lettered_at: Date | null;
        last_error: string | null;
        next_attempt_ready: boolean;
        status: string;
      }>(
        `select audit_id, attempts, dead_lettered_at, last_error, status,
                next_attempt_at <= now() as next_attempt_ready
           from harness_runtime.langfuse_outbox
          where audit_id=any($1::text[])
          order by audit_id`,
        [[runtimeSharedA, runtimeSharedB, runtimeDiscard, runtimeQueued]],
      );
      const byAuditId = new Map(
        states.rows.map((row) => [row.audit_id, row]),
      );
      assert.deepEqual(
        {
          status: byAuditId.get(runtimeSharedA)?.status,
          attempts: byAuditId.get(runtimeSharedA)?.attempts,
          deadLetteredAt: byAuditId.get(runtimeSharedA)?.dead_lettered_at,
          lastError: byAuditId.get(runtimeSharedA)?.last_error,
          nextAttemptReady: byAuditId.get(runtimeSharedA)?.next_attempt_ready,
        },
        {
          status: 'queued',
          attempts: 0,
          deadLetteredAt: null,
          lastError: null,
          nextAttemptReady: true,
        },
      );
      assert.equal(byAuditId.get(runtimeDiscard)?.status, 'discarded');
      assert.equal(byAuditId.get(runtimeDiscard)?.attempts, 1);
      assert.ok(byAuditId.get(runtimeDiscard)?.dead_lettered_at);
      assert.equal(byAuditId.get(runtimeQueued)?.status, 'queued');
      assert.equal(byAuditId.get(runtimeQueued)?.attempts, 0);
      assert.equal(byAuditId.get(runtimeQueued)?.dead_lettered_at, null);
      assert.equal(byAuditId.get(runtimeSharedB)?.status, 'dead_letter');
      assert.equal(byAuditId.get(runtimeSharedB)?.attempts, 1);
    } finally {
      await pool.query(
        `delete from harness_runtime.langfuse_outbox
          where audit_id=any($1::text[])`,
        [[runtimeSharedA, runtimeSharedB, runtimeDiscard, runtimeQueued]],
      );
      await pool.query(
        `delete from harness_runtime.audit_events
          where id=any($1::text[])`,
        [[runtimeSharedA, runtimeSharedB, runtimeDiscard, runtimeQueued]],
      );
      await pool.end();
    }
  },
);
