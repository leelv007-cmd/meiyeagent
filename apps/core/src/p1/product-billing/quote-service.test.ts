import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applyBillableSecondsRules } from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';
import { ProductQuoteService } from './quote-service.js';

const fixedNow = new Date('2026-07-20T12:00:00.000Z');

function service() {
  return new ProductQuoteService({ clock: () => fixedNow });
}

function perRequestInput(quoteId = 'quote-req-1') {
  return {
    quoteId,
    catalogModelId: 'model-copy',
    catalogModelRevision: 'catalog-r1',
    quotePolicyRevision: 'qp-r1',
    billingMode: 'per_request' as const,
    outputCount: 3,
    outputLabel: '3 条内容候选',
    unitRate: 1,
    currency: 'CNY',
    routeSnapshotRef: 'route-1',
    frozenCandidateDeploymentIds: ['dep-a', 'dep-b'],
    workspaceId: 'ws-1',
  };
}

function perSecondInput(quoteId = 'quote-sec-1') {
  return {
    quoteId,
    catalogModelId: 'model-video',
    catalogModelRevision: 'catalog-r1',
    quotePolicyRevision: 'qp-video-r1',
    billingMode: 'per_output_second' as const,
    unitRate: 0.5,
    currency: 'CNY',
    targetSeconds: 10,
    minChargeSeconds: 4,
    roundingStepSeconds: 1,
    routeSnapshotRef: 'route-video-1',
    frozenCandidateDeploymentIds: ['dep-video-a', 'dep-video-b'],
    workspaceId: 'ws-1',
  };
}

async function runLifecycle(
  quotes: ProductQuoteService,
  input: ReturnType<typeof perRequestInput> | ReturnType<typeof perSecondInput>,
  taskId: string,
  options: {
    trustedUsage?: {
      kind: 'provider_usage' | 'provider_bill' | 'media_duration';
      actualSeconds: number;
    };
    skipTrusted?: boolean;
    attemptId?: string;
  } = {},
) {
  const quoted = quotes.buildQuote(input);
  const confirmed = quotes.confirm({ quoteId: quoted.quoteId, taskId });
  const reserved = quotes.reserve({
    quoteId: quoted.quoteId,
    units: [{
      resource: input.billingMode === 'per_output_second' ? 'video' : 'copy',
      quantity:
        input.billingMode === 'per_output_second'
          ? (quoted.quotedSeconds as number)
          : (input.outputCount ?? 1),
    }],
  });
  const dispatched = quotes.dispatch({
    quoteId: quoted.quoteId,
    deploymentId: input.frozenCandidateDeploymentIds![0]!,
    attemptId: options.attemptId ?? `attempt-${taskId}`,
    providerCost: {
      supplierPriceRevision: 'supplier-price-r1',
      billingMode: input.billingMode,
      unitPriceMicros: 100_000,
      currency: 'CNY',
      unit: input.billingMode === 'per_output_second' ? 'second' : 'request',
      estimatedCostMicros: 100_000,
    },
  });
  const settled = quotes.settle({
    quoteId: quoted.quoteId,
    ...(options.skipTrusted
      ? {}
      : options.trustedUsage
        ? { trustedUsage: options.trustedUsage }
        : input.billingMode === 'per_output_second'
          ? {
              trustedUsage: {
                kind: 'provider_usage' as const,
                actualSeconds: input.targetSeconds!,
              },
            }
          : {
              trustedUsage: {
                kind: 'provider_usage' as const,
                actualSeconds: 0,
              },
            }),
    attemptId: options.attemptId ?? `attempt-${taskId}`,
  });
  return { quoted, confirmed, reserved, dispatched, settled };
}

