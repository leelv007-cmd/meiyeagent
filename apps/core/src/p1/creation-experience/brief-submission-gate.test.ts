import assert from 'node:assert/strict';
import test from 'node:test';

import { confirmBrief, projectBriefTrigger } from './brief-trigger-projection.js';
import { MemoryBriefConfirmationRepository } from './brief-confirmation-repository.js';
import { CreationExperienceBriefSubmissionGate } from './brief-submission-gate.js';
import { MemoryCreationExperienceCatalogRepository } from './memory-repository.js';
import {
  CompositeBriefRevisionResolver,
  MemoryBriefRevisionContextRepository,
  briefIntentRevisionId,
  briefSourceRevisionId,
} from './postgres-brief-revision-context.js';

test('server submission gate requires a durable current confirmation when projection requires Brief', async () => {
  const workspaceId = 'workspace-a';
  const briefContextId = 'brief-context-a';
  const contexts = new MemoryBriefRevisionContextRepository();
  const confirmations = new MemoryBriefConfirmationRepository();
  const context = await contexts.syncBriefRevisionContext(
    workspaceId,
    {
      briefContextId,
      draftRevisionId: 'draft:hash-a',
      intentRevisionId: briefIntentRevisionId('safe intent'),
      lensId: 'video',
      projectionFacts: {
        aspectRatio: '9:16',
        crossPlatform: false,
        deliverableCount: 1,
        durationSeconds: 15,
        highRiskFacts: [],
        imageCount: 0,
        outputCount: 1,
        restrictedAssets: false,
      },
      quoteId: 'quote-a',
      recipeRevisionId: 'recipe.video@3',
      sourceRevisionId: briefSourceRevisionId([]),
      surfaceRevisionId: 'surface.home@3',
    },
    null,
  );
  let current = {
    draftRevisionId: context.draftRevisionId,
    lensId: context.lensId,
    modelRevisionId: 'model@1',
    quoteRevisionId: 'quote@1',
    recipeRevisionId: context.recipeRevisionId,
    sourceRevisionId: context.sourceRevisionId,
    surfaceRevisionId: context.surfaceRevisionId,
  };
  const projection = projectBriefTrigger({
    currentRevisions: current,
    lensId: 'video',
  });
  await contexts.recordBriefProjection(
    workspaceId,
    briefContextId,
    context.revision,
    {
      bindRevisions: projection.bindRevisions,
      requiresBrief: projection.requiresBrief,
    },
  );
  const gate = new CreationExperienceBriefSubmissionGate(
    contexts,
    confirmations,
    {
      resolveCurrentRevisions() {
        return current;
      },
      resolveCurrentQuoteSignal() {
        return null;
      },
    },
  );
  await assert.rejects(
    () =>
      gate.assertCurrent({
        briefContextId,
        intent: 'safe intent',
        operation: 'video.generate',
        sourceReferenceIds: [],
        workspaceId,
      }),
    /durable Brief confirmation is required/,
  );
  await confirmations.putBriefConfirmation(
    workspaceId,
    'confirmation-a',
    confirmBrief({ projection }),
  );
  await gate.assertCurrent({
    briefConfirmationId: 'confirmation-a',
    briefContextId,
    intent: 'safe intent',
    operation: 'video.generate',
    sourceReferenceIds: [],
    workspaceId,
  });
  await assert.rejects(
    () =>
      gate.assertCurrent({
        briefConfirmationId: 'confirmation-a',
        briefContextId,
        expectedContextRevision: context.revision + 1,
        intent: 'safe intent',
        operation: 'video.generate',
        sourceReferenceIds: [],
        workspaceId,
      }),
    /Brief context revision changed/,
  );
  await assert.rejects(
    () =>
      gate.assertCurrent({
        briefConfirmationId: 'confirmation-a',
        briefContextId,
        intent: 'safe intent',
        operation: 'video.generate',
        outputCount: 1,
        sourceReferenceIds: [],
        workspaceId,
      }),
    /aspect ratio does not match/,
  );
  await gate.assertCurrent({
    aspectRatio: '9:16',
    briefConfirmationId: 'confirmation-a',
    briefContextId,
    durationSeconds: 15,
    intent: 'safe intent',
    operation: 'video.generate',
    outputCount: 1,
    sourceReferenceIds: [],
    workspaceId,
  });
  await assert.rejects(
    () =>
      gate.assertCurrent({
        briefConfirmationId: 'confirmation-a',
        briefContextId,
        intent: 'safe intent',
        operation: 'audio.speech',
        sourceReferenceIds: [],
        workspaceId,
      }),
    /no registered Brief Lens policy/,
  );
  await assert.rejects(
    () =>
      gate.assertCurrent({
        briefConfirmationId: 'confirmation-a',
        briefContextId,
        intent: 'safe intent',
        operation: 'video.generate',
        outputCount: 100,
        sourceReferenceIds: [],
        workspaceId,
      }),
    /output count does not match/,
  );
  await assert.rejects(
    () =>
      gate.assertCurrent({
        briefConfirmationId: 'confirmation-a',
        briefContextId,
        catalogRevision: 'fake-catalog@999',
        intent: 'safe intent',
        operation: 'video.generate',
        sourceReferenceIds: [],
        workspaceId,
      }),
    /model Catalog revision does not match/,
  );
  await assert.rejects(
    () =>
      gate.assertCurrent({
        briefConfirmationId: 'confirmation-a',
        briefContextId,
        catalogModelId: 'model-other',
        intent: 'safe intent',
        operation: 'video.generate',
        sourceReferenceIds: [],
        workspaceId,
      }),
    /model id does not match/,
  );
  await assert.rejects(
    () =>
      gate.assertCurrent({
        briefConfirmationId: 'confirmation-a',
        briefContextId,
        intent: 'changed high-risk intent',
        operation: 'video.generate',
        sourceReferenceIds: [],
        workspaceId,
      }),
    /intent does not match/,
  );
  await assert.rejects(
    () =>
      gate.assertCurrent({
        briefConfirmationId: 'confirmation-a',
        briefContextId,
        intent: 'safe intent',
        operation: 'video.generate',
        sourceReferenceIds: ['restricted-asset'],
        workspaceId,
      }),
    /sources do not match/,
  );
  await assert.rejects(
    () =>
      gate.assertCurrent({
        briefConfirmationId: 'confirmation-a',
        briefContextId,
        intent: 'safe intent',
        operation: 'video.generate',
        quoteRevision: 'quote@different',
        sourceReferenceIds: [],
        workspaceId,
      }),
    /quote revision does not match/,
  );
  current = { ...current, quoteRevisionId: 'quote@2' };
  await assert.rejects(
    () =>
      gate.assertCurrent({
        briefConfirmationId: 'confirmation-a',
        briefContextId,
        intent: 'safe intent',
        operation: 'video.generate',
        sourceReferenceIds: [],
        workspaceId,
      }),
    /projection is stale/,
  );
});

