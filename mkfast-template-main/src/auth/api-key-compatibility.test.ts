import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  API_KEY_SCHEMA_COMPATIBILITY,
  apiKeyPlugin,
} from './api-key-compatibility';

test('API key create and list keep the existing user owner column', () => {
  assert.equal(
    API_KEY_SCHEMA_COMPATIBILITY.apikey.fields.referenceId,
    'userId'
  );
  assert.equal(
    apiKeyPlugin.schema.apikey.fields.configId.defaultValue,
    'default'
  );
  assert.equal(apiKeyPlugin.endpoints.createApiKey.path, '/api-key/create');
  assert.equal(apiKeyPlugin.endpoints.listApiKeys.path, '/api-key/list');
});

test('existing API keys migrate into the deterministic default configuration', async () => {
  const migration = await readFile(
    new URL(
      '../../drizzle/0009_api_key_plugin_compatibility.sql',
      import.meta.url
    ),
    'utf8'
  );

  assert.match(migration, /ADD COLUMN IF NOT EXISTS "config_id" text/u);
  assert.match(
    migration,
    /UPDATE "apikey"[\s\S]*SET "config_id" = 'default'[\s\S]*WHERE "config_id" IS NULL/u
  );
  assert.match(migration, /ALTER COLUMN "config_id" SET DEFAULT 'default'/u);
  assert.match(migration, /ALTER COLUMN "config_id" SET NOT NULL/u);
  assert.match(
    migration,
    /CREATE INDEX IF NOT EXISTS "apikey_configId_idx"[\s\S]*\("config_id"\)/u
  );
  assert.doesNotMatch(migration, /DROP COLUMN "user_id"/u);
  assert.doesNotMatch(migration, /RENAME COLUMN "user_id"/u);
});
