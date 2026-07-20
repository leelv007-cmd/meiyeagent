import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertPendingActionsShareDatabase,
  readHarnessRuntimeConfig,
} from './runtime-config.js';

test('DBOS system database must be explicitly separate from business Postgres', () => {
  assert.throws(
    () =>
      readHarnessRuntimeConfig({
        DATABASE_URL: 'postgres://localhost/meiye',
      }),
    /HARNESS_DBOS_SYSTEM_DATABASE_URL/u,
  );
  assert.throws(
    () =>
      readHarnessRuntimeConfig({
        DATABASE_URL: 'postgres://localhost/meiye',
        HARNESS_DBOS_SYSTEM_DATABASE_URL: 'postgres://localhost/meiye',
      }),
    /separate database/u,
  );
});

test('runtime config preserves explicit pool and sticky application version', () => {
  assert.deepEqual(
    readHarnessRuntimeConfig({
      DATABASE_URL: 'postgres://localhost/meiye',
      HARNESS_DBOS_SYSTEM_DATABASE_URL:
        'postgres://localhost/meiye_dbos_sys',
      HARNESS_DBOS_SYSTEM_POOL_MAX: '4',
      HARNESS_DB_POOL_MAX: '9',
      DBOS__APPVERSION: 'release-2026-07-18',
    }),
    {
      businessDatabaseUrl: 'postgres://localhost/meiye',
      businessPoolMax: 9,
      dbos: {
        name: 'beauty-marketing-harness',
        systemDatabaseUrl: 'postgres://localhost/meiye_dbos_sys',
        systemDatabasePoolSize: 4,
        applicationVersion: 'release-2026-07-18',
      },
    },
  );
});

test('pending-action question and approval stores must share one Postgres database', () => {
  assert.doesNotThrow(() =>
    assertPendingActionsShareDatabase({
      approvalRequestsDatabaseUrl:
        'postgres://operations:secret@db.internal:5432/meiye?application_name=operations',
      pendingQuestionsDatabaseUrl:
        'postgres://harness:other@db.internal:5432/meiye?application_name=harness',
    }),
  );
  assert.throws(
    () =>
      assertPendingActionsShareDatabase({
        approvalRequestsDatabaseUrl: 'postgres://db.internal:5432/meiye',
        pendingQuestionsDatabaseUrl:
          'postgres://db.internal:5432/meiye_harness',
      }),
    /Pending actions.*same Postgres database/u,
  );
});
