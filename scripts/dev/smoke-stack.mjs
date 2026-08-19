import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fetchHealthy } from './health-fetch.mjs';
import { spawnDatabaseProvision } from './database-provision.mjs';
import { postgresProcessEnv } from './postgres-process.mjs';
import {
  assertStackPortsAvailable,
  inspectListeningPort,
} from './port-occupancy.mjs';
import {
  assertDevelopmentRuntimeCanBoot,
  createDevelopmentRuntimeProfile,
} from './runtime-profile.mjs';
import { runHttpSmokeJourney } from './smoke-journey.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const stamp = `${Date.now()}`;
const pid = process.pid;
const businessName = `meiye_lane79_smoke_${pid}_${stamp}`;
const dbosName = `${businessName}_dbos`;
const children = [];
const tempDirs = [];

function adminUrlFrom(databaseUrl) {
  const url = new URL(databaseUrl);
  url.pathname = '/postgres';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function databaseUrlWithName(templateUrl, name) {
  const url = new URL(templateUrl);
  url.pathname = `/${encodeURIComponent(name)}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function assertSafeTempDatabaseName(name) {
  if (!/^meiye_lane79_[a-z0-9_]+$/.test(name)) {
    throw new Error(`Refusing to manage non-lane79 temp database ${name}`);
  }
}

async function pickFreePort(preferred) {
  const occupants = await inspectListeningPort(preferred);
  if (occupants.length === 0) return preferred;
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected a TCP address.'));
        return;
      }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
    server.once('error', reject);
  });
}

async function retry(label, assertion, timeoutMs = 180_000) {
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

function spawnLogged(command, args, env) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr?.on('data', (chunk) => process.stderr.write(chunk));
  children.push(child);
  return child;
}

async function dropDatabase(adminUrl, name) {
  assertSafeTempDatabaseName(name);
  // Two separate -c statements: a single multi-statement -c runs in one
  // implicit transaction, and DROP DATABASE refuses to run inside one.
  const terminateSql = [
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity`,
    ` WHERE datname = ${literal(name)} AND pid <> pg_backend_pid();`,
  ].join('\n');
  const dropSql = `DROP DATABASE IF EXISTS ${quoteIdent(name)};`;
  await execFileAsync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-c', terminateSql, '-c', dropSql],
    { encoding: 'utf8', env: postgresProcessEnv(adminUrl) },
  );
}

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function cleanup(adminUrl) {
  for (const child of [...children]) {
    if (child.exitCode !== null || child.signalCode) continue;
    child.kill('SIGTERM');
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 1_500));
  for (const child of children) {
    if (child.exitCode === null && !child.signalCode) child.kill('SIGKILL');
  }
  if (adminUrl) {
    await dropDatabase(adminUrl, businessName).catch((error) => {
      process.stderr.write(`${error}\n`);
    });
    await dropDatabase(adminUrl, dbosName).catch((error) => {
      process.stderr.write(`${error}\n`);
    });
  }
  for (const directory of tempDirs) {
    await rm(directory, { force: true, recursive: true }).catch(() => undefined);
  }
}

const templateUrl =
  process.env.LANE79_SMOKE_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://meiye:meiye@127.0.0.1:54329/meiye';
const adminUrl = adminUrlFrom(templateUrl);
const businessUrl = databaseUrlWithName(templateUrl, businessName);
const dbosUrl = databaseUrlWithName(templateUrl, dbosName);
assertSafeTempDatabaseName(businessName);
assertSafeTempDatabaseName(dbosName);

const webPort = await pickFreePort(Number(process.env.LANE79_WEB_PORT ?? 3179));
const corePort = await pickFreePort(Number(process.env.LANE79_CORE_PORT ?? 4179));
const assetDir = await mkdtemp(join(tmpdir(), 'meiye-lane79-assets-'));
const secretDir = await mkdtemp(join(tmpdir(), 'meiye-lane79-secrets-'));
tempDirs.push(assetDir, secretDir);

