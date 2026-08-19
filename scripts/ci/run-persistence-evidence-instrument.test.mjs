import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  parseTapCounts,
  sanitizeTestOutput,
} from './run-persistence-evidence-instrument.mjs';

test('parseTapCounts reads authoritative per-file TAP totals', () => {
  assert.deepEqual(
    parseTapCounts(`TAP version 13
ok 1 - persists
ok 2 - recovers
1..2
# tests 2
# pass 2
# fail 0
# skipped 0
`),
    { pass: 2, fail: 0, skip: 0 }
  );
});

test('parseTapCounts returns zero contribution when a file emits no TAP summary', () => {
  assert.deepEqual(parseTapCounts('TAP version 13\n1..0\n'), {
    pass: 0,
    fail: 0,
    skip: 0,
  });
});

test('sanitizeTestOutput removes database connection strings before artifact write', () => {
  const secret = 'postgres://tester:secret@127.0.0.1:5432/private_db';
  const output = sanitizeTestOutput(`failed to connect ${secret}`, [secret]);

  assert.doesNotMatch(output, /tester|secret|private_db/u);
  assert.match(output, /REDACTED_POSTGRES_URL/u);
});

test('runner refuses to self-sign freshness without a provision receipt', async () => {
  const outputDirectory = await mkdtemp(
    path.join(tmpdir(), 'meiye-runner-receipt-')
  );
  const result = spawnSync(
    process.execPath,
    [
      path.resolve('scripts/ci/run-persistence-evidence-instrument.mjs'),
      'run',
      '--output-dir',
      outputDirectory,
    ],
    { encoding: 'utf8' }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--provision requires a value/u);
});

test('shell orchestration keeps the admin PostgreSQL URI out of Node argv', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'meiye-shell-argv-'));
  const binDirectory = path.join(directory, 'bin');
  const evidenceDirectory = path.join(directory, 'evidence');
  const argvLog = path.join(directory, 'node-argv.log');
  await Promise.all([mkdir(binDirectory), mkdir(evidenceDirectory)]);
  const nodeStub = path.join(binDirectory, 'node');
  const pnpmStub = path.join(binDirectory, 'pnpm');
  await writeFile(
    nodeStub,
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$NODE_ARGV_LOG"
if [[ "$1" == "scripts/ci/provision-persistence-instrument.mjs" ]]; then
  while [[ "$#" -gt 0 ]]; do
    if [[ "$1" == "--env-output" ]]; then
      shift
      printf '%s\\n' '{"TEST_DATABASE_URL":"postgres://local/business","TEST_DBOS_SYSTEM_DATABASE_URL":"postgres://local/dbos"}' > "$1"
      break
    fi
    shift
  done
elif [[ "$*" == *"p.TEST_DATABASE_URL"* ]]; then
  printf '%s' 'postgres://local/business'
elif [[ "$*" == *"p.TEST_DBOS_SYSTEM_DATABASE_URL"* ]]; then
  printf '%s' 'postgres://local/dbos'
fi
`
  );
  await writeFile(pnpmStub, '#!/usr/bin/env bash\nexit 0\n');
  await Promise.all([chmod(nodeStub, 0o755), chmod(pnpmStub, 0o755)]);

  const result = spawnSync(
    '/bin/bash',
    [path.resolve('scripts/ci/run-persistence-evidence-instrument.sh')],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        CI_EVIDENCE_DIR: evidenceDirectory,
        NODE_ARGV_LOG: argvLog,
        PATH: `${binDirectory}:/usr/bin:/bin`,
        PERSISTENCE_POSTGRES_ADMIN_URL:
          'postgres://admin:top-secret@127.0.0.1:5432/postgres',
        RELEASE_COMMIT_SHA: 'c'.repeat(40),
        TMPDIR: directory,
      },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const argv = await readFile(argvLog, 'utf8');
  assert.doesNotMatch(argv, /postgres(?:ql)?:\/\//iu);
  assert.doesNotMatch(argv, /top-secret/u);
  assert.doesNotMatch(argv, /--admin-url/u);
});
