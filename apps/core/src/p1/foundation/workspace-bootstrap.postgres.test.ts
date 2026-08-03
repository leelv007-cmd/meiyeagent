import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
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
    t.after(async () => {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.end();
    });

    const created = await bootstrapper.bootstrap({
      ownerEmail: `bootstrap-owner-${suffix}@example.test`,
      ownerUserId,
      ownerName: 'Bootstrap owner',
      workspaceId,
      workspaceName: 'First workspace name',
    });
    assert.deepEqual(created, { created: true });

    const replayed = await bootstrapper.bootstrap({
      ownerEmail: `bootstrap-owner-${suffix}@example.test`,
      ownerUserId,
      ownerName: 'Replacement owner name',
      workspaceId,
      workspaceName: 'Attempted replacement name',
    });
    assert.deepEqual(replayed, { created: false });

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
  }
);
