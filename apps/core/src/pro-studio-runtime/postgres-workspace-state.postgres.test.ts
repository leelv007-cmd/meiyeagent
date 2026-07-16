import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import {
  migrateProStudioWorkspaceState,
  PostgresWorkspaceStateRepository,
} from './postgres-workspace-state.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'persists runtime state and rolls failed transactions back in Postgres',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const workspaceId = `pro-studio-state-${randomUUID()}`;
    await pool.query(`
			CREATE TABLE IF NOT EXISTS workspaces (
				id text PRIMARY KEY,
				name text NOT NULL,
				created_at timestamptz NOT NULL DEFAULT now()
			)
		`);
    await migrateProStudioWorkspaceState(pool);
    await pool.query(
      "INSERT INTO workspaces (id, name) VALUES ($1, 'Pro Studio state test')",
      [workspaceId]
    );
    t.after(async () => {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.end();
    });

    const repository = new PostgresWorkspaceStateRepository(pool, {
      createInitialState: () => ({ count: 0 }),
      namespace: 'integration_test',
    });
    await repository.transact(workspaceId, (state) => {
      state.count = 3;
    });
    await assert.rejects(
      repository.transact(workspaceId, (state) => {
        state.count = 99;
        throw new Error('rollback');
      }),
      /rollback/
    );

    assert.deepEqual(await repository.read(workspaceId), { count: 3 });
  }
);
