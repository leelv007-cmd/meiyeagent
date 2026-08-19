import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readStackState, writeStackState } from './stack-state.mjs';

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

test('independent Core and worker share default queue fingerprint and clear the first claim on exit', async () => {
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
    const first = spawn(
      process.execPath,
      ['--import', script, '-e', 'setTimeout(() => {}, 300)'],
      {
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      try {
        await readStackState(path, { allowStarting: true });
        break;
      } catch {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
    }
    const second = await runAssert(env);
    assert.equal(second.code, 0, second.stderr);
    await new Promise((resolveExit) => first.once('exit', resolveExit));
    await assert.rejects(() => readStackState(path), /no running stack/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
