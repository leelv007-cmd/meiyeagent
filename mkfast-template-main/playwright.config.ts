import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

export function productionJourneyGlobalTimeout(
  env: Record<string, string | undefined>
): number | undefined {
  return env.CI && env.PLAYWRIGHT_PRODUCTION_CANDIDATE === 'true'
    ? 60 * 60_000
    : undefined;
}

const port = Number(
  process.env.PLAYWRIGHT_WEB_PORT ?? process.env.PORT ?? 3200
);
const corePort = Number(process.env.PLAYWRIGHT_CORE_PORT ?? 4100);
const productionCandidate =
  process.env.PLAYWRIGHT_PRODUCTION_CANDIDATE === 'true';
const localURL = `http://127.0.0.1:${port}`;
const coreURL = `http://127.0.0.1:${corePort}`;
const candidateURL = `http://localhost:${Number(
  process.env.PLAYWRIGHT_CANDIDATE_PORT ?? 3010
)}`;
const internalWebURL = productionCandidate
  ? `http://127.0.0.1:${new URL(candidateURL).port}`
  : `http://127.0.0.1:${port}`;
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ??
  (productionCandidate ? candidateURL : localURL);
const authBaseURL = process.env.PLAYWRIGHT_AUTH_BASE_URL ?? localURL;
const databaseURL =
  process.env.TEST_DATABASE_URL ??
  'postgres://meiye:meiye@127.0.0.1:54329/meiye';
const dbosSystemDatabaseURL = (() => {
  const url = new URL(process.env.TEST_DBOS_SYSTEM_DATABASE_URL ?? databaseURL);
  const baseName = decodeURIComponent(url.pathname.slice(1)) || 'meiye_dbos';
  url.pathname = `/${baseName}_playwright_${corePort}_${process.pid}`;
  url.search = '';
  url.hash = '';
  return url.toString();
})();
const jobQueuePrefix = `meiye-p1-e2e-${corePort}`;
const integrationSecretStoreKey =
  process.env.INTEGRATION_SECRET_STORE_KEY ?? '0'.repeat(64);
const serviceMaxRestarts = process.env.E2E_SERVICE_MAX_RESTARTS ?? '2';
const providerFree = process.env.PLAYWRIGHT_PROVIDER_FREE === 'true';

// Playwright resolves string reporter ids with require.resolve from its own
// package, so a relative id crashes config loading before any service starts
// (proven by the 2026-08-12 kill-acceptance probe). An absolute path is the
// only resolution-proof spelling.
const serviceLivenessReporter = fileURLToPath(
  new URL('./scripts/e2e/service-liveness-reporter.mjs', import.meta.url)
);

