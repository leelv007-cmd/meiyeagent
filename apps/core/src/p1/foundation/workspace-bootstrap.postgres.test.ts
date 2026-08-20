import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresContentPackageWriteOwnership } from '../operations/content-package-write-ownership.js';
import { P1DomainError } from './domain.js';
import { PostgresFoundationRepository } from './postgres-repository.js';
import { PostgresWorkspaceBootstrapper } from './workspace-bootstrap.js';

const connectionString = process.env.TEST_DATABASE_URL;

async function ensureIdentityAndOwnershipSchema(pool: Pool) {
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
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id text NOT NULL,
      role text NOT NULL DEFAULT 'owner',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, user_id)
    );
  `);
  await new PostgresFoundationRepository(pool).migrate();
  await new PostgresContentPackageWriteOwnership(pool).migrate();
}

async function readOwnershipRows(pool: Pool, workspaceId: string) {
  const p1Owner = await pool.query<{ owner: string }>(
    'SELECT owner FROM p1_write_ownership WHERE workspace_id = $1',
    [workspaceId]
  );
  const contentPackageOwner = await pool.query<{ owner: string }>(
    'SELECT owner FROM content_package_write_ownership WHERE workspace_id = $1',
    [workspaceId]
  );
  return { p1Owner, contentPackageOwner };
}

test(
  'Core bootstrap creates only the requested owner membership and preserves it on retry',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const workspaceId = `bootstrap-workspace-${suffix}`;
    const ownerUserId = `bootstrap-owner-${suffix}`;
    const bootstrapper = new PostgresWorkspaceBootstrapper(pool);
    await ensureIdentityAndOwnershipSchema(pool);
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
      await pool.query('DELETE FROM "user" WHERE id = $1', [ownerUserId]);
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

    const createdOwnership = await readOwnershipRows(pool, workspaceId);
    assert.deepEqual(createdOwnership.p1Owner.rows, [{ owner: 'p1' }]);
    assert.deepEqual(createdOwnership.contentPackageOwner.rows, [
      { owner: 'contentpackage' },
    ]);
  }
);

test(
  'Core bootstrap seeds write ownership when Web already created the workspace',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const workspaceId = `bootstrap-web-precreated-${suffix}`;
    const ownerUserId = `bootstrap-web-owner-${suffix}`;
    const ownerEmail = `bootstrap-web-owner-${suffix}@example.test`;
    const bootstrapper = new PostgresWorkspaceBootstrapper(pool);
    await ensureIdentityAndOwnershipSchema(pool);
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
      await pool.query('DELETE FROM "user" WHERE id = $1', [ownerUserId]);
      await pool.end();
    });

    await pool.query(
      `INSERT INTO "user" (id, name, email, email_verified)
       VALUES ($1, $2, $3, true)`,
      [ownerUserId, 'Web owner', ownerEmail]
    );
    await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, $2)`, [
      workspaceId,
      'Web-created workspace',
    ]);
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [workspaceId, ownerUserId]
    );

    const missingBefore = await readOwnershipRows(pool, workspaceId);
    assert.deepEqual(missingBefore.p1Owner.rows, []);
    assert.deepEqual(missingBefore.contentPackageOwner.rows, []);

    const firstInput = {
      idempotencyKey: `workspace-bootstrap:${workspaceId}`,
      ownerEmail,
      ownerUserId,
      ownerName: 'Web owner',
      workspaceId,
      workspaceName: 'Web-created workspace',
    };
    const created = await bootstrapper.bootstrap(firstInput);
    assert.deepEqual(created, { created: false });

    const seeded = await readOwnershipRows(pool, workspaceId);
    assert.deepEqual(seeded.p1Owner.rows, [{ owner: 'p1' }]);
    assert.deepEqual(seeded.contentPackageOwner.rows, [
      { owner: 'contentpackage' },
    ]);

    const replayed = await bootstrapper.bootstrap(firstInput);
    assert.deepEqual(replayed, { created: false });

    const replayedOwnership = await readOwnershipRows(pool, workspaceId);
    assert.deepEqual(replayedOwnership.p1Owner.rows, [{ owner: 'p1' }]);
    assert.deepEqual(replayedOwnership.contentPackageOwner.rows, [
      { owner: 'contentpackage' },
    ]);
  }
);
