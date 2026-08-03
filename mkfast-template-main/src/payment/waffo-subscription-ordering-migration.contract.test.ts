import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Waffo subscription ordering migration carries the fence, change and receipt contracts', async () => {
  const migration = await readFile(
    new URL(
      '../../drizzle/0020_waffo_subscription_ordering.sql',
      import.meta.url
    ),
    'utf8'
  );

  // Monotonic event fence columns on payment.
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "waffo_provider_occurred_at" timestamp with time zone/u
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "waffo_event_id" text/u);
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "waffo_event_rank" integer/u
  );

  // Upgrade replacement pointer on bindings.
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "replaces_subscription_id" text/u
  );

  // One in-flight Waffo checkout per owner and workspace, with the stale
  // demotion sweep ordered before the unique index so dirty databases can
  // apply it.
  const sweep = migration.indexOf("SET status = 'failed'");
  const inflight = migration.indexOf(
    'plan_checkout_bindings_waffo_inflight_uidx'
  );
  assert.ok(sweep >= 0 && inflight > sweep);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS "plan_checkout_bindings_waffo_inflight_uidx"\s*ON plan_checkout_bindings \(owner_user_id, workspace_id\)\s*WHERE provider = 'waffo' AND status IN \('pending', 'checkout_created'\)/u
  );

  // Parked next-cycle change table.
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS "waffo_subscription_changes"/u
  );
  assert.match(
    migration,
    /CHECK \("status" IN \('pending', 'applied', 'canceled'\)\)/u
  );

  // Durable cancellation receipt lease columns and widened status contract.
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0/u
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "available_at" timestamp with time zone NOT NULL DEFAULT now\(\)/u
  );
  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp with time zone/u
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "claim_token" text/u);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS "last_error_code" text/u);
  assert.match(
    migration,
    /CHECK \("status" IN \('pending', 'processing', 'completed'\)\)/u
  );
});
