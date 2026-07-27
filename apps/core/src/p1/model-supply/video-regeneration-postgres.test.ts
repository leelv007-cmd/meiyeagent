import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, it } from 'node:test';
import { Pool } from 'pg';
import { PostgresVideoRegenerationRepository } from './video-regeneration-postgres.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe(
  'Postgres video regeneration repository',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' },
  () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const workspaceId = `video-regeneration-${randomUUID()}`;
    const repository = new PostgresVideoRegenerationRepository(pool);

    after(async () => {
      await pool.query(
        'DELETE FROM model_video_regeneration_free_actions WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM model_video_regeneration_tasks WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM model_video_regeneration_quotes WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.end();
    });

    it('restores quote scope/task truth and deduplicates free-action replay', async () => {
      await repository.migrate();
      await repository.saveQuoteBinding({
        actorId: 'owner-1',
        createdAt: '2026-07-20T12:00:00.000Z',
        quoteId: 'quote-1',
        scope: 'shot',
        shotId: 'opening',
        sourceRunId: 'source-1',
        targetSeconds: 12,
        workspaceId,
      });
      await repository.saveTaskBinding({
        actorId: 'owner-1',
        createdAt: '2026-07-20T12:00:00.000Z',
        quoteId: 'quote-1',
        scope: 'shot',
        shotId: 'opening',
        sourceRunId: 'source-1',
        taskId: 'task-1',
        workspaceId,
      });
      const free = {
        action: 'recover' as const,
        actorId: 'owner-1',
        at: '2026-07-20T12:00:02.000Z',
        supplierTaskRef: 'supplier-1',
        taskId: 'task-1',
        workspaceId,
      };
      await repository.appendFreeAction(free);
      await repository.appendFreeAction(free);

      const restarted = new PostgresVideoRegenerationRepository(pool);
      assert.equal(
        (await restarted.getQuoteBinding(workspaceId, 'quote-1'))?.scope,
        'shot',
      );
      assert.equal(
        (await restarted.getTaskBinding(workspaceId, 'task-1'))?.sourceRunId,
        'source-1',
      );
      await assert.rejects(
        restarted.saveTaskBinding({
          actorId: 'another-owner',
          createdAt: '2026-07-20T12:00:00.000Z',
          quoteId: 'quote-1',
          scope: 'shot',
          shotId: 'opening',
          sourceRunId: 'source-1',
          taskId: 'task-1',
          workspaceId,
        }),
        /different immutable facts/,
      );
      const count = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM model_video_regeneration_free_actions
          WHERE workspace_id = $1 AND task_id = 'task-1'`,
        [workspaceId],
      );
      assert.equal(count.rows[0]?.count, '1');
    });

    it('rejects retired whole-film scope at the persistence boundary', async () => {
      await repository.migrate();
      await assert.rejects(
        pool.query(
          `INSERT INTO model_video_regeneration_quotes
             (workspace_id, quote_id, source_run_id, scope, payload, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, now())`,
          [
            workspaceId,
            'quote-retired-scope',
            'source-retired-scope',
            'full_compose',
            JSON.stringify({
              actorId: 'owner-1',
              createdAt: '2026-07-20T12:00:00.000Z',
              quoteId: 'quote-retired-scope',
              scope: 'full_compose',
              sourceRunId: 'source-retired-scope',
              targetSeconds: 12,
              workspaceId,
            }),
          ],
        ),
        /model_video_regeneration_quotes_shot_only_check|check constraint/,
      );
    });
  },
);
