import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CREDENTIAL_FREE_APP_ENV,
  CREDENTIAL_FREE_MODEL_EXECUTION_MODE,
  DEVELOPMENT_DIRECT_WITHOUT_ACTIVATION_ERROR,
  PLATFORM_DEFAULT_MODEL_SEED,
  RECORDED_HARNESS_STILL_REQUIRES_LIVE_MODEL_ERROR,
  assertDevelopmentRuntimeCanBoot,
  assertPairedRuntimeProfile,
  createDevelopmentRuntimeProfile,
  runtimeProfileFingerprint,
} from './runtime-profile.mjs';

const sampleDatabaseUrl =
  'postgres://meiye:meiye@127.0.0.1:54329/meiye_example';

test('development runtime defaults to fixture/e2e when keys are unset', () => {
  const profile = createDevelopmentRuntimeProfile({
    CORE_PORT: '4100',
    DATABASE_URL: sampleDatabaseUrl,
    PLAYWRIGHT_CORE_PORT: '4102',
    PORT: '3102',
  });

  assert.deepEqual(
    {
      appEnv: profile.APP_ENV,
      byokMode: profile.BYOK_EXECUTION_MODE,
      corePort: profile.CORE_PORT,
      feishuMode: profile.FEISHU_MCP_MODE,
      integrationMode: profile.INTEGRATION_SECRET_STORE_MODE,
      modelMode: profile.MODEL_EXECUTION_MODE,
      webPort: profile.PORT,
    },
    {
      appEnv: 'e2e',
      byokMode: 'recorded',
      corePort: '4102',
      feishuMode: 'recorded',
      integrationMode: 'recorded',
      modelMode: 'fixture',
      webPort: '3102',
    },
  );
  assert.equal(
    profile.HARNESS_DBOS_SYSTEM_DATABASE_URL,
    'postgres://meiye:meiye@127.0.0.1:54329/meiye_example_dbos',
  );
  assert.equal(profile.CORE_SERVICE_URL, 'http://127.0.0.1:4102');
  assert.equal(profile.CORE_LOCAL_SUPERVISOR, '1');
  assert.equal(profile.MAIN_APP_ORIGIN, 'http://localhost:3102');
  assert.equal(profile.LANGFUSE_PROMPT_POLICY, 'pilot');
  assert.equal(profile.RUN_ISSUE_247_E2E_PROVISIONAL_BOUNDS_SEED, 'true');
  assert.equal(
    profile.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE,
    sampleDatabaseUrl,
  );
  assert.equal(
    profile.E2E_PLATFORM_DEFAULT_MODEL_COPY,
    PLATFORM_DEFAULT_MODEL_SEED.copy,
  );
  assert.equal(profile.CANVAS_SERVICE_URL, undefined);
  assert.equal(profile.CANVAS_ORIGIN, undefined);
});

test('development runtime respects explicit direct+development', () => {
  const profile = createDevelopmentRuntimeProfile({
    APP_ENV: 'development',
    BYOK_EXECUTION_MODE: 'live',
    DATABASE_URL: sampleDatabaseUrl,
    FEISHU_MCP_MODE: 'live',
    INTEGRATION_SECRET_STORE_MODE: 'live',
    MODEL_EXECUTION_MODE: 'direct',
  });

  assert.equal(profile.APP_ENV, 'development');
  assert.equal(profile.MODEL_EXECUTION_MODE, 'direct');
  assert.equal(profile.BYOK_EXECUTION_MODE, 'live');
  assert.equal(profile.FEISHU_MCP_MODE, 'live');
  assert.equal(profile.INTEGRATION_SECRET_STORE_MODE, 'live');
});

test('development runtime keeps e2e fixture when e2e callers set both keys', () => {
  const profile = createDevelopmentRuntimeProfile({
    APP_ENV: 'e2e',
    DATABASE_URL: sampleDatabaseUrl,
    MODEL_EXECUTION_MODE: 'fixture',
  });

  assert.equal(profile.APP_ENV, 'e2e');
  assert.equal(profile.MODEL_EXECUTION_MODE, 'fixture');
});

test('development runtime fills the unset half of the fixture/e2e pair legally', () => {
  const fixtureOnly = createDevelopmentRuntimeProfile({
    DATABASE_URL: sampleDatabaseUrl,
    MODEL_EXECUTION_MODE: 'fixture',
  });
  assert.equal(fixtureOnly.APP_ENV, 'e2e');
  assert.equal(fixtureOnly.MODEL_EXECUTION_MODE, 'fixture');

  const e2eOnly = createDevelopmentRuntimeProfile({
    APP_ENV: 'e2e',
    DATABASE_URL: sampleDatabaseUrl,
  });
  assert.equal(e2eOnly.APP_ENV, 'e2e');
  assert.equal(e2eOnly.MODEL_EXECUTION_MODE, 'fixture');

  const developmentOnly = createDevelopmentRuntimeProfile({
    APP_ENV: 'development',
    DATABASE_URL: sampleDatabaseUrl,
  });
  assert.equal(developmentOnly.APP_ENV, 'development');
  assert.equal(developmentOnly.MODEL_EXECUTION_MODE, 'recorded');
});

test('development runtime preserves an explicit separate DBOS database', () => {
  const profile = createDevelopmentRuntimeProfile({
    DATABASE_URL: 'postgres://meiye:meiye@127.0.0.1:54329/meiye_business',
    HARNESS_DBOS_SYSTEM_DATABASE_URL:
      'postgres://meiye:meiye@127.0.0.1:54329/meiye_system',
  });

  assert.equal(
    profile.HARNESS_DBOS_SYSTEM_DATABASE_URL,
    'postgres://meiye:meiye@127.0.0.1:54329/meiye_system',
  );
});

