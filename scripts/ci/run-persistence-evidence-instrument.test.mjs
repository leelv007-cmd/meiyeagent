import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
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
