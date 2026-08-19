import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { P1DomainError } from './domain.js';
import { PostgresWorkspaceBootstrapper } from './workspace-bootstrap.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Core bootstrap creates only the requested owner membership and preserves it on retry',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const workspaceId = `bootstrap-workspace-${suffix}`;
    const ownerUserId = `bootstrap-owner-${suffix}`;
    const bootstrapper = new PostgresWorkspaceBootstrapper(pool);
    await bootstrapper.migrate();
    t.after(async () => {
      await pool.query(
        'DELETE FROM p1_workspace_bootstrap_receipts WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query('DELETE FROM p1_write_ownership WHERE workspace_id = $1', [
        workspaceId,
      ]);
      await pool.query(
        'DELETE FROM content_package_write_ownership WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.end();
    });

    const firstInput = {
      idempotencyKey: `workspace-bootstrap:${workspaceId}`,
      ownerEmail: `bootstrap-owner-${suffix}@example.test`,
      ownerUserId,
      ownerName: 'Bootstrap owner',
      workspaceId,
      workspaceName: 'First workspace name',
    };
    const created = await bootstrapper.bootstrap(firstInput);
    assert.deepEqual(created, { created: true });

    const replayed = await bootstrapper.bootstrap(firstInput);
    assert.deepEqual(replayed, { created: true });

    await assert.rejects(
      bootstrapper.bootstrap({
        ...firstInput,
        ownerName: 'Replacement owner name',
      }),
      (error: unknown) =>
        error instanceof P1DomainError &&
        error.code === 'IDEMPOTENCY_CONFLICT'
    );

    const preserved = await bootstrapper.bootstrap({
      ...firstInput,
      idempotencyKey: `workspace-bootstrap:${workspaceId}:retry`,
      ownerName: 'Replacement owner name',
      workspaceName: 'Attempted replacement name',
    });
    assert.deepEqual(preserved, { created: false });

    const result = await pool.query<{
      name: string;
      role: string;
      email: string;
      email_verified: boolean;
      owner_name: string;
      user_id: string;
    }>(
      `SELECT
         workspace.name,
         membership.role,
         membership.user_id,
         owner.email,
         owner.email_verified,
         owner.name AS owner_name
         FROM workspaces workspace
         INNER JOIN workspace_memberships membership
           ON membership.workspace_id = workspace.id
         INNER JOIN "user" owner ON owner.id = membership.user_id
        WHERE workspace.id = $1`,
      [workspaceId]
    );
    assert.deepEqual(result.rows, [
      {
        email: `bootstrap-owner-${suffix}@example.test`,
        email_verified: true,
        name: 'First workspace name',
        owner_name: 'Bootstrap owner',
        role: 'owner',
        user_id: ownerUserId,
      },
    ]);

    const p1Owner = await pool.query<{ owner: string }>(
      'SELECT owner FROM p1_write_ownership WHERE workspace_id = $1',
      [workspaceId]
    );
    const contentPackageOwner = await pool.query<{ owner: string }>(
      'SELECT owner FROM content_package_write_ownership WHERE workspace_id = $1',
      [workspaceId]
    );
    assert.deepEqual(p1Owner.rows, [{ owner: 'p1' }]);
    assert.deepEqual(contentPackageOwner.rows, [{ owner: 'contentpackage' }]);
  }
);
