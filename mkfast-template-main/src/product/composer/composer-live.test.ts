import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  BrowserSurfaceProjection,
  CreativeToolEntry,
  ProductQuoteSnapshot,
} from '@meiye/contracts';

import {
  buildLiveBriefInput,
  buildLiveQuoteInput,
  confirmComposerBrief,
  fetchComposerCatalogSource,
  fetchComposerPreferences,
  fetchComposerSurface,
  requestComposerBrief,
  requestComposerQuote,
  requestRecipePatchPreview,
  syncComposerBriefContext,
} from './composer-live';

describe('Composer live public contracts', () => {
  it('loads the published launch surface through the creation module', async () => {
    const calls: unknown[] = [];
    const fixture = {
      surfaceId: 'surface.home.launch',
    } as BrowserSurfaceProjection;
    const result = await fetchComposerSurface(undefined, async (...args) => {
      calls.push(args);
      return fixture;
    });

    assert.equal(result, fixture);
    assert.deepEqual(calls, [
      [
        'creation-experience',
        {
          action: 'surface_browser',
          payload: { surfaceId: 'surface.home.launch' },
        },
        undefined,
      ],
    ]);
  });

  it('loads live Surface recipes and ToolEntry registry for fullscreen catalog', async () => {
    const calls: unknown[] = [];
    const surface = {
      surfaceId: 'surface.home.launch',
      revision: 7,
      revisionId: 'surface.home.launch@7',
      status: 'published',
      recipeRefs: [],
      toolEntryRefs: [],
      contentHash: 'hash',
      recipes: [],
    } satisfies BrowserSurfaceProjection;
    const tools: CreativeToolEntry[] = [
      {
        id: 'tool.multi_size',
        label: '服务端多尺寸',
        summary: '服务端工具说明',
        kind: 'standalone_tool',
        container: 'route',
        order: 9,
      },
    ];
    const result = await fetchComposerCatalogSource(
      undefined,
      async (...args) => {
        calls.push(args);
        return args[1].action === 'surface_browser' ? surface : tools;
      }
    );

    assert.equal(result.surface, surface);
    assert.deepEqual(result.tools, tools);
    assert.deepEqual(calls, [
      [
        'creation-experience',
        {
          action: 'surface_browser',
          payload: { surfaceId: 'surface.home.launch' },
        },
        undefined,
      ],
      ['creation-experience', { action: 'tool_list', payload: {} }, undefined],
    ]);
  });

  it('loads model preferences for the exact Composer operation', async () => {
    const calls: unknown[] = [];
    const preferences = {
      favorites: [],
      recent: [],
      workspaceDefault: 'seedream-5-pro',
    };
    const result = await fetchComposerPreferences(
      'image_text',
      undefined,
      async (...args) => {
        calls.push(args);
        return preferences;
      }
    );

    assert.equal(result, preferences);
    assert.deepEqual(calls, [
      [
        'model-supply',
        {
          action: 'preferences',
          payload: { operation: 'image.generate' },
        },
        undefined,
      ],
    ]);
  });

  it('builds and submits one server ProductQuoteSnapshot request', async () => {
    const input = buildLiveQuoteInput({
      sessionId: 'session-1',
      lensId: 'video',
      catalogRevision: 'catalog-r1',
      submission: {
        creationMode: 'customized',
        intent: '生成一条竖屏护理项目视频',
        catalogModel: { id: 'model-video', revision: 'catalog-r1' },
        recipe: { id: 'recipe-video', revision: 'recipe-video@1' },
        contentPackagePlatform: 'douyin',
        distributionTarget: 'export',
        deliverable: {
          kind: 'video_package',
          quantity: 1,
          aspectRatio: '9:16',
          durationSeconds: 15,
        },
      },
      model: {
        id: 'model-video',
        displayName: '视频模型',
        modality: 'video',
        qualityRank: 1,
        capabilityLabels: [],
        available: true,
        availabilityKind: 'production',
        unitPrice: {
          amountMicros: 1_500_000,
          currency: 'CNY',
          revision: 'price-r1',
          unit: 'second',
        },
      },
    });
    assert.deepEqual(input, {
      quoteId:
        'composer:session-1:video:model-video:catalog-r1:1:15:douyin:export:video_package:auto',
      catalogModelId: 'model-video',
      operation: 'video.generate',
      quantity: 1,
      submission: {
        creationMode: 'customized',
        intent: '生成一条竖屏护理项目视频',
        catalogModel: { id: 'model-video', revision: 'catalog-r1' },
        recipe: { id: 'recipe-video', revision: 'recipe-video@1' },
        contentPackagePlatform: 'douyin',
        distributionTarget: 'export',
        deliverable: {
          kind: 'video_package',
          quantity: 1,
          aspectRatio: '9:16',
          durationSeconds: 15,
        },
      },
      targetSeconds: 15,
    });

    const snapshot = { quoteId: input.quoteId } as ProductQuoteSnapshot;
    const calls: unknown[] = [];
    const result = await requestComposerQuote(input, async (...args) => {
      calls.push(args);
      return snapshot;
    });
    assert.equal(result, snapshot);
    assert.deepEqual(calls, [
      [
        'product-billing',
        { action: 'quote', payload: input },
        `composer-quote:${input.quoteId}`,
      ],
    ]);
  });

  it('binds image aspect ratio into both the public intent and quote id', () => {
    const model = {
      id: 'model-image',
      displayName: '图像模型',
      modality: 'image' as const,
      qualityRank: 1,
      capabilityLabels: [],
      available: true,
      availabilityKind: 'production' as const,
    };
    const portrait = buildLiveQuoteInput({
      aspectRatio: '3:4',
      catalogRevision: 'catalog-r1',
      lensId: 'image_text',
      model,
      quantity: 3,
      sessionId: 'session-image',
      submission: imageSubmission('3:4'),
    });
    const square = buildLiveQuoteInput({
      aspectRatio: '1:1',
      catalogRevision: 'catalog-r1',
      lensId: 'image_text',
      model,
      quantity: 3,
      sessionId: 'session-image',
      submission: imageSubmission('1:1'),
    });

    assert.equal(portrait.aspectRatio, '3:4');
    assert.notEqual(portrait.quoteId, square.quoteId);
  });

  it('binds the explicit free-image operation into the quote request and id', () => {
    const model = {
      id: 'model-image',
      displayName: '图像模型',
      modality: 'image' as const,
      qualityRank: 1,
      capabilityLabels: [],
      available: true,
      availabilityKind: 'production' as const,
    };
    const generate = buildLiveQuoteInput({
      catalogRevision: 'catalog-r1',
      lensId: 'image_text',
      model,
      sessionId: 'session-operation',
      submission: imageSubmission('3:4', 'image.generate'),
    });
    const edit = buildLiveQuoteInput({
      catalogRevision: 'catalog-r1',
      lensId: 'image_text',
      model,
      sessionId: 'session-operation',
      submission: imageSubmission('3:4', 'image.edit'),
    });

    assert.equal(edit.submission.imageOperation, 'image.edit');
    assert.notEqual(generate.quoteId, edit.quoteId);
  });

  function imageSubmission(
    aspectRatio: '1:1' | '3:4',
    imageOperation: 'image.generate' | 'image.edit' = 'image.generate'
  ) {
    return {
      creationMode: 'free' as const,
      intent: '生成一张夏日护理海报',
      imageOperation,
      catalogModel: { id: 'model-image', revision: 'catalog-r1' },
      recipe: { id: 'recipe-image', revision: 'recipe-image@1' },
      contentPackagePlatform: 'xiaohongshu' as const,
      distributionTarget: 'export' as const,
      deliverable: {
        kind: 'image_set' as const,
        quantity: 3,
        aspectRatio,
      },
    };
  }

  it('projects Brief from live draft, source and quote signals', async () => {
    const input = buildLiveBriefInput({
      briefContextId: 'composer:session-1',
      lensId: 'image_text',
      quote: {
        quoteId: 'quote-1',
        revision: 'quote-r1',
        catalogModelId: 'model-image',
        quotePolicyRevision: 'quote.policy@1',
        billingMode: 'per_request',
        formula: { unitRate: 2, expression: '2' },
        confirmedAmount: 2,
        lifecycleStatus: 'quoted',
      },
      currentRevisions: {
        draftRevisionId: 'draft-1',
        recipeRevisionId: 'recipe-1',
        surfaceRevisionId: 'surface-1',
      },
      delivery: { platform: 'xiaohongshu', deliverableKind: 'image_set' },
      imageCount: 5,
      sources: [{ id: 'source-1', category: 'customer_case' }],
      highRiskFacts: [{ kind: 'price', status: 'missing' }],
    });
    assert.equal(input.imageCount, 5);
    assert.equal(input.quote?.quoteRevisionId, 'quote-r1');
    assert.equal(input.currentRevisions.surfaceRevisionId, 'surface-1');
    assert.equal(input.highRiskFacts?.[0]?.kind, 'price');

    const calls: unknown[] = [];
    await requestComposerBrief(input, async (...args) => {
      calls.push(args);
      return { requiresBrief: true } as never;
    });
    assert.deepEqual(calls, [
      [
        'creation-experience',
        { action: 'brief_project', payload: input },
        undefined,
      ],
    ]);
  });

  it('syncs a server revision context before projecting Brief', async () => {
    const calls: unknown[] = [];
    const context = {
      briefContextId: 'composer:session-1',
      currentRevisions: { draftRevisionId: 'draft:composer:session-1@2' },
      revision: 2,
    };
    const result = await syncComposerBriefContext(
      {
        briefContextId: 'composer:session-1',
        draft: { settings: { durationSeconds: 15 }, userText: '项目介绍' },
        expectedRevision: 1,
        lensId: 'video',
        quoteId: 'quote-1',
        recipeRevisionId: 'recipe.video@3',
        sourceIds: ['asset-1'],
        surfaceRevisionId: 'surface.home.launch@3',
      },
      async (...args) => {
        calls.push(args);
        return context;
      }
    );
    assert.equal(result, context);
    assert.deepEqual(calls, [
      [
        'creation-experience',
        {
          action: 'brief_context_sync',
          payload: {
            briefContextId: 'composer:session-1',
            draft: {
              settings: { durationSeconds: 15 },
              userText: '项目介绍',
            },
            expectedRevision: 1,
            lensId: 'video',
            quoteId: 'quote-1',
            recipeRevisionId: 'recipe.video@3',
            sourceIds: ['asset-1'],
            surfaceRevisionId: 'surface.home.launch@3',
          },
        },
        'brief-context:composer:session-1:1',
      ],
    ]);
  });

  it('confirms Brief through Core with the server context id', async () => {
    const calls: unknown[] = [];
    const input = {
      briefContextId: 'composer:session-1',
      confirmationId: 'brief-confirm:session-1:2',
      currentRevisions: { draftRevisionId: 'client-value-is-ignored' },
      deliverableKind: 'video_package',
      lensId: 'video' as const,
    };
    const confirmation = {
      confirmationId: input.confirmationId,
      confirmedAt: '2026-07-20T12:00:00.000Z',
      boundRevisions: { draftRevisionId: 'draft:composer:session-1@2' },
      triggerCodes: ['any_video'],
    };
    const result = await confirmComposerBrief(input, async (...args) => {
      calls.push(args);
      return confirmation;
    });
    assert.equal(result, confirmation);
    assert.deepEqual(calls, [
      [
        'creation-experience',
        { action: 'brief_confirm', payload: input },
        'brief-confirm:session-1:2',
      ],
    ]);
  });

  it('requests RecipePatchPreview from the published server revision', async () => {
    const calls: unknown[] = [];
    await requestRecipePatchPreview(
      {
        recipeRevisionId: 'recipe.project_intro@3',
        currentLens: 'copy',
        surfaceRevisionId: 'surface.home.launch@2',
        draft: {
          userText: '保留原文',
          sources: [],
          lensId: 'copy',
          recipeRevisionId: null,
          settings: {},
          dirtySettings: {},
        },
      },
      async (...args) => {
        calls.push(args);
        return { recipeRevisionId: 'recipe.project_intro@3' };
      }
    );
    assert.deepEqual(calls, [
      [
        'creation-experience',
        {
          action: 'recipe_patch_preview',
          payload: {
            recipeRevisionId: 'recipe.project_intro@3',
            currentLens: 'copy',
            surfaceRevisionId: 'surface.home.launch@2',
            draft: {
              userText: '保留原文',
              sources: [],
              lensId: 'copy',
              recipeRevisionId: null,
              settings: {},
              dirtySettings: {},
            },
          },
        },
        undefined,
      ],
    ]);
  });
});
