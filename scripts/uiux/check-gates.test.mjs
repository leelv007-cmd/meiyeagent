import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { CHECK_GATES, runGates } from './check-gates.mjs';

test('root check defines all required gates in order', () => {
  assert.deepEqual(
    CHECK_GATES.map(({ name }) => name),
    [
      'workspace checks',
      'locale keys',
      'secret scan',
      'D-123 cost boundary',
      'decision ticket guard',
      'HeroUI mirror guard',
      'works canonical projection guard',
      'retired old-IA route mount guard',
    ]
  );
});

test('a failing gate does not skip the following gate and fails the aggregate', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'check-gates-contract-'));
  const logPath = path.join(rootDir, 'gates.log');
  const gate = (name, status) => ({
    name,
    command: process.execPath,
    args: [
      '-e',
      `require('node:fs').appendFileSync(${JSON.stringify(
        logPath
      )}, ${JSON.stringify(`${name}\n`)}); process.exit(${status})`,
    ],
  });
  const output = [];

  try {
    const status = runGates(
      [gate('first', 0), gate('second', 23), gate('third', 0)],
      { cwd: rootDir, writeLine: (line) => output.push(line) }
    );

    assert.equal(status, 1);
    assert.equal(await readFile(logPath, 'utf8'), 'first\nsecond\nthird\n');
    assert.ok(output.includes('[check] FAIL second (exit 23)'));
    assert.ok(output.includes('[check] PASS third'));
    assert.ok(output.includes('[check] Overall: FAIL'));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
