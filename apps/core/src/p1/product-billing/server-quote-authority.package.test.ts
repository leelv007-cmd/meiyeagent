import assert from 'node:assert/strict';
import test from 'node:test';

import { CatalogProductQuoteAuthority } from './server-quote-authority.js';

function packageAuthority() {
  const catalogCalls: string[] = [];
  const authority = new CatalogProductQuoteAuthority(
    {
      async getCatalog(_workspaceId, operation) {
        catalogCalls.push(operation);
        if (operation === 'image.generate') {
          return {
            models: [
              {
                id: 'image-note-v2',
                creditPricing: {
                  'image.generate': {
                    creditCost: 5,
                    failureRefundsCredits: true,
                  },
                },
              },
            ],
            revisionId: 'catalog-image-r2',
          };
        }
        if (operation === 'copy.generate') {
          return {
            models: [
              {
                id: 'copy-v4',
                creditPricing: {
                  'copy.generate': {
                    creditCost: 2,
                    failureRefundsCredits: false,
                  },
                },
              },
            ],
            revisionId: 'catalog-copy-r4',
          };
        }
        throw new Error(`unexpected operation ${operation}`);
      },
    },
    () => new Date('2026-08-11T08:00:00.000Z'),
  );
  return { authority, catalogCalls };
}

test('package authority catalog-prices every server-authorized carrier and totals the root exactly', async () => {
  const { authority, catalogCalls } = packageAuthority();

  const quote = await authority.resolvePackage({
    quoteId: 'quote-package-note-copy',
    workspaceId: 'workspace-package',
    carrierAuthorities: [
      {
        allocationId: 'note',
        carrier: 'note',
        catalogModelId: 'image-note-v2',
        operation: 'image.generate',
        routeSnapshotRef: 'route-note-r2',
        rightsRevisionRefs: ['rights-note-r2'],
      },
      {
        allocationId: 'copy',
        carrier: 'copy',
        catalogModelId: 'copy-v4',
        operation: 'copy.generate',
        routeSnapshotRef: 'route-copy-r4',
        rightsRevisionRefs: ['rights-copy-r4'],
      },
    ],
    finalDeliverables: [
      { allocationId: 'note', carrier: 'note', deliveryUnits: 4 },
      { allocationId: 'copy', carrier: 'copy', deliveryUnits: 1 },
    ],
  });

  assert.deepEqual(catalogCalls.sort(), ['copy.generate', 'image.generate']);
  assert.equal(quote.catalogModelId.startsWith('package:'), true);
  assert.equal(quote.operation, 'package.execute');
  assert.equal(quote.outputCount, 5);
  assert.equal(quote.creditCost, 22);
  assert.equal(quote.unitRate, 22);
  assert.equal(quote.failureRefundsCredits, false);
  assert.equal(quote.expiresAt, '2026-08-11T09:00:00.000Z');
  assert.equal(quote.packageContract?.allocations.length, 2);
  assert.deepEqual(quote.packageContract?.allocations, [
    {
      allocationId: 'copy',
      carrier: 'copy',
      deliveryUnits: 1,
      creditCost: 2,
      failureRefundsCredits: false,
      operation: 'copy.generate',
      catalogModel: { id: 'copy-v4', revision: 'catalog-copy-r4' },
      routeSnapshotRef: 'route-copy-r4',
      rightsRevisionRefs: ['rights-copy-r4'],
    },
    {
      allocationId: 'note',
      carrier: 'note',
      deliveryUnits: 4,
      creditCost: 20,
      failureRefundsCredits: true,
      operation: 'image.generate',
      catalogModel: { id: 'image-note-v2', revision: 'catalog-image-r2' },
      routeSnapshotRef: 'route-note-r2',
      rightsRevisionRefs: ['rights-note-r2'],
    },
  ]);
  assert.match(quote.packageContract?.contractHash ?? '', /^[a-f0-9]{64}$/u);
});

test('package authority fails closed when a final carrier lacks its server authority', async () => {
  const { authority } = packageAuthority();

  await assert.rejects(
    authority.resolvePackage({
      quoteId: 'quote-package-missing-copy-authority',
      workspaceId: 'workspace-package',
      carrierAuthorities: [
        {
          allocationId: 'note',
          carrier: 'note',
          catalogModelId: 'image-note-v2',
          operation: 'image.generate',
          routeSnapshotRef: 'route-note-r2',
          rightsRevisionRefs: ['rights-note-r2'],
        },
      ],
      finalDeliverables: [
        { allocationId: 'note', carrier: 'note', deliveryUnits: 4 },
        { allocationId: 'copy', carrier: 'copy', deliveryUnits: 1 },
      ],
    }),
    /exactly cover final deliverables/u,
  );
});

test('package authority rejects incomplete server carrier authority instead of filling an operation or route', async () => {
  const { authority } = packageAuthority();

  await assert.rejects(
    authority.resolvePackage({
      quoteId: 'quote-package-missing-route',
      workspaceId: 'workspace-package',
      carrierAuthorities: [
        {
          allocationId: 'copy',
          carrier: 'copy',
          catalogModelId: 'copy-v4',
          operation: 'copy.generate',
          routeSnapshotRef: '',
          rightsRevisionRefs: ['rights-copy-r4'],
        },
      ],
      finalDeliverables: [
        { allocationId: 'copy', carrier: 'copy', deliveryUnits: 1 },
      ],
    }),
    /authority copy is incomplete/u,
  );
});
