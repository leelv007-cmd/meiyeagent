/**
 * Regression: ISSUE-004 — getDb must not leak Postgres clients under local SSR,
 * and must not share CF Workers I/O across requests.
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

test('getDb keeps max:1 Hyperdrive clients with idle recycling', () => {
  assert.match(source, /max:\s*1/u);
  assert.match(source, /idle_timeout:\s*5/u);
  assert.match(source, /max_lifetime:\s*60 \* 5/u);
  // Must not cache a process-wide client (CF cross-request I/O ban).
  assert.doesNotMatch(source, /__meiyeDb/u);
  assert.doesNotMatch(source, /globalThis\.__meiye/u);
});

test('V31-50 keeps PostgreSQL failure recovery out of the global database module', () => {
  assert.doesNotMatch(source, /uncaughtException/u);
  assert.doesNotMatch(source, /installPostgresConnectionProcessGuard/u);
  assert.doesNotMatch(source, /attachPostgresClientErrorSink/u);
});
