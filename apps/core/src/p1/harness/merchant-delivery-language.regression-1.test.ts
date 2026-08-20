import assert from 'node:assert/strict';
import test from 'node:test';

import { merchantFailureReport } from './merchant-delivery-language.js';

// Regression: ISSUE-008 — failed runs exposed a retired in-place retry
// Found by /qa on 2026-08-19
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-08-19.md
test('failure reports return to editable work without offering retry', () => {
  const codes = [
    'MEDIA_EXACT_TEXT_VERIFICATION_FAILED',
    'MEDIA_GENERATION_FAILED',
    'HARNESS_MEDIA_SCOPE_INVALID',
    'WORK_EXECUTION_STALLED',
    'TIMEOUT',
    'CONTENT_PACKAGE_REVISION_CONFLICT',
    'HARNESS_WORKFLOW_FAILED',
    'STRUCTURED_NODE_RUN_FAILED',
  ];

  for (const code of codes) {
    const report = merchantFailureReport({ code, quotaRefunded: true });
    assert.equal(report.kind, 'failure');
    assert.equal(report.actions.includes('retry'), false, code);
    assert.equal(report.actions.includes('adjust_intent'), true, code);
    assert.match(report.nextStep, /返回工作台/u, code);
  }
});

test('a content-source block offers 再生成一次 as a new frozen-intent submit', () => {
  const report = merchantFailureReport({
    code: 'HARNESS_ALL_CANDIDATES_BLOCKED',
    gateIds: ['critical_fact_source'],
    quotaRefunded: true,
  });
  assert.equal(report.kind, 'failure');
  assert.equal(report.category, 'content_source');
  assert.equal(report.actions.includes('retry'), true);
  assert.equal(report.actions.includes('adjust_intent'), true);
});

test('critical_fact_source still offers 再生成一次 when the terminal code is not the selection error', () => {
  const report = merchantFailureReport({
    code: 'STRUCTURED_NODE_RUN_FAILED',
    gateIds: ['critical_fact_source'],
    quotaRefunded: true,
  });
  assert.equal(report.kind, 'failure');
  assert.equal(report.category, 'content_source');
  assert.equal(report.actions.includes('retry'), true);
  assert.equal(report.actions.includes('adjust_intent'), true);
});
