import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createDevelopmentRuntimeProfile } from './runtime-profile.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const profile = createDevelopmentRuntimeProfile(process.env);

function run(command, args) {
  return spawn(command, args, {
    cwd: repoRoot,
    env: profile,
    stdio: 'inherit',
  });
}

const provision = run('./scripts/ci/provision-test-db.sh', [
  profile.DATABASE_URL,
  profile.HARNESS_DBOS_SYSTEM_DATABASE_URL,
]);
const provisionExit = await new Promise((resolveExit, reject) => {
  provision.once('error', reject);
  provision.once('exit', (code, signal) =>
    resolveExit({ code, signal })
  );
});
if (provisionExit.code !== 0) {
  throw new Error(
    `Development database provisioning failed (${provisionExit.signal ?? provisionExit.code}).`
  );
}

const stack = run('pnpm', ['run', 'dev:all']);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stack.kill(signal));
}
const stackExit = await new Promise((resolveExit, reject) => {
  stack.once('error', reject);
  stack.once('exit', (code, signal) => resolveExit({ code, signal }));
});
if (stackExit.signal) process.kill(process.pid, stackExit.signal);
process.exitCode = stackExit.code ?? 1;
