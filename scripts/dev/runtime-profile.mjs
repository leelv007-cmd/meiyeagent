function derivedDbosUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!databaseName || databaseName.includes('/')) {
    throw new Error('DATABASE_URL must name exactly one PostgreSQL database.');
  }
  url.pathname = `/${encodeURIComponent(`${databaseName}_dbos`)}`;
  return url.toString();
}

function hasExplicit(input, key) {
  return Object.prototype.hasOwnProperty.call(input, key) && input[key] != null;
}

/**
 * Resolve APP_ENV + MODEL_EXECUTION_MODE as a legal pair.
 *
 * runtime-config.ts hard-gates fixture to APP_ENV=e2e. Defaults fill only
 * unset keys, and when the caller sets only one of the pair the other is
 * chosen so the combination stays legal (never development+fixture).
 */
function resolveAppEnvAndModelMode(input) {
  const explicitAppEnv = hasExplicit(input, 'APP_ENV')
    ? String(input.APP_ENV)
    : undefined;
  const explicitModelMode = hasExplicit(input, 'MODEL_EXECUTION_MODE')
    ? String(input.MODEL_EXECUTION_MODE)
    : undefined;

  if (explicitAppEnv === undefined && explicitModelMode === undefined) {
    // Credential-free local green loop (matches .env.example).
    return { APP_ENV: 'e2e', MODEL_EXECUTION_MODE: 'fixture' };
  }

  if (explicitAppEnv !== undefined && explicitModelMode !== undefined) {
    // Both explicit: respect as-is. Illegal pairs fail later at runtime-config.
    return {
      APP_ENV: explicitAppEnv,
      MODEL_EXECUTION_MODE: explicitModelMode,
    };
  }

  if (explicitModelMode !== undefined) {
    // Model set, APP_ENV unset: fixture forces e2e; other modes default to development.
    return {
      APP_ENV: explicitModelMode === 'fixture' ? 'e2e' : 'development',
      MODEL_EXECUTION_MODE: explicitModelMode,
    };
  }

  // APP_ENV set, model unset: only e2e defaults to fixture; anything else gets
  // recorded so we never invent development+fixture.
  return {
    APP_ENV: explicitAppEnv,
    MODEL_EXECUTION_MODE: explicitAppEnv === 'e2e' ? 'fixture' : 'recorded',
  };
}

/**
 * Development stack profile. Explicit input keys always win; defaults apply
 * only when a key is absent. E2E / Playwright callers that need fixture must
 * pass APP_ENV=e2e and MODEL_EXECUTION_MODE=fixture explicitly (or leave both
 * unset to receive the credential-free default pair).
 */
export function createDevelopmentRuntimeProfile(input) {
  if (!input.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for the development stack.');
  }

  const webPort = '3000';
  const corePort = input.PLAYWRIGHT_CORE_PORT || input.CORE_PORT || '4100';
  const dbosUrl = hasExplicit(input, 'HARNESS_DBOS_SYSTEM_DATABASE_URL')
    ? input.HARNESS_DBOS_SYSTEM_DATABASE_URL
    : derivedDbosUrl(input.DATABASE_URL);
  if (new URL(dbosUrl).toString() === new URL(input.DATABASE_URL).toString()) {
    throw new Error(
      'HARNESS_DBOS_SYSTEM_DATABASE_URL must differ from DATABASE_URL.'
    );
  }

  const { APP_ENV, MODEL_EXECUTION_MODE } = resolveAppEnvAndModelMode(input);

  // Vite SSR OOM'd under long QA (~1.4GB). Keep an explicit heap floor for the
  // whole stack without clobbering a caller that already set NODE_OPTIONS.
  const nodeOptions = hasExplicit(input, 'NODE_OPTIONS')
    ? String(input.NODE_OPTIONS)
    : '--max-old-space-size=8192';

  return {
    ...input,
    APP_BASE_URL: `http://localhost:${webPort}`,
    APP_ENV,
    BYOK_EXECUTION_MODE: hasExplicit(input, 'BYOK_EXECUTION_MODE')
      ? input.BYOK_EXECUTION_MODE
      : 'recorded',
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
    FEISHU_MCP_MODE: hasExplicit(input, 'FEISHU_MCP_MODE')
      ? input.FEISHU_MCP_MODE
      : 'recorded',
    HARNESS_DBOS_SYSTEM_DATABASE_URL: dbosUrl,
    INTEGRATION_SECRET_STORE_MODE: hasExplicit(
      input,
      'INTEGRATION_SECRET_STORE_MODE'
    )
      ? input.INTEGRATION_SECRET_STORE_MODE
      : 'recorded',
    MAIN_APP_ORIGIN: `http://localhost:${webPort}`,
    MODEL_EXECUTION_MODE,
    NODE_OPTIONS: nodeOptions,
    P1_ASSET_PUBLIC_BASE_URL: `http://localhost:${webPort}/api/core/p1/assets?objectKey=`,
    PORT: webPort,
    VITE_BASE_URL: `http://localhost:${webPort}`,
  };
}
