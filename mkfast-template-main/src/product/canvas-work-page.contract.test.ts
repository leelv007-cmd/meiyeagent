import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the merchant canvas page does not expose the internal Work evidence block', () => {
  const source = readFileSync(
    new URL('./canvas-work-page.tsx', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(source, /<ObjectEvidence\b/u);
  assert.doesNotMatch(source, /kind=["']Work["']/u);
  assert.doesNotMatch(source, /object_evidence_source_canvas/u);
});
