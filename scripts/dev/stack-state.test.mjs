import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  claimStackState,
  clearStackState,
  createStackStatePayload,
  readStackState,
  writeStackState,
} from './stack-state.mjs';

const sampleProfile = {
  APP_ENV: 'e2e',
  CORE_PORT: '4100',
  DATABASE_URL: 'postgres://meiye:meiye@127.0.0.1:54329/meiye_main_runtime_demo',
  HARNESS_DBOS_SYSTEM_DATABASE_URL:
    'postgres://meiye:meiye@127.0.0.1:54329/meiye_main_runtime_demo_dbos',
  JOB_QUEUE_PREFIX: 'meiye-main-runtime-demo',
  MODEL_EXECUTION_MODE: 'fixture',
  PORT: '3000',
};

test('stack state payload carries only non-secret database fingerprints', () => {
  const payload = createStackStatePayload(sampleProfile, { pid: 42 });
  assert.equal(payload.DATABASE_HOST, '127.0.0.1');
  assert.equal(payload.DATABASE_PORT, '54329');
  assert.match(payload.DATABASE_FINGERPRINT, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(payload.HARNESS_DBOS_SYSTEM_DATABASE_HOST, '127.0.0.1');
  assert.equal(payload.HARNESS_DBOS_SYSTEM_DATABASE_PORT, '54329');
  assert.match(
    payload.HARNESS_DBOS_SYSTEM_DATABASE_FINGERPRINT,
    /^sha256:[a-f0-9]{64}$/u,
  );
  assert.equal(payload.DATABASE_URL, undefined);
  assert.equal(payload.HARNESS_DBOS_SYSTEM_DATABASE_URL, undefined);
  assert.equal(payload.CORE_PORT, '4100');
  assert.equal(payload.APP_ENV, 'e2e');
  assert.equal(payload.MODEL_EXECUTION_MODE, 'fixture');
  assert.equal(payload.JOB_QUEUE_PREFIX, 'meiye-main-runtime-demo');
  assert.equal(payload.status, 'ready');
  assert.equal(payload.pid, 42);
  assert.match(payload.startedAt, /^\d{4}-\d{2}-\d{2}T/u);
});

test('readStackState returns fingerprints without persisting database credentials', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-stack-state-'));
  const path = join(directory, 'stack-state.json');
  try {
    await writeStackState(sampleProfile, { path, pid: 7 });
    const state = await readStackState(path);
    assert.match(state.DATABASE_FINGERPRINT, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(state.pid, 7);
    const raw = await readFile(path, 'utf8');
    assert.doesNotMatch(raw, /postgres:|meiye_main_runtime_demo|meiye:meiye/u);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('readStackState refuses starting state unless the caller explicitly accepts it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-stack-state-starting-'));
  const path = join(directory, 'stack-state.json');
  try {
    await writeStackState(sampleProfile, { path, status: 'starting' });
    await assert.rejects(
      () => readStackState(path),
      /stack is starting/u,
    );
    const state = await readStackState(path, { allowStarting: true });
    assert.equal(state.status, 'starting');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('stack state transitions from starting to ready without changing ownership time', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-stack-state-ready-'));
  const path = join(directory, 'stack-state.json');
  const startedAt = '2026-08-19T12:00:00.000Z';
  const readyAt = '2026-08-19T12:00:05.000Z';
  try {
    const starting = await writeStackState(sampleProfile, {
      path,
      startedAt,
      status: 'starting',
    });
    await writeStackState(sampleProfile, {
      ownerPid: starting.pid,
      ownerToken: starting.ownerToken,
      path,
      readyAt,
      startedAt,
      status: 'ready',
    });
    const state = await readStackState(path);
    assert.equal(state.status, 'ready');
    assert.equal(state.startedAt, startedAt);
    assert.equal(state.readyAt, readyAt);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('readStackState reports no running stack when the state file is missing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-stack-state-missing-'));
  const path = join(directory, 'stack-state.json');
  try {
    await assert.rejects(
      () => readStackState(path),
      /no running stack found/u,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('readStackState rejects a corrupt or incomplete state file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-stack-state-bad-'));
  const path = join(directory, 'stack-state.json');
  try {
    await writeFile(path, '{not-json', 'utf8');
    await assert.rejects(
      () => readStackState(path),
      /no running stack found/u,
    );

    await writeFile(path, JSON.stringify({ CORE_PORT: '4100' }), 'utf8');
    await assert.rejects(
      () => readStackState(path),
      /no running stack found/u,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('claimStackState is first-writer-wins', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-stack-state-claim-'));
  const path = join(directory, 'stack-state.json');
  try {
    const first = await claimStackState(sampleProfile, { path, pid: 1 });
    assert.equal(first.claimed, true);
    assert.match(first.ownerToken, /^[0-9a-f-]{36}$/u);
    const second = await claimStackState(
      { ...sampleProfile, APP_ENV: 'development', MODEL_EXECUTION_MODE: 'direct' },
      { path, pid: 2 },
    );
    assert.equal(second.claimed, false);
    assert.equal(second.payload.APP_ENV, 'e2e');
    assert.equal(second.payload.MODEL_EXECUTION_MODE, 'fixture');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('old owners cannot overwrite or clear a newer stack state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-stack-state-owner-'));
  const path = join(directory, 'stack-state.json');
  try {
    const oldOwner = await claimStackState(sampleProfile, { path, pid: 101 });
    assert.equal(
      await clearStackState(path, {
        ownerPid: 101,
        ownerToken: oldOwner.ownerToken,
      }),
      true,
    );
    const newOwner = await claimStackState(sampleProfile, { path, pid: 202 });
    assert.equal(newOwner.claimed, true);

    await assert.rejects(
      () => writeStackState(sampleProfile, { path, status: 'ready' }),
      { code: 'EEXIST' },
    );
    await assert.rejects(
      () => clearStackState(path),
      /stack state owner is required/u,
    );

    await assert.rejects(
      () =>
        writeStackState(sampleProfile, {
          ownerPid: 101,
          ownerToken: oldOwner.ownerToken,
          path,
          status: 'ready',
        }),
      /stack state owner changed/u,
    );
    assert.equal(
      await clearStackState(path, {
        ownerPid: 101,
        ownerToken: oldOwner.ownerToken,
      }),
      false,
    );
    const current = await readStackState(path, { allowStarting: true });
    assert.equal(current.pid, 202);
    assert.equal(current.ownerToken, newOwner.ownerToken);
    assert.equal(current.status, 'starting');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('clearStackState removes the state file for its matching owner', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-stack-state-clear-'));
  const path = join(directory, 'stack-state.json');
  try {
    const state = await writeStackState(sampleProfile, { path });
    await clearStackState(path, {
      ownerPid: state.pid,
      ownerToken: state.ownerToken,
    });
    await assert.rejects(() => readStackState(path), /no running stack found/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
