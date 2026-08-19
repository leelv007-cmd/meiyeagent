import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  databaseFingerprint,
  parseTapCounts,
  persistenceFileTimeoutMs,
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
  const secret =
    'postgres://encoded%2Duser:p%40ss%2Fword@127.0.0.1:5432/private%2Ddb';
  const output = sanitizeTestOutput(
    `failed user=encoded-user password=p@ss/word database=private-db url=${secret}`,
    [secret],
  );

  assert.doesNotMatch(
    output,
    /encoded-user|p@ss\/word|private-db|encoded%2Duser|p%40ss%2Fword/u,
  );
  assert.match(output, /REDACTED_POSTGRES_URL/u);
});

test('sanitization preserves TAP control syntax for credential-shaped keywords', () => {
  const secret = 'postgres://1:ok@127.0.0.1:5432/pass';
  const output = sanitizeTestOutput(
    `TAP version 13
ok 1 - connected user 1 password ok database pass
1..1
# tests 1
# pass 1
# fail 0
# skipped 0
`,
    [secret],
  );

  assert.doesNotMatch(output, /user 1|password ok|database pass/u);
  assert.deepEqual(parseTapCounts(output), { pass: 1, fail: 0, skip: 0 });
  assertTapStructure(output, {
    failed: 0,
    planned: 1,
    run: 1,
  });
});

test('persistence file timeout is bounded and explicitly calibratable', () => {
  assert.equal(persistenceFileTimeoutMs(undefined), 300_000);
  assert.equal(persistenceFileTimeoutMs('1000'), 1_000);
  assert.equal(persistenceFileTimeoutMs('1800000'), 1_800_000);
  assert.throws(
    () => persistenceFileTimeoutMs('999'),
    /PERSISTENCE_FILE_TIMEOUT_MS must be an integer between/u,
  );
  assert.throws(
    () => persistenceFileTimeoutMs('unbounded'),
    /PERSISTENCE_FILE_TIMEOUT_MS must be an integer between/u,
  );
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

test('runner bounds each file and writes redacted TAP evidence on timeout', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'meiye-runner-timeout-'));
  const binDirectory = path.join(directory, 'bin');
  const evidenceDirectory = path.join(directory, 'evidence');
  const catalogPath = path.join(directory, 'catalog.json');
  const provisionPath = path.join(directory, 'provision.json');
  const descendantPidPath = path.join(directory, 'descendant.pid');
  const businessUrl = 'postgres://1:ok@127.0.0.1:5432/pass';
  const dbosUrl = 'postgres://2:skip@127.0.0.1:5432/fail';
  const commitSha = spawnSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).stdout.trim();
  const file = 'apps/core/src/p1/example.postgres.test.ts';
  await Promise.all([mkdir(binDirectory), mkdir(evidenceDirectory)]);
  await writeFile(
    path.join(binDirectory, 'pnpm'),
    `#!/usr/bin/env bash
(trap '' TERM
 exec >/dev/null 2>&1
 while true; do sleep 1; done) &
printf '%s' "$!" > "$DESCENDANT_PID_PATH"
trap 'exit 0' TERM
printf 'TAP version 13\\n# url=%s\\n' "$TEST_DATABASE_URL"
wait
`,
  );
  await chmod(path.join(binDirectory, 'pnpm'), 0o755);
  await writeFile(
    catalogPath,
    `${JSON.stringify({
      schemaVersion: 'journey-ownership/v1',
      entries: [{ path: file, kind: 'persistence' }],
    })}\n`,
  );
  await writeFile(
    provisionPath,
    `${JSON.stringify({
      schemaVersion: 'persistence-provision/v1',
      provisioner: 'provision-persistence-instrument/v1',
      commitSha,
      provisionId: 'timeout-provision',
      fresh: true,
      provisionedAt: '2026-08-20T00:00:00.000Z',
      databasePair: {
        business: databaseFingerprint(businessUrl),
        dbosSystem: databaseFingerprint(dbosUrl),
      },
      databaseNames: {
        business: 'pass',
        dbosSystem: 'fail',
      },
    })}\n`,
  );

  const startedAt = Date.now();
  let descendantPid;
  try {
    const result = spawnSync(
      process.execPath,
      [
        path.resolve('scripts/ci/run-persistence-evidence-instrument.mjs'),
        'run',
        '--catalog',
        catalogPath,
        '--provision',
        provisionPath,
        '--output-dir',
        evidenceDirectory,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          DESCENDANT_PID_PATH: descendantPidPath,
          PATH: `${binDirectory}:/usr/bin:/bin`,
          PERSISTENCE_FILE_TIMEOUT_MS: '1000',
          RELEASE_COMMIT_SHA: commitSha,
          TEST_DATABASE_URL: businessUrl,
          TEST_DBOS_SYSTEM_DATABASE_URL: dbosUrl,
        },
      },
    );
    const elapsedMs = Date.now() - startedAt;
    descendantPid = Number(await readFile(descendantPidPath, 'utf8'));

    assert.notEqual(result.status, 0);
    assert.ok(elapsedMs < 4_000, `timeout runner took ${elapsedMs}ms`);
    assert.equal(processIsAlive(descendantPid), false);
    const [artifactName] = await readdir(path.join(evidenceDirectory, 'files'));
    const artifact = await readFile(
      path.join(evidenceDirectory, 'files', artifactName),
      'utf8',
    );
    assert.match(
      artifact,
      /not ok 1 - persistence file timed out after 1000 ms/u,
    );
    assert.equal(
      [...artifact.matchAll(/^TAP version 13$/gmu)].length,
      1,
    );
    assert.deepEqual(parseTapCounts(artifact), {
      pass: 0,
      fail: 1,
      skip: 0,
    });
    assertTapStructure(artifact, {
      failed: 1,
      planned: 1,
      run: 1,
    });
    assert.doesNotMatch(artifact, /postgres(?:ql)?:\/\//iu);
    const results = JSON.parse(
      await readFile(path.join(evidenceDirectory, 'results.json'), 'utf8'),
    );
    assert.deepEqual(results.files[0].counts, {
      pass: 0,
      fail: 1,
      skip: 0,
    });
  } finally {
    if (descendantPid && processIsAlive(descendantPid)) {
      process.kill(descendantPid, 'SIGKILL');
    }
  }
});

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function assertTapStructure(tap, expected) {
  const parser = spawnSync(
    'perl',
    [
      '-MTAP::Parser',
      '-e',
      'my $tap = do { local $/; <STDIN> }; my $p = TAP::Parser->new({ tap => $tap }); 1 while $p->next; print join(q{,}, $p->tests_planned, $p->tests_run, scalar($p->failed), scalar($p->parse_errors));',
    ],
    { encoding: 'utf8', input: tap },
  );
  assert.equal(parser.status, 0, parser.stderr);
  assert.equal(
    parser.stdout,
    `${expected.planned},${expected.run},${expected.failed},0`,
  );
}

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
      [[ ! -e "$1" ]] || exit 44
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
  assert.equal(
    (await readdir(directory)).some((name) =>
      name.startsWith('meiye-persistence-pair.')
    ),
    false
  );
});
