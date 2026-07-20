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

  function createService() {
    const catalog = new MemoryCreationExperienceCatalogRepository();
    const foundation = new MemoryFoundationRepository();
    const service = new P1ApplicationService(foundation, {
      operations: [new CreationExperienceFoundationModule(catalog)],
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

    const surfacePublished = (await service.executeModule(
      context,
      'creation-experience',
      {
        action: 'surface_publish',
        payload: {
          surfaceId: 'surface.mod',
          expectedRevision: surfaceDraft.revision,
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

    await service.executeModule(
      context,
      'creation-experience',
      {
        action: 'recipe_publish',
        payload: {
          recipeId: 'recipe.conflict',
          expectedRevision: draft.revision,
          reason: 'first',
        },
      },
      'idem-c2',
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
              expectedRevision: draft.revision,
              reason: 'stale',
            },
          },
          'idem-c3',
        ),
      (error: unknown) => {
        assert.ok(error instanceof P1DomainError);
        assert.equal(error.code, 'IDEMPOTENCY_CONFLICT');
        return true;
      },
    );
  });
});
