/**
 * A2 / #89 — first-ship Surface + eight Recipe seeds (D-082/D-083).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LAUNCH_RECIPE_SPECS,
  LAUNCH_SURFACE_ID,
  LAUNCH_TOOL_ENTRY_REFS,
  REUSE_CONTENT_ACTION_LABEL,
  REUSE_CONTENT_FAMILY_ID,
  listLaunchCardFamilies,
  listLaunchRecipeSpecs,
  listReuseContentVariants,
  publishLaunchCatalog,
  recipeStudioInputFromSpec,
  seedLaunchCatalogInMemory,
} from './launch-seeds.js';
import { CreationExperienceCatalogService } from './catalog-service.js';
import { MemoryCreationExperienceCatalogRepository } from './memory-repository.js';
import { findForbiddenBrowserKey } from './browser-projection.js';
import { RecipeStudioService } from './recipe-studio.js';

describe('launch seeds (D-082 / D-083)', () => {
  it('defines eight Recipe variants mapping to six cold cards', () => {
    assert.equal(LAUNCH_RECIPE_SPECS.length, 8);
    assert.deepEqual(listLaunchCardFamilies(), [
      'case_to_xhs_note',
      'project_intro',
      'campaign_visual_set',
      'promotion_poster',
      'douyin_project_video',
      'reuse_content',
    ]);
  });

  it('uses structured factTypes instead of text upload slots', () => {
    const specs = listLaunchRecipeSpecs();
    assert.equal(
      specs.some((spec) =>
        spec.sourceRequirements.some((slot) => slot.kinds?.includes('text')),
      ),
      false,
    );
    assert.deepEqual(
      specs.find((spec) => spec.recipeId === 'recipe.project_intro')?.factTypes,
      ['service'],
    );
    assert.deepEqual(
      specs.find((spec) => spec.recipeId === 'recipe.campaign_visual_set')
        ?.factTypes,
      ['service', 'price', 'group_buy', 'fulfillment'],
    );
    assert.deepEqual(
      specs.find((spec) => spec.recipeId === 'recipe.promotion_poster')
        ?.factTypes,
      ['price', 'discount', 'fulfillment'],
    );
  });

  it('locks presentation copy to D-083 wording', () => {
    const byTitle = Object.fromEntries(
      listLaunchRecipeSpecs()
        .filter((s) => s.familyId !== REUSE_CONTENT_FAMILY_ID)
        .map((s) => [s.presentation.title, s]),
    );

    assert.equal(
      byTitle['从案例图写小红书']?.presentation.summary,
      '用案例图生成笔记与封面',
    );
    assert.equal(
      byTitle['从案例图写小红书']?.presentation.actionLabel,
      '选择图文并套用',
    );
    assert.equal(byTitle['从案例图写小红书']?.lensId, 'image_text');

    assert.equal(
      byTitle['朋友圈项目介绍']?.presentation.summary,
      '用项目资料生成朋友圈文案',
    );
    assert.equal(
      byTitle['朋友圈项目介绍']?.presentation.actionLabel,
      '选择文案并套用',
    );
    assert.equal(byTitle['朋友圈项目介绍']?.lensId, 'copy');

    assert.equal(
      byTitle['项目/活动套图']?.presentation.summary,
      '用项目或活动信息生成 4 张套图',
    );
    assert.equal(
      byTitle['项目/活动套图']?.presentation.actionLabel,
      '选择图文并套用',
    );

    assert.equal(
      byTitle['促销海报']?.presentation.summary,
      '用优惠和期限生成活动海报',
    );
    assert.equal(
      byTitle['促销海报']?.presentation.actionLabel,
      '选择图文并套用',
    );

    assert.equal(
      byTitle['抖音项目成片']?.presentation.summary,
      '用案例素材生成 15 秒竖版成片',
    );
    assert.equal(
      byTitle['抖音项目成片']?.presentation.actionLabel,
      '选择视频并套用',
    );
    assert.equal(byTitle['抖音项目成片']?.lensId, 'video');
  });

  it('locks delivery defaults to D-082 first-ship table', () => {
    const specs = Object.fromEntries(
      listLaunchRecipeSpecs().map((s) => [s.recipeId, s]),
    );

    assert.deepEqual(specs['recipe.case_to_xhs_note']?.delivery, {
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'export',
      deliverableKind: 'note',
      quantity: 1,
      aspectRatio: '3:4',
      notePageBound: 3,
    });
    assert.equal(
      specs['recipe.case_to_xhs_note']?.contextPatches?.reuseCaseImages,
      true,
    );

    assert.deepEqual(specs['recipe.project_intro']?.delivery, {
      contentPackagePlatform: 'wechat_moments',
      distributionTarget: 'assisted_handoff',
      deliverableKind: 'copy_document',
      quantity: 1,
    });

    assert.deepEqual(specs['recipe.campaign_visual_set']?.delivery, {
      contentPackagePlatform: 'generic',
      distributionTarget: 'export',
      deliverableKind: 'image_set',
      quantity: 4,
      aspectRatio: '3:4',
    });

    assert.deepEqual(specs['recipe.promotion_poster']?.delivery, {
      contentPackagePlatform: 'offline_material',
      distributionTarget: 'export',
      deliverableKind: 'poster',
      quantity: 1,
      aspectRatio: '3:4',
    });
    assert.deepEqual(
      specs['recipe.promotion_poster']?.settingsPatches?.editableAspectRatios,
      ['3:4', '1:1', '9:16'],
    );

    assert.deepEqual(specs['recipe.douyin_project_video']?.delivery, {
      contentPackagePlatform: 'douyin',
      distributionTarget: 'export',
      deliverableKind: 'video_package',
      quantity: 1,
      aspectRatio: '9:16',
      durationSeconds: 15,
    });
    assert.equal(
      specs['recipe.douyin_project_video']?.contextPatches?.includeCover,
      true,
    );
    assert.equal(
      specs['recipe.douyin_project_video']?.contextPatches?.includePublishCopy,
      true,
    );
  });

  it('models 旧内容换平台 as familyId three variants with cold no default lens', () => {
    const variants = listReuseContentVariants();
    assert.equal(variants.length, 3);
    assert.deepEqual(
      variants.map((v) => v.lensId).sort(),
      ['copy', 'image_text', 'video'],
    );
    assert.ok(variants.every((v) => v.familyId === REUSE_CONTENT_FAMILY_ID));
    assert.ok(
      variants.every(
        (v) => v.presentation.title === '旧内容换平台',
      ),
    );
    assert.ok(
      variants.every(
        (v) =>
          v.presentation.summary === '选择旧内容，再决定改成哪种形式',
      ),
    );
    assert.ok(
      variants.every(
        (v) => v.presentation.actionLabel === REUSE_CONTENT_ACTION_LABEL,
      ),
    );
    assert.ok(
      variants.every((v) => v.contextPatches?.coldDefaultLens === null),
    );
    assert.ok(
      variants.every((v) => v.contextPatches?.requiresUserLensChoice === true),
    );
    // No single default lens among variants — cold must choose.
    const defaultLens = variants.find(
      (v) => v.contextPatches?.coldDefaultLens != null,
    );
    assert.equal(defaultLens, undefined);
  });

  it('ships only capability-verified Pro Studio in the launch Surface', () => {
    assert.deepEqual(
      LAUNCH_TOOL_ENTRY_REFS.map((r) => r.toolEntryId),
      ['tool.pro_studio'],
    );
  });

  it('publishes all eight formal seeds through the Recipe Studio four-gate chain', async () => {
    const { repository, service, result } = await seedLaunchCatalogInMemory();
    assert.equal(result.recipes.length, 8);
    assert.ok(result.recipes.every((r) => r.status === 'published'));
    assert.ok(result.recipes.every((r) => r.studioRelease));
    for (const recipe of result.recipes) {
      const history = await repository.listRecipeHistory(recipe.recipeId);
      assert.deepEqual(
        history.slice(0, 4).map((revision) => revision.studioRelease?.phase),
        ['compiled', 'validated', 'evaluated', 'internal_tested'],
      );
      assert.ok(
        history[0]?.studioRelease?.compilationReceipt.promptRevisionRef.endsWith(
          '@1',
        ),
      );
      assert.equal(history[1]?.studioRelease?.validation?.passed, true);
      assert.equal(history[2]?.studioRelease?.evaluation?.passed, true);
      assert.equal(history[3]?.studioRelease?.internalTest?.passed, true);
    }
    const validations = await Promise.all(
      result.recipes.map((recipe) =>
        service.validateRecipe(recipe.recipeId, recipe.revision),
      ),
    );
    assert.equal(validations.length, 8);
    assert.ok(validations.every((validation) => validation.ok));
    assert.equal(result.surface.status, 'published');
    assert.equal(result.surface.surfaceId, LAUNCH_SURFACE_ID);
    assert.equal(result.surface.recipeRefs.length, 8);
    assert.equal(result.surface.toolEntryRefs.length, 1);

    const browser = await service.projectBrowserSurface(LAUNCH_SURFACE_ID);
    assert.equal(browser.recipes.length, 8);
    assert.equal(findForbiddenBrowserKey(browser), null);

    // Featured six-card grouping: five singles + reuse family at order 5.
    const featured = browser.recipeRefs.filter((r) => r.featured);
    assert.equal(featured.length, 8);
    const orders = new Set(featured.map((r) => r.order));
    assert.deepEqual([...orders].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);

    const reuse = browser.recipes.filter(
      (r) => r.familyId === REUSE_CONTENT_FAMILY_ID,
    );
    assert.equal(reuse.length, 3);
    assert.ok(reuse.every((r) => r.presentation.actionLabel === '选择创作形式'));
  });

  it('marks seeds as first published revision defaults (adjustable via new revision)', async () => {
    const repository = new MemoryCreationExperienceCatalogRepository();
    const service = new CreationExperienceCatalogService(
      repository,
      () => '2026-07-20T12:00:00.000Z',
    );
    const { recipes, surface } = await publishLaunchCatalog(service);

    for (const recipe of recipes) {
      // Studio gates @1..4 → preview@5 → published@6.
      assert.equal(recipe.revision, 6);
      assert.equal(recipe.status, 'published');
      assert.ok(recipe.publishedAt);
    }
    // The first gated seed creates Surface @3; each remaining seed switches one ref.
    assert.equal(surface.revision, 24);
    assert.equal(surface.status, 'published');

    // New revision path still works (later product adjustments).
    const head = recipes[0]!;
    const nextDraft = await service.draftRecipe({
      recipeId: head.recipeId,
      expectedRevision: head.revision,
      body: {
        lensId: head.lensId,
        familyId: head.familyId,
        presentation: {
          ...head.presentation,
          summary: 'adjusted summary via new revision',
        },
        delivery: head.delivery,
        modelPolicy: head.modelPolicy,
        promptRevisionRef: head.promptRevisionRef,
        targetWorkspaceKind: head.targetWorkspaceKind,
      },
      actorId: 'ops',
      reason: 'later adjustment',
      correlationId: 'adj-1',
    });
    assert.equal(nextDraft.revision, 7);
    assert.equal(nextDraft.status, 'draft');
    // Prior published revision remains readable.
    const prior = await service.getRecipeByRevisionId(head.revisionId);
    assert.equal(prior?.presentation.summary, head.presentation.summary);
  });

  it('resumes an interrupted formal seed gate chain without bypassing or duplicating completed gates', async () => {
    const repository = new MemoryCreationExperienceCatalogRepository();
    const now = () => '2026-07-20T12:00:00.000Z';
    const service = new CreationExperienceCatalogService(repository, now);
    const studio = new RecipeStudioService(service, now, {
      async listUnavailableFrozenRevisionRefs() {
        return [];
      },
    });
    const firstSpec = LAUNCH_RECIPE_SPECS[0]!;
    const compiled = await studio.compile(
      recipeStudioInputFromSpec(firstSpec),
    );
    await studio.validate({
      recipeId: compiled.recipeId,
      expectedRevision: compiled.revision,
      actorId: 'system.launch-seed',
      reason: 'resume test',
      correlationId: 'launch-resume-test',
    });

    const first = await publishLaunchCatalog(service, { now });
    assert.equal(first.recipes.length, 8);
    assert.deepEqual(
      (
        await repository.listRecipeHistory(firstSpec.recipeId)
      ).map((revision) => revision.studioRelease?.phase),
      [
        'compiled',
        'validated',
        'evaluated',
        'internal_tested',
        'internal_tested',
        'internal_tested',
      ],
    );

    const restarted = await publishLaunchCatalog(service, { now });
    assert.equal(restarted.surface.revisionId, first.surface.revisionId);
    assert.equal(
      (await repository.listRecipeHistory(firstSpec.recipeId)).length,
      6,
    );
  });
});
