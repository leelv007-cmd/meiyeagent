/**
 * WORK-01 / R-P1-08: Works is a read-only archive. Server export lives on Result.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const dir = dirname(fileURLToPath(import.meta.url));

test('works detail does not submit result_export', () => {
  const source = readFileSync(join(dir, 'works-detail-page.tsx'), 'utf8');
  assert.doesNotMatch(source, /action:\s*['"]result_export['"]/u);
  assert.doesNotMatch(source, /\bcommandP1\b/);
  assert.match(source, /workResultAction/);
  assert.match(source, /data-result-writer="result"/);
});

test('works list does not submit result_export', () => {
  const source = readFileSync(join(dir, 'works-list-page.tsx'), 'utf8');
  assert.doesNotMatch(source, /action:\s*['"]result_export['"]/u);
  assert.doesNotMatch(source, /\bcommandP1\b/);
});
