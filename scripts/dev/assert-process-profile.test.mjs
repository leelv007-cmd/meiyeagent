import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  acquireStackStateLock,
  readStackState,
  writeStackState,
} from './stack-state.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, 'assert-process-profile.mjs');

function runAssert(env) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('exit', (code) => resolveRun({ code, stderr }));
  });
}

function spawnProfileProcess(env, holdMs) {
  return spawn(
    process.execPath,
    ['--import', script, '-e', `setTimeout(() => {}, ${holdMs})`],
    {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

async function waitForState(path, assertion) {
  const deadline = Date.now() + 1_000;
  let lastState;
  while (Date.now() < deadline) {
    try {
      lastState = await readStackState(path, { allowStarting: true });
      if (assertion(lastState)) return lastState;
    } catch {
      // The participant may not have claimed the state yet.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error(`state condition was not reached: ${JSON.stringify(lastState)}`);
}

test('assert-process-profile fails when the worker fingerprint drifts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-process-profile-'));
  const path = join(directory, 'stack-state.json');
  try {
    await writeStackState(
      {
        APP_ENV: 'e2e',
        CORE_PORT: '4179',
        DATABASE_URL: 'postgres://meiye:meiye@127.0.0.1:54329/meiye_lane79_pair',
        MODEL_EXECUTION_MODE: 'fixture',
        PORT: '3179',
      },
      { path },
    );
    const result = await runAssert({
      APP_ENV: 'development',
      DATABASE_URL: 'postgres://meiye:meiye@127.0.0.1:54329/meiye_lane79_pair',
      MODEL_EXECUTION_MODE: 'direct',
      MEIYE_STACK_STATE_PATH: path,
    });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /API\/worker runtime profile mismatch/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('independent Core and worker transfer ownership and clear after the last participant exits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-process-profile-claim-'));
  const path = join(directory, 'stack-state.json');
  const databaseUrl =
    'postgres://meiye:meiye@127.0.0.1:54329/meiye_independent_pair';
  const env = {
    APP_ENV: 'e2e',
    DATABASE_URL: databaseUrl,
    HARNESS_DBOS_SYSTEM_DATABASE_URL: '',
    JOB_QUEUE_PREFIX: undefined,
    MEIYE_STACK_STATE_PATH: path,
    MODEL_EXECUTION_MODE: 'fixture',
  };
  try {
    const first = spawnProfileProcess(env, 250);
    await waitForState(path, (state) => state.pid === first.pid);
    const second = spawnProfileProcess(env, 600);
    await waitForState(path, (state) => state.participants?.length === 2);
    await new Promise((resolveExit) => first.once('exit', resolveExit));

    const transferred = await waitForState(
      path,
      (state) => state.participants?.length === 1,
    );
    assert.equal(transferred.pid, second.pid);
    assert.equal(transferred.participants[0].pid, second.pid);

    const differentProfile = await runAssert({
      ...env,
      DATABASE_URL:
        'postgres://meiye:meiye@127.0.0.1:54329/meiye_different_pair',
    });
    assert.notEqual(differentProfile.code, 0);
    assert.match(differentProfile.stderr, /runtime profile mismatch/u);

    await new Promise((resolveExit) => second.once('exit', resolveExit));
    await assert.rejects(() => readStackState(path), /no running stack/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('the last independent participant waits through lock contention and eventually clears state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-process-profile-lock-'));
  const path = join(directory, 'stack-state.json');
  const env = {
    APP_ENV: 'e2e',
    DATABASE_URL:
      'postgres://meiye:meiye@127.0.0.1:54329/meiye_contended_pair',
    MEIYE_STACK_STATE_PATH: path,
    MODEL_EXECUTION_MODE: 'fixture',
  };
  let lock;
  let participant;
  try {
    participant = spawnProfileProcess(env, 100);
    await waitForState(path, (state) => state.participants?.length === 1);
    lock = await acquireStackStateLock(path);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 650));
    assert.equal(
      participant.exitCode,
      null,
      'participant must not silently abandon cleanup after the old 500ms limit',
    );
    await lock.release();
    lock = undefined;
    await new Promise((resolveExit) => participant.once('exit', resolveExit));
    await assert.rejects(() => readStackState(path), /no running stack/u);
  } finally {
    await lock?.release();
    participant?.kill('SIGKILL');
    await rm(directory, { force: true, recursive: true });
  }
});
