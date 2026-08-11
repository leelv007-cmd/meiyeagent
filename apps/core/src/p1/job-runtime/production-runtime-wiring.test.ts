import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production assembly owns one pg-boss job runtime', async () => {
  const source = await readFile(
    new URL('../../assembly/core-assembly.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /const jobRuntime = PgBossJobPort\.connect\(/u);
  assert.equal(source.match(/PgBossJobPort\.connect\(/gu)?.length, 1);
});
