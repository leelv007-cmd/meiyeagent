import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import { P1DomainError } from '../foundation/domain.js';
import type {
  VideoRegenerationTaskBinding,
  VideoRegenerationFreeActionRecord,
  VideoRegenerationQuoteBinding,
  VideoRegenerationRepository,
} from './video-regeneration-runtime.js';

type PayloadRow<T> = QueryResultRow & { payload: T };

export class PostgresVideoRegenerationRepository
  implements VideoRegenerationRepository, PostgresSchemaMigrator
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS model_video_regeneration_quotes (
        workspace_id text NOT NULL,
        quote_id text NOT NULL,
        source_run_id text NOT NULL,
        scope text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, quote_id),
        CHECK (scope IN ('shot', 'full_compose')),
        CHECK (payload->>'workspaceId' = workspace_id),
        CHECK (payload->>'quoteId' = quote_id)
      );

      CREATE TABLE IF NOT EXISTS model_video_regeneration_tasks (
        workspace_id text NOT NULL,
        task_id text NOT NULL,
        quote_id text NOT NULL,
        source_run_id text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, task_id),
        UNIQUE (workspace_id, quote_id),
        FOREIGN KEY (workspace_id, quote_id)
          REFERENCES model_video_regeneration_quotes (workspace_id, quote_id),
        CHECK (payload->>'workspaceId' = workspace_id),
        CHECK (payload->>'taskId' = task_id)
      );

      CREATE TABLE IF NOT EXISTS model_video_regeneration_free_actions (
        workspace_id text NOT NULL,
        action_id text NOT NULL,
        task_id text NOT NULL,
        action text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, action_id),
        FOREIGN KEY (workspace_id, task_id)
          REFERENCES model_video_regeneration_tasks (workspace_id, task_id),
        CHECK (payload->>'workspaceId' = workspace_id),
        CHECK (payload->>'taskId' = task_id)
      );

      CREATE INDEX IF NOT EXISTS model_video_regeneration_free_actions_task_idx
        ON model_video_regeneration_free_actions
        (workspace_id, task_id, created_at);

      DROP INDEX IF EXISTS model_video_regeneration_tasks_source_idx;
      ALTER TABLE model_video_regeneration_tasks
        ADD COLUMN IF NOT EXISTS created_at timestamptz;
      UPDATE model_video_regeneration_tasks
         SET created_at = COALESCE(
           created_at,
           (payload->>'createdAt')::timestamptz,
           now()
         )
       WHERE created_at IS NULL;
      ALTER TABLE model_video_regeneration_tasks
        ALTER COLUMN created_at SET NOT NULL,
        DROP COLUMN IF EXISTS status,
        DROP COLUMN IF EXISTS updated_at;
    `);
  }

  async saveQuoteBinding(binding: VideoRegenerationQuoteBinding) {
    await this.pool.query(
      `INSERT INTO model_video_regeneration_quotes
         (workspace_id, quote_id, source_run_id, scope, payload, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
       ON CONFLICT (workspace_id, quote_id) DO NOTHING`,
      [
        binding.workspaceId,
        binding.quoteId,
        binding.sourceRunId,
        binding.scope,
        JSON.stringify(binding),
        binding.createdAt,
      ],
    );
    const stored = await this.getQuoteBinding(
      binding.workspaceId,
      binding.quoteId,
    );
    if (!isDeepStrictEqual(stored, binding)) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `Video regeneration quote ${binding.quoteId} already has different scope facts.`,
      );
    }
  }

  async getQuoteBinding(workspaceId: string, quoteId: string) {
    const result = await this.pool.query<
      PayloadRow<VideoRegenerationQuoteBinding>
    >(
      `SELECT payload
         FROM model_video_regeneration_quotes
        WHERE workspace_id = $1 AND quote_id = $2`,
      [workspaceId, quoteId],
    );
    return result.rows[0]?.payload
      ? structuredClone(result.rows[0].payload)
      : null;
  }

  async saveTaskBinding(task: VideoRegenerationTaskBinding) {
    await this.pool.query(
      `INSERT INTO model_video_regeneration_tasks
         (workspace_id, task_id, quote_id, source_run_id, payload,
          created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
       ON CONFLICT (workspace_id, task_id) DO UPDATE SET
         payload = EXCLUDED.payload
       WHERE model_video_regeneration_tasks.quote_id = EXCLUDED.quote_id
         AND model_video_regeneration_tasks.source_run_id = EXCLUDED.source_run_id
         AND model_video_regeneration_tasks.payload - 'supplierTaskRef' =
             EXCLUDED.payload - 'supplierTaskRef'
         AND (
           model_video_regeneration_tasks.payload->>'supplierTaskRef' IS NULL
           OR model_video_regeneration_tasks.payload->>'supplierTaskRef' =
              EXCLUDED.payload->>'supplierTaskRef'
         )`,
      [
        task.workspaceId,
        task.taskId,
        task.quoteId,
        task.sourceRunId,
        JSON.stringify(task),
        task.createdAt,
      ],
    );
    const stored = await this.getTaskBinding(task.workspaceId, task.taskId);
    if (!isDeepStrictEqual(stored, task)) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        `Video regeneration task ${task.taskId} already has different immutable facts.`,
      );
    }
  }

  async getTaskBinding(workspaceId: string, taskId: string) {
    const result = await this.pool.query<
      PayloadRow<VideoRegenerationTaskBinding>
    >(
      `SELECT payload
         FROM model_video_regeneration_tasks
        WHERE workspace_id = $1 AND task_id = $2`,
      [workspaceId, taskId],
    );
    return result.rows[0]?.payload
      ? structuredClone(result.rows[0].payload)
      : null;
  }

  async appendFreeAction(input: VideoRegenerationFreeActionRecord) {
    const actionId = createHash('sha256')
      .update(
        JSON.stringify({
          action: input.action,
          supplierTaskRef: input.supplierTaskRef,
          taskId: input.taskId,
          workspaceId: input.workspaceId,
        }),
      )
      .digest('hex');
    await this.pool.query(
      `INSERT INTO model_video_regeneration_free_actions
         (workspace_id, action_id, task_id, action, payload, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)
       ON CONFLICT (workspace_id, action_id) DO NOTHING`,
      [
        input.workspaceId,
        actionId,
        input.taskId,
        input.action,
        JSON.stringify(input),
        input.at,
      ],
    );
  }
}
