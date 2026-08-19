import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { postgresProcessEnv } from './postgres-process.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('postgres process env carries credentials without exposing them in argv', async () => {
  const connectionUrl =
    'postgres://operator:never-print-postgres@127.0.0.1:54329/meiye_runtime';
  const source = `
    const keys = ['PGDATABASE', 'PGHOST', 'PGPASSWORD', 'PGPORT', 'PGUSER'];
    if (keys.some((key) => process.env[key] !== process.env['EXPECTED_' + key])) {
      process.exit(65);
    }
    process.stdout.write('ready\\n');
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ['-e', source], {
    env: postgresProcessEnv(connectionUrl, {
      EXPECTED_PGDATABASE: 'meiye_runtime',
      EXPECTED_PGHOST: '127.0.0.1',
      EXPECTED_PGPASSWORD: 'never-print-postgres',
      EXPECTED_PGPORT: '54329',
      EXPECTED_PGUSER: 'operator',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolveReady, reject) => {
      child.stdout.once('data', resolveReady);
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`fixture exited ${code}`)));
    });
    const { stdout: commandLine } = await execFileAsync(
      'ps',
      ['-ww', '-p', String(child.pid), '-o', 'command='],
      { encoding: 'utf8' },
    );
    assert.doesNotMatch(commandLine, /never-print-postgres|postgres:\/\//u);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolveExit) => child.once('exit', resolveExit));
  }
});

test('explicit rotated credentials override URL defaults without entering argv', () => {
  const env = postgresProcessEnv(
    'postgres://rotation-role@127.0.0.1:54329/meiye_runtime',
    { PGPASSWORD: 'rotated-secret-from-env' },
  );
  assert.equal(env.PGUSER, 'rotation-role');
  assert.equal(env.PGPASSWORD, 'rotated-secret-from-env');
});

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (['.mjs', '.mts', '.ts'].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

test('repository PostgreSQL launch sites keep connection URLs out of argv and command strings', async () => {
  const roots = [
    resolve(repoRoot, 'scripts'),
    resolve(repoRoot, 'mkfast-template-main/playwright.config.ts'),
    resolve(repoRoot, 'mkfast-template-main/tests/e2e/specs'),
  ];
  const files = [];
  for (const root of roots) {
    if (extname(root)) files.push(root);
    else files.push(...(await sourceFiles(root)));
  }
  const violations = [];
  const forbidden = [
    /(?:execFileSync|execFileAsync|run)\(\s*['"](?:psql|pg_dump|pg_restore)['"]\s*,\s*\[\s*(?:[a-zA-Z]+Url|databaseUrl)/su,
    /['"](?:-d|--dbname)['"]\s*,\s*[a-zA-Z]+Url/su,
    /(?:TEST_DATABASE_URL|TEST_DBOS_SYSTEM_DATABASE_URL|DATABASE_URL)=['"]?\$\{/u,
    /--var DATABASE_URL:\$\{/u,
  ];
  for (const path of files) {
    if (/\.test\.[cm]?[jt]s$/u.test(path)) continue;
    const source = await readFile(path, 'utf8');
    if (forbidden.some((pattern) => pattern.test(source))) {
      violations.push(path.slice(repoRoot.length + 1));
    }
  }
  assert.deepEqual(violations, []);
});
