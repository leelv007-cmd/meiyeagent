import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySchemaBoot,
  PRODUCTION_SCHEMA_RELATIONS,
  resolveSchemaBootMode,
  verifyPostgresSchema,
  type SchemaQueryable,
} from './schema-boot.js';
import type { PostgresSchemaMigrator } from '../postgres-schema-migration.js';

function throwingMigrator(): PostgresSchemaMigrator {
  return {
    async migrate() {
      throw new Error('DDL must not run');
    },
  };
}

function fakePool(reg: string | null): SchemaQueryable {
  return {
    async query() {
      return { rows: [{ reg }] };
    },
  };
}

test('production API and worker replicas verify schema; migrate job migrates', () => {
  const production = { APP_ENV: 'production' };
  const staging = { APP_ENV: 'staging' };
  assert.equal(resolveSchemaBootMode(production, 'api'), 'verify');
  assert.equal(resolveSchemaBootMode(production, 'worker'), 'verify');
  assert.equal(resolveSchemaBootMode(staging, 'api'), 'verify');
  assert.equal(resolveSchemaBootMode({ APP_ENV: 'production', CORE_LOCAL_SUPERVISOR: '1' }, 'api'), 'verify');
  assert.equal(resolveSchemaBootMode(production, 'migrate'), 'migrate');
});

test('only the local supervisor may auto-migrate outside protected envs', () => {
  assert.equal(
    resolveSchemaBootMode({ APP_ENV: 'e2e', CORE_LOCAL_SUPERVISOR: '1' }, 'api'),
    'migrate',
  );
  assert.equal(
    resolveSchemaBootMode({ APP_ENV: 'e2e', CORE_LOCAL_SUPERVISOR: '1' }, 'worker'),
    'migrate',
  );
  assert.equal(resolveSchemaBootMode({ APP_ENV: 'e2e' }, 'api'), 'verify');
  assert.equal(resolveSchemaBootMode({ APP_ENV: 'development' }, 'worker'), 'verify');
});

test('production replica verify never calls migrator.migrate', async () => {
  const migrator = throwingMigrator();
  await applySchemaBoot({
    mode: 'verify',
    pool: fakePool('public.p1_owned_assets'),
    migrators: [migrator],
    relations: ['public.p1_owned_assets'],
  });
});

test('schema mismatch fails without running DDL', async () => {
  const migrator = throwingMigrator();
  await assert.rejects(
    () =>
      applySchemaBoot({
        mode: 'verify',
        pool: fakePool(null),
        migrators: [migrator],
        relations: ['public.p1_owned_assets'],
      }),
    { message: 'schema mismatch: missing public.p1_owned_assets' },
  );
});

test('verifyPostgresSchema reports every missing relation', async () => {
  const pool: SchemaQueryable = {
    async query(_text, values) {
      const relation = String(values?.[0] ?? '');
      return { rows: [{ reg: relation.includes('owned') ? relation : null }] };
    },
  };
  await assert.rejects(
    () =>
      verifyPostgresSchema(pool, [
        'public.p1_owned_assets',
        'public.p1_worker_metric_samples',
      ]),
    { message: 'schema mismatch: missing public.p1_worker_metric_samples' },
  );
});

test('migrate mode is the only path that invokes migrators', async () => {
  const calls: string[] = [];
  const pool = {
    async connect() {
      return {
        async query(sql: string) {
          calls.push(sql);
        },
        release() {
          calls.push('release');
        },
      };
    },
  };
  const migrator: PostgresSchemaMigrator = {
    async migrate() {
      calls.push('ddl');
    },
  };
  await applySchemaBoot({
    mode: 'migrate',
    pool: pool as never,
    migrators: [migrator],
  });
  assert.ok(calls.includes('ddl'));
  assert.equal(
    PRODUCTION_SCHEMA_RELATIONS.includes('public.p1_owned_assets'),
    true,
  );
});
