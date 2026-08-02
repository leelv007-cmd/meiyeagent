import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CatalogProductQuoteAuthority } from './server-quote-authority.js';
import { createDefaultCatalogModels } from '../model-supply/catalog.js';

function authority(credits = 5) {
  return new CatalogProductQuoteAuthority({
    async getCatalog(_workspaceId, operation) {
      return {
        models: [
          {
            id: operation === 'video.generate' ? 'video-model' : 'image-model',
            creditPricing: {
              [operation]: {
                creditCost: credits,
                failureRefundsCredits: true,
                ...(operation === 'video.generate'
                  ? { videoCreditCosts: { 15: 50, 30: 90, 60: 160 } }
                  : {}),
              },
            },
          },
        ],
        revisionId: 'catalog-r11',
      };
    },
  });
}

describe('CatalogProductQuoteAuthority', () => {
  it('quotes every published credit operation from its own price and refund policy', async () => {
    const operations = [
      'copy.generate',
      'copy.adapt',
      'image.generate',
      'image.edit',
      'image.reference_transform',
      'video.generate',
      'audio.speech',
      'audio.sfx',
    ] as const;
    const quoteAuthority = new CatalogProductQuoteAuthority({
      async getCatalog(_workspaceId, operation) {
        const index = operations.indexOf(operation);
        return {
          models: [{
            id: `model-${index}`,
            creditPricing: {
              [operation]: {
                creditCost: index + 1,
                failureRefundsCredits: index % 2 === 0,
                ...(operation === 'video.generate'
                  ? { videoCreditCosts: { 15: index + 1 } }
                  : {}),
              },
            },
          }],
          revisionId: 'catalog-eight-operations',
        };
      },
    });

    for (const [index, operation] of operations.entries()) {
      const quote = await quoteAuthority.resolve({
        catalogModelId: `model-${index}`,
        operation: operation as never,
        quantity: 1,
        quoteId: `quote-${operation}`,
        ...(operation === 'video.generate' ? { targetSeconds: 15 } : {}),
        workspaceId: 'workspace-eight-operations',
      });
      assert.equal(quote.operation, operation);
      assert.equal(quote.creditCost, index + 1);
      assert.equal(quote.failureRefundsCredits, index % 2 === 0);
      assert.ok(quote.outputLabel?.length);
      // Result-adjust / free+deep Selection AI quotes have no Composer
      // submission body; authority must still freeze a contract hash so
      // merchant execution can reserve a complete credit quote.
      assert.match(quote.submissionContractHash ?? '', /^[a-f0-9]{64}$/u);
    }
  });

  it('quotes all eight operations from the published default catalog', async () => {
    const models = createDefaultCatalogModels();
    const quoteAuthority = new CatalogProductQuoteAuthority({
      async getCatalog() {
        return { models, revisionId: 'published-default-catalog' };
      },
    });
    for (const operation of [
      'copy.generate',
      'copy.adapt',
      'image.generate',
      'image.edit',
      'image.reference_transform',
      'video.generate',
      'audio.speech',
      'audio.sfx',
    ] as const) {
      const model = models.find((candidate) => candidate.creditPricing?.[operation]);
      assert.ok(model, `missing default pricing for ${operation}`);
      const pricing = model.creditPricing?.[operation];
      const quote = await quoteAuthority.resolve({
        catalogModelId: model.id,
        operation,
        quoteId: `default-${operation}`,
        ...(operation === 'video.generate' ? { targetSeconds: 15 } : {}),
        workspaceId: 'workspace-default-catalog',
      });
      assert.equal(
        quote.creditCost,
        operation === 'video.generate'
          ? pricing?.videoCreditCosts?.[15]
          : pricing?.creditCost,
      );
      assert.equal(
        quote.failureRefundsCredits,
        pricing?.failureRefundsCredits,
      );
    }
  });

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
    assert.equal(quote.creditCost, 15);
    assert.equal(quote.failureRefundsCredits, true);
    assert.equal(quote.unitRate, 15);
    assert.equal(quote.outputCount, 3);
    assert.equal(quote.outputLabel, '3 张 1:1 图片');
    assert.equal(quote.authorizedCeiling, undefined);
    assert.equal(quote.routeSnapshotRef, undefined);
    assert.equal(quote.frozenCandidateDeploymentIds, undefined);
    assert.equal(quote.debitUnits, undefined);
  });

  it('preflights both copy and image buckets for an image-text package', async () => {
    const quote = await authority().resolve({
      catalogModelId: 'image-model',
      operation: 'image.generate',
      quantity: 4,
      quoteId: 'quote-image-text',
      submission: {
        creationMode: 'customized',
        intent: '生成一组带文案的护理项目图文',
        catalogModel: { id: 'image-model', revision: 'catalog-r11' },
        recipe: { id: 'recipe-note', revision: 'recipe-note@1' },
        contentPackagePlatform: 'xiaohongshu',
        distributionTarget: 'export',
        deliverable: {
          kind: 'image_text_package',
          quantity: 4,
          aspectRatio: '3:4',
        },
      },
      workspaceId: 'workspace-1',
    });

    assert.equal(quote.creditCost, 20);
  });

  it('uses the signed note page bound for the image-text debit preview', async () => {
    const quote = await authority().resolve({
      catalogModelId: 'image-model',
      operation: 'image.generate',
      quoteId: 'quote-note',
      submission: {
        creationMode: 'customized',
        intent: '生成三页项目种草笔记',
        catalogModel: { id: 'image-model', revision: 'catalog-r11' },
        recipe: { id: 'recipe-note', revision: 'recipe-note@1' },
        contentPackagePlatform: 'xiaohongshu',
        distributionTarget: 'export',
        deliverable: {
          kind: 'note',
          quantity: 1,
          aspectRatio: '3:4',
          notePageBound: 3,
        },
      },
      workspaceId: 'workspace-1',
    });

    assert.equal(quote.creditCost, 15);
  });

  it('selects the explicit video duration tier and rejects a model absent from the catalog', async () => {
    const quote = await authority().resolve({
      catalogModelId: 'video-model',
      operation: 'video.generate',
      quoteId: 'quote-video',
      targetSeconds: 30,
      workspaceId: 'workspace-1',
    });

    assert.equal(quote.billingMode, 'per_request');
    assert.equal(quote.creditCost, 90);
    assert.equal(quote.unitRate, 90);
    assert.equal(quote.targetSeconds, 30);
    assert.equal(quote.minChargeSeconds, undefined);
    assert.equal(quote.roundingStepSeconds, undefined);
    assert.equal(quote.debitUnits, undefined);

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

  it('derives video duration from the signed submission instead of a caller override', async () => {
    const submission = {
      creationMode: 'customized' as const,
      intent: '生成一支疗程介绍短片',
      catalogModel: { id: 'video-model', revision: 'catalog-r11' },
      recipe: { id: 'recipe-video', revision: 'recipe-video@1' },
      contentPackagePlatform: 'douyin' as const,
      distributionTarget: 'export' as const,
      deliverable: {
        kind: 'video_package' as const,
        quantity: 1,
        durationSeconds: 60,
      },
    };
    const quote = await authority().resolve({
      catalogModelId: 'video-model',
      operation: 'video.generate',
      quoteId: 'quote-signed-video-60',
      submission,
      workspaceId: 'workspace-1',
    });
    assert.equal(quote.targetSeconds, 60);
    assert.equal(quote.creditCost, 160);
    await assert.rejects(
      authority().resolve({
        catalogModelId: 'video-model',
        operation: 'video.generate',
        quoteId: 'quote-signed-video-15',
        submission,
        targetSeconds: 15,
        workspaceId: 'workspace-1',
      }),
      /signed deliverable duration/i,
    );
  });

  it('fails closed on malformed credit pricing and invalid quantity', async () => {
    await assert.rejects(
      authority(Number.NaN).resolve({
        catalogModelId: 'image-model',
        operation: 'image.generate',
        quoteId: 'quote-invalid-price',
        workspaceId: 'workspace-1',
      }),
      /credit pricing/i,
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

  it('rejects a quantity that drifts from the signed deliverable', async () => {
    await assert.rejects(
      authority().resolve({
        catalogModelId: 'image-model',
        operation: 'image.generate',
        quantity: 2,
        quoteId: 'quote-quantity-drift',
        submission: {
          creationMode: 'customized',
          intent: '生成一张活动配图',
          catalogModel: { id: 'image-model', revision: 'catalog-r11' },
          recipe: { id: 'recipe-image', revision: 'recipe-image@1' },
          contentPackagePlatform: 'xiaohongshu',
          distributionTarget: 'export',
          deliverable: {
            kind: 'image_set',
            quantity: 1,
            aspectRatio: '3:4',
          },
        },
        workspaceId: 'workspace-1',
      }),
      /signed deliverable quantity/u,
    );
  });

  it('changes the signed preview when the destination contract changes', async () => {
    const baseSubmission = {
      creationMode: 'customized' as const,
      intent: '为夏日护理项目写一组预约图片',
      catalogModel: { id: 'image-model', revision: 'catalog-r11' },
      recipe: { id: 'recipe-image', revision: 'recipe-image@1' },
      contentPackagePlatform: 'xiaohongshu' as const,
      distributionTarget: 'export' as const,
      deliverable: {
        kind: 'image_set' as const,
        quantity: 1,
        aspectRatio: '3:4' as const,
      },
    };
    const xhs = await authority().resolve({
      catalogModelId: 'image-model',
      operation: 'image.generate',
      quoteId: 'quote-xhs',
      submission: baseSubmission,
      workspaceId: 'workspace-1',
    });
    const moments = await authority().resolve({
      catalogModelId: 'image-model',
      operation: 'image.generate',
      quoteId: 'quote-moments',
      submission: {
        ...baseSubmission,
        contentPackagePlatform: 'wechat_moments',
        distributionTarget: 'assisted_handoff',
      },
      workspaceId: 'workspace-1',
    });

    assert.match(xhs.submissionContractHash ?? '', /^[a-f0-9]{64}$/u);
    assert.notEqual(
      xhs.submissionContractHash,
      moments.submissionContractHash,
    );

    const freeMode = await authority().resolve({
      catalogModelId: 'image-model',
      operation: 'image.generate',
      quoteId: 'quote-free',
      submission: { ...baseSubmission, creationMode: 'free' },
      workspaceId: 'workspace-1',
    });
    const freeDeep = await authority().resolve({
      catalogModelId: 'image-model',
      operation: 'image.generate',
      quoteId: 'quote-free-deep',
      submission: {
        ...baseSubmission,
        creationMode: 'free',
        thinkingLevel: 'deep',
      },
      workspaceId: 'workspace-1',
    });
    const changedIntent = await authority().resolve({
      catalogModelId: 'image-model',
      operation: 'image.generate',
      quoteId: 'quote-new-intent',
      submission: { ...baseSubmission, intent: '为秋季护理项目写一组预约图片' },
      workspaceId: 'workspace-1',
    });

    assert.notEqual(xhs.submissionContractHash, freeMode.submissionContractHash);
    assert.notEqual(
      freeMode.submissionContractHash,
      freeDeep.submissionContractHash,
    );
    // free+deep must still freeze a complete merchant execution contract shape
    // (operation + outputCount + submissionContractHash + creditCost).
    for (const quote of [freeMode, freeDeep]) {
      assert.equal(quote.operation, 'image.generate');
      assert.equal(quote.outputCount, 1);
      assert.ok(quote.submissionContractHash);
      assert.ok(
        quote.creditCost !== undefined && quote.creditCost >= 1,
        'free creation still prices merchant credits from the catalog',
      );
    }
    assert.notEqual(
      xhs.submissionContractHash,
      changedIntent.submissionContractHash,
    );
  });
});
