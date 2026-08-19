import {
  DEFAULT_JOB_QUEUE_PREFIX,
  runtimeProfileFingerprint,
} from './runtime-fingerprint.mjs';

export const CREDENTIAL_FREE_APP_ENV = 'e2e';
export const CREDENTIAL_FREE_MODEL_EXECUTION_MODE = 'fixture';

export const PLATFORM_DEFAULT_MODEL_SEED = Object.freeze({
  audio: 'audio-speech-fixture',
  copy: 'deepseek-v4-pro',
  image: 'nano-banana-2',
  video: 'seedance-2',
});

export const DEVELOPMENT_DIRECT_WITHOUT_ACTIVATION_ERROR = [
  'Refusing to start the development stack: APP_ENV=development and MODEL_EXECUTION_MODE=direct have no live activation evidence.',
  'Missing: a live-verified activation probe for the configured direct structured model',
  '(admin-config global/__global__/model.activation.evidence.<deploymentId> matching the current non-secret fingerprint).',
  'Fix (pick one):',
  '  1. Credential-free local stack (documented default): APP_ENV=e2e MODEL_EXECUTION_MODE=fixture (see .env.example).',
  '  2. Switch MODEL_EXECUTION_MODE=recorded for contract-only probes, then complete activation before using direct.',
  '  3. Complete a live activation probe /核销 so runtime.activation becomes live_verified, then keep direct.',
  'start-stack fails closed here so Core does not die later at structured-model-runtime with a bare throw.',
].join('\n');

export const RECORDED_HARNESS_STILL_REQUIRES_LIVE_MODEL_ERROR = [
  'Refusing to start: MODEL_EXECUTION_MODE=recorded still hits the Harness live-direct gate',
  '(createHarnessStructuredModelExecutor fail-closed: recorded_only is not live_verified).',
  'Missing: a live direct structured model with live-verified activation evidence.',
  'Fix: use the credential-free pair APP_ENV=e2e MODEL_EXECUTION_MODE=fixture (see .env.example),',
  'or complete activation and boot MODEL_EXECUTION_MODE=direct.',
].join('\n');

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

export { runtimeProfileFingerprint };

function printableFingerprintValue(key, value) {
  if (key.endsWith('_FINGERPRINT')) return JSON.stringify('[redacted hash]');
  return JSON.stringify(value);
}

export function assertPairedRuntimeProfile(actual, expected) {
  const left = runtimeProfileFingerprint(actual);
  const right = runtimeProfileFingerprint(expected);
  const mismatches = Object.keys(left).filter((key) => left[key] !== right[key]);
  if (mismatches.length === 0) return left;
  throw new Error(
    [
      `API/worker runtime profile mismatch (${mismatches.join(', ')}).`,
      ...mismatches.map(
        (key) =>
          `  ${key}: this process=${printableFingerprintValue(key, left[key])} peer/stack=${printableFingerprintValue(key, right[key])}`,
      ),
      'Start API and worker from the same start-stack / pnpm dev profile so the runtime fingerprint matches.',
    ].join('\n'),
  );
}

export function hasLiveActivationEvidence(input) {
  const flag = String(
    input?.HARNESS_LIVE_ACTIVATION ?? input?.MODEL_ACTIVATION_STATUS ?? '',
  ).trim();
  return (
    flag === 'live_verified' || flag === '1' || flag === 'true' || flag === 'yes'
  );
}

