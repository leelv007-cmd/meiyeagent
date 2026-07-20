import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  adaptCanvasPersistedQuote,
  adaptClientQuoteFor,
  adaptCreativeExecutionQuote,
  projectAdapterQuoteView,
} from './canvas-quote-adapter.js';
import { ProductQuoteService } from './quote-service.js';

describe('quote source adapters (no fourth quote object)', () => {
  it('adapts CreativeExecutionContract quote fields without field duplication', () => {
    const contract = {
      catalogModelId: 'seedance-2',
      catalogRevision: 'catalog-r1',
      quoteRevision: 'catalog-r1:price-r1:seedance-2:video.generate:9:16',
      estimatedAmount: 6,
      currency: 'CNY',
      durationSeconds: 12,
      outputCount: 1,
    };

    const input = adaptCreativeExecutionQuote(contract, {
      quoteId: 'quote-from-contract',
      billingMode: 'per_output_second',
      minChargeSeconds: 4,
      roundingStepSeconds: 1,
      routeSnapshotRef: 'route-from-ops',
      frozenCandidateDeploymentIds: ['dep-1'],
      workspaceId: 'ws-1',
    });

    // Maps existing contract fields — does not invent parallel amount fields
    assert.equal(input.catalogModelId, contract.catalogModelId);
    assert.equal(input.catalogModelRevision, contract.catalogRevision);
    assert.equal(input.quotePolicyRevision, contract.quoteRevision);
    assert.equal(input.targetSeconds, contract.durationSeconds);
    assert.equal(input.currency, contract.currency);
    assert.equal(input.unitRate, 0.5); // 6 / 12

    const view = projectAdapterQuoteView(input, '2026-07-20T12:00:00.000Z');
    assert.equal(view.quoteId, 'quote-from-contract');
    assert.equal(view.billingMode, 'per_output_second');
    assert.equal(view.quotedSeconds, 12);
    assert.equal(view.confirmedAmount, 6);
    assert.equal(view.routeSnapshotRef, 'route-from-ops');
    // View is a projection of ProductQuoteSnapshot fields only
    assert.equal(
      'estimatedAmount' in view,
      false,
      'must not copy CreativeExecutionContract.estimatedAmount as a parallel field',
    );
  });

  it('adapts canvas persisted quote into build input (no field copy store)', () => {
    const canvasQuote = {
      quoteId: 'canvas-quote-abc',
      catalogRevisionId: 'recorded-default-v1',
      deploymentId: 'seedance-primary',
      operation: 'video.generate',
      priceRevision: 'seedance:price-r1',
      routeSnapshot: {
        id: 'route-snap-1',
        actualCatalogModelId: 'seedance-2',
        allowedCandidates: [
          { deploymentId: 'seedance-primary' },
          { deploymentId: 'seedance-fallback' },
        ],
      },
      estimatedProviderCost: {
        amountMicros: 200_000,
        currency: 'CNY' as const,
        unit: 'second',
      },
      workspaceId: 'ws-canvas',
      createdAt: '2026-07-20T10:00:00.000Z',
    };

    const input = adaptCanvasPersistedQuote(canvasQuote, {
      targetSeconds: 8,
      minChargeSeconds: 4,
      taskId: 'task-canvas-1',
    });

    assert.equal(input.quoteId, canvasQuote.quoteId);
    assert.equal(input.catalogModelId, 'seedance-2');
    assert.equal(input.catalogModelRevision, canvasQuote.catalogRevisionId);
    assert.equal(input.quotePolicyRevision, canvasQuote.priceRevision);
    assert.equal(input.routeSnapshotRef, canvasQuote.routeSnapshot.id);
    assert.equal(input.billingMode, 'per_output_second');
    assert.equal(input.unitRate, 0.2);
    assert.deepEqual(input.frozenCandidateDeploymentIds, [
      'seedance-primary',
      'seedance-fallback',
    ]);

    // Feeding adapter output into ProductQuoteService freezes the single snapshot
    const quotes = new ProductQuoteService({
      clock: () => new Date('2026-07-20T12:00:00.000Z'),
    });
    const snapshot = quotes.buildQuote(input);
    assert.equal(snapshot.quoteId, canvasQuote.quoteId);
    assert.equal(snapshot.routeSnapshotRef, 'route-snap-1');
    assert.equal(snapshot.lifecycleStatus, 'quoted');

    // Adapter does not persist a second canvas-shaped object
    assert.equal(
      'deploymentId' in snapshot,
      false,
      'ProductQuoteSnapshot must not duplicate canvas deploymentId field',
    );
    assert.equal(
      'estimatedProviderCost' in snapshot,
      false,
      'ProductQuoteSnapshot must not duplicate canvas estimatedProviderCost',
    );
    assert.equal(
      'payloadHash' in snapshot,
      false,
      'ProductQuoteSnapshot must not duplicate canvas payloadHash',
    );
  });

  it('adapts client quoteFor preview into build input', () => {
    const client = {
      catalogModelId: 'model-image',
      catalogRevision: 'cat-1',
      quoteRevision: 'quote-rev-1',
      billingMode: 'per_request' as const,
      unitRate: 1,
      currency: 'CNY',
      estimatedAmount: 1,
    };

    const input = adaptClientQuoteFor(client, {
      quoteId: 'quote-client-1',
      workspaceId: 'ws-1',
      routeSnapshotRef: 'route-img',
    });

    assert.equal(input.billingMode, 'per_request');
    assert.equal(input.unitRate, 1);
    assert.equal(input.quotePolicyRevision, 'quote-rev-1');

    const view = projectAdapterQuoteView(input, '2026-07-20T12:00:00.000Z');
    assert.equal(view.confirmedAmount, 1);
    assert.equal(view.quotedSeconds, undefined);
  });

  it('three sources converge into the same ProductQuoteSnapshot shape via service', () => {
    const quotes = new ProductQuoteService({
      clock: () => new Date('2026-07-20T12:00:00.000Z'),
    });

    const fromContract = quotes.buildQuote(
      adaptCreativeExecutionQuote(
        {
          catalogModelId: 'm1',
          catalogRevision: 'c1',
          quoteRevision: 'q1',
          estimatedAmount: 1,
          currency: 'CNY',
        },
        {
          quoteId: 'q-contract',
          billingMode: 'per_request',
          workspaceId: 'ws',
        },
      ),
    );

    const fromCanvas = quotes.buildQuote(
      adaptCanvasPersistedQuote(
        {
          quoteId: 'q-canvas',
          catalogRevisionId: 'c1',
          deploymentId: 'd1',
          operation: 'image.generate',
          priceRevision: 'q1',
          routeSnapshot: {
            id: 'r1',
            actualCatalogModelId: 'm1',
            allowedCandidates: [{ deploymentId: 'd1' }],
          },
          estimatedProviderCost: {
            amountMicros: 1_000_000,
            currency: 'CNY',
            unit: 'request',
          },
          workspaceId: 'ws',
        },
        { billingMode: 'per_request', unitRate: 1 },
      ),
    );

    const fromClient = quotes.buildQuote(
      adaptClientQuoteFor(
        {
          catalogModelId: 'm1',
          quoteRevision: 'q1',
          billingMode: 'per_request',
          unitRate: 1,
          currency: 'CNY',
        },
        { quoteId: 'q-client', workspaceId: 'ws' },
      ),
    );

    for (const snapshot of [fromContract, fromCanvas, fromClient]) {
      assert.equal(snapshot.billingMode, 'per_request');
      assert.equal(snapshot.lifecycleStatus, 'quoted');
      assert.equal(typeof snapshot.formula.unitRate, 'number');
      assert.equal(typeof snapshot.quotePolicyRevision, 'string');
      assert.ok(snapshot.confirmedAmount !== undefined);
      assert.ok(snapshot.authorizedCeiling !== undefined);
    }
  });
});
