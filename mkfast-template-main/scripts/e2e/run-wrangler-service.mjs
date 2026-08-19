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

const directory = await mkdtemp(join(tmpdir(), 'meiye-wrangler-env-'));
const envFile = join(directory, 'runtime.env');
const contents = bindingNames
  .filter((name) => process.env[name] !== undefined)
  .map((name) => `${name}=${JSON.stringify(process.env[name])}`)
  .join('\n');
await writeFile(envFile, `${contents}\n`, { encoding: 'utf8', mode: 0o600 });

const child = spawn(
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

const signalHandlers = new Map();
for (const signal of ['SIGINT', 'SIGTERM']) {
  const handler = () => child.kill(signal);
  signalHandlers.set(signal, handler);
  process.on(signal, handler);
}

let result;
try {
  result = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
} finally {
  await rm(directory, { force: true, recursive: true });
  for (const [signal, handler] of signalHandlers) {
    process.off(signal, handler);
  }
}
if (result.signal) process.kill(process.pid, result.signal);
process.exitCode = result.code ?? 1;
