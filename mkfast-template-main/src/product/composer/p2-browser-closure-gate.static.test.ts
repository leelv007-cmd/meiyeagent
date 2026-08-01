import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('#323 browser gate requires paid-media confirmation before AI cover execution', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'tests/e2e/specs/p2-browser-closure.spec.ts'),
    'utf8'
  );
  const start = source.indexOf(
    "test('delivered AI cover exposes five presets, signed ratios, style-role analysis, and a Result image'"
  );
  const end = source.indexOf(
    "test('viral chip uses honest paste fallback",
    start
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const aiCoverJourney = source.slice(start, end);

  assert.match(
    aiCoverJourney,
    /await expect\(executionConfirm\)\.toBeVisible\(\{\s*timeout:\s*60_000,?\s*\}\)/u
  );
  assert.match(
    aiCoverJourney,
    /await executionConfirm\.getByRole\('button', \{ name: '确认执行' \}\)\.click\(\)/u
  );
  assert.doesNotMatch(
    aiCoverJourney,
    /executionConfirm\.isVisible[\s\S]*?catch\(\(\) => false\)/u
  );
});
