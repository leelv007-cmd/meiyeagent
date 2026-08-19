import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('real provision script keeps every PostgreSQL URI out of descendant argv', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'meiye-real-provision-'));
  const binDirectory = path.join(directory, 'bin');
  const psqlLog = path.join(directory, 'psql.log');
  const pnpmLog = path.join(directory, 'pnpm.log');
  const statePath = path.join(directory, 'databases.state');
  await mkdir(binDirectory);
  const psqlPath = path.join(binDirectory, 'psql');
  const pnpmPath = path.join(binDirectory, 'pnpm');
  await writeFile(
    psqlPath,
    `#!/bin/bash
input="$(cat)"
printf 'argv=%s database=%s host=%s port=%s user=%s password_set=%s sslmode=%s input=%s\\n' \
  "$*" "$PGDATABASE" "$PGHOST" "$PGPORT" "$PGUSER" "\${PGPASSWORD:+yes}" "\${PGSSLMODE:-}" "$input" >> "$PSQL_ARGV_LOG"
if [[ "$*" == *"SELECT 1"* ]]; then
  grep -Fxq "$PGDATABASE" "$PSQL_STATE" 2>/dev/null && { printf '1\\n'; exit 0; }
  exit 1
fi
if [[ "$input" == *"CREATE DATABASE"* ]]; then
  for argument in "$@"; do
    [[ "$argument" == --set=db_name=* ]] && printf '%s\\n' "\${argument#--set=db_name=}" >> "$PSQL_STATE"
  done
  exit 0
fi
if [[ "$*" == *"to_regclass"* ]]; then
  printf 'session\\n'
fi
`
  );
  await writeFile(
    pnpmPath,
    `#!/bin/bash
printf 'argv=%s database_url_set=%s\\n' "$*" "\${DATABASE_URL:+yes}" >> "$PNPM_ARGV_LOG"
exit 0
`
  );
  await Promise.all([chmod(psqlPath, 0o755), chmod(pnpmPath, 0o755)]);

  const result = spawnSync(
    '/bin/bash',
    [path.resolve('scripts/ci/provision-test-db.sh')],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDirectory}:${path.dirname(process.execPath)}:${process.env.PATH}`,
        PNPM_ARGV_LOG: pnpmLog,
        PSQL_ARGV_LOG: psqlLog,
        PSQL_STATE: statePath,
        TEST_DATABASE_URL:
          'postgres://meiye:business-secret@127.0.0.1:5432/business_fixture',
        TEST_DBOS_SYSTEM_DATABASE_URL:
          'postgres://meiye:dbos-secret@127.0.0.1:5432/dbos_fixture',
      },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const psqlCalls = await readFile(psqlLog, 'utf8');
  const pnpmCalls = await readFile(pnpmLog, 'utf8');
  assert.doesNotMatch(psqlCalls, /postgres(?:ql)?:\/\//iu);
  assert.doesNotMatch(psqlCalls, /business-secret|dbos-secret/u);
  assert.doesNotMatch(pnpmCalls, /postgres(?:ql)?:\/\//iu);
  assert.match(psqlCalls, /database=business_fixture/u);
  assert.match(psqlCalls, /database=dbos_fixture/u);
  assert.match(psqlCalls, /database=postgres/u);
  assert.match(psqlCalls, /password_set=yes/u);
  assert.match(pnpmCalls, /database_url_set=yes/u);
});
