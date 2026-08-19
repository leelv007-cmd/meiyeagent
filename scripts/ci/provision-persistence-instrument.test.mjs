import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cliPath = path.resolve('scripts/ci/provision-persistence-instrument.mjs');

test('provisioner rejects an existing database before producing a receipt', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'meiye-provision-control-')
  );
  const psqlPath = path.join(directory, 'psql');
  const receiptPath = path.join(directory, 'receipt.json');
  const envPath = path.join(directory, 'pair.env');
  await writeFile(
    psqlPath,
    '#!/usr/bin/env bash\nprintf "meiye_instrument_business_control\\n"\n'
  );
  await chmod(psqlPath, 0o755);

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      '--admin-url',
      'postgres://tester:secret@127.0.0.1:5432/postgres',
      '--commit-sha',
      'a'.repeat(40),
      '--provision-id',
      'control',
      '--receipt',
      receiptPath,
      '--env-output',
      envPath,
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already exists/u);
  await assert.rejects(readFile(receiptPath), /ENOENT/u);
  await assert.rejects(readFile(envPath), /ENOENT/u);
  assert.doesNotMatch(result.stderr, /tester:secret/u);
});

test('provisioner creates unique databases before emitting a secret-free receipt', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'meiye-provision-success-')
  );
  const binDirectory = path.join(directory, 'bin');
  const scriptDirectory = path.join(directory, 'scripts', 'ci');
  const psqlPath = path.join(binDirectory, 'psql');
  const provisionPath = path.join(scriptDirectory, 'provision-test-db.sh');
  const callLog = path.join(directory, 'psql.log');
  const receiptPath = path.join(directory, 'receipt.json');
  const envPath = path.join(directory, 'pair.env');
  await Promise.all([
    mkdir(binDirectory, { recursive: true }),
    mkdir(scriptDirectory, { recursive: true }),
  ]);
  await writeFile(
    psqlPath,
    `#!/usr/bin/env bash
input="$(cat)"
printf '%s %s\\n' "$*" "$input" >> "$PSQL_CALL_LOG"
if [[ "$*" == *"SELECT current_database()"* ]]; then
  url="$1"
  printf '%s\\n' "\${url##*/}"
fi
`
  );
  await writeFile(provisionPath, '#!/usr/bin/env bash\nexit 0\n');
  await Promise.all([chmod(psqlPath, 0o755), chmod(provisionPath, 0o755)]);

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      '--admin-url',
      'postgres://tester:secret@127.0.0.1:5432/postgres',
      '--commit-sha',
      'b'.repeat(40),
      '--provision-id',
      'unique-control',
      '--receipt',
      receiptPath,
      '--env-output',
      envPath,
    ],
    {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDirectory}:${process.env.PATH}`,
        PSQL_CALL_LOG: callLog,
      },
    }
  );

  assert.equal(result.status, 0, result.stderr);
  const receiptText = await readFile(receiptPath, 'utf8');
  const receipt = JSON.parse(receiptText);
  assert.equal(receipt.provisioner, 'provision-persistence-instrument/v1');
  assert.equal(receipt.fresh, true);
  assert.notEqual(
    receipt.databaseNames.business,
    receipt.databaseNames.dbosSystem
  );
  assert.doesNotMatch(receiptText, /tester|secret|postgres:\/\//u);
  const calls = await readFile(callLog, 'utf8');
  assert.match(calls, /CREATE DATABASE/u);
  assert.match(calls, new RegExp(receipt.databaseNames.business, 'u'));
  assert.match(calls, new RegExp(receipt.databaseNames.dbosSystem, 'u'));
});
