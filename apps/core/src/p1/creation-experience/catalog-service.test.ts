import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { P1DomainError } from '../foundation/domain.js';
import {
  findForbiddenBrowserKey,
  projectBrowserRecipe,
  serializeBrowserProjection,
} from './browser-projection.js';
import { CreationExperienceCatalogService } from './catalog-service.js';
import { MemoryCreationExperienceCatalogRepository } from './memory-repository.js';
import {
  CREATION_LENS_SEEDS,
  TOOL_ENTRY_SEEDS,
  listCreationLensSeeds,
  listToolEntrySeeds,
} from './static-seeds.js';
import type { RecipeBodyInput, SurfaceBodyInput } from './types.js';

function audit(extra: Record<string, unknown> = {}) {
  return {
    actorId: 'admin-1',
    reason: 'test',
    correlationId: 'corr-1',
    ...extra,
  };
}

function sampleRecipeBody(
  overrides: Partial<RecipeBodyInput> = {},
): RecipeBodyInput {
  return {
    lensId: 'image_text',
    familyId: 'xhs-case-note',
    presentation: {
      title: '从案例图写小红书',
      summary: '用案例图生成笔记与封面',
      actionLabel: '选择图文并套用',
    },
    delivery: {
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'export',
      deliverableKind: 'note',
      notePageBound: 3,
      quantity: 1,
      aspectRatio: '3:4',
    },
    contextPatches: { tone: '专业亲和' },
    sourceRequirements: [{ slot: 'case_image', required: true, kinds: ['image'] }],
    modelPolicy: { mode: 'auto' },
    settingsPatches: { count: 1 },
    outputContractRef: 'output.note.v1',
    quotePolicyRevisionRef: 'quote.policy@1',
    workflowRevisionRef: 'workflow.image_text@1',
    promptRevisionRef: 'prompt.xhs-case@1',
    targetWorkspaceKind: 'image_text',
    ...overrides,
  };
}

function createService() {
  const repository = new MemoryCreationExperienceCatalogRepository();
  const service = new CreationExperienceCatalogService(
    repository,
    () => '2026-07-20T00:00:00.000Z',
    () => 'session-fixed-1',
  );
  return { repository, service };
}

async function publishRecipe(
  service: CreationExperienceCatalogService,
  recipeId: string,
  body: RecipeBodyInput = sampleRecipeBody(),
) {
  const draft = await service.draftRecipe({
    recipeId,
    expectedRevision: null,
    body,
    ...audit(),
  });
  const preview = await service.previewRecipe({
    recipeId,
    expectedRevision: draft.revision,
    ...audit({ reason: 'preview' }),
  });
  return service.publishRecipe({
    recipeId,
    expectedRevision: preview.revision,
    ...audit({ reason: 'publish' }),
  });
}

