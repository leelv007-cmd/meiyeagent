/**
 * V31-08 Progressive Level 0–3 + billing UX + turn-runner shortcuts.
 *
 * Acceptance:
 * - Level 0 zero LLM (llmCallCount === 0; kernel never invoked)
 * - Level 1 pure copy: interpreting → handing_off
 * - A13 pure-copy boundary; kill switch only tightens
 * - A5 billing UX three rules on exempt path
 * - Simple-task latency micro-check (V31-05 baseline in-flight — noted)
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentControlLimits } from '@meiye/contracts';

import { FixtureAgentKernel } from './agent-kernel.js';
import {
  BILLING_UX_COPY,
  formatQuoteCostLabel,
  formatRefundDualState,
  projectSessionBillingUx,
} from './billing-ux.js';
import {
  applyConfirmationKillSwitch,
  classifyProgressiveLevel,
  isPureCopyOperation,
} from './progressive-level.js';
import {
  CANONICAL_SIX_PRIMITIVE_ORDER,
  didNotCall,
  maxToolCalls,
  noToolErrors,
  runSessionBehaviorQuickChecks,
  toolOrder,
} from './quick-checks.js';
import {
  level0StaysOutsideMachine,
  level1ShortcutPath,
} from './state-machine.js';
import { AgentTurnRunner } from './turn-runner.js';

const CONTROL_LIMITS: AgentControlLimits = {
  maxLlmSteps: 4,
  maxToolCalls: 6,
  maxRetrievalCalls: 6,
  maxMerchantQuestions: 1,
  maxReplans: 0,
  maxSchemaRepairs: 1,
  maxContextTokens: 16_000,
  maxDelegations: 1,
};

const FINISH_DECISION = {
  merchantMessage: '纯文案草稿已就绪',
  action: { kind: 'finish_turn' as const },
  evidenceRefs: [],
  assumptions: [
    { key: 'platform', statement: '默认小红书', risk: 'low' as const },
  ],
};

function baseTurn(overrides: Record<string, unknown> = {}) {
  return {
    threadId: 'thread-1',
    runId: 'run-1',
    workspaceId: 'ws-1',
    actorId: 'actor-1',
    phase: 'intent' as const,
    merchantMessage: '写一条朋友圈护理介绍',
    proactiveMode: 'balanced' as const,
    sessionRevision: 0,
    approvedToolNames: [] as string[],
    limits: { ...CONTROL_LIMITS },
    harnessReleaseId: 'release-1',
    ...overrides,
  };
}

// ─── Classifier unit ────────────────────────────────────────────────────────

test('merchant prose without structured lens or paid-unit authority is never copy-exempt', () => {
  const result = classifyProgressiveLevel({
    merchantMessage: '写一条朋友圈护理介绍',
  });
  assert.equal(result.level, 2);
  assert.equal(result.confirmationExempt, false);
  assert.equal(result.reason, 'structured_execution_authority_missing');
});

test('Level 0: deterministic light edit patterns', () => {
  const result = classifyProgressiveLevel({
    merchantMessage: '删除最后一句',
  });
  assert.equal(result.level, 0);
  assert.equal(result.deterministicEdit?.kind, 'delete_last_sentence');
  assert.equal(result.confirmationExempt, true);
});

test('Level 1: pure copy simple generation is confirmation-exempt (U1)', () => {
  const result = classifyProgressiveLevel({
    merchantMessage: '写一条朋友圈护理介绍',
    lens: 'copy',
  });
  assert.equal(result.level, 1);
  assert.equal(result.isPureCopy, true);
  assert.equal(result.confirmationExempt, true);
  assert.equal(result.approvalBasis, 'policy_exempt_copy');
});

test('Level 2: paid media / multi-page creation is not exempt (A13)', () => {
  const result = classifyProgressiveLevel({
    merchantMessage: '做一套小红书 5 页护理案例',
  });
  assert.equal(result.level, 2);
  assert.equal(result.confirmationExempt, false);
  assert.equal(result.isPureCopy, false);
});

test('Level 3: campaign / ongoing goal', () => {
  const result = classifyProgressiveLevel({
    merchantMessage: '8 月帮我持续推头皮护理',
  });
  assert.equal(result.level, 3);
  assert.equal(result.confirmationExempt, false);
});

test('A13 pure-copy: unit resources with image force paid-media', () => {
  assert.equal(
    isPureCopyOperation({
      merchantMessage: '写介绍',
      paidMediaUnitResources: ['image'],
    }),
    false,
  );
  assert.equal(
    isPureCopyOperation({
      merchantMessage: '写介绍',
      paidMediaUnitResources: ['copy'],
    }),
    true,
  );
  assert.equal(
    isPureCopyOperation({
      merchantMessage: '写介绍',
      includesPaidMediaExecution: true,
    }),
    false,
  );
});

test('kill switch only tightens pure-copy exemption (never expands paid media)', () => {
  const pure = classifyProgressiveLevel({
    merchantMessage: '写一条护理介绍',
    lens: 'copy',
  });
  assert.equal(pure.confirmationExempt, true);
  const tightened = applyConfirmationKillSwitch(pure, true);
  assert.equal(tightened.confirmationExempt, false);
  assert.equal(tightened.approvalBasis, 'merchant_confirmed');
  assert.match(tightened.reason, /kill_switch/);

  const media = classifyProgressiveLevel({
    merchantMessage: '出一组图文',
    lens: 'note',
  });
  assert.equal(media.confirmationExempt, false);
  const still = applyConfirmationKillSwitch(media, false);
  // Even with kill switch off, paid media stays non-exempt.
  assert.equal(still.confirmationExempt, false);
});

// ─── Billing UX (A5) ────────────────────────────────────────────────────────

test('billing UX: quote chip always visible with dual-state refund copy', () => {
  const on = projectSessionBillingUx({
    quote: { creditCost: 3, failureRefundsCredits: true },
    balance: { availableCredits: 100 },
  });
  assert.equal(on.quoteChip.visible, true);
  if (on.quoteChip.visible) {
    assert.equal(on.quoteChip.costLabel, formatQuoteCostLabel(3));
    assert.equal(on.quoteChip.refundLabel, BILLING_UX_COPY.refundOn);
    assert.equal(on.quoteChip.refundLabel, formatRefundDualState(true));
  }
  assert.equal(on.balanceBlock, null);
  assert.equal(on.submitBlocked, false);

  const off = projectSessionBillingUx({
    quote: { creditCost: 3, failureRefundsCredits: false },
    balance: { availableCredits: 100 },
  });
  assert.equal(off.quoteChip.visible, true);
  if (off.quoteChip.visible) {
    assert.equal(off.quoteChip.refundLabel, BILLING_UX_COPY.refundOff);
  }
});

test('billing UX: balance shortfall blocks with dual exits', () => {
  const blocked = projectSessionBillingUx({
    quote: { creditCost: 50, failureRefundsCredits: true },
    balance: { availableCredits: 12 },
  });
  assert.equal(blocked.submitBlocked, true);
  assert.ok(blocked.balanceBlock);
  assert.equal(blocked.balanceBlock?.missingCredits, 38);
  assert.equal(blocked.balanceBlock?.shortfallLabel, '还差 38 分');
  assert.deepEqual(
    blocked.balanceBlock?.exits.map((exit) => exit.id),
    ['buy_booster', 'upgrade_plan'],
  );
  assert.equal(blocked.balanceBlock?.exits[0]?.label, '购买加油包');
  assert.equal(blocked.balanceBlock?.exits[1]?.label, '升级套餐');
  // Chip still always visible on shortfall.
  assert.equal(blocked.quoteChip.visible, true);
});

// ─── Quick Checks API ───────────────────────────────────────────────────────

test('Quick Checks: toolOrder / didNotCall / maxToolCalls / noToolErrors', () => {
  const calls = [
    { toolName: 'read_context' },
    { toolName: 'generate' },
    { toolName: 'check' },
    { toolName: 'record' },
  ];
  assert.equal(toolOrder(calls, [...CANONICAL_SIX_PRIMITIVE_ORDER]), true);
  assert.equal(didNotCall(calls, 'ask_merchant'), true);
  assert.equal(didNotCall(calls, 'record'), false);
  assert.equal(maxToolCalls(calls, 8), true);
  assert.equal(maxToolCalls(calls, 2), false);
  assert.equal(noToolErrors(calls), true);
  assert.equal(
    noToolErrors([{ toolName: 'generate', error: new Error('x') }]),
    false,
  );
});

test('Quick Checks run the fixed session behavior suite', () => {
  const readonlyTrace = {
    toolCalls: [
      { toolName: 'read_context' },
      { toolName: 'generate' },
      { toolName: 'check' },
    ],
    llmCallCount: 1,
    tags: ['readonly'],
  };
  const verdicts = runSessionBehaviorQuickChecks(readonlyTrace);
  const recordGate = verdicts.find(
    (item) => item.id === 'session.didNotCall.record_readonly',
  );
  assert.equal(recordGate?.passed, true);

  const withRecord = runSessionBehaviorQuickChecks({
    toolCalls: [{ toolName: 'record' }],
  });
  assert.equal(
    withRecord.find((item) => item.id === 'session.didNotCall.record_readonly')
      ?.passed,
    false,
  );
});

// ─── Turn runner production path ────────────────────────────────────────────

test('Level 0 turn: zero LLM calls and state stays outside machine', async () => {
  let kernelInvocations = 0;
  const kernel = new FixtureAgentKernel({
    decision: () => {
      kernelInvocations += 1;
      return FINISH_DECISION;
    },
  });
  // Wrap to count even if Fixture always builds decision eagerly.
  const countingKernel = {
    runTurn: async (request: Parameters<FixtureAgentKernel['runTurn']>[0]) => {
      kernelInvocations += 1;
      return kernel.runTurn(request);
    },
  };

  const runner = new AgentTurnRunner({
    kernel: countingKernel,
    resolveRelease: async () => ({
      controlLimits: { ...CONTROL_LIMITS },
      releaseId: 'release-1',
    }),
    billingQuote: { creditCost: 1, failureRefundsCredits: true },
    billingBalancePort: {
      resolveBalance: async () => ({ availableCredits: 50 }),
    },
    readOnly: true,
  });

  const result = await runner.run(
    baseTurn({ merchantMessage: '删除最后一句' }),
  );

  assert.equal(kernelInvocations, 0);
  assert.equal(result.llmCallCount, 0);
  assert.equal(result.progressiveLevel.level, 0);
  assert.equal(result.state, 'idle');
  assert.deepEqual(level0StaysOutsideMachine(), ['idle']);
  assert.equal(result.decision?.action.kind, 'finish_turn');
  assert.ok(result.billingUx);
  assert.equal(result.billingUx?.quoteChip.visible, true);
  // "Cheap" is asserted structurally, not by wall clock. The old `<50ms` bound
  // passed standalone at ~9ms and failed at 76-134ms whenever the rest of this
  // file ran first or the host was busy, so it measured the host, not Level 0.
  // What Level 0 actually promises is that no billable work happens: no kernel
  // invocation, no LLM call, no tool call, and no state written into the
  // machine — all four asserted above. The latency figure itself belongs to the
  // V31-05 baseline capture (Task 10), which measures it on a quiet host.
  assert.deepEqual(result.toolCalls, []);
});

test('Level 1 pure copy: interpreting → handing_off + billing UX', async () => {
  let kernelInvocations = 0;
  const kernel = {
    runTurn: async () => {
      kernelInvocations += 1;
      return {
        decision: FINISH_DECISION,
        toolCalls: [],
        steps: 1,
      };
    },
  };

  const runner = new AgentTurnRunner({
    kernel,
    resolveRelease: async () => ({
      controlLimits: { ...CONTROL_LIMITS },
      releaseId: 'release-1',
    }),
    resolveLevelInput: () => ({
      merchantMessage: '写一条朋友圈护理介绍',
      lens: 'copy',
    }),
    billingQuote: { creditCost: 2, failureRefundsCredits: true },
    billingBalancePort: {
      resolveBalance: async () => ({ availableCredits: 100 }),
    },
    readOnly: true,
  });

  const result = await runner.run(
    baseTurn({ merchantMessage: '写一条朋友圈护理介绍' }),
  );

  assert.equal(kernelInvocations, 1);
  assert.equal(result.llmCallCount, 1);
  assert.equal(result.progressiveLevel.level, 1);
  assert.equal(result.progressiveLevel.confirmationExempt, true);
  assert.equal(result.state, 'handing_off');
  assert.deepEqual(level1ShortcutPath(), [
    'idle',
    'interpreting',
    'handing_off',
  ]);
  assert.ok(result.billingUx?.quoteChip.visible);
  if (result.billingUx?.quoteChip.visible) {
    assert.equal(result.billingUx.quoteChip.costLabel, '本次约消耗 2 分');
    assert.equal(result.billingUx.quoteChip.refundLabel, '失败自动退回');
  }
  assert.equal(result.billingUx?.submitBlocked, false);
});

test('Level 1 shortfall: chip visible + dual exits + submit blocked', async () => {
  const kernel = {
    runTurn: async () => ({
      decision: FINISH_DECISION,
      toolCalls: [],
      steps: 1,
    }),
  };
  const runner = new AgentTurnRunner({
    kernel,
    resolveRelease: async () => ({
      controlLimits: { ...CONTROL_LIMITS },
      releaseId: 'release-1',
    }),
    resolveLevelInput: () => ({
      merchantMessage: '写一条护理文案',
      lens: 'copy',
    }),
    billingQuote: { creditCost: 20, failureRefundsCredits: false },
    billingBalancePort: {
      resolveBalance: async () => ({ availableCredits: 5 }),
    },
    readOnly: true,
  });

  const result = await runner.run(
    baseTurn({ merchantMessage: '写一条护理文案' }),
  );
  assert.equal(result.state, 'handing_off');
  assert.equal(result.billingUx?.submitBlocked, true);
  assert.equal(result.billingUx?.balanceBlock?.missingCredits, 15);
  assert.deepEqual(
    result.billingUx?.balanceBlock?.exits.map((exit) => exit.id),
    ['buy_booster', 'upgrade_plan'],
  );
  if (result.billingUx?.quoteChip.visible) {
    assert.equal(result.billingUx.quoteChip.refundLabel, '该模型失败不退回');
  }
});

test('kill switch on Level 1 pure copy removes confirmationExempt', async () => {
  const kernel = {
    runTurn: async () => ({
      decision: FINISH_DECISION,
      toolCalls: [],
      steps: 1,
    }),
  };
  const runner = new AgentTurnRunner({
    kernel,
    resolveRelease: async () => ({
      controlLimits: { ...CONTROL_LIMITS },
      releaseId: 'release-1',
    }),
    resolveLevelInput: () => ({
      merchantMessage: '写一条护理介绍',
      lens: 'copy',
    }),
    forceConfirmationKillSwitch: true,
    readOnly: true,
  });

  const result = await runner.run(
    baseTurn({ merchantMessage: '写一条护理介绍' }),
  );
  assert.equal(result.progressiveLevel.level, 1);
  assert.equal(result.progressiveLevel.confirmationExempt, false);
  // Without exempt, L1 shortcut is off — finish_turn still reaches handing_off
  // via normal edge, but approvalBasis is merchant_confirmed.
  assert.equal(result.progressiveLevel.approvalBasis, 'merchant_confirmed');
});

test('Level 2 classification does not take L1 shortcut', async () => {
  const kernel = {
    runTurn: async () => ({
      decision: {
        ...FINISH_DECISION,
        action: {
          kind: 'propose_plan' as const,
          proposal: {
            goalNarrative: '小红书五页护理案例',
            recommendedDeliverables: [
              { carrier: 'note' as const, quantity: 5 },
            ],
          },
        },
      },
      toolCalls: [],
      steps: 1,
    }),
  };
  const runner = new AgentTurnRunner({
    kernel,
    resolveRelease: async () => ({
      controlLimits: { ...CONTROL_LIMITS },
      releaseId: 'release-1',
    }),
    resolveLevelInput: () => ({
      merchantMessage: '做一套小红书 5 页护理案例',
      carriers: ['note'],
      lens: 'note',
    }),
    readOnly: true,
  });

  const result = await runner.run(
    baseTurn({ merchantMessage: '做一套小红书 5 页护理案例' }),
  );
  assert.equal(result.progressiveLevel.level, 2);
  assert.equal(result.progressiveLevel.confirmationExempt, false);
  // L2 takes plan_compiling after propose_plan, not L1 shortcut.
  assert.equal(result.state, 'plan_compiling');
  assert.equal(result.billingUx, null);
});
