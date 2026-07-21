import assert from 'node:assert/strict';
import test from 'node:test';

import { CatalogProductQuoteAuthority } from './server-quote-authority.js';

test('quotes copy.adapt as one formal three-platform delivery', async () => {
  const authority = new CatalogProductQuoteAuthority({
    async getCatalog() {
      return {
        revisionId: 'catalog-current',
        models: [
          {
            id: 'llm-openai',
            unitPrice: {
              amountMicros: 60_000,
              currency: 'CNY' as const,
              revision: 'price-current',
              unit: 'request',
            },
          },
        ],
      };
    },
  });

  const quote = await authority.resolve({
    catalogModelId: 'llm-openai',
    operation: 'copy.adapt',
    quantity: 3,
    quoteId: 'quote-copy-adapt',
    workspaceId: 'workspace-1',
  });

  assert.equal(quote.outputCount, 3);
  assert.equal(quote.outputLabel, '三平台版本');
  assert.equal(quote.unitRate, 0.18);
});
