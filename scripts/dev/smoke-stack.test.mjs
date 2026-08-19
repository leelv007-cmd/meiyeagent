import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  ISOLATED_SMOKE_PREFERRED_CORE_PORT,
  ISOLATED_SMOKE_PREFERRED_WEB_PORT,
  assertSafeTempDatabaseName,
  createIsolatedSmokeDatabaseNames,
  dropIsolatedTempDatabase,
} from './smoke-stack.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const smokeStackScript = resolve(here, 'smoke-stack.mjs');
const SECRET = 'never-print-isolated-smoke';
const SECRET_DATABASE_URL = `postgres://operator:${SECRET}@127.0.0.1:54329/should_not_drop`;

function runPlanOnly(env) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [smokeStackScript], {
      env: {
        ...process.env,
        DATABASE_URL: SECRET_DATABASE_URL,
        HARNESS_DBOS_SYSTEM_DATABASE_URL: `${SECRET_DATABASE_URL}_dbos`,
        LANE79_SMOKE_PLAN_ONLY: '1',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('exit', (code) => resolveRun({ code, output }));
  });
}

test('isolated smoke uses lane-safe temp database names', () => {
  const names = createIsolatedSmokeDatabaseNames({ pid: 4242, stamp: '1700000000000' });
  assert.equal(names.businessName, 'meiye_lane79_smoke_4242_1700000000000');
  assert.equal(names.dbosName, 'meiye_lane79_smoke_4242_1700000000000_dbos');
  assertSafeTempDatabaseName(names.businessName);
  assertSafeTempDatabaseName(names.dbosName);
  assert.equal(ISOLATED_SMOKE_PREFERRED_WEB_PORT, 3179);
  assert.equal(ISOLATED_SMOKE_PREFERRED_CORE_PORT, 4179);
});

test('isolated smoke refuses to drop unrelated databases', async () => {
  await assert.rejects(
    () => dropIsolatedTempDatabase(SECRET_DATABASE_URL, 'meiye'),
    /Refusing to manage non-lane79 temp database meiye/u,
  );
  await assert.rejects(
    () => dropIsolatedTempDatabase(SECRET_DATABASE_URL, 'postgres'),
    /Refusing to manage non-lane79 temp database postgres/u,
  );
  await assert.rejects(
    () => dropIsolatedTempDatabase(SECRET_DATABASE_URL, 'should_not_drop'),
    /Refusing to manage non-lane79 temp database should_not_drop/u,
  );
  await assert.rejects(
    () =>
      dropIsolatedTempDatabase(
        SECRET_DATABASE_URL,
        'meiye_lane79_smoke_1; DROP DATABASE meiye',
      ),
    /Refusing to manage non-lane79 temp database/u,
  );
});

test('isolated smoke plan-only prints lane-safe names without credentials or port 3000', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-isolated-smoke-'));
  try {
    const result = await runPlanOnly({
      LANE79_CORE_PORT: '4179',
      LANE79_WEB_PORT: '3179',
      MEIYE_STACK_STATE_PATH: join(directory, 'stack-state.json'),
    });
    assert.equal(result.code, 0);
    assert.match(result.output, /dev:smoke:isolated plan:/u);
    assert.match(result.output, /meiye_lane79_smoke_\d+_\d+/u);
    assert.match(result.output, /web=3179/u);
    assert.match(result.output, /core=4179/u);
    assert.doesNotMatch(result.output, /\b3000\b/u);
    assert.doesNotMatch(result.output, new RegExp(SECRET, 'u'));
    assert.doesNotMatch(result.output, /postgres:\/\//u);
    assert.doesNotMatch(result.output, /should_not_drop/u);
    assert.doesNotMatch(result.output, /DROP DATABASE/iu);
    assert.doesNotMatch(result.output, /Lane-79 smoke: /u);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
