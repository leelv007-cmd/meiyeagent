import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORT ?? 3000);
const corePort = Number(process.env.PLAYWRIGHT_CORE_PORT ?? 4100);
const canvasPort = Number(process.env.PLAYWRIGHT_CANVAS_PORT ?? 4200);
const productionCandidate =
  process.env.PLAYWRIGHT_PRODUCTION_CANDIDATE === 'true';
const localURL = `http://localhost:${port}`;
const coreURL = `http://127.0.0.1:${corePort}`;
const canvasURL = `http://localhost:${canvasPort}`;
const candidateURL = `http://localhost:${Number(
  process.env.PLAYWRIGHT_CANDIDATE_PORT ?? 3010
)}`;
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
const providerFree = process.env.PLAYWRIGHT_PROVIDER_FREE === 'true';
const paymentServerEnvironment = providerFree
  ? []
  : [
      'VITE_PAYMENT_PROVIDER=stripe',
      'VITE_PUBLIC_PAID_LAUNCH_ENABLED=true',
      'PRO_STUDIO_OFFER_ID=pro-studio-e2e',
      'PRO_STUDIO_PRICE_ID=price-pro-studio-e2e',
      'PRO_STUDIO_AMOUNT_CENTS=29900',
      'PRO_STUDIO_CURRENCY=CNY',
      'PRO_STUDIO_PAYMENT_TYPE=one_time',
      'STRIPE_SECRET_KEY=sk_test_pro_studio_e2e',
      'STRIPE_WEBHOOK_SECRET=whsec_pro_studio_e2e',
    ];
const canvasOfferEnvironment = providerFree
  ? []
  : [
      'PRO_STUDIO_OFFER_ID=pro-studio-e2e',
      'PRO_STUDIO_PRICE_ID=price-pro-studio-e2e',
    ];
const paymentWorkerVariables = providerFree
  ? []
  : [
      '--var VITE_PAYMENT_PROVIDER:stripe',
      '--var VITE_PUBLIC_PAID_LAUNCH_ENABLED:true',
      '--var PRO_STUDIO_OFFER_ID:pro-studio-e2e',
      '--var PRO_STUDIO_PRICE_ID:price-pro-studio-e2e',
      '--var PRO_STUDIO_AMOUNT_CENTS:29900',
      '--var PRO_STUDIO_CURRENCY:CNY',
      '--var PRO_STUDIO_PAYMENT_TYPE:one_time',
      '--var STRIPE_SECRET_KEY:sk_test_pro_studio_e2e',
      '--var STRIPE_WEBHOOK_SECRET:whsec_pro_studio_e2e',
    ];