export default defineConfig({
  globalTimeout: productionJourneyGlobalTimeout(process.env),
  testDir: './tests/e2e/specs',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [
    [process.env.CI ? 'github' : 'list'],
    // Turns "a service died mid-run" into one instrument failure instead of
    // dozens of cascade reds in the login fixture.
    [serviceLivenessReporter],
  ],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      name: 'Core',
      command: [
        '../scripts/ci/provision-test-db.sh',
        '&&',
        'node scripts/e2e/run-service.mjs pnpm --dir .. --filter @meiye/core start',
      ].join(' '),
      env: {
        APP_BASE_URL: internalWebURL,
        APP_ENV: 'e2e',
        BYOK_EXECUTION_MODE: 'recorded',
        BYOK_MODEL_BINDINGS: 'e2e-placeholder=e2e-placeholder',
        CORE_LOCAL_SUPERVISOR: '1',
        CORE_PORT: String(corePort),
        CORE_SERVICE_TOKEN: 'local-core-service-token',
        DATABASE_URL: databaseURL,
        DBOS__VMID: `core-e2e-${corePort}`,
        DOUYIN_CALLBACK_TOKEN: 'local-douyin-callback-token',
        E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS: '10000',
        E2E_FIXTURE_MID_RUN_PAGE_HOLD_MS: '20000',
        E2E_PLATFORM_DEFAULT_MODEL_AUDIO: 'audio-speech-fixture',
        E2E_PLATFORM_DEFAULT_MODEL_COPY: 'deepseek-v4-pro',
        E2E_PLATFORM_DEFAULT_MODEL_IMAGE: 'nano-banana-2',
        E2E_PLATFORM_DEFAULT_MODEL_VIDEO: 'seedance-2',
        E2E_SERVICE_MAX_RESTARTS: serviceMaxRestarts,
        E2E_SERVICE_NAME: 'core',
        FEISHU_MCP_MODE: 'recorded',
        HARNESS_DBOS_SYSTEM_DATABASE_URL: dbosSystemDatabaseURL,
        INTEGRATION_SECRET_STORE_KEY: integrationSecretStoreKey,
        INTEGRATION_SECRET_STORE_MODE: 'recorded',
        JOB_QUEUE_PREFIX: jobQueuePrefix,
        LANGFUSE_BASE_URL: '',
        LANGFUSE_PROMPT_POLICY: 'pilot',
        LANGFUSE_PROMPT_VERSIONS: '',
        LANGFUSE_PUBLIC_KEY: '',
        LANGFUSE_SECRET_KEY: '',
        MODEL_EXECUTION_MODE: 'fixture',
        RUN_ISSUE_247_E2E_PROVISIONAL_BOUNDS_SEED: 'true',
        RUN_ISSUE_298_E2E_CREDIT_PLAN_SEED: 'true',
        TEST_DATABASE_URL: databaseURL,
        TEST_DBOS_SYSTEM_DATABASE_URL: dbosSystemDatabaseURL,
      },
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      url: `${coreURL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      name: 'P1 Worker',
      command:
        'node scripts/e2e/run-service.mjs pnpm --dir .. --filter @meiye/core start:worker',
      env: {
        APP_BASE_URL: internalWebURL,
        APP_ENV: 'e2e',
        BYOK_EXECUTION_MODE: 'recorded',
        BYOK_MODEL_BINDINGS: 'e2e-placeholder=e2e-placeholder',
        CORE_LOCAL_SUPERVISOR: '1',
        CORE_SERVICE_TOKEN: 'local-core-service-token',
        DATABASE_URL: databaseURL,
        DBOS__VMID: `p1-worker-e2e-${corePort}`,
        E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS: '10000',
        E2E_FIXTURE_MID_RUN_PAGE_HOLD_MS: '20000',
        E2E_SERVICE_MAX_RESTARTS: serviceMaxRestarts,
        E2E_SERVICE_NAME: 'p1-worker',
        FEISHU_MCP_MODE: 'recorded',
        HARNESS_DBOS_SYSTEM_DATABASE_URL: dbosSystemDatabaseURL,
        INTEGRATION_SECRET_STORE_KEY: integrationSecretStoreKey,
        INTEGRATION_SECRET_STORE_MODE: 'recorded',
        JOB_QUEUE_PREFIX: jobQueuePrefix,
        LANGFUSE_BASE_URL: '',
        LANGFUSE_PROMPT_POLICY: 'pilot',
        LANGFUSE_PROMPT_VERSIONS: '',
        LANGFUSE_PUBLIC_KEY: '',
        LANGFUSE_SECRET_KEY: '',
        MODEL_EXECUTION_MODE: 'fixture',
      },
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      timeout: 120_000,
      wait: { stdout: /meiye-core P1 job worker started/ },
    },
    {
      name: 'Web',
      command: [
        'node scripts/e2e/ensure-miniflare-v8-flags.mjs',
        'pnpm locale:compile:e2e',
        `node scripts/e2e/run-service.mjs pnpm exec vite dev --host 127.0.0.1 --port ${port} --mode e2e`,
      ].join(' && '),
      env: {
        BETTER_AUTH_SECRET: 'e2e-better-auth-secret',
        CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: databaseURL,
        CORE_SERVICE_TOKEN: 'local-core-service-token',
        CORE_SERVICE_URL: coreURL,
        DATABASE_URL: databaseURL,
        E2E_SERVICE_MAX_RESTARTS: serviceMaxRestarts,
        E2E_SERVICE_NAME: 'web',
        JOB_QUEUE_PREFIX: jobQueuePrefix,
        MINIFLARE_WORKERD_V8_FLAGS: '--max-old-space-size=8192',
        PARAGLIDE_PRECOMPILED: 'true',
        VITE_BASE_URL: authBaseURL,
        ...(providerFree
          ? {}
          : {
              STRIPE_SECRET_KEY: 'sk_test_plan_e2e',
              STRIPE_WEBHOOK_SECRET: 'whsec_plan_e2e',
              VITE_PAYMENT_PROVIDER: 'stripe',
              VITE_PUBLIC_PAID_LAUNCH_ENABLED: 'true',
            }),
      },
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      url: authBaseURL,
      reuseExistingServer: !process.env.CI,
      // A clean checkout may need to compile the Paraglide locale bundle
      // before Vite can bind. Keep the startup gate longer than that cold
      // compile so the browser gate reaches a real Web server.
      timeout: 300_000,
    },
    ...(productionCandidate
      ? [
          {
            command: [
              'pnpm build',
              '&&',
              // wrangler embeds the same miniflare copy the Web project
              // patches, but boot order is not guaranteed — splice here too,
              // and pass the flag into the wrangler process itself or the
              // candidate workerd stays at the ~1.4 GB default heap and dies
              // with "Network connection lost" on the first heavy request
              // (2/2 CI samples on run 31812359379 / 31815761907).
              'node scripts/e2e/ensure-miniflare-v8-flags.mjs',
              '&&',
              'node scripts/e2e/run-wrangler-service.mjs',
              '--config wrangler.quality.jsonc',
              '--ip 127.0.0.1',
              `--port ${new URL(candidateURL).port}`,
              '--show-interactive-dev-session=false',
              '--log-level error',
            ].join(' '),
            env: {
              APP_ENV: 'e2e',
              BETTER_AUTH_SECRET: 'e2e-better-auth-secret',
              CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
                databaseURL,
              CORE_SERVICE_TOKEN: 'local-core-service-token',
              CORE_SERVICE_URL: coreURL,
              DATABASE_URL: databaseURL,
              E2E_SERVICE_HEALTH_URL: `${internalWebURL}/api/ping`,
              E2E_SERVICE_MAX_RESTARTS: serviceMaxRestarts,
              E2E_SERVICE_NAME: 'production-candidate',
              MINIFLARE_WORKERD_V8_FLAGS: '--max-old-space-size=8192',
              MODEL_EXECUTION_MODE: 'fixture',
              PARAGLIDE_PRECOMPILED: 'true',
              VITE_BASE_URL: candidateURL,
              ...(providerFree
                ? {}
                : {
                    STRIPE_SECRET_KEY: 'sk_test_plan_e2e',
                    STRIPE_WEBHOOK_SECRET: 'whsec_plan_e2e',
                    VITE_PAYMENT_PROVIDER: 'stripe',
                    VITE_PUBLIC_PAID_LAUNCH_ENABLED: 'true',
                  }),
            },
            gracefulShutdown: {
              signal: 'SIGTERM' as const,
              timeout: 10_000,
            },
            url: candidateURL,
            reuseExistingServer: false,
            timeout: 240_000,
          },
        ]
      : []),
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { height: 900, width: 1440 },
      },
    },
  ],
});
