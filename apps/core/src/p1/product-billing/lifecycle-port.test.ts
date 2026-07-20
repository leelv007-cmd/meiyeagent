import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProductBillingLifecycle } from './lifecycle-port.js';
import { MemoryProductUsageLedger } from './product-usage-ledger.js';
import { ProductQuoteService } from './quote-service.js';

function fixture(targetSeconds = 10) {
  const usage = new MemoryProductUsageLedger();
  const quotes = new ProductQuoteService({ usageLedger: usage });
  const quote = quotes.buildQuote({
    billingMode: 'per_output_second',
    catalogModelId: 'video-model',
    frozenCandidateDeploymentIds: ['deployment-a', 'deployment-b'],
    quoteId: `quote-${targetSeconds}`,
    quotePolicyRevision: 'policy-1',
    roundingStepSeconds: 1,
    targetSeconds,
    unitRate: 0.5,
    workspaceId: 'workspace-1',
  });
  quotes.confirm({ quoteId: quote.quoteId, taskId: 'work-1' });
  return {
    lifecycle: new ProductBillingLifecycle(quotes),
    quote,
    quotes,
    usage,
  };
}

const estimatedCost = {
  currency: 'CNY',
  estimatedCostMicros: 100_000,
  evidenceKind: 'estimated' as const,
  supplierPriceRevision: 'supplier-price-1',
  unit: 'second',
  unitPriceMicros: 10_000,
};

