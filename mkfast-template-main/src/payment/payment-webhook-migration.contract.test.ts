import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('verified payment events and settlement outbox have a durable fenced migration', async () => {
  const migration = await readFile(
    new URL(
      '../../drizzle/0007_payment_webhook_settlement_outbox.sql',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "verified_at" timestamp with time zone/u
  );
  assert.match(migration, /CREATE TABLE "payment_webhook_settlement_outbox"/u);
  assert.match(migration, /"claim_token" text/u);
  assert.match(migration, /"lease_expires_at" timestamp with time zone/u);
  assert.match(migration, /"attempt_count" integer DEFAULT 0 NOT NULL/u);
  assert.match(
    migration,
    /"available_at" timestamp with time zone DEFAULT now\(\) NOT NULL/u
  );
  assert.match(migration, /"last_error_code" text/u);
  assert.match(migration, /"provider_applied_at" timestamp with time zone/u);
  assert.match(migration, /"normalized_event" jsonb/u);
  assert.match(
    migration,
    /FOREIGN KEY \("provider","event_id"\)[\s\S]*REFERENCES "payment_webhook_events"\("provider","event_id"\)/u
  );
  assert.match(migration, /ON DELETE RESTRICT/u);
  assert.doesNotMatch(migration, /ON DELETE CASCADE/u);
});

test('rollout safety preserves queued outbox rows and requires payment business-key cleanup', async () => {
  const migration = await readFile(
    new URL(
      '../../drizzle/0010_payment_webhook_rollout_safety.sql',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(
    migration,
    /DROP CONSTRAINT IF EXISTS "payment_webhook_settlement_outbox_event_fk"/u
  );
  assert.match(
    migration,
    /FOREIGN KEY \("provider", "event_id"\)[\s\S]*ON DELETE RESTRICT/u
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "payment_session_id_unique"[\s\S]*\("session_id"\)/u
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "payment_subscription_id_unique"[\s\S]*\("subscription_id"\)/u
  );
  assert.doesNotMatch(migration, /DELETE FROM "payment"/u);
  assert.doesNotMatch(migration, /ON CONFLICT[\s\S]*DO UPDATE/u);
});
