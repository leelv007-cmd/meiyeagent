/**
 * Regression: ISSUE-004 — getDb must not mint a new postgres client per call.
 * Found by /qa on 2026-08-07
 * Report: .gstack/qa-reports/qa-report-localhost-3000-2026-08-07.md
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'index.ts'),
  'utf8',
);

test('getDb reuses one postgres client per isolate (no per-call connect)', () => {
  assert.match(source, /__meiyeDb/u);
  assert.match(source, /__meiyeDbConnectionString/u);
  assert.match(source, /max:\s*1/u);
  // Must short-circuit when the cached client matches the binding.
  assert.match(
    source,
    /g\.__meiyeDb && g\.__meiyeDbConnectionString === connectionString/u,
  );
});
