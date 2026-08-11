import assert from 'node:assert/strict';
import test from 'node:test';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import {
  createCampaignWorkQuoteMinter,
  publicOperationForComposerSubmission,
} from './campaign-work-quote.js';
import type { ComposerSubmissionRequest } from '../execution-spine/creation-execution-snapshot.js';
import { pickComposerSubmissionSignedFields } from '@meiye/contracts';

function baseSubmission(
  overrides: Partial<ComposerSubmissionRequest> = {},
): ComposerSubmissionRequest {
  return {
    actorId: 'merchant-1',
    workspaceId: 'workspace-1',
    idempotencyKey: 'composer-campaign-1',
    intent: '第一周夏日护理海报',
    creationMode: 'customized',
    surface: { id: 'surface-1', revision: 'surface-r1' },
    recipe: { id: 'recipe.promotion_poster', revision: 'recipe-r1' },
    catalogModel: { id: 'image-model', revision: 'model-r1' },
    quote: { id: 'quote-work-1', revision: '1' },
    route: { id: 'route-1', revision: 'route-r1' },
    briefContext: { id: 'brief-1', revision: 1 },
    deliverable: {
      kind: 'poster',
      quantity: 1,
      aspectRatio: '3:4',
    },
    contentPackagePlatform: 'offline_material',
    distributionTarget: 'export',
    sources: { assets: [] },
    rights: { revision: 'rights-r1', summary: 'ok' },
    identity: { id: 'identity-1', revision: '1' },
    modelPolicy: { mode: 'auto' },
    contentModules: ['image'],
    ...overrides,
  } as ComposerSubmissionRequest;
}

test('publicOperationForComposerSubmission maps poster to image.generate', () => {
  const submission = baseSubmission();
  assert.equal(
    publicOperationForComposerSubmission(submission),
    'image.generate',
  );
});

test('ensureQuoteForSubmission reuses quote when contract hash matches', async () => {
  const submission = baseSubmission();
  const signed = pickComposerSubmissionSignedFields(
    submission as unknown as Record<string, unknown>,
  );
  const hash = fingerprintValue(signed);
  let buildCalls = 0;
  const minter = createCampaignWorkQuoteMinter({
    authority: {
      async resolve() {
        throw new Error('should not resolve when hash matches');
      },
    },
    quotes: {
      async getQuote() {
        return {
          quoteId: 'quote-work-1',
          revision: '1',
          submissionContractHash: hash,
          catalogModelId: 'image-model',
          lifecycleStatus: 'quoted',
        } as never;
      },
      async buildQuote() {
        buildCalls += 1;
        throw new Error('should not build');
      },
    },
  });

  const ensured = await minter.ensureQuoteForSubmission(submission);
  assert.equal(ensured.quote.id, 'quote-work-1');
  assert.equal(buildCalls, 0);
});

test('ensureQuoteForSubmission mints a new quote when intent changes (Work2)', async () => {
  const work1 = baseSubmission();
  const work2 = baseSubmission({
    idempotencyKey: 'composer-campaign-1:campaign:2',
    intent: '第二周补水护理海报',
    quote: { id: 'quote-work-1', revision: '1' },
  });
  const work1Signed = pickComposerSubmissionSignedFields(
    work1 as unknown as Record<string, unknown>,
  );
  const work1Hash = fingerprintValue(work1Signed);
  const store = new Map<string, Record<string, unknown>>();
  store.set('quote-work-1', {
    quoteId: 'quote-work-1',
    revision: '1',
    submissionContractHash: work1Hash,
    catalogModelId: 'image-model',
    lifecycleStatus: 'quoted',
  });

  let resolvedSubmissionIntent: string | undefined;
  let buildCalls = 0;
  const minter = createCampaignWorkQuoteMinter({
    authority: {
      async resolve(input) {
        resolvedSubmissionIntent = input.submission?.intent;
        assert.equal(input.operation, 'image.generate');
        assert.equal(input.catalogModelId, 'image-model');
        assert.ok(input.submission);
        return {
          billingMode: 'per_request',
          catalogModelId: 'image-model',
          catalogModelRevision: 'model-r1',
          creditCost: 10,
          currency: 'CREDITS',
          failureRefundsCredits: true,
          formulaExpression: '10 credits',
          operation: 'image.generate',
          outputCount: 1,
          outputLabel: '1 image',
          quoteId: input.quoteId,
          quotePolicyRevision: 'quote.policy@1',
          submissionContractHash: fingerprintValue(input.submission!),
          unitRate: 10,
          workspaceId: input.workspaceId,
          expiresAt: '2099-01-01T00:00:00.000Z',
        };
      },
    },
    quotes: {
      async getQuote(quoteId) {
        return (store.get(quoteId) as never) ?? null;
      },
      async buildQuote(input) {
        buildCalls += 1;
        const row = {
          quoteId: input.quoteId,
          revision: '1',
          submissionContractHash: input.submissionContractHash,
          catalogModelId: input.catalogModelId,
          lifecycleStatus: 'quoted',
          creditCost: input.creditCost,
        };
        store.set(input.quoteId, row);
        return row as never;
      },
    },
  });

  const ensured = await minter.ensureQuoteForSubmission(work2);
  assert.notEqual(ensured.quote.id, 'quote-work-1');
  assert.match(ensured.quote.id, /^campaign-work-quote:/u);
  assert.equal(resolvedSubmissionIntent, '第二周补水护理海报');
  assert.equal(ensured.intent, '第二周补水护理海报');
  assert.equal(buildCalls, 1);

  // Recovery retry must reuse the stable campaign quote, not rebuild.
  const stillHasWork1Quote = {
    ...work2,
    quote: { id: 'quote-work-1', revision: '1' },
  };
  const retry = await minter.ensureQuoteForSubmission(stillHasWork1Quote);
  assert.equal(retry.quote.id, ensured.quote.id);
  assert.equal(buildCalls, 1);
});