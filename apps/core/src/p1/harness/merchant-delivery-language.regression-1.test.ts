import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentPrimitiveExecutionError } from '../agent-primitives/foundation-module.js';
import { StructuredNodeRunError } from '../model-supply/structured-node-runner.js';
import { merchantFailureReport } from './merchant-delivery-language.js';
import { normalizeHarnessTerminalFailure } from './terminal-failure.js';

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
    'AGENT_PRIMITIVE_EXECUTION_UNCERTAIN',
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

/**
 * 失败档 production wrap (live e2e audit payload):
 * FixtureRejectedBeforeAcceptanceError → StructuredNodeRunError →
 * AgentPrimitiveExecutionError (code AGENT_PRIMITIVE_EXECUTION_UNCERTAIN).
 * readTerminalFailure prefixes CONTENT_PACKAGE_REVISION_CONFLICT then
 * spreads payload, so `code` stays AGENT_PRIMITIVE_EXECUTION_UNCERTAIN
 * and `acceptance` rides the cause chain. `reason` is never persisted.
 */
function persistedFixtureRejectBeforeAccept(quotaRefunded: boolean) {
  return {
    code: 'CONTENT_PACKAGE_REVISION_CONFLICT',
    ...normalizeHarnessTerminalFailure(
      new AgentPrimitiveExecutionError(
        new StructuredNodeRunError('failed', 'rejected_before_accept'),
      ),
    ),
    quotaRefunded,
  } as Record<string, unknown>;
}

test('a fixture provider reject-before-accept offers 再生成一次 as a new submit', () => {
  const currentFailure = persistedFixtureRejectBeforeAccept(true);
  assert.equal(currentFailure.code, 'AGENT_PRIMITIVE_EXECUTION_UNCERTAIN');
  assert.equal(currentFailure.acceptance, 'rejected_before_accept');
  assert.equal('reason' in currentFailure, false);

  const report = merchantFailureReport(currentFailure);
  assert.equal(report.kind, 'failure');
  assert.equal(report.category, 'content_source');
  assert.equal(report.actions.includes('retry'), true);
  assert.equal(report.actions.includes('adjust_intent'), true);
});

test('acceptance_unknown structured failures still return to the workbench without retry', () => {
  const report = merchantFailureReport({
    code: 'CONTENT_PACKAGE_REVISION_CONFLICT',
    ...normalizeHarnessTerminalFailure(
      new AgentPrimitiveExecutionError(
        new StructuredNodeRunError('unknown', 'acceptance_unknown'),
      ),
    ),
    quotaRefunded: true,
  });
  assert.equal(report.actions.includes('retry'), false);
  assert.equal(report.actions.includes('adjust_intent'), true);
  assert.match(report.nextStep, /返回工作台/u);
});