export function assertDevelopmentRuntimeCanBoot(profile) {
  const appEnv = String(profile?.APP_ENV ?? '');
  const mode = String(profile?.MODEL_EXECUTION_MODE ?? '');

  if (mode === CREDENTIAL_FREE_MODEL_EXECUTION_MODE) {
    if (appEnv !== CREDENTIAL_FREE_APP_ENV) {
      throw new Error(
        `MODEL_EXECUTION_MODE=fixture is hard-gated to APP_ENV=e2e (got APP_ENV=${appEnv || '(empty)'}). Use the .env.example pair.`,
      );
    }
    return;
  }

  if (hasLiveActivationEvidence(profile)) return;

  if (appEnv === 'development' && mode === 'direct') {
    throw new Error(DEVELOPMENT_DIRECT_WITHOUT_ACTIVATION_ERROR);
  }

  if (mode === 'recorded') {
    throw new Error(RECORDED_HARNESS_STILL_REQUIRES_LIVE_MODEL_ERROR);
  }

  if (mode === 'direct' || mode === 'gateway') {
    throw new Error(DEVELOPMENT_DIRECT_WITHOUT_ACTIVATION_ERROR);
  }
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

  const webPort = hasExplicit(input, 'PORT') ? String(input.PORT) : '3000';
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
  const workerdV8Flags = hasExplicit(input, 'MINIFLARE_WORKERD_V8_FLAGS')
    ? String(input.MINIFLARE_WORKERD_V8_FLAGS)
    : '--max-old-space-size=8192';

  const langfusePolicy = hasExplicit(input, 'LANGFUSE_PROMPT_POLICY')
    ? input.LANGFUSE_PROMPT_POLICY
    : APP_ENV === CREDENTIAL_FREE_APP_ENV &&
        MODEL_EXECUTION_MODE === CREDENTIAL_FREE_MODEL_EXECUTION_MODE
      ? 'pilot'
      : undefined;

  return {
    ...input,
    APP_BASE_URL: `http://localhost:${webPort}`,
    APP_ENV,
    BYOK_EXECUTION_MODE: hasExplicit(input, 'BYOK_EXECUTION_MODE')
      ? input.BYOK_EXECUTION_MODE
      : 'recorded',
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: hasExplicit(
      input,
      'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE',
    )
      ? input.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
      : input.DATABASE_URL,
    CORE_PORT: corePort,
    CORE_SERVICE_URL: `http://127.0.0.1:${corePort}`,
    E2E_PLATFORM_DEFAULT_MODEL_AUDIO:
      input.E2E_PLATFORM_DEFAULT_MODEL_AUDIO ||
      PLATFORM_DEFAULT_MODEL_SEED.audio,
    E2E_PLATFORM_DEFAULT_MODEL_COPY:
      input.E2E_PLATFORM_DEFAULT_MODEL_COPY || PLATFORM_DEFAULT_MODEL_SEED.copy,
    E2E_PLATFORM_DEFAULT_MODEL_IMAGE:
      input.E2E_PLATFORM_DEFAULT_MODEL_IMAGE ||
      PLATFORM_DEFAULT_MODEL_SEED.image,
    E2E_PLATFORM_DEFAULT_MODEL_VIDEO:
      input.E2E_PLATFORM_DEFAULT_MODEL_VIDEO ||
      PLATFORM_DEFAULT_MODEL_SEED.video,
    ...(langfusePolicy ? { LANGFUSE_PROMPT_POLICY: langfusePolicy } : {}),
    ...(APP_ENV === CREDENTIAL_FREE_APP_ENV &&
    MODEL_EXECUTION_MODE === CREDENTIAL_FREE_MODEL_EXECUTION_MODE &&
    !hasExplicit(input, 'RUN_ISSUE_247_E2E_PROVISIONAL_BOUNDS_SEED')
      ? { RUN_ISSUE_247_E2E_PROVISIONAL_BOUNDS_SEED: 'true' }
      : {}),
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
    JOB_QUEUE_PREFIX: hasExplicit(input, 'JOB_QUEUE_PREFIX')
      ? input.JOB_QUEUE_PREFIX
      : DEFAULT_JOB_QUEUE_PREFIX,
    MODEL_EXECUTION_MODE,
    MINIFLARE_WORKERD_V8_FLAGS: workerdV8Flags,
    NODE_OPTIONS: nodeOptions,
    P1_ASSET_PUBLIC_BASE_URL: `http://localhost:${webPort}/api/core/p1/assets?objectKey=`,
    PORT: webPort,
    VITE_BASE_URL: `http://localhost:${webPort}`,
  };
}