describe('ProductQuoteService lifecycle', () => {
  it('quote→confirm→reserve→dispatch→settle for per_request', async () => {
    const quotes = service();
    const result = await runLifecycle(quotes, perRequestInput(), 'task-req-1');

    assert.equal(result.quoted.lifecycleStatus, 'quoted');
    assert.equal(result.quoted.confirmedAmount, 1);
    assert.equal(result.quoted.authorizedCeiling, 1);
    assert.equal(result.quoted.billingMode, 'per_request');
    assert.equal(result.quoted.outputCount, 3);
    assert.equal(result.quoted.outputLabel, '3 条内容候选');

    assert.equal(result.confirmed.lifecycleStatus, 'confirmed');
    assert.equal(result.confirmed.taskId, 'task-req-1');

    assert.equal(result.reserved.quote.lifecycleStatus, 'reserved');
    assert.equal(result.reserved.usage.status, 'reserved');
    assert.equal(result.reserved.usage.reservedQuantity, 3);

    assert.equal(result.dispatched.quote.lifecycleStatus, 'dispatched');
    assert.ok(result.dispatched.providerCost);

    assert.equal(result.settled.quote.lifecycleStatus, 'settled');
    assert.equal(result.settled.quote.settlementStatus, 'reconciled');
    assert.equal(result.settled.quote.settledAmount, 1);
    assert.equal(result.settled.usage.settledQuantity, 3);
    assert.equal(result.settled.usage.status, 'committed');
    // per_request does not set billedSeconds from duration
    assert.equal(result.settled.quote.billedSeconds, undefined);
  });

  it('keeps a confirmed quote bound to one task while same-task confirmations replay', async () => {
    const quotes = service();
    const quote = quotes.buildQuote(perRequestInput('quote-task-binding'));
    quotes.confirm({ quoteId: quote.quoteId, taskId: 'task-bound' });

    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        Promise.resolve().then(() =>
          quotes.confirm({
            quoteId: quote.quoteId,
            taskId: index % 3 === 0 ? 'task-bound' : 'task-conflict',
          }),
        ),
      ),
    );
    const bound = quotes.getQuote(quote.quoteId);
    assert.equal(bound?.taskId, 'task-bound');
    for (const [index, attempt] of attempts.entries()) {
      const taskId = index % 3 === 0 ? 'task-bound' : 'task-conflict';
      if (taskId === 'task-bound') {
        assert.equal(attempt.status, 'fulfilled');
      } else {
        assert.ok(
          attempt.status === 'rejected' &&
            attempt.reason instanceof P1DomainError &&
            attempt.reason.code === 'IDEMPOTENCY_CONFLICT',
        );
      }
    }

    quotes.reserve({
      quoteId: quote.quoteId,
      units: [{ resource: 'copy', quantity: 3 }],
    });
    quotes.dispatch({
      attemptId: 'attempt-task-binding',
      deploymentId: 'dep-a',
      quoteId: quote.quoteId,
    });
    const settled = quotes.settle({
      quoteId: quote.quoteId,
      trustedUsage: { actualSeconds: 0, kind: 'provider_usage' },
    });
    assert.equal(
      quotes.confirm({ quoteId: quote.quoteId, taskId: 'task-bound' })
        .lifecycleStatus,
      'settled',
    );
    assert.throws(
      () =>
        quotes.confirm({
          quoteId: quote.quoteId,
          taskId: 'task-conflict',
        }),
      (error: unknown) =>
        error instanceof P1DomainError &&
        error.code === 'IDEMPOTENCY_CONFLICT',
    );
    assert.equal(quotes.getUsage('task-bound')?.id, settled.usage.id);
  });

  it('quote→confirm→reserve→dispatch→settle for per_output_second', async () => {
    const quotes = service();
    const input = perSecondInput();
    const expectedQuoted = applyBillableSecondsRules({
      rawSeconds: 10,
      minChargeSeconds: 4,
      roundingStepSeconds: 1,
    });
    const result = await runLifecycle(quotes, input, 'task-sec-1', {
      trustedUsage: { kind: 'media_duration', actualSeconds: 10 },
    });

    assert.equal(result.quoted.quotedSeconds, expectedQuoted);
    assert.equal(result.quoted.confirmedAmount, 0.5 * expectedQuoted);
    assert.equal(result.quoted.authorizedCeiling, 5);

    assert.equal(result.reserved.usage.reservedQuantity, 10);
    assert.equal(result.settled.quote.billedSeconds, 10);
    assert.equal(result.settled.quote.settledAmount, 5);
    assert.equal(result.settled.quote.settlementStatus, 'reconciled');
    assert.equal(result.settled.usage.settledQuantity, 10);
  });

  it('low actual seconds auto-refunds the difference', async () => {
    const quotes = service();
    const input = perSecondInput('quote-low');
    // target 10s → ceiling 5 units; actual 4s → billable max(4,4)=4 → amount 2
    const result = await runLifecycle(quotes, input, 'task-low', {
      trustedUsage: { kind: 'provider_usage', actualSeconds: 4 },
      attemptId: 'attempt-low',
    });

    assert.equal(result.settled.quote.billedSeconds, 4);
    assert.equal(result.settled.quote.settledAmount, 2);
    assert.equal(result.settled.quote.refundedAmount, 3);
    assert.equal(result.settled.usage.status, 'partially_refunded');
    assert.equal(result.settled.usage.refundedQuantity, 6);
    assert.equal(result.settled.usage.settledQuantity, 4);
  });

  it('trusted product units settle each reserved bucket and refund the unused declaration', () => {
    const quotes = service();
    const quoted = quotes.buildQuote({
      ...perRequestInput('quote-note-units'),
      outputCount: 1,
      outputLabel: '图文笔记',
      unitRate: 0.12,
    });
    quotes.confirm({ quoteId: quoted.quoteId, taskId: 'task-note-units' });
    const reserved = quotes.reserve({
      quoteId: quoted.quoteId,
      units: [
        { resource: 'copy', quantity: 2 },
        { resource: 'image', quantity: 12 },
      ],
    });
    quotes.dispatch({
      quoteId: quoted.quoteId,
      deploymentId: 'dep-a',
      attemptId: 'attempt-note-units',
    });

    const settled = quotes.settle({
      quoteId: quoted.quoteId,
      attemptId: 'attempt-note-units',
      trustedUsage: {
        kind: 'product_units',
        units: [{ resource: 'image', quantity: 5 }],
      },
    });

    assert.deepEqual(reserved.usage.reservedUnits, [
      { resource: 'copy', quantity: 2 },
      { resource: 'image', quantity: 12 },
    ]);
    assert.equal(settled.quote.settledAmount, 0.12);
    assert.equal(settled.usage.status, 'partially_refunded');
    assert.deepEqual(settled.usage.settledUnits, [
      { resource: 'copy', quantity: 2 },
      { resource: 'image', quantity: 5 },
    ]);
    assert.deepEqual(settled.usage.refundedUnits, [
      { resource: 'image', quantity: 7 },
    ]);
  });

  it('rejects a reservation that drifts from the frozen debit preview', () => {
    const quotes = service();
    const quoted = quotes.buildQuote({
      ...perRequestInput('quote-frozen-debit'),
      debitUnits: [
        { resource: 'copy', quantity: 1 },
        { resource: 'image', quantity: 3 },
      ],
      outputCount: 1,
    });
    quotes.confirm({ quoteId: quoted.quoteId, taskId: 'task-frozen-debit' });

    assert.throws(
      () =>
        quotes.reserve({
          quoteId: quoted.quoteId,
          units: [
            { resource: 'copy', quantity: 1 },
            { resource: 'image', quantity: 2 },
          ],
        }),
      /does not match the frozen debit preview/u,
    );
  });

  it('high actual seconds does not silent-surcharge (platform absorbs)', async () => {
    const quotes = service();
    const input = perSecondInput('quote-high');
    // ceiling 5; actual 20s → raw 10 units → capped at 5, absorb 5
    const result = await runLifecycle(quotes, input, 'task-high', {
      trustedUsage: { kind: 'provider_bill', actualSeconds: 20 },
      attemptId: 'attempt-high',
    });

    assert.equal(result.settled.quote.billedSeconds, 20);
    assert.equal(result.settled.quote.settledAmount, 5);
    assert.equal(result.settled.quote.platformAbsorbedAmount, 5);
    assert.equal(result.settled.quote.refundedAmount, 0);
    assert.equal(result.settled.usage.settledQuantity, 10);
    assert.equal(result.settled.usage.reservedQuantity, 10);

    const costs = quotes.listProviderCosts('task-high');
    assert.equal(costs.length, 1);
    assert.ok((costs[0]?.supplyCostDeltaMicros ?? 0) > 0);
  });

  it('missing trusted usage keeps estimated/unknown and does not set billedSeconds', async () => {
    const quotes = service();
    const input = perSecondInput('quote-unknown');
    const result = await runLifecycle(quotes, input, 'task-unknown', {
      skipTrusted: true,
      attemptId: 'attempt-unknown',
    });

    assert.equal(result.settled.quote.settlementStatus, 'estimated');
    assert.equal(result.settled.quote.billedSeconds, undefined);
    assert.equal(result.settled.quote.settledAmount, 5);
    assert.equal(result.settled.usage.settlementStatus, 'estimated');
  });

  it('billedSeconds only comes from trusted provider/media evidence', async () => {
    const quotes = service();
    quotes.buildQuote(perSecondInput('quote-evidence'));
    quotes.confirm({ quoteId: 'quote-evidence', taskId: 'task-evidence' });
    quotes.reserve({
      quoteId: 'quote-evidence',
      units: [{ resource: 'video', quantity: 10 }],
    });
    quotes.dispatch({
      quoteId: 'quote-evidence',
      deploymentId: 'dep-video-a',
      attemptId: 'attempt-evidence',
    });

    // Client-like estimate must not be accepted as trusted (skip → estimated)
    const estimated = quotes.settle({ quoteId: 'quote-evidence' });
    assert.equal(estimated.quote.billedSeconds, undefined);
    assert.equal(estimated.quote.settlementStatus, 'estimated');

    // Fresh task with trusted media_duration
    quotes.buildQuote(perSecondInput('quote-evidence-2'));
    quotes.confirm({ quoteId: 'quote-evidence-2', taskId: 'task-evidence-2' });
    quotes.reserve({
      quoteId: 'quote-evidence-2',
      units: [{ resource: 'video', quantity: 10 }],
    });
    quotes.dispatch({
      quoteId: 'quote-evidence-2',
      deploymentId: 'dep-video-a',
      attemptId: 'attempt-evidence-2',
    });
    const trusted = quotes.settle({
      quoteId: 'quote-evidence-2',
      trustedUsage: { kind: 'media_duration', actualSeconds: 8 },
    });
    assert.equal(trusted.quote.billedSeconds, 8);
    assert.equal(trusted.quote.settlementStatus, 'reconciled');
  });

  it('fallback stays within frozen candidates and does not double product charge', async () => {
    const quotes = service();
    const input = perSecondInput('quote-fb');
    quotes.buildQuote(input);
    quotes.confirm({ quoteId: 'quote-fb', taskId: 'task-fb' });
    const reserved = quotes.reserve({
      quoteId: 'quote-fb',
      units: [{ resource: 'video', quantity: 10 }],
    });
    quotes.dispatch({
      quoteId: 'quote-fb',
      deploymentId: 'dep-video-a',
      attemptId: 'attempt-fb-1',
      providerCost: {
        supplierPriceRevision: 'sp-1',
        billingMode: 'per_output_second',
        unitPriceMicros: 50_000,
        currency: 'CNY',
        unit: 'second',
      },
    });

    const fallback = quotes.fallbackDispatch({
      quoteId: 'quote-fb',
      deploymentId: 'dep-video-b',
      attemptId: 'attempt-fb-2',
      supplyCostDeltaMicros: 75_000,
      providerCost: {
        supplierPriceRevision: 'sp-2',
        billingMode: 'per_output_second',
        unitPriceMicros: 60_000,
        currency: 'CNY',
        unit: 'second',
      },
    });

    assert.ok(fallback.providerCost);
    assert.equal(fallback.providerCost?.supplyCostDeltaMicros, 75_000);

    // Still exactly one product usage reservation
    const usage = quotes.getUsage('task-fb');
    assert.ok(usage);
    assert.equal(usage?.status, 'reserved');
    assert.equal(usage?.reservedQuantity, reserved.usage.reservedQuantity);
    assert.equal(usage?.id, reserved.usage.id);

    // Outside frozen set is rejected
    assert.throws(
      () =>
        quotes.fallbackDispatch({
          quoteId: 'quote-fb',
          deploymentId: 'dep-video-OUTSIDE',
          attemptId: 'attempt-fb-3',
        }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'INVALID_STATE',
    );

    const settled = quotes.settle({
      quoteId: 'quote-fb',
      trustedUsage: { kind: 'provider_usage', actualSeconds: 10 },
    });
    // One settle only — no double charge
    assert.equal(settled.usage.settledQuantity, 10);
    assert.equal(quotes.getUsage('task-fb')?.settledQuantity, 10);

    const costs = quotes.listProviderCosts('task-fb');
    assert.equal(costs.length, 2);
  });

  it('reserve and settle are idempotent per task', async () => {
    const quotes = service();
    quotes.buildQuote(perRequestInput('quote-idemp'));
    quotes.confirm({ quoteId: 'quote-idemp', taskId: 'task-idemp' });
    const r1 = quotes.reserve({
      quoteId: 'quote-idemp',
      units: [{ resource: 'copy', quantity: 3 }],
    });
    const r2 = quotes.reserve({
      quoteId: 'quote-idemp',
      units: [{ resource: 'copy', quantity: 3 }],
    });
    assert.deepEqual(r1.usage, r2.usage);

    quotes.dispatch({
      quoteId: 'quote-idemp',
      deploymentId: 'dep-a',
      attemptId: 'attempt-idemp',
    });
    const s1 = quotes.settle({
      quoteId: 'quote-idemp',
      trustedUsage: { kind: 'provider_usage', actualSeconds: 0 },
    });
    const s2 = quotes.settle({
      quoteId: 'quote-idemp',
      trustedUsage: { kind: 'provider_usage', actualSeconds: 0 },
    });
    assert.equal(s1.usage.settledQuantity, s2.usage.settledQuantity);
    assert.equal(s1.quote.lifecycleStatus, 'settled');
    assert.equal(s2.quote.lifecycleStatus, 'settled');
  });

  it('failAndRefund releases full pre-auth when no trusted partial output', async () => {
    const quotes = service();
    quotes.buildQuote(perSecondInput('quote-fail'));
    quotes.confirm({ quoteId: 'quote-fail', taskId: 'task-fail' });
    quotes.reserve({
      quoteId: 'quote-fail',
      units: [{ resource: 'video', quantity: 10 }],
    });
    quotes.dispatch({
      quoteId: 'quote-fail',
      deploymentId: 'dep-video-a',
      attemptId: 'attempt-fail',
    });

    const failed = quotes.failAndRefund({ quoteId: 'quote-fail' });
    assert.equal(failed.quote.lifecycleStatus, 'refunded');
    assert.equal(failed.quote.settledAmount, 0);
    assert.equal(failed.quote.refundedAmount, 5);
    assert.equal(failed.usage.status, 'refunded');
    assert.equal(failed.usage.settledQuantity, 0);
  });

  it('failAndRefund can charge only trusted second delta on partial failure', async () => {
    const quotes = service();
    quotes.buildQuote(perSecondInput('quote-partial-fail'));
    quotes.confirm({
      quoteId: 'quote-partial-fail',
      taskId: 'task-partial-fail',
    });
    quotes.reserve({
      quoteId: 'quote-partial-fail',
      units: [{ resource: 'video', quantity: 10 }],
    });
    quotes.dispatch({
      quoteId: 'quote-partial-fail',
      deploymentId: 'dep-video-a',
      attemptId: 'attempt-partial-fail',
    });

    // 2 raw seconds, minCharge 4 → billable 4 → amount 2
    const failed = quotes.failAndRefund({
      quoteId: 'quote-partial-fail',
      trustedUsage: { kind: 'provider_usage', actualSeconds: 2 },
    });
    assert.equal(failed.quote.billedSeconds, 4);
    assert.equal(failed.quote.settledAmount, 2);
    assert.equal(failed.quote.refundedAmount, 3);
    assert.equal(failed.usage.status, 'partially_refunded');
    assert.equal(failed.usage.settledQuantity, 4);
    assert.equal(failed.usage.refundedQuantity, 6);
  });

  it('forces system credit refunds while user failures follow model policy', () => {
    const fail = (quoteId: string, forceCreditRefund: boolean) => {
      const quotes = service();
      quotes.buildQuote({
        ...perRequestInput(quoteId),
        creditCost: 5,
        failureRefundsCredits: false,
        unitRate: 5,
      });
      quotes.confirm({ quoteId, taskId: `task-${quoteId}` });
      quotes.reserve({
        quoteId,
        units: [],
      });
      return quotes.failAndRefund({ quoteId, forceCreditRefund });
    };

    assert.equal(fail('quote-user-failure', false).usage.status, 'committed');
    assert.equal(fail('quote-system-failure', true).usage.status, 'refunded');
  });

  it('min charge and rounding affect quotedSeconds', () => {
    const quotes = service();
    const quoted = quotes.buildQuote({
      ...perSecondInput('quote-round'),
      targetSeconds: 5,
      minChargeSeconds: 8,
      roundingStepSeconds: 5,
    });
    // max(5,8)=8, ceil to step 5 → 10
    assert.equal(quoted.quotedSeconds, 10);
    assert.equal(quoted.confirmedAmount, 5);
  });
});
