import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import { PostgresModelSupplyRepository } from './postgres-repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'current model migrations omit regeneration tables while preserving legacy evidence',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const suffix = randomUUID().replaceAll('-', '');
    const freshSchema = `issue264_fresh_${suffix}`;
    const upgradeSchema = `issue264_upgrade_${suffix}`;
    const admin = new Pool({ connectionString });
    t.after(async () => {
      await admin.query(`DROP SCHEMA IF EXISTS ${freshSchema} CASCADE`);
      await admin.query(`DROP SCHEMA IF EXISTS ${upgradeSchema} CASCADE`);
      await admin.end();
    });
    await admin.query(`CREATE SCHEMA ${freshSchema}`);
    await admin.query(`CREATE SCHEMA ${upgradeSchema}`);

    const fresh = new Pool({
      connectionString,
      options: `-c search_path=${freshSchema},public`,
    });
    await new PostgresModelSupplyRepository(fresh).migrate();
    const freshRelations = await fresh.query<{ relation: string | null }>(`
      SELECT to_regclass('model_video_regeneration_quotes')::text AS relation
      UNION ALL
      SELECT to_regclass('model_video_regeneration_tasks')::text
      UNION ALL
      SELECT to_regclass('model_video_regeneration_free_actions')::text
    `);
    assert.deepEqual(
      freshRelations.rows.map((row) => row.relation),
      [null, null, null],
    );
    await fresh.end();

    const upgrade = new Pool({
      connectionString,
      options: `-c search_path=${upgradeSchema},public`,
    });
    await upgrade.query(`
      CREATE TABLE model_video_regeneration_quotes (
        workspace_id text NOT NULL,
        quote_id text NOT NULL,
        source_run_id text NOT NULL,
        scope text NOT NULL CHECK (scope = 'shot'),
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, quote_id)
      );
      CREATE TABLE model_video_regeneration_tasks (
        workspace_id text NOT NULL,
        task_id text NOT NULL,
        quote_id text NOT NULL,
        source_run_id text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, task_id)
      );
      CREATE TABLE model_video_regeneration_free_actions (
        workspace_id text NOT NULL,
        action_id text NOT NULL,
        task_id text NOT NULL,
        action text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, action_id)
      );
      INSERT INTO model_video_regeneration_quotes
        (workspace_id, quote_id, source_run_id, scope, payload, created_at)
      VALUES
        ('workspace-legacy', 'quote-legacy', 'run-legacy', 'shot',
         '{"workspaceId":"workspace-legacy","quoteId":"quote-legacy"}'::jsonb,
         '2026-07-20T00:00:00.000Z');
      INSERT INTO model_video_regeneration_tasks
        (workspace_id, task_id, quote_id, source_run_id, payload, created_at)
      VALUES
        ('workspace-legacy', 'task-legacy', 'quote-legacy', 'run-legacy',
         '{"workspaceId":"workspace-legacy","taskId":"task-legacy"}'::jsonb,
         '2026-07-20T00:00:01.000Z');
      INSERT INTO model_video_regeneration_free_actions
        (workspace_id, action_id, task_id, action, payload, created_at)
      VALUES
        ('workspace-legacy', 'action-legacy', 'task-legacy', 'recover',
         '{"workspaceId":"workspace-legacy","taskId":"task-legacy"}'::jsonb,
         '2026-07-20T00:00:02.000Z');
    `);

    await new PostgresModelSupplyRepository(upgrade).migrate();
    const retained = await upgrade.query<{
      actions: number;
      quotes: number;
      tasks: number;
    }>(`
      SELECT
        (SELECT count(*)::int FROM model_video_regeneration_quotes) AS quotes,
        (SELECT count(*)::int FROM model_video_regeneration_tasks) AS tasks,
        (SELECT count(*)::int FROM model_video_regeneration_free_actions) AS actions
    `);
    assert.deepEqual(retained.rows[0], {
      actions: 1,
      quotes: 1,
      tasks: 1,
    });
    const constraints = await upgrade.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
       WHERE conrelid = 'model_video_regeneration_quotes'::regclass
         AND contype = 'c'
    `);
    assert.equal(
      constraints.rows.some((row) => /scope = 'shot'/u.test(row.definition)),
      true,
    );
    await upgrade.end();
  },
);
