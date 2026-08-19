import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';

import {
  assertOperationsHotPathContract,
  hotPathWorkspaceState,
} from './operations-hot-path.contract.js';
import { PostgresOperationsRepository } from './postgres-repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

class GuardedPostgresOperationsRepository extends PostgresOperationsRepository {
  override async loadWorkspace(): Promise<never> {
    throw new Error(
      'whole-workspace load is forbidden on the operations hot path',
    );
  }

  override async saveWorkspace(): Promise<never> {
    throw new Error(
      'whole-workspace save is forbidden on the operations hot path',
    );
  }

  override async withWorkspaceLock(): Promise<never> {
    throw new Error(
      'workspace global lock is forbidden on the operations hot path',
    );
  }
}

test(
  'Postgres hot-path repository matches the shared Memory contract without loading the workspace',
  {
    skip: connectionString
      ? false
      : 'TEST_DATABASE_URL is not configured — PG seam skipped',
  },
  async () => {
    assert.ok(connectionString);
    const pool = new Pool({ connectionString });
    const workspaceId = `hot-path-${randomUUID()}`;
    try {
      const seeder = new PostgresOperationsRepository(pool);
      await seeder.migrate();
      await seeder.saveWorkspace(hotPathWorkspaceState(workspaceId));
      const adapter = new GuardedPostgresOperationsRepository(pool);
      await assertOperationsHotPathContract(adapter, workspaceId);
    } finally {
      await pool.end();
    }
  },
);
