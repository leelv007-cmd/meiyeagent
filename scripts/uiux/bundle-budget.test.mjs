import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const bundleBudgetScript = fileURLToPath(
  new URL('./bundle-budget.mjs', import.meta.url)
);

test('bundle gate identifies a missing production build as not run', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'bundle-budget-'));
  try {
    const result = spawnSync(process.execPath, [bundleBudgetScript], {
      cwd: fixture,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /"status": "not-run"/u);
    assert.match(result.stdout, /production-build-artifacts-missing/u);
    assert.doesNotMatch(result.stderr, /ENOENT/u);
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
});
