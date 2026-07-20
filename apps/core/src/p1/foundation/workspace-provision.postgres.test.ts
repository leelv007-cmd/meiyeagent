import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { P1ApplicationService } from './application-service.js';
import { ProductEntitlementFoundationModule } from './entitlement-module.js';
import { ProductEntitlementApplicationService } from './entitlement-service.js';
import { PostgresFoundationRepository } from './postgres-repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'trusted register_gift provisions a fresh verified workspace in Postgres',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const workspaceId = `provision-workspace-${suffix}`;
    const userId = `provision-owner-${suffix}`;
    const repository = new PostgresFoundationRepository(pool);
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
    await repository.migrate();
    await pool.query(
      `INSERT INTO "user" (id, name, email, email_verified)
       VALUES ($1, 'Provision owner', $2, true)`,
      [userId, `${userId}@example.test`],
    );
    await pool.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, 'Provision test')`,
      [workspaceId],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [workspaceId, userId],
    );
    t.after(async () => {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
      await pool.end();
    });

    const entitlements = new ProductEntitlementApplicationService(repository);
    const service = new P1ApplicationService(repository, {
      operations: [new ProductEntitlementFoundationModule(entitlements)],
      // Workspace bootstrap is independent of the product cutover owner. New
      // verified workspaces can still be routed to the legacy product service.
      writeOwnershipReader: async () => 'legacy',
    });
    const context = {
      actor: 'worker' as const,
      correlationId: `workspace-provision:trial:v1:${workspaceId}`,
      userId,
      workspaceId,
    };
    const command = { action: 'register_gift', payload: {} };

    const first = await service.executeModule(
      context,
      'entitlements',
      command,
      'workspace-provision:trial:v1',
    );
    const replay = await service.executeModule(
      context,
      'entitlements',
      command,
      'workspace-provision:trial:v1',
    );

    assert.deepEqual(replay, first);
    assert.equal(
      (first as { plan: { tier: string } }).plan.tier,
      'trial',
    );
  },
);
