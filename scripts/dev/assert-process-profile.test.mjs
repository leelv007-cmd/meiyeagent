import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { writeStackState } from './stack-state.mjs';

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

test('assert-process-profile fails when the worker triple drifts', async () => {
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
