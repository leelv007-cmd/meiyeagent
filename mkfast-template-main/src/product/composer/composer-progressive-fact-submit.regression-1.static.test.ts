import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const home = readFileSync(
  new URL('./composer-home.tsx', import.meta.url),
  'utf8'
);

// Regression: ISSUE-003 — 先核对信息 accepted clicks with no visible effect
// Found by /qa on 2026-08-19
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-08-19.md
test('progressive fact submit focuses the existing store action', () => {
  assert.match(
    home,
    /onRevealStoreFacts:\s*\(\)\s*=>\s*\{[\s\S]*progressive-fact-store-link[\s\S]*scrollIntoView[\s\S]*focus\(\)/u
  );
  assert.doesNotMatch(home, /setFactReviewRevealed/u);
});
