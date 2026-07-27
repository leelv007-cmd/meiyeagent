import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { fetchHealthy } from './health-fetch.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const startedAt = new Date().toISOString();
const corePort =
  process.env.PLAYWRIGHT_CORE_PORT || process.env.CORE_PORT || '4100';
const databaseUrl = process.env.DATABASE_URL;
const canvasServiceToken = process.env.CANVAS_SERVICE_TOKEN;

if (!databaseUrl) throw new Error('DATABASE_URL is required.');
if (!canvasServiceToken) throw new Error('CANVAS_SERVICE_TOKEN is required.');

async function retry(label, assertion, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
    }
  }
  throw new Error(
    `${label} did not become ready: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function expectOk(label, url, init) {
  return fetchHealthy(label, url, init);
}

await retry('Web', () => expectOk('Web', 'http://localhost:3000/auth/login'));

await retry('Canvas', () =>
  expectOk('Canvas', 'http://localhost:4200/api/internal/health', {
    headers: { 'x-canvas-service-token': canvasServiceToken },
  }),
);

await retry('Core assembly', async () => {
  const response = await expectOk(
    'Core assembly',
    `http://127.0.0.1:${corePort}/health/assembly`,
  );
  const payload = await response.json();
  const assembly = payload?.data;
  if (
    assembly?.status !== 'active' ||
    assembly?.harness !== 'active' ||
    assembly?.composerSubmission !== 'active'
  ) {
    throw new Error(`unexpected activation signal ${JSON.stringify(assembly)}`);
  }
});

await retry('Worker heartbeat', async () => {
  const { stdout } = await execFileAsync('psql', [
    databaseUrl,
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-Atqc',
    `SELECT sampled_at
       FROM p1_worker_metric_samples
      WHERE sampled_at >= '${startedAt}'::timestamptz
      ORDER BY sampled_at DESC
      LIMIT 1`,
  ]);
  if (!stdout.trim()) {
    throw new Error(`no Worker heartbeat at or after ${startedAt}`);
  }
});

process.stdout.write(
  `Four-service smoke passed: Web:3000, Core:${corePort} Harness active, Worker heartbeat fresh, Canvas:4200.\n`,
);

const playwright = await new Promise((resolveExit, reject) => {
  const child = execFile(
    'pnpm',
    [
      '--filter',
      '@meiye/web',
      'exec',
      'playwright',
      'test',
      '--config',
      'playwright.dev-stack.config.ts',
      'tests/e2e/specs/assembly-gate-required-journey.spec.ts',
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PLAYWRIGHT_AUTH_BASE_URL: 'http://localhost:3000',
        PLAYWRIGHT_BASE_URL: 'http://localhost:3000',
        PLAYWRIGHT_CANVAS_PORT: '4200',
        PLAYWRIGHT_CORE_PORT: corePort,
        PORT: '3000',
        TEST_DATABASE_URL: databaseUrl,
      },
    },
  );
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  child.once('error', reject);
  child.once('exit', (code, signal) => resolveExit({ code, signal }));
});

if (playwright.code !== 0) {
  throw new Error(
    `Required assembly journey failed (${playwright.signal ?? playwright.code}).`,
  );
}
process.stdout.write(
  'Required assembly journey passed through the running pnpm dev stack.\n',
);
