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

test('stack state payload carries the runtime database URLs', () => {
  const payload = createStackStatePayload(sampleProfile, { pid: 42 });
  assert.equal(payload.DATABASE_URL, sampleProfile.DATABASE_URL);
  assert.equal(
    payload.HARNESS_DBOS_SYSTEM_DATABASE_URL,
    sampleProfile.HARNESS_DBOS_SYSTEM_DATABASE_URL,
  );
  assert.equal(payload.CORE_PORT, '4100');
  assert.equal(payload.APP_ENV, 'e2e');
  assert.equal(payload.MODEL_EXECUTION_MODE, 'fixture');
  assert.equal(payload.JOB_QUEUE_PREFIX, 'meiye-main-runtime-demo');
  assert.equal(payload.status, 'ready');
  assert.equal(payload.pid, 42);
  assert.match(payload.startedAt, /^\d{4}-\d{2}-\d{2}T/u);
});

test('readStackState returns the running stack database when present', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-stack-state-'));
  const path = join(directory, 'stack-state.json');
  try {
    await writeStackState(sampleProfile, { path, pid: 7 });
    const state = await readStackState(path);
    assert.equal(state.DATABASE_URL, sampleProfile.DATABASE_URL);
    assert.equal(state.pid, 7);
    const raw = await readFile(path, 'utf8');
    assert.match(raw, /meiye_main_runtime_demo/);
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
    await writeStackState(sampleProfile, {
      path,
      startedAt,
      status: 'starting',
    });
    await writeStackState(sampleProfile, {
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

test('clearStackState removes the state file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-stack-state-clear-'));
  const path = join(directory, 'stack-state.json');
  try {
    await writeStackState(sampleProfile, { path });
    await clearStackState(path);
    await assert.rejects(() => readStackState(path), /no running stack found/u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
