import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('./workflow-core.ts', import.meta.url),
  'utf8'
);

// Regression: ISSUE-007 — bounded continuation leaked server-policy wording
// Found by /qa on 2026-08-19
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-08-19.md
test('bounded continuation uses merchant language and normalizes punctuation', () => {
  assert.doesNotMatch(workflow, /具体上限由服务端策略决定/u);
  assert.doesNotMatch(workflow, /不接受前台传入数值/u);
  assert.match(workflow, /label: canContinue \? '继续完善'/u);
  assert.match(workflow, /merchantClause\(suspension\.unmetExplanation\)/u);
  assert.ok(
    workflow.includes("return value.trim().replace(/[。！？!?]+$/u, '');")
  );
});
