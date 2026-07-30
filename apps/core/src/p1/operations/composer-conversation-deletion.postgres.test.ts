import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import {
  OperationsApplicationService,
  OperationsFoundationModule,
  PostgresOperationsRepository,
  PostgresReuseMemoryRepository,
  ReuseMemoryComposerConversationDeletionNotifier,
  ReuseMemoryService,
} from './index.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Composer deletion tombstones memory provenance and retains memory and Works in PostgreSQL',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString, max: 6 });
    const operationsRepository = new PostgresOperationsRepository(pool);
    const memoryRepository = new PostgresReuseMemoryRepository(pool);
    const suffix = randomUUID();
    const workspaceId = `workspace-composer-delete-${suffix}`;
    const userId = `owner-composer-delete-${suffix}`;
    const conversationId = `composer:conversation-${suffix}`;
    const context = {
      actor: 'owner' as const,
      correlationId: `corr-composer-delete-${suffix}`,
      userId,
      workspaceId,
    };
    const memory = new ReuseMemoryService(memoryRepository, {
      async verifyCandidate() {},
      async verifyRevision() {},
    });
    const operations = new OperationsApplicationService(operationsRepository, {
      canvasExporter: {
        async export() {
          throw new Error('not used');
        },
      },
      creationExecutor: {
        async inspect() {},
        async submit() {
          throw new Error('not used');
        },
        async verify(input) {
          return { ...input, status: 'unknown' as const };
        },
      },
      imageGenerator: {
        async submit() {
          throw new Error('not used');
        },
      },
      notifier: { async send() {} },
    });
    operations.attachComposerConversationDeletionNotifier(
      new ReuseMemoryComposerConversationDeletionNotifier(memory)
    );
    const module = new OperationsFoundationModule(operations);

    try {
      await operationsRepository.migrate();
      await memoryRepository.migrate();
      await pool.query(
        `INSERT INTO "user" (id, name, email)
         VALUES ($1, 'Composer deletion owner', $2)`,
        [userId, `${userId}@example.test`]
      );
      await pool.query(
        `INSERT INTO workspaces (id, name)
         VALUES ($1, 'Composer deletion workspace')`,
        [workspaceId]
      );
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')`,
        [workspaceId, userId]
      );

      const work = await operations.createCreativeWork(context, {
        intent: '沉淀一条可复用的真实门店表达',
        mode: 'agent',
        sessionId: conversationId,
        sourceReferences: [],
      });
      const source = {
        conversationId,
        messages: [{ index: 0, text: '以后文案保持专业、亲切、利落。' }],
        observedAt: new Date().toISOString(),
        turnId: `turn-${suffix}`,
        workspaceId,
      };
      await memory.saveMemorySourceConversation(source);
      await memory.saveMemoryWorkLog(source);
      await memory.proposePreference({
        candidateId: `candidate-${suffix}`,
        defaultScope: { storeId: 'store-a' },
        evidenceDecisionIds: [`decision-${suffix}`],
        evidenceTaskIds: [`task-${suffix}`],
        proposedAt: source.observedAt,
        proposedValue: '专业、亲切、利落',
        semanticKey: 'copy.tone',
        source: {
          conversationId,
          messageRange: { start: 0, end: 0 },
          sourceTurnId: source.turnId,
        },
        status: 'pending',
        trigger: 'explicit_long_term_intent',
        workspaceId,
      });
      await memory.confirmPreference(
        { userId, workspaceId },
        {
          candidateId: `candidate-${suffix}`,
          expectedRevision: 0,
          idempotencyKey: `confirm-${suffix}`,
          negativeExamples: [],
          positiveExamples: [],
          preferenceId: `preference-${suffix}`,
        }
      );

      const deletion = await module.execute({
        context,
        idempotencyKey: `delete-${suffix}`,
        input: {
          action: 'delete_composer_conversation',
          payload: { conversationId },
        },
      });
      assert.equal(
        (deletion as { action: string }).action,
        'composer_conversation.deleted'
      );

      const page = await memory.memoryEntriesPage(workspaceId, { limit: 10 });
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0]?.status, 'confirmed');
      assert.equal(page.items[0]?.source?.status, 'deleted');
      assert.equal(page.items[0]?.source?.preview, null);
      assert.equal(
        (await operations.getCanonicalHistory(context)).sessions.length,
        0
      );

      const retained = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM p1_creative_works
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, work.id]
      );
      assert.equal(retained.rows[0]?.count, '1');
      await assert.rejects(
        pool.query(
          `DELETE FROM p1_creative_works
            WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, work.id]
        ),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, '42501');
          assert.match(
            (error as Error).message,
            /delete Composer conversations through the Operations port/u
          );
          return true;
        }
      );
    } finally {
      await pool.end();
    }
  }
);
