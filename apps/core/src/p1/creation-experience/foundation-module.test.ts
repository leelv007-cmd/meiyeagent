import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { P1ApplicationService } from '../foundation/application-service.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import { P1DomainError } from '../foundation/domain.js';
import { CreationExperienceFoundationModule } from './foundation-module.js';
import { MemoryCreationExperienceCatalogRepository } from './memory-repository.js';
import {
  findForbiddenBrowserKey,
  serializeBrowserProjection,
} from './browser-projection.js';
import type { ServerRecipeRecord, ServerSurfaceRecord } from './types.js';

describe('Creation Experience FoundationModule seam', () => {
  const context = {
    workspaceId: 'workspace-a',
    userId: 'platform-admin',
    correlationId: 'ce-1',
    actor: 'admin' as const,
  };

  function createService(options: { quoteAmount?: number } = {}) {
    const catalog = new MemoryCreationExperienceCatalogRepository();
    const foundation = new MemoryFoundationRepository();
    const service = new P1ApplicationService(foundation, {
      operations: [
        new CreationExperienceFoundationModule(catalog, undefined, {
          briefRevisionResolver: {
            resolveCurrentRevisions() {
              return { draftRevisionId: 'draft-current' };
            },
            resolveCurrentQuoteSignal() {
              return {
                amount: options.quoteAmount ?? 20,
                extraConfirmThreshold: 20,
                quotePolicyRevision: 'quote-policy-1',
                quoteRevisionId: 'quote-rev-1',
              };
            },
          },
        }),
      ],
    });
    return { service, catalog };
  }

  it('exposes independent module name and does not require operations service', async () => {
    const module = new CreationExperienceFoundationModule();
    assert.equal(module.name, 'creation-experience');
  });

  it('lists static lenses and tools via query', async () => {
    const { service } = createService();
    const lenses = await service.queryModule(context, 'creation-experience', {
      action: 'lens_list',
      payload: {},
    });
    assert.deepEqual(
      (lenses as Array<{ id: string }>).map((lens) => lens.id),
      ['copy', 'image_text', 'video'],
    );

    const tools = await service.queryModule(context, 'creation-experience', {
      action: 'tool_list',
      payload: {},
    });
    assert.ok(Array.isArray(tools));
    assert.ok((tools as unknown[]).length >= 1);
  });

  it('projects all Brief safety signals through the public module query', async () => {
    const { service } = createService();
    await service.executeModule(
      context,
      'creation-experience',
      {
        action: 'brief_context_sync',
        payload: {
          briefContextId: 'brief-context-signals',
          draft: {
            delivery: { platforms: ['douyin', 'xiaohongshu'] },
            highRiskFacts: [{ kind: 'price', status: 'missing' }],
            settings: { quantity: 5 },
            sources: [{ category: 'customer_case' }],
            userText: '夏日项目价格',
          },
          expectedRevision: null,
          lensId: 'video',
          quoteId: null,
          recipeRevisionId: null,
          sourceIds: ['asset-1'],
          surfaceRevisionId: null,
        },
      },
      'idem-brief-context-signals',
    );
    const projection = (await service.queryModule(
      context,
      'creation-experience',
      {
        action: 'brief_project',
        payload: {
          briefContextId: 'brief-context-signals',
          lensId: 'copy',
          deliverableCount: 1,
          platforms: [],
          sources: [],
          highRiskFacts: [],
          quote: null,
          confirmedRevisions: { draftRevisionId: 'draft-old' },
          currentRevisions: { draftRevisionId: 'draft-current' },
        },
      },
    )) as { requiresBrief: boolean; triggers: Array<{ code: string }> };

    assert.equal(projection.requiresBrief, true);
    assert.deepEqual(
      projection.triggers.map((trigger) => trigger.code),
      [
        'any_video',
        'multi_deliverable_or_cross_platform',
        'restricted_assets',
        'high_risk_fact_missing_or_conflict',
        'quote_policy_threshold',
      ],
    );
  });

  it('treats copy variants as output count instead of multiple deliverables', async () => {
    const { service } = createService({ quoteAmount: 0 });
    await service.executeModule(
      context,
      'creation-experience',
      {
        action: 'brief_context_sync',
        payload: {
          briefContextId: 'brief-context-copy-variants',
          draft: {
            delivery: { deliverableKind: 'copy', platform: 'xiaohongshu' },
            settings: { quantity: 3 },
            sources: [],
            userText: '夏日美甲项目介绍',
          },
          expectedRevision: null,
          lensId: 'copy',
          quoteId: null,
          recipeRevisionId: null,
          sourceIds: [],
          surfaceRevisionId: null,
        },
      },
      'idem-brief-context-copy-variants',
    );

    const projection = (await service.queryModule(
      context,
      'creation-experience',
      {
        action: 'brief_project',
        payload: { briefContextId: 'brief-context-copy-variants' },
      },
    )) as { requiresBrief: boolean; triggers: Array<{ code: string }> };

    assert.equal(projection.requiresBrief, false);
    assert.deepEqual(projection.triggers, []);
  });

  it('still requires Brief for explicit multi-kind delivery and every video', async () => {
    const { service } = createService();
    for (const input of [
      {
        briefContextId: 'brief-context-multi-kind',
        draft: {
          delivery: { deliverableKinds: ['copy', 'image'] },
          settings: { quantity: 1 },
          sources: [],
          userText: '同时生成文案和图片',
        },
        lensId: 'copy',
      },
      {
        briefContextId: 'brief-context-video',
        draft: {
          delivery: { deliverableKind: 'video' },
          settings: { durationSeconds: 15, quantity: 1 },
          sources: [],
          userText: '生成竖版视频',
        },
        lensId: 'video',
      },
    ] as const) {
      await service.executeModule(
        context,
        'creation-experience',
        {
          action: 'brief_context_sync',
          payload: {
            ...input,
            expectedRevision: null,
            quoteId: null,
            recipeRevisionId: null,
            sourceIds: [],
            surfaceRevisionId: null,
          },
        },
        `idem-${input.briefContextId}`,
      );
      const projection = (await service.queryModule(
        context,
        'creation-experience',
        {
          action: 'brief_project',
          payload: { briefContextId: input.briefContextId },
        },
      )) as { requiresBrief: boolean; triggers: Array<{ code: string }> };
      assert.equal(projection.requiresBrief, true);
    }
  });

  it('runs full recipe/surface publish lifecycle through the module', async () => {
    const { service } = createService();

    const draft = (await service.executeModule(
      context,
      'creation-experience',
      {
        action: 'recipe_draft',
        payload: {
          recipeId: 'recipe.mod',
          expectedRevision: null,
          actorId: 'spoofed-actor',
          correlationId: 'spoofed-correlation',
          reason: 'seed',
          body: {
            lensId: 'copy',
            presentation: {
              title: '朋友圈项目介绍',
              summary: '用项目资料生成朋友圈文案',
            },
            modelPolicy: { mode: 'auto' },
            promptRevisionRef: 'prompt.moments@1',
            targetWorkspaceKind: 'copy',
            delivery: { platform: 'moments', deliverableKind: 'caption' },
          },
        },
      },
      'idem-recipe-draft',
    )) as ServerRecipeRecord;
    assert.equal(draft.status, 'draft');
    assert.equal(draft.actorId, context.userId);
    assert.equal(draft.correlationId, context.correlationId);

    const preview = (await service.executeModule(
      context,
      'creation-experience',
      {
        action: 'recipe_preview',
        payload: {
          recipeId: 'recipe.mod',
          expectedRevision: draft.revision,
          reason: 'preview',
        },
      },
      'idem-recipe-preview',
    )) as ServerRecipeRecord;
    assert.equal(preview.status, 'preview');

    const published = (await service.executeModule(
      context,
      'creation-experience',
      {
        action: 'recipe_publish',
        payload: {
          recipeId: 'recipe.mod',
          expectedRevision: preview.revision,
          reason: 'publish',
        },
      },
      'idem-recipe-publish',
    )) as ServerRecipeRecord;
    assert.equal(published.status, 'published');

    const surfaceDraft = (await service.executeModule(
      context,
      'creation-experience',
      {
        action: 'surface_draft',
        payload: {
          surfaceId: 'surface.mod',
          expectedRevision: null,
          reason: 'seed surface',
          body: {
            recipeRefs: [
              {
                recipeRevisionId: published.revisionId,
                lensId: 'copy',
                order: 0,
                featured: true,
                visible: true,
              },
            ],
            toolEntryRefs: [
              {
                toolEntryId: 'tool.multi_size',
                order: 0,
                visible: true,
              },
            ],
          },
        },
      },
      'idem-surface-draft',
    )) as ServerSurfaceRecord;

    const surfacePreview = (await service.executeModule(
      context,
      'creation-experience',
      {
        action: 'surface_preview',
        payload: {
          surfaceId: 'surface.mod',
          expectedRevision: surfaceDraft.revision,
          reason: 'preview surface',
        },
      },
      'idem-surface-preview',
    )) as ServerSurfaceRecord;

    const surfacePublished = (await service.executeModule(
      context,
      'creation-experience',
      {
        action: 'surface_publish',
        payload: {
          surfaceId: 'surface.mod',
          expectedRevision: surfacePreview.revision,
          reason: 'publish surface',
        },
      },
      'idem-surface-publish',
    )) as ServerSurfaceRecord;
    assert.equal(surfacePublished.status, 'published');

    const freeze = (await service.executeModule(
      context,
      'creation-experience',
      {
        action: 'session_freeze',
        payload: {
          surfaceRevisionId: surfacePublished.revisionId,
          sessionId: 'mod-sess-1',
        },
      },
      'idem-freeze',
    )) as { sessionId: string; surface: unknown };
    assert.equal(freeze.sessionId, 'mod-sess-1');
    assert.equal(findForbiddenBrowserKey(freeze.surface), null);

    const browser = await service.queryModule(context, 'creation-experience', {
      action: 'recipe_browser',
      payload: { recipeId: 'recipe.mod' },
    });
    assert.equal(findForbiddenBrowserKey(browser), null);
    assert.equal(
      serializeBrowserProjection(browser).includes('hiddenPrompt'),
      false,
    );

    const session = await service.queryModule(context, 'creation-experience', {
      action: 'session_get',
      payload: { sessionId: 'mod-sess-1' },
    });
    assert.ok(session);
    const otherWorkspaceContext = {
      ...context,
      workspaceId: 'workspace-b',
      correlationId: 'ce-workspace-b',
    };
    assert.equal(
      await service.queryModule(
        otherWorkspaceContext,
        'creation-experience',
        {
          action: 'session_get',
          payload: { sessionId: 'mod-sess-1' },
        },
      ),
      null,
    );
    const otherWorkspaceFreeze = (await service.executeModule(
      otherWorkspaceContext,
      'creation-experience',
      {
        action: 'session_freeze',
        payload: {
          surfaceRevisionId: surfacePublished.revisionId,
          sessionId: 'mod-sess-1',
        },
      },
      'idem-freeze-workspace-b',
    )) as { sessionId: string; workspaceId: string };
    assert.equal(otherWorkspaceFreeze.workspaceId, 'workspace-b');

    const patchPreview = (await service.queryModule(
      context,
      'creation-experience',
      {
        action: 'recipe_patch_preview',
        payload: {
          recipeRevisionId: published.revisionId,
          currentLens: null,
          surfaceRevisionId: surfacePublished.revisionId,
          draft: {
            userText: '保留这段原文',
            sources: [],
            lensId: null,
            recipeRevisionId: null,
            settings: {},
            dirtySettings: {},
          },
        },
      },
    )) as {
      recipeRevisionId: string;
      lensId: string;
      preserve: string[];
    };
    assert.equal(patchPreview.recipeRevisionId, published.revisionId);
    assert.equal(patchPreview.lensId, 'copy');
    assert.deepEqual(patchPreview.preserve, ['userText']);

    await assert.rejects(
      () =>
        service.executeModule(
          context,
          'creation-experience',
          {
            action: 'event_append',
            payload: {
              actionId: 'action.start',
              kind: 'start',
              lensId: 'video',
              recipeRevisionId: published.revisionId,
            },
          },
          'idem-event-lens-mismatch',
        ),
      /does not match Recipe revision/,
    );
  });

  it('surfaces CAS conflict on concurrent module publish', async () => {
    const { service } = createService();
    const draft = (await service.executeModule(
      context,
      'creation-experience',
      {
        action: 'recipe_draft',
        payload: {
          recipeId: 'recipe.conflict',
          expectedRevision: null,
          reason: 'seed',
          body: {
            lensId: 'video',
            presentation: { title: '抖音项目成片', summary: '15 秒竖版' },
            modelPolicy: { mode: 'fixed', catalogModelId: 'model.video.1' },
            promptRevisionRef: 'prompt.video@1',
            targetWorkspaceKind: 'video',
          },
        },
      },
      'idem-c1',
    )) as ServerRecipeRecord;

    const preview = (await service.executeModule(
      context,
      'creation-experience',
      {
        action: 'recipe_preview',
        payload: {
          recipeId: 'recipe.conflict',
          expectedRevision: draft.revision,
          reason: 'preview',
        },
      },
      'idem-c2',
    )) as ServerRecipeRecord;

    await service.executeModule(
      context,
      'creation-experience',
      {
        action: 'recipe_publish',
        payload: {
          recipeId: 'recipe.conflict',
          expectedRevision: preview.revision,
          reason: 'first',
        },
      },
      'idem-c3',
    );

    await assert.rejects(
      () =>
        service.executeModule(
          context,
          'creation-experience',
          {
            action: 'recipe_publish',
            payload: {
              recipeId: 'recipe.conflict',
              expectedRevision: preview.revision,
              reason: 'stale',
            },
          },
          'idem-c4',
        ),
      (error: unknown) => {
        assert.ok(error instanceof P1DomainError);
        assert.equal(error.code, 'IDEMPOTENCY_CONFLICT');
        return true;
      },
    );
  });
});
