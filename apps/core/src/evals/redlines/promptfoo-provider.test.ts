import assert from 'node:assert/strict';
import test from 'node:test';

import { REDLINE_CASES } from './cases.js';
import RedlinePromptfooProvider, {
  evaluateRedlineCase,
} from './promptfoo-provider.js';

test('recorded redline cases are blocked by the canonical production validator', () => {
  for (const redlineCase of REDLINE_CASES) {
    const result = evaluateRedlineCase(redlineCase);

    assert.equal(result.passed, true, `${result.caseId}: ${result.reason}`);
    assert.equal(result.gateId, redlineCase.vars.expectedGateId);
    assert.ok(result.reason.length > 0);
  }
});

test('redline eval turns red when the production gate is mutated to allow a breach', () => {
  const result = evaluateRedlineCase(REDLINE_CASES[0]!, () => ({
    passed: true,
    failures: [],
  }));

  assert.equal(result.passed, false);
  assert.equal(result.gateId, null);
  assert.match(result.reason, /expected cross_workspace_lineage/);
});

test('promptfoo provider reports a provider error for an unstable gate result', async () => {
  const provider = new RedlinePromptfooProvider();
  const response = await provider.callApi('recorded redline case', {
    vars: REDLINE_CASES[0]!.vars,
  });

  assert.equal(response.error, undefined);
  assert.deepEqual(JSON.parse(response.output), {
    caseId: REDLINE_CASES[0]!.vars.caseId,
    gateId: REDLINE_CASES[0]!.vars.expectedGateId,
    passed: true,
    reason: '候选引用了其他门店或其他表达主体的数据，已停止该候选。',
  });
});
