import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  acquireStackStateLock,
  claimStackState,
  createStackStatePayload,
  readStackState,
} from './stack-state.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const stackStateModule = resolve(here, 'stack-state.mjs');
const sampleProfile = {
  APP_ENV: 'e2e',
  DATABASE_URL: 'postgres://meiye:meiye@127.0.0.1:54329/meiye_atomic',
  HARNESS_DBOS_SYSTEM_DATABASE_URL:
    'postgres://meiye:meiye@127.0.0.1:54329/meiye_atomic_dbos',
  MODEL_EXECUTION_MODE: 'fixture',
};

function spawnStaleMutation(operation, path, owner) {
  const source = `
    import { pathToFileURL } from 'node:url';
    const state = await import(pathToFileURL(process.argv[1]));
    const owner = {
      ownerPid: Number(process.env.OWNER_PID),
      ownerToken: process.env.OWNER_TOKEN,
    };
    try {
      const result = process.env.OPERATION === 'write'
        ? await state.writeStackState({
            APP_ENV: 'e2e',
            DATABASE_URL: process.env.DATABASE_URL,
            HARNESS_DBOS_SYSTEM_DATABASE_URL: process.env.DBOS_URL,
            MODEL_EXECUTION_MODE: 'fixture',
          }, { ...owner, path: process.env.STATE_PATH, status: 'ready' })
        : await state.clearStackState(process.env.STATE_PATH, owner);
      process.exit(result === false ? 3 : 0);
    } catch {
      process.exit(2);
    }
  `;
  return spawn(
    process.execPath,
    ['--input-type=module', '-e', source, stackStateModule],
    {
      env: {
        ...process.env,
        DATABASE_URL: sampleProfile.DATABASE_URL,
        DBOS_URL: sampleProfile.HARNESS_DBOS_SYSTEM_DATABASE_URL,
        OPERATION: operation,
        OWNER_PID: String(owner.pid),
        OWNER_TOKEN: owner.ownerToken,
        STATE_PATH: path,
      },
      stdio: 'ignore',
    },
  );
}

function childExit(child) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });
}

test('owner compare and write/delete are serialized against a concurrent owner replacement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-state-cas-'));
  const path = join(directory, 'stack-state.json');
  try {
    const oldOwner = await claimStackState(sampleProfile, {
      path,
      pid: process.pid,
    });
    const lock = await acquireStackStateLock(path);
    const staleWrite = spawnStaleMutation('write', path, oldOwner.payload);
    const staleClear = spawnStaleMutation('clear', path, oldOwner.payload);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    assert.equal(staleWrite.exitCode, null);
    assert.equal(staleClear.exitCode, null);

    const newOwnerToken = randomUUID();
    const newOwnerPid = 424_242;
    const replacement = createStackStatePayload(sampleProfile, {
      ownerToken: newOwnerToken,
      pid: newOwnerPid,
      status: 'starting',
    });
    await writeFile(path, `${JSON.stringify(replacement, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await lock.release();

    assert.notEqual(await childExit(staleWrite), 0);
    assert.notEqual(await childExit(staleClear), 0);
    const current = await readStackState(path, { allowStarting: true });
    assert.equal(current.ownerToken, newOwnerToken);
    assert.equal(current.pid, newOwnerPid);
    assert.equal(current.status, 'starting');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('a live lock owner remains exclusive after the lock is older than thirty seconds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-state-live-lock-'));
  const path = join(directory, 'stack-state.json');
  const lock = await acquireStackStateLock(path);
  let contender;
  try {
    const lockPath = `${path}.lock`;
    const payload = JSON.parse(await readFile(lockPath, 'utf8'));
    payload.createdAt = new Date(Date.now() - 31_000).toISOString();
    await writeFile(lockPath, `${JSON.stringify(payload)}\n`, 'utf8');
    await assert.rejects(
      async () => {
        contender = await acquireStackStateLock(path, { timeoutMs: 100 });
      },
      /Timed out waiting for the stack state lock/u,
    );
  } finally {
    await contender?.release();
    await lock.release();
    await rm(directory, { force: true, recursive: true });
  }
});
