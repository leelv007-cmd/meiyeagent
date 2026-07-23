import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { PostgresProStudioMigration } from './postgres-pro-studio-migration.js';

test('creates launch/session, project/revision and canvas-owned-asset facts', async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      return { rows: [] };
    },
  } as unknown as PoolClient;

  await new PostgresProStudioMigration().migrate(client);

  const sql = queries.join('\n');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS pro_studio_launch_codes/);
  assert.match(sql, /code_hash text NOT NULL UNIQUE/);
  assert.match(sql, /browser_nonce_hash text NOT NULL/);
  assert.doesNotMatch(sql, /\bcode text\b|\btoken text\b/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS pro_studio_canvas_sessions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS advanced_canvas_projects/);
  assert.match(sql, /draft_version bigint NOT NULL/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS advanced_canvas_revisions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS pro_studio_owned_assets/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS tombstoned_at/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS export_policy jsonb/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS pro_studio_asset_deletion_outbox/);
  assert.match(sql, /workspace_id text NOT NULL/);
});
