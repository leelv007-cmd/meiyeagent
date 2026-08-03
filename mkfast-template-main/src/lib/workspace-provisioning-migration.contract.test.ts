import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('claim fencing has a forward migration for databases that already applied outbox v1', async () => {
  const migration = await readFile(
    new URL(
      '../../drizzle/0006_workspace_provision_claim_fencing.sql',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(
    migration,
    /ALTER TABLE "workspace_provisioning_outbox"[\s\S]*ADD COLUMN IF NOT EXISTS "claim_token" text;/u
  );
});

test('bootstrap identity has a backfill migration and a strict trigger contract', async () => {
  const migration = await readFile(
    new URL(
      '../../drizzle/0018_workspace_provisioning_identity.sql',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(
    migration,
    /ADD COLUMN IF NOT EXISTS "owner_email" text;[\s\S]*ADD COLUMN IF NOT EXISTS "owner_name" text;[\s\S]*ADD COLUMN IF NOT EXISTS "workspace_name" text;/u
  );
  assert.match(
    migration,
    /UPDATE "workspace_provisioning_outbox" AS outbox[\s\S]*FROM "user" AS verified_user[\s\S]*INNER JOIN "workspaces"/u
  );
  assert.match(
    migration,
    /ALTER COLUMN "owner_email" SET NOT NULL[\s\S]*ALTER COLUMN "owner_name" SET NOT NULL[\s\S]*ALTER COLUMN "workspace_name" SET NOT NULL/u
  );
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION "bootstrap_verified_user_workspace"[\s\S]*"owner_email"[\s\S]*"owner_name"[\s\S]*"workspace_name"/u
  );
});
