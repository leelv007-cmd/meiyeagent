import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
