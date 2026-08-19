import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { spawnDatabaseProvision } from './database-provision.mjs';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const provisionScript = resolve(here, '../ci/provision-test-db.sh');

test('database provision passes connection URIs through env, never child argv', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-provision-env-'));
  const fixture = join(directory, 'provision-fixture.mjs');
  const businessUrl =
    'postgres://business:never-print-business@127.0.0.1:54329/meiye_business';
  const dbosUrl =
    'postgres://dbos:never-print-dbos@127.0.0.1:54329/meiye_dbos';
  try {
    await writeFile(
      fixture,
      [
        '#!/usr/bin/env node',
        "if (!process.env.TEST_DATABASE_URL || !process.env.TEST_DBOS_SYSTEM_DATABASE_URL) process.exit(65);",
        "process.stdout.write('ready\\n');",
        'setInterval(() => {}, 1000);',
      ].join('\n'),
      'utf8',
    );
    await chmod(fixture, 0o700);
    const child = spawnDatabaseProvision(
      {
        DATABASE_URL: businessUrl,
        HARNESS_DBOS_SYSTEM_DATABASE_URL: dbosUrl,
      },
      { cwd: directory, scriptPath: fixture, stdio: ['ignore', 'pipe', 'pipe'] },
    );
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
    assert.doesNotMatch(commandLine, /never-print-business|never-print-dbos/u);
    child.kill('SIGTERM');
    await new Promise((resolveExit) => child.once('exit', resolveExit));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('provision shell refuses positional database URIs without echoing them', async () => {
  const businessUrl =
    'postgres://business:never-print-business@127.0.0.1:54329/meiye_business';
  const dbosUrl =
    'postgres://dbos:never-print-dbos@127.0.0.1:54329/meiye_dbos';
  const result = await new Promise((resolveRun) => {
    const child = spawn(provisionScript, [businessUrl, dbosUrl], {
      env: { ...process.env, TEST_DATABASE_URL: '', TEST_DBOS_SYSTEM_DATABASE_URL: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.once('exit', (code) => resolveRun({ code, output }));
  });
  assert.equal(result.code, 64);
  assert.match(result.output, /environment variables/u);
  assert.doesNotMatch(result.output, /never-print-business|never-print-dbos/u);
});

test('provision shell keeps database URIs out of every child argv', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-provision-children-'));
  const binDirectory = join(directory, 'bin');
  const argvLog = join(directory, 'argv.log');
  const businessUrl =
    'postgres://business:never-print-business@127.0.0.1:54329/meiye_business';
  const dbosUrl =
    'postgres://dbos:never-print-dbos@127.0.0.1:54329/meiye_dbos';
  try {
    await writeFile(argvLog, '', 'utf8');
    await mkdir(binDirectory, { recursive: true });
    await symlink(process.execPath, join(binDirectory, 'node'));
    const fakePsql = join(binDirectory, 'psql');
    const fakePnpm = join(binDirectory, 'pnpm');
    await writeFile(
      fakePsql,
      [
        '#!/bin/sh',
        'printf "psql %s\\n" "$*" >> "$ARGV_LOG"',
        'case "$*" in *to_regclass*) printf "session\\n" ;; esac',
      ].join('\n'),
      'utf8',
    );
    await writeFile(
      fakePnpm,
      ['#!/bin/sh', 'printf "pnpm %s\\n" "$*" >> "$ARGV_LOG"'].join('\n'),
      'utf8',
    );
    await Promise.all([chmod(fakePsql, 0o700), chmod(fakePnpm, 0o700)]);

    const result = await new Promise((resolveRun) => {
      const child = spawn(provisionScript, [], {
        env: {
          ...process.env,
          ARGV_LOG: argvLog,
          PATH: `${binDirectory}:/usr/bin:/bin`,
          TEST_DATABASE_URL: businessUrl,
          TEST_DBOS_SYSTEM_DATABASE_URL: dbosUrl,
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
      child.once('exit', (code) => resolveRun({ code, output }));
    });
    assert.equal(result.code, 0, result.output);
    const childArgv = await readFile(argvLog, 'utf8');
    assert.doesNotMatch(
      childArgv,
      /never-print-business|never-print-dbos|postgres:\/\//u,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