describe('ProductBillingLifecycle', () => {
  it('owns reserve, attempt dispatch, trusted settle, and replay in one ledger', () => {
    const { lifecycle, quote, quotes, usage } = fixture();

    lifecycle.beforeSubmit({
      quoteRevision: quote.revision,
      resource: 'video',
      taskId: 'work-1',
      workspaceId: 'workspace-1',
    });
    lifecycle.dispatchAttempt({
      attemptId: 'attempt-a',
      deploymentId: 'deployment-a',
      providerCost: estimatedCost,
      taskId: 'work-1',
      workspaceId: 'workspace-1',
    });
    lifecycle.settleTask({
      attemptId: 'attempt-a',
      deploymentId: 'deployment-a',
      providerCost: {
        ...estimatedCost,
        evidence: 'provider-usage-1',
        evidenceKind: 'provider_usage',
        observedCostMicros: 60_000,
        usageQuantity: 6,
        usageUnit: 'second',
      },
      status: 'completed',
      taskId: 'work-1',
      trustedUsage: {
        actualSeconds: 6,
        evidenceRef: 'provider-usage-1',
        kind: 'provider_usage',
      },
      workspaceId: 'workspace-1',
    });
    lifecycle.settleTask({
      attemptId: 'attempt-a',
      deploymentId: 'deployment-a',
      status: 'completed',
      taskId: 'work-1',
      workspaceId: 'workspace-1',
    });

    assert.deepEqual(usage.listByWorkspace('workspace-1'), [
      {
        billingMode: 'per_output_second',
        createdAt: usage.getByTask('work-1')!.createdAt,
        id: usage.getByTask('work-1')!.id,
        quoteId: quote.quoteId,
        refundedQuantity: 2,
        reservedQuantity: 5,
        resource: 'video',
        settledQuantity: 3,
        settlementStatus: 'reconciled',
        status: 'partially_refunded',
        taskId: 'work-1',
        updatedAt: usage.getByTask('work-1')!.updatedAt,
        workspaceId: 'workspace-1',
      },
    ]);
    assert.equal(quotes.getQuoteByTask('work-1')?.billedSeconds, 6);
    assert.equal(quotes.listProviderCosts('work-1').length, 1);
    assert.equal(
      quotes.listProviderCosts('work-1')[0]?.observedCostMicros,
      60_000,
    );
  });

  it('keeps fallback on the frozen candidates without reserving twice', () => {
    const { lifecycle, quote, quotes, usage } = fixture();
    lifecycle.beforeSubmit({
      quoteRevision: quote.revision,
      resource: 'video',
      taskId: 'work-1',
      workspaceId: 'workspace-1',
    });
    lifecycle.dispatchAttempt({
      attemptId: 'attempt-a',
      deploymentId: 'deployment-a',
      providerCost: estimatedCost,
      taskId: 'work-1',
      workspaceId: 'workspace-1',
    });
    lifecycle.dispatchAttempt({
      attemptId: 'attempt-b',
      deploymentId: 'deployment-b',
      providerCost: { ...estimatedCost, supplierPriceRevision: 'supplier-price-2' },
      taskId: 'work-1',
      workspaceId: 'workspace-1',
    });

    assert.equal(usage.listByWorkspace('workspace-1').length, 1);
    assert.equal(quotes.listProviderCosts('work-1').length, 2);
    assert.throws(() =>
      lifecycle.dispatchAttempt({
        attemptId: 'attempt-c',
        deploymentId: 'deployment-outside-freeze',
        providerCost: estimatedCost,
        taskId: 'work-1',
        workspaceId: 'workspace-1',
      }),
    );
  });

  it('fails closed when dispatch has no frozen route candidates', () => {
    const quotes = new ProductQuoteService();
    const quote = quotes.buildQuote({
      billingMode: 'per_request',
      catalogModelId: 'image-model',
      quoteId: 'quote-without-route-freeze',
      quotePolicyRevision: 'policy-1',
      unitRate: 1,
      workspaceId: 'workspace-1',
    });
    quotes.confirm({ quoteId: quote.quoteId, taskId: 'work-1' });
    quotes.reserve({ quoteId: quote.quoteId, resource: 'image' });
    assert.throws(
      () =>
        quotes.dispatch({
          attemptId: 'attempt-a',
          deploymentId: 'deployment-a',
          quoteId: quote.quoteId,
        }),
      /no frozen fallback candidate set/,
    );
  });

  it('caps high trusted usage and fully refunds a failed task', () => {
    const high = fixture();
    high.lifecycle.beforeSubmit({
      quoteRevision: high.quote.revision,
      resource: 'video',
      taskId: 'work-1',
      workspaceId: 'workspace-1',
    });
    high.lifecycle.dispatchAttempt({
      attemptId: 'attempt-a',
      deploymentId: 'deployment-a',
      providerCost: estimatedCost,
      taskId: 'work-1',
      workspaceId: 'workspace-1',
    });
    high.lifecycle.settleTask({
      attemptId: 'attempt-a',
      deploymentId: 'deployment-a',
      status: 'completed',
      taskId: 'work-1',
      trustedUsage: { actualSeconds: 12, kind: 'media_duration' },
      workspaceId: 'workspace-1',
    });
    assert.equal(high.usage.getByTask('work-1')?.settledQuantity, 5);
    assert.equal(high.quotes.getQuoteByTask('work-1')?.platformAbsorbedAmount, 1);

    const failed = fixture(20);
    failed.lifecycle.beforeSubmit({
      quoteRevision: failed.quote.revision,
      resource: 'video',
      taskId: 'work-1',
      workspaceId: 'workspace-1',
    });
    failed.lifecycle.dispatchAttempt({
      attemptId: 'attempt-a',
      deploymentId: 'deployment-a',
      providerCost: estimatedCost,
      taskId: 'work-1',
      workspaceId: 'workspace-1',
    });
    failed.lifecycle.settleTask({
      attemptId: 'attempt-a',
      deploymentId: 'deployment-a',
      status: 'failed',
      taskId: 'work-1',
      workspaceId: 'workspace-1',
    });
    assert.equal(failed.usage.getByTask('work-1')?.status, 'refunded');
  });

  it('rejects cross-workspace and stale-revision submissions before reserve', () => {
    const { lifecycle, quote } = fixture();
    lifecycle.assertAcceptedQuote({
      quoteId: quote.quoteId,
      quoteRevision: quote.revision,
      taskId: 'work-1',
      workspaceId: 'workspace-1',
    });
    assert.throws(() =>
      lifecycle.assertAcceptedQuote({
        quoteId: quote.quoteId,
        quoteRevision: quote.revision,
        taskId: 'work-other',
        workspaceId: 'workspace-1',
      }),
    );
    assert.throws(() =>
      lifecycle.assertAcceptedQuote({
        quoteId: quote.quoteId,
        quoteRevision: quote.revision,
        taskId: 'work-1',
        workspaceId: 'workspace-2',
      }),
    );
    assert.throws(() =>
      lifecycle.beforeSubmit({
        quoteRevision: quote.revision,
        resource: 'video',
        taskId: 'work-1',
        workspaceId: 'workspace-2',
      }),
    );
    assert.throws(() =>
      lifecycle.beforeSubmit({
        quoteRevision: 'stale-revision',
        resource: 'video',
        taskId: 'work-1',
        workspaceId: 'workspace-1',
      }),
    );
  });
});