export default defineConfig({
  testDir: './tests/e2e/specs',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: [
        `APP_ENV=e2e RUN_ISSUE_247_E2E_PROVISIONAL_BOUNDS_SEED=true TEST_DATABASE_URL='${databaseURL}' TEST_DBOS_SYSTEM_DATABASE_URL='${dbosSystemDatabaseURL}' ../scripts/ci/provision-test-db.sh`,
        '&&',
        `DATABASE_URL='${databaseURL}'`,
        `HARNESS_DBOS_SYSTEM_DATABASE_URL='${dbosSystemDatabaseURL}'`,
        `DBOS__VMID=core-e2e-${corePort}`,
        'CORE_SERVICE_TOKEN=local-core-service-token',
        'DOUYIN_CALLBACK_TOKEN=local-douyin-callback-token',
        `JOB_QUEUE_PREFIX=${jobQueuePrefix}`,
        `APP_BASE_URL=${baseURL}`,
        'APP_ENV=e2e',
        'LANGFUSE_PROMPT_POLICY=pilot',
        'BYOK_EXECUTION_MODE=recorded',
        'BYOK_MODEL_BINDINGS=e2e-placeholder=e2e-placeholder',
        'FEISHU_MCP_MODE=recorded',
        'INTEGRATION_SECRET_STORE_MODE=recorded',
        `INTEGRATION_SECRET_STORE_KEY=${integrationSecretStoreKey}`,
        'MODEL_EXECUTION_MODE=fixture',
        // The e2e stack boots without Langfuse credentials; strict (the
        // default) refuses to start, so pin the audited builtin-fallback mode.
        'LANGFUSE_PROMPT_POLICY=pilot',
        // E2E-only observation window: 10,000 ms instead of the 40 ms fixture
        // default, adding 9,960 ms to each structured copy run.
        'E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS=10000',
        'E2E_PLATFORM_DEFAULT_MODEL_COPY=deepseek-v4-pro',
        // Deliberately differs from the retired browser constant
        // (`seedream-5-pro`). The canonical-default journey must fail if that
        // client-side table ever returns.
        'E2E_PLATFORM_DEFAULT_MODEL_IMAGE=nano-banana-2',
        'E2E_PLATFORM_DEFAULT_MODEL_VIDEO=seedance-2',
        'E2E_PLATFORM_DEFAULT_MODEL_AUDIO=audio-speech-fixture',
        `CORE_PORT=${corePort}`,
        'node scripts/e2e/run-service.mjs pnpm --dir .. --filter @meiye/core start',
      ].join(' '),
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      url: `${coreURL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      name: 'P1 Worker',
      command: [
        `DATABASE_URL='${databaseURL}'`,
        // Same DBOS system database as the core block: the worker's terminal
        // notifier (DBOS.send) must land where core's DBOS.recv waits, or
        // every image/video journey stalls into the 150s media timeout.
        `HARNESS_DBOS_SYSTEM_DATABASE_URL='${dbosSystemDatabaseURL}'`,
        `DBOS__VMID=p1-worker-e2e-${corePort}`,
        `APP_BASE_URL=${baseURL}`,
        'CORE_SERVICE_TOKEN=local-core-service-token',
        `JOB_QUEUE_PREFIX=${jobQueuePrefix}`,
        'APP_ENV=e2e',
        'LANGFUSE_PROMPT_POLICY=pilot',
        'BYOK_EXECUTION_MODE=recorded',
        'BYOK_MODEL_BINDINGS=e2e-placeholder=e2e-placeholder',
        'FEISHU_MCP_MODE=recorded',
        'INTEGRATION_SECRET_STORE_MODE=recorded',
        `INTEGRATION_SECRET_STORE_KEY=${integrationSecretStoreKey}`,
        'MODEL_EXECUTION_MODE=fixture',
        'LANGFUSE_PROMPT_POLICY=pilot',
        // Keep the worker on the same E2E-only 10,000 ms first-copy-chunk hold.
        'E2E_FIXTURE_STRUCTURED_FIRST_CHUNK_HOLD_MS=10000',
        'node scripts/e2e/run-service.mjs pnpm --dir .. --filter @meiye/core start:worker',
      ].join(' '),
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      timeout: 120_000,
      wait: { stdout: /meiye-core P1 job worker started/ },
    },
    {
      command: [
        'pnpm locale:compile:e2e',
        [
          `VITE_BASE_URL=${authBaseURL}`,
          ...paymentServerEnvironment,
          'BETTER_AUTH_SECRET=e2e-better-auth-secret',
          `CORE_SERVICE_URL=${coreURL}`,
          'CORE_SERVICE_TOKEN=local-core-service-token',
          `CANVAS_SERVICE_URL=${canvasURL}`,
          'CANVAS_SERVICE_TOKEN=local-canvas-service-token',
          `CANVAS_ORIGIN=${canvasURL}`,
          `JOB_QUEUE_PREFIX=${jobQueuePrefix}`,
          `DATABASE_URL='${databaseURL}'`,
          `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE='${databaseURL}'`,
          'PARAGLIDE_PRECOMPILED=true',
          `node scripts/e2e/run-service.mjs pnpm exec vite dev --port ${port} --mode e2e`,
        ].join(' '),
      ].join(' && '),
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      url: authBaseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      name: 'Canvas',
      command: [
        `DATABASE_URL='${databaseURL}'`,
        `CORE_SERVICE_URL=${coreURL}`,
        'CORE_SERVICE_TOKEN=local-core-service-token',
        'CANVAS_SERVICE_TOKEN=local-canvas-service-token',
        `CANVAS_ORIGIN=${canvasURL}`,
        `MAIN_APP_ORIGIN=${authBaseURL}`,
        ...canvasOfferEnvironment,
        `PORT=${canvasPort}`,
        `node scripts/e2e/run-service.mjs pnpm --dir .. --filter @meiye/canvas exec next dev --webpack --port ${canvasPort}`,
      ].join(' '),
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      url: canvasURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    ...(productionCandidate
      ? [
          {
            command: [
              'APP_ENV=e2e',
              'MODEL_EXECUTION_MODE=fixture',
              `VITE_BASE_URL=${candidateURL}`,
              ...paymentServerEnvironment,
              'BETTER_AUTH_SECRET=e2e-better-auth-secret',
              `CORE_SERVICE_URL=${coreURL}`,
              'CORE_SERVICE_TOKEN=local-core-service-token',
              `CANVAS_SERVICE_URL=${canvasURL}`,
              'CANVAS_SERVICE_TOKEN=local-canvas-service-token',
              `CANVAS_ORIGIN=${canvasURL}`,
              `DATABASE_URL='${databaseURL}'`,
              `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE='${databaseURL}'`,
              'PARAGLIDE_PRECOMPILED=true',
              'pnpm build',
              '&&',
              `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE='${databaseURL}'`,
              'node scripts/e2e/run-service.mjs pnpm exec wrangler dev',
              '--config wrangler.quality.jsonc',
              '--ip 127.0.0.1',
              `--port ${new URL(candidateURL).port}`,
              '--var APP_ENV:e2e',
              '--var MODEL_EXECUTION_MODE:fixture',
              `--var VITE_BASE_URL:${candidateURL}`,
              '--var BETTER_AUTH_SECRET:e2e-better-auth-secret',
              `--var CORE_SERVICE_URL:${coreURL}`,
              '--var CORE_SERVICE_TOKEN:local-core-service-token',
              `--var CANVAS_SERVICE_URL:${canvasURL}`,
              '--var CANVAS_SERVICE_TOKEN:local-canvas-service-token',
              `--var CANVAS_ORIGIN:${canvasURL}`,
              ...paymentWorkerVariables,
              `--var DATABASE_URL:${databaseURL}`,
              '--show-interactive-dev-session=false',
              '--log-level error',
            ].join(' '),
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
