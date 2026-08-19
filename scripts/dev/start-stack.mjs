import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnDatabaseProvision } from './database-provision.mjs';
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
  claimStackState,
  clearStackState,
  stackStatePathFromEnv,
  writeStackState,
} from './stack-state.mjs';
import { superviseStack } from './stack-supervisor.mjs';

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

// Truth source for `pnpm dev:status` / `pnpm dev:smoke:running`: the profile
// actually handed to the stack processes, not a later re-read of .env.
const stackStatePath = stackStatePathFromEnv(profile);
const claim = await claimStackState(profile, {
  path: stackStatePath,
  status: 'starting',
});
if (!claim.claimed) {
  throw new Error(
    'A development stack already owns output/dev/stack-state.json. Stop it before starting another stack.',
  );
}

let provision;
let stack;
let requestedSignal;
let resultSignal;
let caughtError;
const signalHandlers = new Map();
for (const signal of ['SIGINT', 'SIGTERM']) {
  const handler = () => {
    requestedSignal ??= signal;
    stopChild(provision, signal);
    stopChild(stack, signal);
  };
  signalHandlers.set(signal, handler);
  process.on(signal, handler);
}
try {
  provision = spawnDatabaseProvision(profile);
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

  stack = run('pnpm', ['run', 'dev:all'], { detached: true });
  const result = await superviseStack({
    child: stack,
    coreHealthUrl: `${profile.CORE_SERVICE_URL}/health/ready`,
    onReady: () =>
      writeStackState(profile, {
        ownerPid: claim.payload.pid,
        ownerToken: claim.ownerToken,
        path: stackStatePath,
        readyAt: new Date().toISOString(),
        startedAt: claim.payload.startedAt,
        status: 'ready',
      }),
    webHealthUrl: `${profile.APP_BASE_URL}/api/ping`,
  });
  if (result.error) console.error(result.error.message);
  resultSignal = result.signal;
  if (!requestedSignal && !resultSignal) {
    process.exitCode = result.code ?? 1;
  }
} catch (error) {
  caughtError = error;
} finally {
  stopChild(provision, 'SIGTERM');
  stopChild(stack, 'SIGTERM');
  await clearStackState(stackStatePath, {
    ownerPid: claim.payload.pid,
    ownerToken: claim.ownerToken,
  }).catch(() => undefined);
  for (const [signal, handler] of signalHandlers) {
    process.off(signal, handler);
  }
}

const exitSignal = requestedSignal ?? resultSignal;
if (exitSignal) process.kill(process.pid, exitSignal);
if (caughtError) throw caughtError;
