import assert from 'node:assert/strict';
import test from 'node:test';
import { createDevelopmentRuntimeProfile } from './runtime-profile.mjs';

test('development runtime activates the four-service fixture stack', () => {
  const profile = createDevelopmentRuntimeProfile({
    APP_ENV: 'development',
    CORE_PORT: '4100',
    DATABASE_URL:
      'postgres://meiye:meiye@127.0.0.1:54329/meiye_example',
    MODEL_EXECUTION_MODE: 'direct',
    PLAYWRIGHT_CANVAS_PORT: '4202',
    PLAYWRIGHT_CORE_PORT: '4102',
    PORT: '3102',
  });

  assert.deepEqual(
    {
      appEnv: profile.APP_ENV,
      byokMode: profile.BYOK_EXECUTION_MODE,
      canvasPort: profile.CANVAS_PORT,
      corePort: profile.CORE_PORT,
      feishuMode: profile.FEISHU_MCP_MODE,
      integrationMode: profile.INTEGRATION_SECRET_STORE_MODE,
      modelMode: profile.MODEL_EXECUTION_MODE,
      videoMode: profile.P1_VIDEO_COMPOSITION_MODE,
      webPort: profile.PORT,
    },
    {
      appEnv: 'e2e',
      byokMode: 'recorded',
      canvasPort: '4200',
      corePort: '4102',
      feishuMode: 'recorded',
      integrationMode: 'recorded',
      modelMode: 'fixture',
      videoMode: 'recorded',
      webPort: '3000',
    },
  );
  assert.equal(
    profile.HARNESS_DBOS_SYSTEM_DATABASE_URL,
    'postgres://meiye:meiye@127.0.0.1:54329/meiye_example_dbos',
  );
  assert.equal(profile.CORE_SERVICE_URL, 'http://127.0.0.1:4102');
  assert.equal(profile.CANVAS_SERVICE_URL, 'http://127.0.0.1:4200');
  assert.equal(profile.MAIN_APP_ORIGIN, 'http://localhost:3000');
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
