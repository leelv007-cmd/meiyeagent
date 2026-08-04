import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresProductRepository } from '../../product/postgres-repository.js';
import { ProductService } from '../../product/product-service.js';
import { cutoverCliUsage, runCutoverCli } from './cli.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('cutover CLI exposes deliberate steps before requiring database access', async () => {
  assert.deepEqual(await runCutoverCli(['--help'], {}), {
    help: cutoverCliUsage,
  });
  await assert.rejects(runCutoverCli(['unknown'], {}), /Unknown cutover action/);
  await assert.rejects(runCutoverCli(['plan'], {}), /DATABASE_URL is required/);
});

test(
  'cutover CLI completes a database action before closing its pool',
  {
    skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured',
    timeout: 10_000,
  },
  async (t) => {
    const suffix = randomUUID();
    const userId = `cutover-cli-user-${suffix}`;
    const workspaceId = `cutover-cli-workspace-${suffix}`;
    const pool = new Pool({ connectionString: databaseUrl });
    const repository = new PostgresProductRepository(pool);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text NOT NULL UNIQUE,
        email_verified boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS workspaces (
        id text PRIMARY KEY,
        name text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS workspace_memberships (
        workspace_id text NOT NULL,
        user_id text NOT NULL,
        role text NOT NULL DEFAULT 'owner',
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, user_id)
      );
    `);
    await repository.migrate();
    await pool.query(
      `INSERT INTO "user" (id, name, email)
       VALUES ($1, 'Cutover CLI user', $2)`,
      [userId, `${userId}@example.test`]
    );
    await pool.query(
      `INSERT INTO workspaces (id, name)
       VALUES ($1, 'Cutover CLI workspace')`,
      [workspaceId]
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [workspaceId, userId]
    );
    await new ProductService({ repository }).execute(
      {
        actor: 'user',
        role: 'owner',
        correlationId: `corr-${suffix}`,
        userId,
        workspaceId,
      },
      { type: 'hide_example', hidden: true },
      `seed-${suffix}`
    );

    t.after(async () => {
      await pool.query(
        'DELETE FROM p1_cutover_execution_runs WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query(
        'DELETE FROM p1_migration_manifests WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query(
        'DELETE FROM product_command_results WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query('DELETE FROM product_states WHERE workspace_id = $1', [
        workspaceId,
      ]);
      await pool.query(
        'DELETE FROM workspace_memberships WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
      await pool.end();
    });

    const result = await runCutoverCli(['plan'], {
      DATABASE_URL: databaseUrl,
      CUTOVER_WORKSPACE_ID: workspaceId,
      CUTOVER_ACTOR_ID: userId,
      CUTOVER_CORRELATION_ID: `corr-${suffix}`,
    });

    assert.ok('runId' in result);
    assert.equal(result.manifest.workspaceId, workspaceId);
  }
);
