import assert from 'node:assert/strict';
import test from 'node:test';

import { Pool } from 'pg';

import { PostgresWorkspaceOwnerMembershipReader } from './eligibility.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'PostgreSQL treats an existing owner membership as the workspace active fact',
  { skip: !connectionString },
  async (t) => {
    const pool = new Pool({ connectionString });
    const client = await pool.connect();
    t.after(async () => {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    });
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE workspaces (
        id text PRIMARY KEY,
        name text NOT NULL
      ) ON COMMIT DROP;
      CREATE TEMP TABLE workspace_memberships (
        workspace_id text NOT NULL,
        user_id text NOT NULL,
        role text NOT NULL,
        PRIMARY KEY (workspace_id, user_id)
      ) ON COMMIT DROP;
    `);
    const memberships = new PostgresWorkspaceOwnerMembershipReader(client);

    assert.equal(
      await memberships.hasOwnerMembership('workspace-eligibility'),
      false,
    );
    await client.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, 'Eligibility workspace')`,
      ['workspace-eligibility'],
    );
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, 'reviewer-1', 'reviewer')`,
      ['workspace-eligibility'],
    );
    assert.equal(
      await memberships.hasOwnerMembership('workspace-eligibility'),
      false,
    );
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, 'owner-1', 'owner')`,
      ['workspace-eligibility'],
    );
    assert.equal(
      await memberships.hasOwnerMembership('workspace-eligibility'),
      true,
    );
  },
);
