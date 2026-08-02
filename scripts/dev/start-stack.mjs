import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createDevelopmentRuntimeProfile } from './runtime-profile.mjs';
import { clearStackState, writeStackState } from './stack-state.mjs';

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

// Truth source for `pnpm dev:smoke`: the profile URLs actually handed to the
// stack processes, not a later re-read of .env which can drift.
await writeStackState(profile);

const stack = run('pnpm', ['run', 'dev:all']);
const clearState = async () => {
  await clearStackState().catch(() => undefined);
};
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void clearState().finally(() => stack.kill(signal));
  });
}
const stackExit = await new Promise((resolveExit, reject) => {
  stack.once('error', reject);
  stack.once('exit', (code, signal) => resolveExit({ code, signal }));
});
await clearState();
if (stackExit.signal) process.kill(process.pid, stackExit.signal);
process.exitCode = stackExit.code ?? 1;