test('development+direct without activation is refused before the stack starts', () => {
  const profile = createDevelopmentRuntimeProfile({
    APP_ENV: 'development',
    DATABASE_URL: sampleDatabaseUrl,
    MODEL_EXECUTION_MODE: 'direct',
  });
  assert.throws(
    () => assertDevelopmentRuntimeCanBoot(profile),
    (error) => {
      assert.equal(error.message, DEVELOPMENT_DIRECT_WITHOUT_ACTIVATION_ERROR);
      assert.match(error.message, /MODEL_EXECUTION_MODE=recorded/u);
      assert.match(error.message, /activation/u);
      return true;
    },
  );
});

test('development+direct with an explicit live activation marker is allowed', () => {
  assert.doesNotThrow(() =>
    assertDevelopmentRuntimeCanBoot(
      createDevelopmentRuntimeProfile({
        APP_ENV: 'development',
        DATABASE_URL: sampleDatabaseUrl,
        HARNESS_LIVE_ACTIVATION: 'live_verified',
        MODEL_EXECUTION_MODE: 'direct',
      }),
    ),
  );
});

test('recorded still fails closed at pre-start because Harness requires live direct', () => {
  assert.throws(
    () =>
      assertDevelopmentRuntimeCanBoot(
        createDevelopmentRuntimeProfile({
          APP_ENV: 'development',
          DATABASE_URL: sampleDatabaseUrl,
          MODEL_EXECUTION_MODE: 'recorded',
        }),
      ),
    (error) => {
      assert.equal(error.message, RECORDED_HARNESS_STILL_REQUIRES_LIVE_MODEL_ERROR);
      assert.match(error.message, /e2e/u);
      return true;
    },
  );
});

test('credential-free e2e+fixture is the documented bootable pair', () => {
  const profile = createDevelopmentRuntimeProfile({
    APP_ENV: CREDENTIAL_FREE_APP_ENV,
    DATABASE_URL: sampleDatabaseUrl,
    MODEL_EXECUTION_MODE: CREDENTIAL_FREE_MODEL_EXECUTION_MODE,
  });
  assert.doesNotThrow(() => assertDevelopmentRuntimeCanBoot(profile));
  assert.equal(profile.APP_ENV, 'e2e');
  assert.equal(profile.MODEL_EXECUTION_MODE, 'fixture');
});

test('API/worker profile fingerprints include DBOS and queue without leaking URIs', () => {
  const expected = runtimeProfileFingerprint({
    APP_ENV: 'e2e',
    DATABASE_URL: sampleDatabaseUrl,
    HARNESS_DBOS_SYSTEM_DATABASE_URL:
      'postgres://meiye:secret@127.0.0.1:54329/meiye_example_dbos',
    JOB_QUEUE_PREFIX: 'meiye-lane-a',
    MODEL_EXECUTION_MODE: 'fixture',
  });
  assert.deepEqual(
    assertPairedRuntimeProfile(
      {
        APP_ENV: 'e2e',
        DATABASE_URL: sampleDatabaseUrl,
        HARNESS_DBOS_SYSTEM_DATABASE_URL:
          'postgres://meiye:secret@127.0.0.1:54329/meiye_example_dbos',
        JOB_QUEUE_PREFIX: 'meiye-lane-a',
        MODEL_EXECUTION_MODE: 'fixture',
      },
      expected,
    ),
    expected,
  );
  assert.throws(
    () =>
      assertPairedRuntimeProfile(
        {
          APP_ENV: 'development',
          DATABASE_URL: sampleDatabaseUrl,
          HARNESS_DBOS_SYSTEM_DATABASE_URL:
            'postgres://operator:never-print@127.0.0.1:54329/other_dbos',
          JOB_QUEUE_PREFIX: 'meiye-lane-b',
          MODEL_EXECUTION_MODE: 'direct',
        },
        expected,
      ),
    (error) => {
      assert.match(error.message, /API\/worker runtime profile mismatch/u);
      assert.match(error.message, /HARNESS_DBOS_SYSTEM_DATABASE_FINGERPRINT/u);
      assert.match(error.message, /JOB_QUEUE_PREFIX/u);
      assert.doesNotMatch(error.message, /never-print|secret/u);
      return true;
    },
  );
});

test('dev profile floors Node heap unless NODE_OPTIONS is already set', () => {
  const profile = createDevelopmentRuntimeProfile({
    DATABASE_URL: 'postgres://meiye:meiye@127.0.0.1:54329/meiye',
  });
  assert.equal(profile.NODE_OPTIONS, '--max-old-space-size=8192');

  const custom = createDevelopmentRuntimeProfile({
    DATABASE_URL: 'postgres://meiye:meiye@127.0.0.1:54329/meiye',
    NODE_OPTIONS: '--max-old-space-size=4096',
  });
  assert.equal(custom.NODE_OPTIONS, '--max-old-space-size=4096');
});

test('dev profile floors workerd heap unless an explicit value is set', () => {
  const profile = createDevelopmentRuntimeProfile({
    DATABASE_URL: sampleDatabaseUrl,
  });
  assert.equal(
    profile.MINIFLARE_WORKERD_V8_FLAGS,
    '--max-old-space-size=8192',
  );

  const custom = createDevelopmentRuntimeProfile({
    DATABASE_URL: sampleDatabaseUrl,
    MINIFLARE_WORKERD_V8_FLAGS: '--max-old-space-size=4096 --trace-gc',
  });
  assert.equal(
    custom.MINIFLARE_WORKERD_V8_FLAGS,
    '--max-old-space-size=4096 --trace-gc',
  );
});