test('D1 policy_exempt_copy submits without a Brief confirmation even when requiresBrief is true', async () => {
  const workspaceId = 'workspace-copy';
  const briefContextId = 'brief-context-copy';
  const contexts = new MemoryBriefRevisionContextRepository();
  const confirmations = new MemoryBriefConfirmationRepository();
  const context = await contexts.syncBriefRevisionContext(
    workspaceId,
    {
      briefContextId,
      draftRevisionId: 'draft:hash-copy',
      intentRevisionId: briefIntentRevisionId('价格稍后补充'),
      lensId: 'copy',
      projectionFacts: {
        aspectRatio: null,
        crossPlatform: false,
        deliverableCount: 1,
        durationSeconds: null,
        highRiskFacts: [{ kind: 'price', status: 'missing' }],
        imageCount: 0,
        outputCount: 1,
        restrictedAssets: false,
      },
      quoteId: 'quote-copy',
      recipeRevisionId: 'recipe.copy@1',
      sourceRevisionId: briefSourceRevisionId([]),
      surfaceRevisionId: 'surface.home@3',
    },
    null,
  );
  const current = {
    draftRevisionId: context.draftRevisionId,
    lensId: context.lensId,
    modelRevisionId: 'model@1',
    quoteRevisionId: 'quote@1',
    recipeRevisionId: context.recipeRevisionId,
    sourceRevisionId: context.sourceRevisionId,
    surfaceRevisionId: context.surfaceRevisionId,
  };
  await contexts.recordBriefProjection(
    workspaceId,
    briefContextId,
    context.revision,
    {
      bindRevisions: current,
      requiresBrief: true,
    },
  );
  const gate = new CreationExperienceBriefSubmissionGate(
    contexts,
    confirmations,
    {
      resolveCurrentRevisions() {
        return current;
      },
      resolveCurrentQuoteSignal() {
        return null;
      },
    },
  );
  const admitted = await gate.assertCurrent({
    briefContextId,
    intent: '价格稍后补充',
    operation: 'copy.generate',
    sourceReferenceIds: [],
    workspaceId,
  });
  assert.deepEqual(admitted, { contextRevision: context.revision });
});

test('revision resolver reads the frozen policy threshold and fails closed without a selected model revision', async () => {
  const contexts = new MemoryBriefRevisionContextRepository();
  await contexts.syncBriefRevisionContext(
    'workspace-a',
    {
      briefContextId: 'brief-context-policy',
      draftRevisionId: 'draft:policy',
      lensId: 'copy',
      quoteId: 'quote-policy',
      recipeRevisionId: null,
      sourceRevisionId: briefSourceRevisionId([]),
      surfaceRevisionId: null,
    },
    null,
  );
  let selectedModelRevision: string | undefined;
  const resolver = new CompositeBriefRevisionResolver(
    contexts,
    new MemoryCreationExperienceCatalogRepository(),
    {
      async getCurrentPublishedCatalogRevision() {
        return { id: 'catalog-head-must-not-be-used' };
      },
    },
    {
      async getQuote() {
        return {
          catalogModelId: 'model-selected',
          ...(selectedModelRevision
            ? { catalogModelRevision: selectedModelRevision }
            : {}),
          confirmedAmount: 15,
          extraConfirmThreshold: 10,
          quotePolicyRevision: 'quote.policy@threshold-10',
          revision: 'quote@policy-1',
        };
      },
    },
  );
  await assert.rejects(
    () =>
      resolver.resolveCurrentRevisions('workspace-a', {
        briefContextId: 'brief-context-policy',
      }),
    /missing its selected model revision/,
  );
  selectedModelRevision = 'model-selected@7';
  const revisions = await resolver.resolveCurrentRevisions('workspace-a', {
    briefContextId: 'brief-context-policy',
  });
  assert.equal(revisions.modelRevisionId, 'model-selected@7');
  const quote = await resolver.resolveCurrentQuoteSignal('workspace-a', {
    briefContextId: 'brief-context-policy',
  });
  assert.equal(quote?.extraConfirmThreshold, 10);
});
