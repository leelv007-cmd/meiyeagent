import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { P1Context } from '../foundation/domain.js';
import { ProductBillingFoundationModule } from './foundation-module.js';
import { ProductQuoteService } from './quote-service.js';

const context: P1Context = {
  workspaceId: 'ws-module',
  userId: 'owner-1',
  correlationId: 'corr-module',
};

function module() {
  const quotes = new ProductQuoteService({
    clock: () => new Date('2026-07-20T12:00:00.000Z'),
  });
  return {
    quotes,
    module: new ProductBillingFoundationModule(quotes),
  };
}

describe('ProductBillingFoundationModule', () => {
  it('executes quote→confirm→reserve→dispatch→settle via module actions', async () => {
    const { module: billing } = module();

    const quoted = (await billing.execute({
      context,
      idempotencyKey: 'key-quote',
      input: {
        action: 'quote',
        payload: {
          quoteId: 'mod-quote-1',
          catalogModelId: 'model-v',
          quotePolicyRevision: 'qp-1',
          billingMode: 'per_output_second',
          unitRate: 1,
          targetSeconds: 6,
          minChargeSeconds: 2,
          frozenCandidateDeploymentIds: ['dep-1', 'dep-2'],
          routeSnapshotRef: 'route-1',
        },
      },
    })) as { quoteId: string; confirmedAmount?: number; lifecycleStatus: string };

    assert.equal(quoted.lifecycleStatus, 'quoted');
    assert.equal(quoted.confirmedAmount, 6);

    await billing.execute({
      context,
      idempotencyKey: 'key-confirm',
      input: {
        action: 'confirm',
        payload: { quoteId: 'mod-quote-1', taskId: 'task-mod-1' },
      },
    });

    const reserved = (await billing.execute({
      context,
      idempotencyKey: 'key-reserve',
      input: {
        action: 'reserve',
        payload: { quoteId: 'mod-quote-1', resource: 'video' },
      },
    })) as { usage: { reservedQuantity: number } };
    assert.equal(reserved.usage.reservedQuantity, 6);

    await billing.execute({
      context,
      idempotencyKey: 'key-dispatch',
      input: {
        action: 'dispatch',
        payload: {
          quoteId: 'mod-quote-1',
          deploymentId: 'dep-1',
          attemptId: 'att-1',
          providerCost: {
            supplierPriceRevision: 'sp-1',
            billingMode: 'per_output_second',
            unitPriceMicros: 10_000,
            currency: 'CNY',
            unit: 'second',
          },
        },
      },
    });

    const settled = (await billing.execute({
      context,
      idempotencyKey: 'key-settle',
      input: {
        action: 'settle',
        payload: {
          quoteId: 'mod-quote-1',
          trustedUsage: {
            kind: 'provider_usage',
            actualSeconds: 3,
          },
          attemptId: 'att-1',
        },
      },
    })) as {
      quote: {
        settledAmount?: number;
        refundedAmount?: number;
        billedSeconds?: number;
        settlementStatus?: string;
      };
    };

    assert.equal(settled.quote.billedSeconds, 3);
    assert.equal(settled.quote.settledAmount, 3);
    assert.equal(settled.quote.refundedAmount, 3);
    assert.equal(settled.quote.settlementStatus, 'reconciled');

    const loaded = await billing.query?.({
      context,
      input: {
        action: 'get_quote',
        payload: { quoteId: 'mod-quote-1' },
      },
    });
    assert.equal((loaded as { quoteId: string }).quoteId, 'mod-quote-1');
  });

  it('quotes from canvas source adapter via module', async () => {
    const { module: billing } = module();
    const quoted = (await billing.execute({
      context,
      idempotencyKey: 'key-canvas',
      input: {
        action: 'quote',
        payload: {
          source: 'canvas',
          targetSeconds: 5,
          canvasQuote: {
            quoteId: 'canvas-mod-1',
            catalogRevisionId: 'cat-1',
            deploymentId: 'dep-c',
            operation: 'video.generate',
            priceRevision: 'price-1',
            routeSnapshot: {
              id: 'route-c',
              actualCatalogModelId: 'model-c',
              allowedCandidates: [{ deploymentId: 'dep-c' }],
            },
            estimatedProviderCost: {
              amountMicros: 500_000,
              currency: 'CNY',
              unit: 'second',
            },
            workspaceId: context.workspaceId,
          },
        },
      },
    })) as {
      quoteId: string;
      billingMode: string;
      unitRate?: number;
      formula: { unitRate: number };
    };

    assert.equal(quoted.quoteId, 'canvas-mod-1');
    assert.equal(quoted.billingMode, 'per_output_second');
    assert.equal(quoted.formula.unitRate, 0.5);
  });
});
