/**
 * V31-08 Quick Checks CI entry — zero LLM, microsecond behavior gates (§31.1b).
 *
 * This file is the Session-side required CI surface. V31-23 extends the shared
 * registry only; do not fork assertion helpers.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_SIX_PRIMITIVE_ORDER,
  SESSION_SIX_PRIMITIVES,
  createSessionBehaviorQuickCheckRegistry,
  didNotCall,
  getDefaultSessionQuickCheckRegistry,
  maxToolCalls,
  noToolErrors,
  outputExcludes,
  outputIncludes,
  outputMatches,
  resetDefaultSessionQuickCheckRegistryForTests,
  toolOrder,
  type QuickCheckTrace,
} from './quick-checks.js';

test('six primitives catalog is stable (A8)', () => {
  assert.deepEqual([...SESSION_SIX_PRIMITIVES], [
    'read_context',
    'generate',
    'revise',
    'record',
    'check',
    'ask_merchant',
  ]);
});

test('toolOrder accepts subsequence of six-primitive make path', () => {
  const calls = [
    { toolName: 'read_context' },
    { toolName: 'extra_lookup' },
    { toolName: 'generate' },
    { toolName: 'check' },
    { toolName: 'record' },
  ];
  assert.equal(toolOrder(calls, [...CANONICAL_SIX_PRIMITIVE_ORDER]), true);
  assert.equal(toolOrder(calls, ['generate', 'read_context']), false);
});

test('didNotCall negative gate for read-only session', () => {
  const readonlyCalls = [
    { toolName: 'read_context' },
    { toolName: 'generate' },
    { toolName: 'check' },
  ];
  assert.equal(didNotCall(readonlyCalls, 'record'), true);
  assert.equal(
    didNotCall([...readonlyCalls, { toolName: 'record' }], 'record'),
    false,
  );
});

test('maxToolCalls and noToolErrors', () => {
  const calls = [
    { toolName: 'read_context' },
    { toolName: 'generate' },
  ];
  assert.equal(maxToolCalls(calls, 2), true);
  assert.equal(maxToolCalls(calls, 1), false);
  assert.equal(noToolErrors(calls), true);
  assert.equal(
    noToolErrors([{ toolName: 'generate', error: 'boom' }]),
    false,
  );
});

test('output includes / excludes / matches', () => {
  const output = { merchantMessage: '纯文案草稿', action: { kind: 'finish_turn' } };
  assert.equal(outputIncludes(output, '纯文案'), true);
  assert.equal(outputExcludes(output, 'providerSecret'), true);
  assert.equal(outputMatches(output, /finish_turn/), true);
  assert.equal(outputIncludes(output, 'token_cost_usd'), false);
});

test('runMatching supports include/exclude tag filters (V31-23)', () => {
  resetDefaultSessionQuickCheckRegistryForTests();
  const registry = createSessionBehaviorQuickCheckRegistry();
  const makeTrace: QuickCheckTrace = {
    toolCalls: [
      { toolName: 'read_context' },
      { toolName: 'generate' },
      { toolName: 'check' },
      { toolName: 'record' },
    ],
  };
  const withoutReadonly = registry.runMatching(makeTrace, {
    includeTags: ['l0.5'],
    excludeTags: ['readonly'],
  });
  assert.ok(
    withoutReadonly.every((item) => item.id !== 'session.didNotCall.record_readonly'),
  );
  assert.equal(
    withoutReadonly.find((item) => item.id === 'session.toolOrder.canonical_make')
      ?.passed,
    true,
  );
});

test('default session registry gates Level 0 zero-LLM trace', () => {
  resetDefaultSessionQuickCheckRegistryForTests();
  const registry = getDefaultSessionQuickCheckRegistry();
  const level0Trace: QuickCheckTrace = {
    toolCalls: [],
    llmCallCount: 0,
    tags: ['level0'],
    output: { merchantMessage: '已按确定性轻修改处理' },
  };
  const verdicts = registry.runAll(level0Trace);
  const zeroLlm = verdicts.find((item) => item.id === 'session.level0.zero_llm');
  assert.equal(zeroLlm?.passed, true);

  const failed = registry.runAll({
    toolCalls: [],
    llmCallCount: 2,
    tags: ['level0'],
  });
  assert.equal(
    failed.find((item) => item.id === 'session.level0.zero_llm')?.passed,
    false,
  );
});

test('session behavior suite: readonly make-path happy + record rejection', () => {
  const registry = createSessionBehaviorQuickCheckRegistry();

  const happy: QuickCheckTrace = {
    toolCalls: [
      { toolName: 'read_context' },
      { toolName: 'generate' },
      { toolName: 'check' },
      { toolName: 'record' },
    ],
    llmCallCount: 1,
  };
  const happyVerdicts = registry.runAll(happy);
  assert.equal(
    happyVerdicts.find((item) => item.id === 'session.toolOrder.canonical_make')
      ?.passed,
    true,
  );
  // didNotCall.record is expected to FAIL on a make path that records —
  // the readonly tag suite uses runTagged instead.
  assert.equal(
    happyVerdicts.find(
      (item) => item.id === 'session.didNotCall.record_readonly',
    )?.passed,
    false,
  );

  const readonlyTrace: QuickCheckTrace = {
    toolCalls: [
      { toolName: 'read_context' },
      { toolName: 'generate' },
      { toolName: 'check' },
    ],
    llmCallCount: 1,
    tags: ['readonly'],
  };
  const readonlyOnly = registry.runTagged(readonlyTrace, 'readonly');
  assert.ok(readonlyOnly.length >= 1);
  assert.equal(
    readonlyOnly.find(
      (item) => item.id === 'session.didNotCall.record_readonly',
    )?.passed,
    true,
  );
});

test('registry refuses duplicate ids (extension safety for V31-23)', () => {
  const registry = createSessionBehaviorQuickCheckRegistry();
  assert.throws(() =>
    registry.register({
      id: 'session.didNotCall.record_readonly',
      description: 'dup',
      assert: () => ({ id: 'x', passed: true }),
    }),
  );
  // replace path is the intentional extension/update seam
  registry.registerOrReplace({
    id: 'session.ext.v31_23_placeholder',
    description: 'V31-23 will expand here',
    tags: ['v31-23'],
    assert: () => ({ id: 'session.ext.v31_23_placeholder', passed: true }),
  });
  assert.ok(registry.get('session.ext.v31_23_placeholder'));
});