describe('Creation Experience Catalog aggregate', () => {
  it('rejects wechat_moments as a variant publish target', async () => {
    const { service } = createService();
    const draft = await service.draftRecipe({
      recipeId: 'recipe.invalid-moments-publish',
      expectedRevision: null,
      body: sampleRecipeBody({
        delivery: {
          contentPackagePlatform: 'wechat_moments',
          distributionTarget: 'publish:xiaohongshu',
          deliverableKind: 'note',
          notePageBound: 3,
          quantity: 1,
          aspectRatio: '3:4',
        },
      }),
      ...audit(),
    });
    await service.previewRecipe({
      recipeId: draft.recipeId,
      expectedRevision: draft.revision,
      ...audit(),
    });

    const validation = await service.validateRecipe(draft.recipeId);
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join(' '), /publish distribution/u);
  });

  it('walks draft → preview → validate → publish for a recipe', async () => {
    const { service } = createService();
    const draft = await service.draftRecipe({
      recipeId: 'recipe.xhs',
      expectedRevision: null,
      body: sampleRecipeBody(),
      ...audit(),
    });
    assert.equal(draft.status, 'draft');
    assert.equal(draft.revision, 1);
    assert.equal(draft.revisionId, 'recipe.xhs@1');
    assert.equal(draft.promptRevisionRef, 'prompt.xhs-case@1');
    assert.ok(draft.contentHash.length === 64);

    const preview = await service.previewRecipe({
      recipeId: 'recipe.xhs',
      expectedRevision: 1,
      ...audit({ reason: 'enter preview' }),
    });
    assert.equal(preview.status, 'preview');
    assert.equal(preview.revision, 2);

    const validation = await service.validateRecipe('recipe.xhs');
    assert.deepEqual(validation, { ok: true, errors: [] });

    const published = await service.publishRecipe({
      recipeId: 'recipe.xhs',
      expectedRevision: 2,
      ...audit({ reason: 'go live' }),
    });
    assert.equal(published.status, 'published');
    assert.equal(published.revision, 3);
    assert.equal(published.publishedAt, '2026-07-20T00:00:00.000Z');

    const history = await service.listRecipeHistory('recipe.xhs');
    assert.equal(history.length, 3);
    assert.deepEqual(
      history.map((entry) => entry.status),
      ['draft', 'preview', 'published'],
    );
  });

  it('atomically publishes a surface only when all recipe refs are published', async () => {
    const { service } = createService();
    const recipe = await publishRecipe(service, 'recipe.a');

    const draftSurface = await service.draftSurface({
      surfaceId: 'surface.home',
      expectedRevision: null,
      body: {
        recipeRefs: [
          {
            recipeRevisionId: recipe.revisionId,
            lensId: 'image_text',
            order: 0,
            featured: true,
            visible: true,
          },
        ],
        toolEntryRefs: [
          {
            toolEntryId: 'tool.pro_studio',
            order: 0,
            visible: true,
          },
        ],
      },
      ...audit(),
    });
    assert.equal(draftSurface.status, 'draft');

    const preview = await service.previewSurface({
      surfaceId: 'surface.home',
      expectedRevision: draftSurface.revision,
      ...audit({ reason: 'preview surface' }),
    });
    const validation = await service.validateSurface('surface.home');
    assert.equal(validation.ok, true);

    const published = await service.publishSurface({
      surfaceId: 'surface.home',
      expectedRevision: preview.revision,
      ...audit({ reason: 'publish surface' }),
    });
    assert.equal(published.status, 'published');
    assert.equal(published.recipeRefs[0]?.recipeRevisionId, recipe.revisionId);
    assert.equal('promptRevisionRef' in published, false);
  });

  it('rejects illegal surface refs (unpublished or unknown recipe)', async () => {
    const { service } = createService();
    const draftRecipe = await service.draftRecipe({
      recipeId: 'recipe.draft-only',
      expectedRevision: null,
      body: sampleRecipeBody(),
      ...audit(),
    });

    await service.draftSurface({
      surfaceId: 'surface.bad',
      expectedRevision: null,
      body: {
        recipeRefs: [
          {
            recipeRevisionId: draftRecipe.revisionId,
            lensId: 'image_text',
            order: 0,
            featured: true,
            visible: true,
          },
        ],
      },
      ...audit(),
    });

    const validation = await service.validateSurface('surface.bad');
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join(' '), /not published/);

    const badPreview = await service.previewSurface({
      surfaceId: 'surface.bad',
      expectedRevision: 1,
      ...audit({ reason: 'preview invalid surface' }),
    });
    await assert.rejects(
      () =>
        service.publishSurface({
          surfaceId: 'surface.bad',
          expectedRevision: badPreview.revision,
          ...audit({ reason: 'should fail' }),
        }),
      (error: unknown) => {
        assert.ok(error instanceof P1DomainError);
        assert.equal(error.code, 'INVALID_STATE');
        assert.match(error.message, /not published/);
        return true;
      },
    );

    await service.draftSurface({
      surfaceId: 'surface.unknown',
      expectedRevision: null,
      body: {
        recipeRefs: [
          {
            recipeRevisionId: 'missing@9',
            lensId: 'copy',
            order: 0,
            featured: false,
            visible: true,
          },
        ],
      },
      ...audit(),
    });
    const unknown = await service.validateSurface('surface.unknown');
    assert.equal(unknown.ok, false);
    assert.match(unknown.errors.join(' '), /unknown revision/);
  });

  it('rejects concurrent publish with CAS expectedRevision conflict', async () => {
    const { service } = createService();
    const draft = await service.draftRecipe({
      recipeId: 'recipe.cas',
      expectedRevision: null,
      body: sampleRecipeBody(),
      ...audit(),
    });
    await assert.rejects(
      () =>
        service.publishRecipe({
          recipeId: 'recipe.cas',
          expectedRevision: draft.revision,
          ...audit({ reason: 'must preview first' }),
        }),
      (error: unknown) => {
        assert.ok(error instanceof P1DomainError);
        assert.equal(error.code, 'INVALID_STATE');
        assert.match(error.message, /Only preview recipes/);
        return true;
      },
    );
    const preview = await service.previewRecipe({
      recipeId: 'recipe.cas',
      expectedRevision: draft.revision,
      ...audit({ reason: 'preview for concurrent publish' }),
    });

    const first = await service.publishRecipe({
      recipeId: 'recipe.cas',
      expectedRevision: preview.revision,
      ...audit({ reason: 'first publisher' }),
    });
    assert.equal(first.status, 'published');

    await assert.rejects(
      () =>
        service.publishRecipe({
          recipeId: 'recipe.cas',
          expectedRevision: preview.revision,
          ...audit({ reason: 'stale publisher' }),
        }),
      (error: unknown) => {
        assert.ok(error instanceof P1DomainError);
        assert.equal(error.code, 'IDEMPOTENCY_CONFLICT');
        return true;
      },
    );
  });

  it('rolls back recipe and surface to a prior published revision', async () => {
    const { service } = createService();
    const v1 = await publishRecipe(
      service,
      'recipe.rollback',
      sampleRecipeBody({
        presentation: {
          title: 'Version One',
          summary: 'first',
        },
      }),
    );

    const draft2 = await service.draftRecipe({
      recipeId: 'recipe.rollback',
      expectedRevision: v1.revision,
      body: sampleRecipeBody({
        presentation: { title: 'Version Two', summary: 'second' },
        promptRevisionRef: 'prompt.v2',
      }),
      ...audit({ reason: 'edit v2' }),
    });
    const preview2 = await service.previewRecipe({
      recipeId: 'recipe.rollback',
      expectedRevision: draft2.revision,
      ...audit({ reason: 'preview v2' }),
    });
    const v2 = await service.publishRecipe({
      recipeId: 'recipe.rollback',
      expectedRevision: preview2.revision,
      ...audit({ reason: 'publish v2' }),
    });
    assert.equal(v2.presentation.title, 'Version Two');

    const rolled = await service.rollbackRecipe({
      recipeId: 'recipe.rollback',
      targetRevision: v1.revision,
      expectedRevision: v2.revision,
      ...audit({ reason: 'rollback to v1' }),
    });
    assert.equal(rolled.status, 'published');
    assert.equal(rolled.presentation.title, 'Version One');
    assert.equal(rolled.promptRevisionRef, 'prompt.xhs-case@1');
    assert.equal(rolled.rolledBackToRevision, v1.revision);

    const surfaceV1 = await service.draftSurface({
      surfaceId: 'surface.rollback',
      expectedRevision: null,
      body: {
        recipeRefs: [
          {
            recipeRevisionId: v1.revisionId,
            lensId: 'image_text',
            order: 0,
            featured: true,
            visible: true,
          },
        ],
      },
      ...audit(),
    });
    const surfacePreview1 = await service.previewSurface({
      surfaceId: 'surface.rollback',
      expectedRevision: surfaceV1.revision,
      ...audit({ reason: 'preview surface v1' }),
    });
    const publishedSurface = await service.publishSurface({
      surfaceId: 'surface.rollback',
      expectedRevision: surfacePreview1.revision,
      ...audit({ reason: 'publish surface v1' }),
    });

    const surfaceDraft2 = await service.draftSurface({
      surfaceId: 'surface.rollback',
      expectedRevision: publishedSurface.revision,
      body: {
        recipeRefs: [
          {
            recipeRevisionId: rolled.revisionId,
            lensId: 'image_text',
            order: 0,
            featured: true,
            visible: true,
          },
        ],
      },
      ...audit({ reason: 'surface v2' }),
    });
    const surfacePreview2 = await service.previewSurface({
      surfaceId: 'surface.rollback',
      expectedRevision: surfaceDraft2.revision,
      ...audit({ reason: 'preview surface v2' }),
    });
    const surfaceV2 = await service.publishSurface({
      surfaceId: 'surface.rollback',
      expectedRevision: surfacePreview2.revision,
      ...audit({ reason: 'publish surface v2' }),
    });

    const surfaceRolled = await service.rollbackSurface({
      surfaceId: 'surface.rollback',
      targetRevision: publishedSurface.revision,
      expectedRevision: surfaceV2.revision,
      ...audit({ reason: 'surface rollback' }),
    });
    assert.equal(surfaceRolled.status, 'published');
    assert.equal(
      surfaceRolled.recipeRefs[0]?.recipeRevisionId,
      v1.revisionId,
    );
    assert.equal(surfaceRolled.rolledBackToRevision, publishedSurface.revision);
  });

  it('freezes a session so later publishes do not change the snapshot', async () => {
    const { service } = createService();
    const recipe = await publishRecipe(service, 'recipe.freeze');
    const surfaceDraft = await service.draftSurface({
      surfaceId: 'surface.freeze',
      expectedRevision: null,
      body: {
        recipeRefs: [
          {
            recipeRevisionId: recipe.revisionId,
            lensId: 'image_text',
            order: 0,
            featured: true,
            visible: true,
          },
        ],
      },
      ...audit(),
    });
    const surfacePreview = await service.previewSurface({
      surfaceId: 'surface.freeze',
      expectedRevision: surfaceDraft.revision,
      ...audit({ reason: 'preview freeze surface' }),
    });
    const surface = await service.publishSurface({
      surfaceId: 'surface.freeze',
      expectedRevision: surfacePreview.revision,
      ...audit({ reason: 'publish freeze surface' }),
    });

    const freeze = await service.freezeSession({
      workspaceId: 'workspace-a',
      surfaceRevisionId: surface.revisionId,
      sessionId: 'sess-1',
    });
    assert.equal(freeze.sessionId, 'sess-1');
    assert.equal(freeze.surfaceRevisionId, surface.revisionId);
    assert.equal(freeze.surface.recipes[0]?.presentation.title, '从案例图写小红书');

    const recipe2Draft = await service.draftRecipe({
      recipeId: 'recipe.freeze',
      expectedRevision: recipe.revision,
      body: sampleRecipeBody({
        presentation: {
          title: '全新标题',
          summary: 'should not affect frozen session',
        },
      }),
      ...audit({ reason: 'post-freeze edit' }),
    });
    const recipe2Preview = await service.previewRecipe({
      recipeId: 'recipe.freeze',
      expectedRevision: recipe2Draft.revision,
      ...audit({ reason: 'post-freeze preview' }),
    });
    const recipe2 = await service.publishRecipe({
      recipeId: 'recipe.freeze',
      expectedRevision: recipe2Preview.revision,
      ...audit({ reason: 'post-freeze publish' }),
    });
    const surface2Draft = await service.draftSurface({
      surfaceId: 'surface.freeze',
      expectedRevision: surface.revision,
      body: {
        recipeRefs: [
          {
            recipeRevisionId: recipe2.revisionId,
            lensId: 'image_text',
            order: 0,
            featured: true,
            visible: true,
          },
        ],
      },
      ...audit({ reason: 'new surface' }),
    });
    const surface2Preview = await service.previewSurface({
      surfaceId: 'surface.freeze',
      expectedRevision: surface2Draft.revision,
      ...audit({ reason: 'preview new surface' }),
    });
    await service.publishSurface({
      surfaceId: 'surface.freeze',
      expectedRevision: surface2Preview.revision,
      ...audit({ reason: 'publish new surface' }),
    });

    const frozenAgain = await service.getSessionFreeze(
      'workspace-a',
      'sess-1',
    );
    assert.ok(frozenAgain);
    assert.equal(frozenAgain.surfaceRevisionId, surface.revisionId);
    assert.equal(
      frozenAgain.surface.recipes[0]?.presentation.title,
      '从案例图写小红书',
    );
    assert.equal(
      frozenAgain.surface.recipes[0]?.revisionId,
      recipe.revisionId,
    );

    const head = await service.getSurfaceHead('surface.freeze');
    assert.ok(head);
    const fresh = await service.freezeSession({
      workspaceId: 'workspace-a',
      surfaceRevisionId: head.revisionId,
    });
    assert.equal(fresh.surface.recipes[0]?.presentation.title, '全新标题');
  });

  it('browser projection serves published-only and ignores draft heads', async () => {
    const { service } = createService();
    const published = await publishRecipe(
      service,
      'recipe.browser-published',
      sampleRecipeBody({
        presentation: {
          title: '已发布标题',
          summary: '已发布摘要',
          actionLabel: '选择',
        },
      }),
    );
    assert.equal(published.status, 'published');

    const draftHead = await service.draftRecipe({
      recipeId: 'recipe.browser-published',
      expectedRevision: published.revision,
      body: sampleRecipeBody({
        presentation: {
          title: '草稿头标题',
          summary: '草稿头摘要',
          actionLabel: '选择',
        },
      }),
      ...audit({ reason: 'draft after publish' }),
    });
    assert.equal(draftHead.status, 'draft');
    assert.ok(draftHead.revision > published.revision);

    const browser = await service.projectBrowserRecipe(
      'recipe.browser-published',
    );
    assert.equal(browser.revision, published.revision);
    assert.equal(browser.presentation.title, '已发布标题');

    await assert.rejects(
      () =>
        service.projectBrowserRecipe(
          'recipe.browser-published',
          draftHead.revision,
        ),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'NOT_FOUND',
    );

    const surfacePublished = await service.draftSurface({
      surfaceId: 'surface.browser-published',
      expectedRevision: null,
      body: {
        recipeRefs: [
          {
            recipeRevisionId: published.revisionId,
            lensId: 'image_text',
            order: 0,
            featured: true,
            visible: true,
          },
        ],
      } satisfies SurfaceBodyInput,
      ...audit(),
    });
    const surfacePreview = await service.previewSurface({
      surfaceId: 'surface.browser-published',
      expectedRevision: surfacePublished.revision,
      ...audit({ reason: 'preview' }),
    });
    const surfaceLive = await service.publishSurface({
      surfaceId: 'surface.browser-published',
      expectedRevision: surfacePreview.revision,
      ...audit({ reason: 'publish' }),
    });
    const surfaceDraftHead = await service.draftSurface({
      surfaceId: 'surface.browser-published',
      expectedRevision: surfaceLive.revision,
      body: {
        recipeRefs: [
          {
            recipeRevisionId: published.revisionId,
            lensId: 'image_text',
            order: 0,
            featured: false,
            visible: true,
          },
        ],
      } satisfies SurfaceBodyInput,
      ...audit({ reason: 'draft surface after publish' }),
    });

    const surfaceBrowser = await service.projectBrowserSurface(
      'surface.browser-published',
    );
    assert.equal(surfaceBrowser.revision, surfaceLive.revision);
    await assert.rejects(
      () =>
        service.projectBrowserSurface(
          'surface.browser-published',
          surfaceDraftHead.revision,
        ),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'NOT_FOUND',
    );
  });

  it('never ships hidden prompt bodies in browser projection', async () => {
    const { service } = createService();
    const draft = await service.draftRecipe({
      recipeId: 'recipe.secret',
      expectedRevision: null,
      body: sampleRecipeBody({
        hiddenPromptBody:
          'SYSTEM: you are a secret prompt that must never reach the browser',
      }),
      ...audit(),
    });
    assert.equal(draft.hiddenPromptBody?.includes('secret prompt'), true);

    const browser = projectBrowserRecipe(draft);
    assert.equal(browser.promptRevisionRef, 'prompt.xhs-case@1');
    assert.equal('hiddenPromptBody' in browser, false);
    assert.equal('prompt' in browser, false);
    assert.equal('systemPrompt' in browser, false);

    const serialized = serializeBrowserProjection(browser);
    assert.equal(serialized.includes('secret prompt'), false);
    assert.equal(serialized.includes('hiddenPromptBody'), false);
    assert.equal(serialized.includes('SYSTEM:'), false);
    assert.equal(findForbiddenBrowserKey(browser), null);

    const preview = await service.previewRecipe({
      recipeId: 'recipe.secret',
      expectedRevision: draft.revision,
      ...audit({ reason: 'preview secret' }),
    });
    const published = await service.publishRecipe({
      recipeId: 'recipe.secret',
      expectedRevision: preview.revision,
      ...audit({ reason: 'publish secret' }),
    });
    const surfaceDraft = await service.draftSurface({
      surfaceId: 'surface.secret',
      expectedRevision: null,
      body: {
        recipeRefs: [
          {
            recipeRevisionId: published.revisionId,
            lensId: 'image_text',
            order: 0,
            featured: true,
            visible: true,
          },
        ],
      } satisfies SurfaceBodyInput,
      ...audit(),
    });
    const surfacePreview = await service.previewSurface({
      surfaceId: 'surface.secret',
      expectedRevision: surfaceDraft.revision,
      ...audit({ reason: 'preview' }),
    });
    await service.publishSurface({
      surfaceId: 'surface.secret',
      expectedRevision: surfacePreview.revision,
      ...audit({ reason: 'publish' }),
    });
    const surfaceBrowser = await service.projectBrowserSurface('surface.secret');
    const surfaceJson = serializeBrowserProjection(surfaceBrowser);
    assert.equal(surfaceJson.includes('secret prompt'), false);
    assert.equal(findForbiddenBrowserKey(surfaceBrowser), null);
    assert.equal(
      surfaceBrowser.recipes[0]?.promptRevisionRef,
      'prompt.xhs-case@1',
    );
  });

  it('exposes lens as static enum and tools as static seed registry', async () => {
    assert.deepEqual(
      CREATION_LENS_SEEDS.map((lens) => lens.id),
      ['copy', 'image_text', 'video'],
    );
    assert.equal(listCreationLensSeeds().length, 3);
    assert.ok(TOOL_ENTRY_SEEDS.length >= 1);
    assert.ok(listToolEntrySeeds().every((tool) => tool.id.startsWith('tool.')));
    for (const tool of TOOL_ENTRY_SEEDS) {
      assert.equal('status' in tool, false);
      assert.equal('revision' in tool, false);
      assert.equal('publishedAt' in tool, false);
    }
    for (const lens of CREATION_LENS_SEEDS) {
      assert.equal('status' in lens, false);
      assert.equal('revision' in lens, false);
    }
  });

  it('rejects draft surface that references unknown static tools', async () => {
    const { service } = createService();
    const recipe = await publishRecipe(service, 'recipe.tool-check');
    await assert.rejects(
      () =>
        service.draftSurface({
          surfaceId: 'surface.bad-tool',
          expectedRevision: null,
          body: {
            recipeRefs: [
              {
                recipeRevisionId: recipe.revisionId,
                lensId: 'image_text',
                order: 0,
                featured: true,
                visible: true,
              },
            ],
            toolEntryRefs: [
              {
                toolEntryId: 'tool.does_not_exist',
                order: 0,
                visible: true,
              },
            ],
          },
          ...audit(),
        }),
      (error: unknown) => {
        assert.ok(error instanceof P1DomainError);
        assert.match(error.message, /unknown static tool/);
        return true;
      },
    );
  });
});
