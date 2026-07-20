import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CatalogProductQuoteAuthority } from './server-quote-authority.js';

function authority(amountMicros = 500_000) {
  return new CatalogProductQuoteAuthority({
    async getCatalog(_workspaceId, operation) {
      return {
        models: [
          {
            id: operation === 'video.generate' ? 'video-model' : 'image-model',
            unitPrice: {
              amountMicros,
              currency: 'CNY' as const,
              revision: 'supplier-price-r7',
              unit: operation === 'video.generate' ? 'second' : 'request',
            },
          },
        ],
        revisionId: 'catalog-r11',
      };
    },
  });
}

describe('CatalogProductQuoteAuthority', () => {
  it('prices image set quantity from the server catalog', async () => {
    const quote = await authority().resolve({
      catalogModelId: 'image-model',
      operation: 'image.generate',
      aspectRatio: '1:1',
      quantity: 3,
      quoteId: 'quote-image-set',
      workspaceId: 'workspace-1',
    });

    assert.equal(quote.billingMode, 'per_request');
    assert.equal(quote.catalogModelRevision, 'catalog-r11');
    assert.equal(quote.quotePolicyRevision, 'quote.policy@1');
    assert.equal(quote.unitRate, 1.5);
    assert.equal(quote.outputCount, 3);
    assert.equal(quote.outputLabel, '3 张 1:1 图片');
    assert.equal(quote.authorizedCeiling, undefined);
    assert.equal(quote.routeSnapshotRef, undefined);
    assert.equal(quote.frozenCandidateDeploymentIds, undefined);
  });

  it('derives video billing rules and rejects a model absent from the catalog', async () => {
    const quote = await authority(250_000).resolve({
      catalogModelId: 'video-model',
      operation: 'video.generate',
      quoteId: 'quote-video',
      targetSeconds: 8,
      workspaceId: 'workspace-1',
    });

    assert.equal(quote.billingMode, 'per_output_second');
    assert.equal(quote.unitRate, 0.25);
    assert.equal(quote.targetSeconds, 8);
    assert.equal(quote.minChargeSeconds, 2);
    assert.equal(quote.roundingStepSeconds, 1);

    await assert.rejects(
      authority().resolve({
        catalogModelId: 'attacker-model',
        operation: 'image.generate',
        quoteId: 'quote-missing',
        workspaceId: 'workspace-1',
      }),
      /not available/,
    );
  });

  it('fails closed on malformed server pricing and invalid quantity', async () => {
    await assert.rejects(
      authority(Number.NaN).resolve({
        catalogModelId: 'image-model',
        operation: 'image.generate',
        quoteId: 'quote-invalid-price',
        workspaceId: 'workspace-1',
      }),
      /server pricing/i,
    );
    await assert.rejects(
      authority().resolve({
        catalogModelId: 'image-model',
        operation: 'image.generate',
        quantity: 1.5,
        quoteId: 'quote-invalid-quantity',
        workspaceId: 'workspace-1',
      }),
      /quantity/,
    );
  });
});
