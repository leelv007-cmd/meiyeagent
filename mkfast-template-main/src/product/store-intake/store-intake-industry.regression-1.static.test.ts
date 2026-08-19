import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wizard = readFileSync(
  new URL('./store-intake-wizard.tsx', import.meta.url),
  'utf8'
);

// Regression: ISSUE-006 — selected store industry was not persisted
// Found by /qa on 2026-08-19
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-08-19.md
test('industry selection enters the confirmed draft and reloads from profile', () => {
  assert.match(
    wizard,
    /answerProgressiveFact\(\s*current\.draft,\s*'industry',\s*nextIndustry\s*\)/u
  );
  assert.match(wizard, /if \(!store\?\.industry/u);
  assert.match(wizard, /setIndustry\(store\.industry\)/u);
});
