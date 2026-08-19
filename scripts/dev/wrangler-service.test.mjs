import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const wrapper = resolve(
  repoRoot,
  'mkfast-template-main/scripts/e2e/run-wrangler-service.mjs',
);

async function createFixture(directory) {
  const fixture = join(directory, 'wrangler-fixture');
  await writeFile(
    fixture,
    [
      '#!/usr/bin/env node',
      "const mode = process.env.FIXTURE_MODE ?? 'normal';",
      'process.stdout.write(JSON.stringify({ envFile: process.argv[2], pid: process.pid }) + "\\n");',
      "for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));",
      "if (mode === 'normal') setTimeout(() => process.exit(0), 80);",
      'else setInterval(() => {}, 1000);',
    ].join('\n'),
    'utf8',
  );
  await chmod(fixture, 0o700);
  return fixture;
}

function spawnWrapper(root, fixture, extraEnv = {}) {
  return spawn(process.execPath, [wrapper], {
    cwd: resolve(repoRoot, 'mkfast-template-main'),
    env: {
      ...process.env,
      DATABASE_URL:
        'postgres://operator:wrangler-never-in-argv@127.0.0.1:54329/meiye',
      MEIYE_WRANGLER_TEST_COMMAND: fixture,
      MEIYE_WRANGLER_TEMP_PREFIX: join(root, 'runtime-'),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function firstJsonLine(child) {
  return new Promise((resolveLine, reject) => {
    let buffer = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline >= 0) resolveLine(JSON.parse(buffer.slice(0, newline)));
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (!buffer.includes('\n')) {
        reject(new Error(`wrapper exited ${code}: ${stderr}`));
      }
    });
  });
}

function exitCode(child) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolveExit) => child.once('exit', resolveExit));
}

async function assertRootEmpty(root) {
  assert.deepEqual(await readdir(root), ['wrangler-fixture']);
}

test('Wrangler wrapper uses a 0600 env file, hides secrets from argv, and cleans on success', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meiye-wrangler-success-'));
  const fixture = await createFixture(root);
  const child = spawnWrapper(root, fixture);
  try {
    const report = await firstJsonLine(child);
    assert.equal((await stat(report.envFile)).mode & 0o777, 0o600);
    assert.match(await readFile(report.envFile, 'utf8'), /wrangler-never-in-argv/u);
    for (const pid of [child.pid, report.pid]) {
      const { stdout } = await execFileAsync(
        'ps',
        ['-ww', '-p', String(pid), '-o', 'command='],
        { encoding: 'utf8' },
      );
      assert.doesNotMatch(stdout, /wrangler-never-in-argv|postgres:\/\//u);
    }
    assert.equal(await exitCode(child), 0);
    await assertRootEmpty(root);
  } finally {
    child.kill('SIGKILL');
    await rm(root, { force: true, recursive: true });
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`Wrangler wrapper cleans its env file after ${signal}`, async () => {
    const root = await mkdtemp(join(tmpdir(), `meiye-wrangler-${signal}-`));
    const fixture = await createFixture(root);
    const child = spawnWrapper(root, fixture, { FIXTURE_MODE: 'wait' });
    try {
      const report = await firstJsonLine(child);
      assert.equal((await stat(report.envFile)).mode & 0o777, 0o600);
      child.kill(signal);
      assert.equal(await exitCode(child), 0);
      await assertRootEmpty(root);
    } finally {
      child.kill('SIGKILL');
      await rm(root, { force: true, recursive: true });
    }
  });
}

for (const [name, extraEnv] of [
  ['synchronous spawn failure', { MEIYE_WRANGLER_TEST_SYNC_SPAWN_FAILURE: 'true' }],
  ['asynchronous spawn failure', { MEIYE_WRANGLER_TEST_COMMAND: '/missing/wrangler-command' }],
  ['env-file write failure', { MEIYE_WRANGLER_ENV_FILE_BASENAME: 'missing/runtime.env' }],
]) {
  test(`Wrangler wrapper cleans after ${name}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'meiye-wrangler-failure-'));
    const fixture = await createFixture(root);
    const child = spawnWrapper(root, fixture, extraEnv);
    try {
      assert.notEqual(await exitCode(child), 0);
      await assertRootEmpty(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
}
