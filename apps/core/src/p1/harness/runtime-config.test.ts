import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertPendingActionsShareDatabase,
  initializeJobWorkerHarnessRuntime,
  readHarnessRuntimeConfig,
  readJobWorkerHarnessRuntimeConfig,
} from './runtime-config.js';

test('job worker warns when DBOS terminal signaling is not configured without exposing values', () => {
  for (const systemDatabaseUrl of [undefined, '']) {
    const warnings: string[] = [];
    const config = readJobWorkerHarnessRuntimeConfig(
      {
        DATABASE_URL:
          'postgres://business-user:business-secret@localhost/meiye',
        HARNESS_DBOS_SYSTEM_DATABASE_URL: systemDatabaseUrl,
      },
      (message) => {
        warnings.push(message);
      },
    );

    assert.equal(config, undefined);
    assert.deepEqual(warnings, [
      '[harness-media] HARNESS_DBOS_SYSTEM_DATABASE_URL is not configured; DBOS terminal signaling for model.media-generation jobs is disabled.',
    ]);
    assert.doesNotMatch(warnings[0]!, /business-user|business-secret|postgres/u);
  }
});

test('job worker keeps configured DBOS storage on the strict runtime parser', () => {
  const warnings: string[] = [];
  assert.deepEqual(
    readJobWorkerHarnessRuntimeConfig(
      {
        DATABASE_URL: 'postgres://localhost/meiye',
        HARNESS_DBOS_SYSTEM_DATABASE_URL:
          'postgres://localhost/meiye_dbos_sys',
      },
      (message) => {
        warnings.push(message);
      },
    ),
    {
      businessDatabaseUrl: 'postgres://localhost/meiye',
      businessPoolMax: 8,
      dbos: {
        name: 'beauty-marketing-harness',
        runAdminServer: false,
        systemDatabaseUrl: 'postgres://localhost/meiye_dbos_sys',
        systemDatabasePoolSize: 4,
      },
    },
  );
  assert.throws(
    () =>
      readJobWorkerHarnessRuntimeConfig(
        {
          DATABASE_URL: 'postgres://localhost/meiye',
          HARNESS_DBOS_SYSTEM_DATABASE_URL: '   ',
        },
        (message) => {
          warnings.push(message);
        },
      ),
    /HARNESS_DBOS_SYSTEM_DATABASE_URL is required/u,
  );
  assert.throws(
    () =>
      readJobWorkerHarnessRuntimeConfig(
        {
          DATABASE_URL: 'postgres://localhost/meiye',
          HARNESS_DBOS_SYSTEM_DATABASE_URL: 'postgres://localhost/meiye',
        },
        (message) => {
          warnings.push(message);
        },
      ),
    /separate database/u,
  );
  assert.deepEqual(warnings, []);
});

test('job worker rejects the same DBOS database across protocol and credential aliases', () => {
  const warnings: string[] = [];

  assert.throws(
    () =>
      readJobWorkerHarnessRuntimeConfig(
        {
          DATABASE_URL:
            'postgres://business-user:business-secret@db.internal:5432/meiye?application_name=business',
          HARNESS_DBOS_SYSTEM_DATABASE_URL:
            'postgresql://dbos-user:dbos-secret@DB.INTERNAL/meiye?application_name=dbos',
        },
        (message) => {
          warnings.push(message);
        },
      ),
    /separate database/u,
  );
  assert.deepEqual(warnings, []);
});

test('job worker rejects PostgreSQL database-name encoding and default-user aliases', () => {
  assert.throws(
    () =>
      readJobWorkerHarnessRuntimeConfig({
        DATABASE_URL: 'postgres://business@db.internal/mei%79e',
        HARNESS_DBOS_SYSTEM_DATABASE_URL:
          'postgresql://dbos@DB.INTERNAL:5432/meiye',
      }),
    /separate database/u,
  );
  assert.throws(
    () =>
      readJobWorkerHarnessRuntimeConfig({
        DATABASE_URL: 'postgres://meiye@db.internal',
        HARNESS_DBOS_SYSTEM_DATABASE_URL:
          'postgres://dbos@db.internal:5432/meiye',
      }),
    /separate database/u,
  );
});

test('job worker resolves a username-less no-path URL to the client default database', () => {
  assert.throws(
    () =>
      readJobWorkerHarnessRuntimeConfig({
        DATABASE_URL: 'postgres://localhost',
        HARNESS_DBOS_SYSTEM_DATABASE_URL: 'postgres://localhost/bin',
        USER: 'bin',
      }),
    /separate database/u,
  );
  assert.throws(
    () =>
      readJobWorkerHarnessRuntimeConfig({
        DATABASE_URL: 'postgres://localhost',
        HARNESS_DBOS_SYSTEM_DATABASE_URL: 'postgres://localhost/dbos',
        PGUSER: 'dbos',
        USER: 'bin',
      }),
    /separate database/u,
  );
});

test('job worker rejects a malformed configured DBOS database URL without warning', () => {
  const warnings: string[] = [];

  assert.throws(
    () =>
      readJobWorkerHarnessRuntimeConfig(
        {
          DATABASE_URL: 'postgres://localhost/meiye',
          HARNESS_DBOS_SYSTEM_DATABASE_URL: 'not-a-database-url',
        },
        (message) => {
          warnings.push(message);
        },
      ),
    TypeError,
  );
  assert.deepEqual(warnings, []);
});

test('job worker startup behavior warns when DBOS signaling is disabled and launches it when configured', async () => {
  const warnings: string[] = [];
  const configured: unknown[] = [];
  let launches = 0;
  const dbos = {
    setConfig(config: unknown) {
      configured.push(config);
    },
    async launch() {
      launches += 1;
    },
  };

  assert.equal(
    await initializeJobWorkerHarnessRuntime(
      { DATABASE_URL: 'postgres://localhost/meiye' },
      dbos,
      (message) => {
        warnings.push(message);
      },
    ),
    undefined,
  );
  assert.equal(launches, 0);
  assert.deepEqual(configured, []);
  assert.equal(warnings.length, 1);

  const runtimeConfig = await initializeJobWorkerHarnessRuntime(
    {
      DATABASE_URL: 'postgres://localhost/meiye',
      HARNESS_DBOS_SYSTEM_DATABASE_URL:
        'postgres://localhost/meiye_dbos_sys',
    },
    dbos,
  );

  assert.equal(launches, 1);
  assert.deepEqual(configured, [runtimeConfig?.dbos]);
});

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
  assert.throws(
    () =>
      readHarnessRuntimeConfig({
        DATABASE_URL:
          'postgres://business:secret@localhost/meiye?application_name=business',
        HARNESS_DBOS_SYSTEM_DATABASE_URL:
          'postgresql://dbos:other@LOCALHOST:5432/meiye#system',
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
