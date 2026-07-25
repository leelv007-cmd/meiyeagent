import assert from 'node:assert/strict';
import test from 'node:test';
import type { PoolClient } from 'pg';
import { PostgresEntitlementPoolsMigration } from './postgres-repository.js';

test('entitlement pool migration creates durable heads and keeps ledger chains separate', async () => {
  const queries: string[] = [];
  const client = {
    async query(sql: string) {
      queries.push(sql);
      return { rows: [] };
    },
  } as unknown as PoolClient;

  await new PostgresEntitlementPoolsMigration().migrate(client);

  const sql = queries.join('\n');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS p1_entitlement_policy_revisions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS p1_entitlement_policy_heads/);
  assert.match(sql, /FOREIGN KEY \(tier, revision, revision_id\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS p1_account_allocations/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS p1_account_allocation_rollbacks/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS p1_supply_pool_revisions/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS p1_supply_pool_heads/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS p1_capacity_leases/);
  assert.match(sql, /expires_at timestamptz NOT NULL/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS p1_supply_request_freezes/);
  assert.match(sql, /product_usage_task_id text/);
  assert.match(sql, /provider_cost_attempt_id text/);
  assert.match(
    sql,
    /DROP INDEX IF EXISTS p1_supply_request_freezes_product_usage_idx/,
  );
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS p1_supply_request_freezes_product_usage_lookup_idx/,
  );
  assert.doesNotMatch(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS p1_supply_request_freezes_product_usage_idx/,
  );
  assert.doesNotMatch(
    sql,
    /REFERENCES\s+(?:p1_)?(?:product_usage|provider_cost|grant_lot)/i,
  );
  assert.match(sql, /Supply request freezes are immutable/);
});
