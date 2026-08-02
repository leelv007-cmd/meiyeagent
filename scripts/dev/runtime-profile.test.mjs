import assert from 'node:assert/strict';
import test from 'node:test';
import { createDevelopmentRuntimeProfile } from './runtime-profile.mjs';

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
      webPort: '3000',
    },
  );
  assert.equal(
    profile.HARNESS_DBOS_SYSTEM_DATABASE_URL,
    'postgres://meiye:meiye@127.0.0.1:54329/meiye_example_dbos',
  );
  assert.equal(profile.CORE_SERVICE_URL, 'http://127.0.0.1:4102');
  assert.equal(profile.MAIN_APP_ORIGIN, 'http://localhost:3000');
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
