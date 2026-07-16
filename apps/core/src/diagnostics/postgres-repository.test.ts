import assert from 'node:assert/strict';
import test from 'node:test';
import type { DiagnosticRun } from '@meiye/contracts';
import { Pool } from 'pg';
import { PostgresDiagnosticRepository } from './postgres-repository.js';
import type { DiagnosticIdentity } from './repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

test('Postgres repository persists and de-duplicates a diagnostic run', {
  skip: connectionString ? false : 'TEST_DATABASE_URL is not configured',
}, async (t) => {
  const pool = new Pool({ connectionString });
  t.after(() => pool.end());
  const repository = new PostgresDiagnosticRepository(pool);
  await repository.migrate();
  await pool.query('delete from diagnostic_runs');

  const run: DiagnosticRun = {
    id: 'run-postgres-1',
    correlationId: 'corr-postgres-1',
    status: 'waiting_for_user',
    events: ['正在读取门店事实'],
  };
  const owner: DiagnosticIdentity = {
    userId: 'user-postgres-1',
    workspaceId: 'workspace-postgres-1',
  };
  const otherWorkspace: DiagnosticIdentity = {
    userId: 'user-postgres-2',
    workspaceId: 'workspace-postgres-2',
  };
  const otherUser: DiagnosticIdentity = {
    userId: 'user-postgres-3',
    workspaceId: owner.workspaceId,
  };
  const created = await repository.create(run, 'idempotent-postgres-1', owner);
  const duplicate = await repository.create(
    { ...run, id: 'run-postgres-duplicate' },
    'idempotent-postgres-1',
    owner
  );
  const otherWorkspaceRun = await repository.create(
    { ...run, id: 'run-postgres-other-workspace' },
    'idempotent-postgres-1',
    otherWorkspace
  );
  const otherUserConflict = await repository.create(
    { ...run, id: 'run-postgres-other-user' },
    'idempotent-postgres-1',
    otherUser
  );

  assert.equal(created?.id, 'run-postgres-1');
  assert.equal(duplicate?.id, 'run-postgres-1');
  assert.equal(otherWorkspaceRun?.id, 'run-postgres-other-workspace');
  assert.equal(otherUserConflict, null);
  assert.equal(await repository.get(run.id, otherWorkspace), null);

  await repository.save({
    ...run,
    status: 'completed',
    result: { title: '标题', hook: '开场', body: '正文' },
  }, owner);
  const persisted = await repository.get(run.id, owner);
  assert.equal(persisted?.status, 'completed');
  assert.equal(persisted?.result?.title, '标题');

  const persistedIdentity = await pool.query<{
    user_id: string;
    workspace_id: string;
  }>(
    `select user_id, workspace_id
     from diagnostic_runs where id = $1`,
    [run.id]
  );
  assert.deepEqual(persistedIdentity.rows[0], {
    user_id: owner.userId,
    workspace_id: owner.workspaceId,
  });

  await assert.rejects(
    repository.save({ ...run, status: 'completed' }, otherWorkspace),
    /was not found/
  );
});