const profile = createDevelopmentRuntimeProfile({
  ...process.env,
  APP_ENV: 'e2e',
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET || 'e2e-better-auth-secret',
  CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: businessUrl,
  CORE_PORT: String(corePort),
  CORE_SERVICE_TOKEN: process.env.CORE_SERVICE_TOKEN || 'change-me',
  DATABASE_URL: businessUrl,
  HARNESS_DBOS_SYSTEM_DATABASE_URL: dbosUrl,
  INTEGRATION_SECRET_STORE_FILE: join(secretDir, 'integration-secrets.json'),
  INTEGRATION_SECRET_STORE_MODE: 'recorded',
  JOB_QUEUE_PREFIX: `meiye-lane79-${pid}`,
  LANGFUSE_BASE_URL: '',
  LANGFUSE_PROMPT_POLICY: 'pilot',
  LANGFUSE_PROMPT_VERSIONS: '',
  LANGFUSE_PUBLIC_KEY: '',
  LANGFUSE_SECRET_KEY: '',
  MODEL_EXECUTION_MODE: 'fixture',
  P1_ASSET_STORAGE_DIR: assetDir,
  PORT: String(webPort),
  VITE_BASE_URL: `http://127.0.0.1:${webPort}`,
  XDG_CONFIG_HOME: join(secretDir, 'xdg-config'),
});
profile.APP_BASE_URL = `http://127.0.0.1:${webPort}`;
profile.MAIN_APP_ORIGIN = `http://127.0.0.1:${webPort}`;
profile.P1_ASSET_PUBLIC_BASE_URL = `http://127.0.0.1:${webPort}/api/core/p1/assets?objectKey=`;
profile.VITE_BASE_URL = `http://127.0.0.1:${webPort}`;
assertDevelopmentRuntimeCanBoot(profile);
await assertStackPortsAvailable(profile);

let failed = false;
try {
  process.stdout.write(
    `Lane-79 smoke: web=${webPort} core=${corePort} db=${businessName}\n`,
  );

  const provision = spawnDatabaseProvision(profile);
  const provisionExit = await new Promise((resolveExit, reject) => {
    provision.once('error', reject);
    provision.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  if (provisionExit.code !== 0) {
    throw new Error(
      `provision-test-db.sh failed (${provisionExit.signal ?? provisionExit.code})`,
    );
  }

  spawnLogged('pnpm', ['--filter', '@meiye/core', 'start'], profile);
  spawnLogged('pnpm', ['--filter', '@meiye/core', 'start:worker'], {
    ...profile,
    DBOS__VMID: `p1-worker-lane79-${corePort}`,
  });
  spawnLogged(
    'pnpm',
    [
      '--filter',
      '@meiye/web',
      'exec',
      'vite',
      'dev',
      '--host',
      '127.0.0.1',
      '--port',
      String(webPort),
      '--mode',
      'e2e',
    ],
    profile,
  );

  await retry('Core assembly', async () => {
    const response = await fetchHealthy(
      'Core assembly',
      `http://127.0.0.1:${corePort}/health/assembly`,
    );
    const payload = await response.json();
    const assembly = payload?.data ?? payload;
    if (
      assembly?.status !== 'active' ||
      assembly?.harness !== 'active' ||
      assembly?.composerSubmission !== 'active'
    ) {
      throw new Error(`unexpected assembly ${JSON.stringify(assembly)}`);
    }
  });
  await retry('Web', () =>
    fetchHealthy('Web', `http://127.0.0.1:${webPort}/auth/login`),
  );

  const result = await runHttpSmokeJourney({
    webOrigin: `http://127.0.0.1:${webPort}`,
  });
  process.stdout.write(
    `dev:smoke passed: register ${result.email} credits=${result.credits} task=${result.taskId ?? result.submission?.task?.id ?? 'ok'}\n`,
  );
} catch (error) {
  failed = true;
  throw error;
} finally {
  await cleanup(adminUrl);
}

if (failed) process.exitCode = 1;
