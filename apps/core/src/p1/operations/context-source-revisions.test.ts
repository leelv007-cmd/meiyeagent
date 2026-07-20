import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import {
  ContextSourceRevisionConflictError,
  MemoryContextSourceRevisionRepository,
  PostgresContextSourceRevisionRepository,
} from './context-source-revisions.js';

test('context source revisions are server-owned CAS heads', async () => {
  const repository = new MemoryContextSourceRevisionRepository();
  assert.equal((await repository.current('workspace-a')).rights, 0);
  assert.equal(
    await repository.advance({
      workspaceId: 'workspace-a',
      key: 'rights',
      expectedRevision: 0,
    }),
    1,
  );
  await assert.rejects(
    repository.advance({
      workspaceId: 'workspace-a',
      key: 'rights',
      expectedRevision: 0,
    }),
    ContextSourceRevisionConflictError,
  );
});

test('memory source revision CAS allows only one concurrent writer', async () => {
  const repository = new MemoryContextSourceRevisionRepository();
  const attempts = await Promise.allSettled([
    repository.advance({
      workspaceId: 'workspace-concurrent',
      key: 'rights',
      expectedRevision: 0,
    }),
    repository.advance({
      workspaceId: 'workspace-concurrent',
      key: 'rights',
      expectedRevision: 0,
    }),
  ]);

  assert.deepEqual(
    attempts.map((attempt) => attempt.status).sort(),
    ['fulfilled', 'rejected'],
  );
  assert.equal(
    (await repository.current('workspace-concurrent')).rights,
    1,
  );
});

test(
  'Postgres context source heads survive process-local repository replacement',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const repository = new PostgresContextSourceRevisionRepository(pool);
    const workspaceId = `context-source-${Date.now()}`;
    await repository.migrate();
    try {
      await repository.advance({
        workspaceId,
        key: 'assets',
        expectedRevision: 0,
      });
      assert.equal(
        (
          await new PostgresContextSourceRevisionRepository(pool).current(
            workspaceId,
          )
        ).assets,
        1,
      );
    } finally {
      await repository.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);
