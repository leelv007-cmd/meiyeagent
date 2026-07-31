import assert from 'node:assert/strict';
import test from 'node:test';
import { createDevelopmentRuntimeProfile } from './runtime-profile.mjs';

test('development runtime activates the web+core fixture stack', () => {
  const profile = createDevelopmentRuntimeProfile({
    APP_ENV: 'development',
    CORE_PORT: '4100',
    DATABASE_URL:
      'postgres://meiye:meiye@127.0.0.1:54329/meiye_example',
    MODEL_EXECUTION_MODE: 'direct',
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

test('development runtime preserves an explicit separate DBOS database', () => {
  const profile = createDevelopmentRuntimeProfile({
    DATABASE_URL:
      'postgres://meiye:meiye@127.0.0.1:54329/meiye_business',
    HARNESS_DBOS_SYSTEM_DATABASE_URL:
      'postgres://meiye:meiye@127.0.0.1:54329/meiye_system',
  });

  assert.equal(
    profile.HARNESS_DBOS_SYSTEM_DATABASE_URL,
    'postgres://meiye:meiye@127.0.0.1:54329/meiye_system',
  );
});
