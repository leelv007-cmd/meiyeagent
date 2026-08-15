import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { P1ApplicationService } from './application-service.js';
import { P1DomainError } from './domain.js';
import { PostgresFoundationRepository } from './postgres-repository.js';
import type { PermissionAuthorizerPort } from '../capability-permission/port.js';

const connectionString = process.env.TEST_DATABASE_URL;

const allowAllAuthorizer: PermissionAuthorizerPort = {
  decide: () => ({ allow: true, required: null, reason: 'capability_granted' }),
  authorize: () => undefined,
};

test(
  'Postgres module command abandons a P1DomainError so the same key is not in_progress',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const workspaceId = `p1-ws-lane78-${suffix}`;
    const userId = `p1-owner-lane78-${suffix}`;
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
      `INSERT INTO "user" (id, name, email) VALUES ($1, 'Lane78 owner', $2)`,
      [userId, `${userId}@example.test`]
    );
    await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Lane78')`, [
      workspaceId,
    ]);
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [workspaceId, userId]
    );
    t.after(async () => {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
      await pool.end();
    });

    const context = {
      workspaceId,
      userId,
      correlationId: 'corr-lane78-module-command',
    };
    let attempts = 0;
    const service = new P1ApplicationService(repository, {
      authorizer: allowAllAuthorizer,
      operations: [
        {
          name: 'entitlements:provision_model_defaults',
          async execute() {
            attempts += 1;
            if (attempts === 1) {
              throw new P1DomainError(
                'INVALID_STATE',
                'Platform default models are not configured.'
              );
            }
            return { defaults: { copy: 'platform-copy-model' }, applied: true };
          },
        },
      ],
    });

    await assert.rejects(
      service.executeModule(
        context,
        'entitlements:provision_model_defaults',
        {},
        'workspace-provision:model-default:v1'
      ),
      (error: unknown) =>
        error instanceof P1DomainError &&
        error.code === 'INVALID_STATE' &&
        /not configured/u.test(error.message)
    );

    const leftover = await pool.query<{ status: string }>(
      `SELECT status FROM p1_module_commands
        WHERE workspace_id = $1 AND idempotency_key = $2`,
      [workspaceId, 'workspace-provision:model-default:v1']
    );
    assert.equal(leftover.rowCount, 0);

    assert.deepEqual(
      await service.executeModule(
        context,
        'entitlements:provision_model_defaults',
        {},
        'workspace-provision:model-default:v1'
      ),
      { defaults: { copy: 'platform-copy-model' }, applied: true }
    );
    assert.equal(attempts, 2);
  }
);
