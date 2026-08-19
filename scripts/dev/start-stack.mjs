import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  assertFrozenInstallParity,
  assertMiniflareWorkerdV8FlagsSupport,
} from './lock-parity.mjs';
import { assertStackPortsAvailable } from './port-occupancy.mjs';
import {
  assertDevelopmentRuntimeCanBoot,
  createDevelopmentRuntimeProfile,
} from './runtime-profile.mjs';
import {
  clearStackState,
  stackStatePathFromEnv,
  writeStackState,
} from './stack-state.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
await assertFrozenInstallParity({
  rootLockPath: process.env.MEIYE_ROOT_LOCK_PATH
    ? resolve(process.env.MEIYE_ROOT_LOCK_PATH)
    : resolve(repoRoot, 'pnpm-lock.yaml'),
  virtualStoreLockPath: process.env.MEIYE_VIRTUAL_STORE_LOCK_PATH
    ? resolve(process.env.MEIYE_VIRTUAL_STORE_LOCK_PATH)
    : resolve(repoRoot, 'node_modules/.pnpm/lock.yaml'),
});
await assertMiniflareWorkerdV8FlagsSupport();
const profile = createDevelopmentRuntimeProfile(process.env);
const wranglerHome = resolve(repoRoot, 'output/dev/xdg-config');
await mkdir(wranglerHome, { recursive: true });
if (!profile.XDG_CONFIG_HOME) profile.XDG_CONFIG_HOME = wranglerHome;
assertDevelopmentRuntimeCanBoot(profile);
await assertStackPortsAvailable(profile);

function run(command, args, { detached = false } = {}) {
  return spawn(command, args, {
    cwd: repoRoot,
    detached,
    env: profile,
    stdio: 'inherit',
  });
}

function stopChild(child, signal) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
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
const stackStatePath = stackStatePathFromEnv(profile);
await writeStackState(profile, { path: stackStatePath });

const stack = run('pnpm', ['run', 'dev:all'], { detached: true });
const clearState = async () => {
  await clearStackState(stackStatePath).catch(() => undefined);
};
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void clearState().finally(() => stopChild(stack, signal));
  });
}
const stackExit = await new Promise((resolveExit, reject) => {
  stack.once('error', reject);
  stack.once('exit', (code, signal) => resolveExit({ code, signal }));
});
stopChild(stack, 'SIGTERM');
await clearState();
if (stackExit.signal) process.kill(process.pid, stackExit.signal);
process.exitCode = stackExit.code ?? 1;
