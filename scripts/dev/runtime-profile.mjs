function derivedDbosUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!databaseName || databaseName.includes('/')) {
    throw new Error('DATABASE_URL must name exactly one PostgreSQL database.');
  }
  url.pathname = `/${encodeURIComponent(`${databaseName}_dbos`)}`;
  return url.toString();
}

export function createDevelopmentRuntimeProfile(input) {
  if (!input.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for the development stack.');
  }

  const webPort = '3000';
  const corePort = input.PLAYWRIGHT_CORE_PORT || input.CORE_PORT || '4100';
  const dbosUrl =
    input.HARNESS_DBOS_SYSTEM_DATABASE_URL ||
    derivedDbosUrl(input.DATABASE_URL);
  if (new URL(dbosUrl).toString() === new URL(input.DATABASE_URL).toString()) {
    throw new Error(
      'HARNESS_DBOS_SYSTEM_DATABASE_URL must differ from DATABASE_URL.'
    );
  }

  return {
    ...input,
    APP_BASE_URL: `http://localhost:${webPort}`,
    APP_ENV: 'e2e',
    BYOK_EXECUTION_MODE: 'recorded',
    CORE_PORT: corePort,
    CORE_SERVICE_URL: `http://127.0.0.1:${corePort}`,
    E2E_PLATFORM_DEFAULT_MODEL_AUDIO:
      input.E2E_PLATFORM_DEFAULT_MODEL_AUDIO || 'audio-speech-fixture',
    E2E_PLATFORM_DEFAULT_MODEL_COPY:
      input.E2E_PLATFORM_DEFAULT_MODEL_COPY || 'deepseek-v4-pro',
    E2E_PLATFORM_DEFAULT_MODEL_IMAGE:
      input.E2E_PLATFORM_DEFAULT_MODEL_IMAGE || 'nano-banana-2',
    E2E_PLATFORM_DEFAULT_MODEL_VIDEO:
      input.E2E_PLATFORM_DEFAULT_MODEL_VIDEO || 'seedance-2',
    FEISHU_MCP_MODE: 'recorded',
    HARNESS_DBOS_SYSTEM_DATABASE_URL: dbosUrl,
    INTEGRATION_SECRET_STORE_MODE: 'recorded',
    MAIN_APP_ORIGIN: `http://localhost:${webPort}`,
    MODEL_EXECUTION_MODE: 'fixture',
    P1_ASSET_PUBLIC_BASE_URL: `http://localhost:${webPort}/api/core/p1/assets?objectKey=`,
    PORT: webPort,
    VITE_BASE_URL: `http://localhost:${webPort}`,
  };
}
