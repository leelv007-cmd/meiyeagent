import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bindingNames = [
  'APP_ENV',
  'BETTER_AUTH_SECRET',
  'CORE_SERVICE_TOKEN',
  'CORE_SERVICE_URL',
  'DATABASE_URL',
  'MODEL_EXECUTION_MODE',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'VITE_BASE_URL',
  'VITE_PAYMENT_PROVIDER',
  'VITE_PUBLIC_PAID_LAUNCH_ENABLED',
];

let child;
let directory;
let failure;
let requestedSignal;
let result;
const signalHandlers = new Map();
for (const signal of ['SIGINT', 'SIGTERM']) {
  const handler = () => {
    requestedSignal ??= signal;
    child?.kill(signal);
  };
  signalHandlers.set(signal, handler);
  process.on(signal, handler);
}

function assertNotSignaled() {
  if (requestedSignal) throw new Error(`Received ${requestedSignal}.`);
}

try {
  directory = await mkdtemp(
    process.env.MEIYE_WRANGLER_TEMP_PREFIX ??
      join(tmpdir(), 'meiye-wrangler-env-')
  );
  assertNotSignaled();
  const envFile = join(
    directory,
    process.env.MEIYE_WRANGLER_ENV_FILE_BASENAME ?? 'runtime.env'
  );
  const contents = bindingNames
    .filter((name) => process.env[name] !== undefined)
    .map((name) => `${name}=${JSON.stringify(process.env[name])}`)
    .join('\n');
  await writeFile(envFile, `${contents}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  if (process.env.MEIYE_WRANGLER_TEST_PRE_HANDLER_DELAY_MS) {
    await new Promise((resolveDelay) =>
      setTimeout(
        resolveDelay,
        Number(process.env.MEIYE_WRANGLER_TEST_PRE_HANDLER_DELAY_MS)
      )
    );
  }
  assertNotSignaled();

  if (process.env.MEIYE_WRANGLER_TEST_SYNC_SPAWN_FAILURE === 'true') {
    throw new Error('Injected synchronous spawn failure.');
  }
  const testCommand = process.env.MEIYE_WRANGLER_TEST_COMMAND;
  child = testCommand
    ? spawn(testCommand, [envFile, ...process.argv.slice(2)], {
        env: process.env,
        stdio: 'inherit',
      })
    : spawn(
        process.execPath,
        [
          'scripts/e2e/run-service.mjs',
          'pnpm',
          'exec',
          'wrangler',
          'dev',
          ...process.argv.slice(2),
          '--env-file',
          envFile,
        ],
        { env: process.env, stdio: 'inherit' }
      );

  result = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
} catch (error) {
  failure = error;
} finally {
  if (child && child.exitCode === null && !child.signalCode) {
    child.kill('SIGTERM');
  }
  for (const [signal, handler] of signalHandlers) {
    process.off(signal, handler);
  }
  if (directory) await rm(directory, { force: true, recursive: true });
}

if (requestedSignal) process.kill(process.pid, requestedSignal);
if (failure) throw failure;
if (result.signal) process.kill(process.pid, result.signal);
process.exitCode = result.code ?? 1;
