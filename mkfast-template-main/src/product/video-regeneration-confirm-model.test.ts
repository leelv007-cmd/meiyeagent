import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ProductQuoteSnapshot } from '@meiye/contracts';

import {
  actionLabelForScope,
  billingModeLabelFromQuote,
  buildVideoRegenConfirmModel,
  buildVideoRegenSettleModel,
} from './video-regeneration-confirm-model';

function baseQuote(
  overrides: Partial<ProductQuoteSnapshot> = {},
): ProductQuoteSnapshot {
  return {
    quoteId: 'quote-1',
    revision: 'r1',
    catalogModelId: 'seedance-2',
    quotePolicyRevision: 'qp-1',
    billingMode: 'per_output_second',
    formula: { unitRate: 0.5, expression: 'per_output_second × 0.5' },
    targetSeconds: 10,
    quotedSeconds: 10,
    confirmedAmount: 5,
    authorizedCeiling: 5,
    lifecycleStatus: 'quoted',
    ...overrides,
  };
}

describe('video regeneration confirm model (pure)', () => {
  it('projects confirm zone fields with explicit per-second billing copy', () => {
    const model = buildVideoRegenConfirmModel({
      quote: baseQuote(),
      scope: 'shot',
      estimatedCompletionAt: '2026-07-20T15:00:30.000Z',
    });
    assert.equal(model.actionLabel, '重新生成此镜头');
    assert.equal(model.billingModeLabel, '按生成成片 10 秒计费');
    assert.equal(model.estimatedCredits, 5);
    assert.equal(model.createsNewTaskNotice.includes('单独计费'), true);
    assert.equal(actionLabelForScope('full_compose'), '重新合成整段');
    assert.equal(
      billingModeLabelFromQuote({
        billingMode: 'per_request',
        quotedSeconds: undefined,
        targetSeconds: 6,
      }),
      '本次按请求计费',
    );
  });

  it('projects auto-refund and estimated honesty states', () => {
    const refunded = buildVideoRegenSettleModel({
      quote: baseQuote({
        lifecycleStatus: 'settled',
        settlementStatus: 'reconciled',
        settledAmount: 2,
        refundedAmount: 3,
        billedSeconds: 4,
        taskId: 'task-1',
      }),
      scope: 'full_compose',
    });
    assert.equal(refunded.autoRefundApplied, true);
    assert.match(refunded.honestyNote, /自动退回/);

    const estimated = buildVideoRegenSettleModel({
      quote: baseQuote({
        lifecycleStatus: 'settled',
        settlementStatus: 'estimated',
        settledAmount: 5,
        taskId: 'task-1',
      }),
      scope: 'shot',
    });
    assert.equal(estimated.autoRefundApplied, false);
    assert.match(estimated.honestyNote, /estimated/);
  });
});
