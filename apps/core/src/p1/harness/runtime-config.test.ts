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

test('a business pool below the finalize peak is raised to three, with the reason on the console', () => {
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (message: string) => {
    warnings.push(message);
  };
  try {
    for (const configured of ['1', '2']) {
      assert.equal(
        readHarnessRuntimeConfig({
          DATABASE_URL: 'postgres://localhost/meiye',
          HARNESS_DBOS_SYSTEM_DATABASE_URL:
            'postgres://localhost/meiye_dbos_sys',
          HARNESS_DB_POOL_MAX: configured,
        }).businessPoolMax,
        3,
      );
    }
    // Three is already enough, so it passes through untouched and unremarked.
    assert.equal(
      readHarnessRuntimeConfig({
        DATABASE_URL: 'postgres://localhost/meiye',
        HARNESS_DBOS_SYSTEM_DATABASE_URL: 'postgres://localhost/meiye_dbos_sys',
        HARNESS_DB_POOL_MAX: '3',
      }).businessPoolMax,
      3,
    );
  } finally {
    console.warn = warn;
  }
  assert.equal(warnings.length, 2);
  for (const warning of warnings) {
    assert.match(warning, /HARNESS_DB_POOL_MAX/u);
    assert.match(warning, /advisory lock.*pinned fact heads.*profile merge/u);
  }
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
