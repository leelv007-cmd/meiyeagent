/**
 * First-ship Surface revision + Recipe variants (A2 / #89, D-082/D-083; #324 viral).
 *
 * Six user-visible cards → eight single-lens Recipe revisions:
 *   five single-lens cards + "旧内容换平台" familyId with three variants.
 * Cold reuse card has NO default lens — Surface holds three ordered refs.
 *
 * Marked as first published revision defaults; later adjustments ship as new
 * revisions only (never rewrite history).
 */

import { isDeepStrictEqual } from 'node:util';

import type {
  CreationLensId,
  RecipeDeliveryDefaults,
  RecipeId,
  RecipePresentation,
  RecipeSourceRequirement,
  StoreFactKind,
  SurfaceId,
} from '@meiye/contracts';
import { CREATION_LENS_LABELS } from '@meiye/contracts';
import { CreationExperienceCatalogService } from './catalog-service.js';
import type { CreationExperienceCatalogRepository } from './memory-repository.js';
import { MemoryCreationExperienceCatalogRepository } from './memory-repository.js';
import {
  createPermittingRecipeEvidencePorts,
  type RecipeEvaluationEvidencePort,
  type RecipeInternalTestEvidencePort,
} from './recipe-evidence-ports.js';
import {
  RecipeStudioService,
  type RecipeSkillRevisionValidationPort,
  type RecipeStudioCompileInput,
  type RecipeStudioOutputKind,
} from './recipe-studio.js';
import type {
  CatalogAuditMeta,
  RecipeBodyInput,
  ServerRecipeRecord,
  ServerSurfaceRecord,
} from './types.js';

/** Global first-ship surface id (Composer cold-start six cards). */
export const LAUNCH_SURFACE_ID: SurfaceId = 'surface.home.launch';

/** Shared family for the three "旧内容换平台" variants (D-082). */
export const REUSE_CONTENT_FAMILY_ID = 'reuse_content';

export const LAUNCH_ACTOR = {
  actorId: 'system.launch-seed',
  reason: 'A2 first-ship Surface/Recipe seeds (D-082/D-083)',
  correlationId: 'launch-seed.a2',
} as const;

export const LENS_LABELS: Record<CreationLensId, string> =
  CREATION_LENS_LABELS;

/** Action labels locked to D-083 wording. */
export function actionLabelForLens(lensId: CreationLensId): string {
  return `选择${LENS_LABELS[lensId]}并套用`;
}

/** Reuse-family cold action — no lens preselection (D-083). */
export const REUSE_CONTENT_ACTION_LABEL = '选择创作形式';

export interface LaunchRecipeSeedSpec {
  recipeId: RecipeId;
  familyId: string;
  /** Stable variant key within family (design D-082 table). */
  variantKey: string;
  lensId: CreationLensId;
  presentation: RecipePresentation;
  delivery: RecipeDeliveryDefaults;
  factTypes: StoreFactKind[];
  sourceRequirements: RecipeSourceRequirement[];
  contextPatches?: Record<string, unknown>;
  settingsPatches?: Record<string, unknown>;
  outputContractRef?: string;
  workflowRevisionRef?: string;
  promptRevisionRef: string;
  quotePolicyRevisionRef?: string;
  /**
   * Featured cold-start card order (0..5 for six cards).
   * The three reuse variants share cardOrder 5.
   */
  cardOrder: number;
  /** True for cold-start six-card featured set. */
  featured: boolean;
}

/**
 * Recipe seeds matching D-082/D-083 field table (+ #324 viral adapt).
 *
 * Contract notes:
 * - `variantKey` is carried in settingsPatches (contracts have no top-level field).
 * - Friends-circle is an assisted handoff, never a ContentPackage variant target.
 * - Reuse variants share presentation title/summary; cold action is
 *   「选择创作形式」rather than lens-specific apply (D-083).
 */
export const LAUNCH_RECIPE_SPECS: readonly LaunchRecipeSeedSpec[] = [
  {
    recipeId: 'recipe.case_to_xhs_note',
    familyId: 'case_to_xhs_note',
    variantKey: 'xhs_image_text',
    lensId: 'image_text',
    presentation: {
      title: '从案例图写小红书',
      summary: '用案例图生成笔记与封面',
      actionLabel: '选择图文并套用',
    },
    delivery: {
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'export',
      deliverableKind: 'note',
      quantity: 1,
      aspectRatio: '3:4',
      notePageBound: 3,
    },
    factTypes: [],
    sourceRequirements: [
      {
        slot: 'case_image',
        required: true,
        kinds: ['image'],
      },
    ],
    contextPatches: {
      reuseCaseImages: true,
      coverAspectRatio: '3:4',
      noteCount: 1,
    },
    settingsPatches: { variantKey: 'xhs_image_text' },
    outputContractRef: 'output.xhs_note@1',
    workflowRevisionRef: 'workflow.image_text@1',
    promptRevisionRef: 'prompt.case_to_xhs_note@1',
    quotePolicyRevisionRef: 'quote.policy@1',
    cardOrder: 0,
    featured: true,
  },
  {
    // #324 P2-12 爆款复刻 — paste-track first; OpenCLI live gate is #328.
    recipeId: 'recipe.viral_adapt',
    familyId: 'viral_adapt',
    variantKey: 'viral_adapt',
    lensId: 'image_text',
    presentation: {
      title: '爆款复刻',
      summary: '粘贴参考笔记，按本店项目仿写成可发笔记',
      actionLabel: '选择图文并套用',
    },
    delivery: {
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'export',
      deliverableKind: 'note',
      quantity: 1,
      aspectRatio: '3:4',
      notePageBound: 3,
    },
    factTypes: [],
    sourceRequirements: [
      {
        // Optional reference images. Pasted note text rides in merchant rawInput
        // (viral adapt journey) — never a server scrape slot.
        slot: 'viral_reference_image',
        required: false,
        kinds: ['image'],
      },
    ],
    contextPatches: {
      viralAdapt: true,
      sourcingTracks: ['paste', 'opencli_link'],
      opencliLiveGated: true,
      coverAspectRatio: '3:4',
      noteCount: 1,
    },
    settingsPatches: { variantKey: 'viral_adapt' },
    outputContractRef: 'output.xhs_note@1',
    workflowRevisionRef: 'workflow.image_text@1',
    promptRevisionRef: 'prompt.viral_adapt@1',
    quotePolicyRevisionRef: 'quote.policy@1',
    cardOrder: 1,
    featured: true,
  },
  {
    recipeId: 'recipe.project_intro',
    familyId: 'project_intro',
    variantKey: 'wechat_copy',
    lensId: 'copy',
    presentation: {
      title: '朋友圈项目介绍',
      summary: '用项目资料生成朋友圈文案',
      actionLabel: '选择文案并套用',
    },
    delivery: {
      contentPackagePlatform: 'wechat_moments',
      distributionTarget: 'assisted_handoff',
      deliverableKind: 'copy_document',
      quantity: 1,
    },
    factTypes: ['service'],
    sourceRequirements: [],
    contextPatches: {
      distributionTarget: 'wechat_moments',
      lengthHint: '80-180',
    },
    settingsPatches: { variantKey: 'wechat_copy' },
    outputContractRef: 'output.wechat_copy@1',
    workflowRevisionRef: 'workflow.copy@1',
    promptRevisionRef: 'prompt.project_intro@1',
    quotePolicyRevisionRef: 'quote.policy@1',
    cardOrder: 1,
    featured: true,
  },
  {
    recipeId: 'recipe.campaign_visual_set',
    familyId: 'campaign_visual_set',
    variantKey: 'image_set',
    lensId: 'image_text',
    presentation: {
      title: '项目/活动套图',
      summary: '用项目或活动信息生成 4 张套图',
      actionLabel: '选择图文并套用',
    },
    delivery: {
      contentPackagePlatform: 'generic',
      distributionTarget: 'export',
      deliverableKind: 'image_set',
      quantity: 4,
      aspectRatio: '3:4',
    },
    factTypes: ['service', 'price', 'group_buy', 'fulfillment'],
    sourceRequirements: [
      { slot: 'campaign_asset', required: false, kinds: ['image'] },
    ],
    contextPatches: {
      setLayout: ['cover', 'highlights', 'details', 'cta'],
      subjectKindField: 'subject_kind',
    },
    settingsPatches: { variantKey: 'image_set' },
    outputContractRef: 'output.image_set@1',
    workflowRevisionRef: 'workflow.image_text@1',
    promptRevisionRef: 'prompt.campaign_visual_set@1',
    quotePolicyRevisionRef: 'quote.policy@1',
    cardOrder: 2,
    featured: true,
  },
  {
    recipeId: 'recipe.promotion_poster',
    familyId: 'promotion_poster',
    variantKey: 'poster',
    lensId: 'image_text',
    presentation: {
      title: '促销海报',
      summary: '用优惠和期限生成活动海报',
      actionLabel: '选择图文并套用',
    },
    delivery: {
      contentPackagePlatform: 'offline_material',
      distributionTarget: 'export',
      deliverableKind: 'poster',
      quantity: 1,
      aspectRatio: '3:4',
    },
    factTypes: ['price', 'discount', 'fulfillment'],
    sourceRequirements: [
      { slot: 'hero_visual', required: false, kinds: ['image'] },
    ],
    contextPatches: {
      editableAspectRatios: ['3:4', '1:1', '9:16'],
    },
    settingsPatches: {
      variantKey: 'poster',
      editableAspectRatios: ['3:4', '1:1', '9:16'],
    },
    outputContractRef: 'output.poster@1',
    workflowRevisionRef: 'workflow.image_text@1',
    promptRevisionRef: 'prompt.promotion_poster@1',
    quotePolicyRevisionRef: 'quote.policy@1',
    cardOrder: 3,
    featured: true,
  },
  {
    recipeId: 'recipe.douyin_project_video',
    familyId: 'douyin_project_video',
    variantKey: 'douyin_video',
    lensId: 'video',
    presentation: {
      title: '抖音项目成片',
      summary: '用案例素材生成 15 秒竖版成片',
      actionLabel: '选择视频并套用',
    },
    delivery: {
      contentPackagePlatform: 'douyin',
      distributionTarget: 'export',
      deliverableKind: 'video_package',
      quantity: 1,
      aspectRatio: '9:16',
      durationSeconds: 15,
    },
    factTypes: [],
    sourceRequirements: [
      {
        slot: 'case_media',
        required: true,
        kinds: ['image', 'video'],
      },
    ],
    contextPatches: {
      includeCover: true,
      includePublishCopy: true,
    },
    settingsPatches: { variantKey: 'douyin_video' },
    outputContractRef: 'output.douyin_video@1',
    workflowRevisionRef: 'workflow.video.15s@1',
    promptRevisionRef: 'prompt.douyin_project_video@1',
    quotePolicyRevisionRef: 'quote.policy@1',
    cardOrder: 4,
    featured: true,
  },
  // —— 旧内容换平台：same familyId, three variants, cold NO default lens ——
  {
    recipeId: 'recipe.reuse_content.copy_adapt',
    familyId: REUSE_CONTENT_FAMILY_ID,
    variantKey: 'copy_adapt',
    lensId: 'copy',
    presentation: {
      title: '旧内容换平台',
      summary: '选择旧内容，再决定改成哪种形式',
      actionLabel: REUSE_CONTENT_ACTION_LABEL,
    },
    delivery: {
      contentPackagePlatform: 'generic',
      distributionTarget: 'export',
      deliverableKind: 'copy_document',
      quantity: 1,
    },
    factTypes: [],
    sourceRequirements: [
      {
        slot: 'source_content',
        required: true,
        kinds: ['content', 'work', 'content_package'],
      },
    ],
    contextPatches: {
      requiresUserLensChoice: true,
      coldDefaultLens: null,
    },
    settingsPatches: { variantKey: 'copy_adapt' },
    outputContractRef: 'output.reuse_copy@1',
    workflowRevisionRef: 'workflow.copy.adapt@1',
    promptRevisionRef: 'prompt.reuse_content.copy@1',
    quotePolicyRevisionRef: 'quote.policy@1',
    cardOrder: 5,
    featured: true,
  },
  {
    recipeId: 'recipe.reuse_content.image_text_adapt',
    familyId: REUSE_CONTENT_FAMILY_ID,
    variantKey: 'image_text_adapt',
    lensId: 'image_text',
    presentation: {
      title: '旧内容换平台',
      summary: '选择旧内容，再决定改成哪种形式',
      actionLabel: REUSE_CONTENT_ACTION_LABEL,
    },
    delivery: {
      contentPackagePlatform: 'generic',
      distributionTarget: 'export',
      deliverableKind: 'image_text_package',
      quantity: 1,
      aspectRatio: '3:4',
      notePageBound: 3,
    },
    factTypes: [],
    sourceRequirements: [
      {
        slot: 'source_content',
        required: true,
        kinds: ['content', 'work', 'content_package'],
      },
    ],
    contextPatches: {
      requiresUserLensChoice: true,
      coldDefaultLens: null,
    },
    settingsPatches: { variantKey: 'image_text_adapt' },
    outputContractRef: 'output.reuse_image_text@1',
    workflowRevisionRef: 'workflow.image_text.adapt@1',
    promptRevisionRef: 'prompt.reuse_content.image_text@1',
    quotePolicyRevisionRef: 'quote.policy@1',
    cardOrder: 5,
    featured: true,
  },
  {
    recipeId: 'recipe.reuse_content.video_adapt',
    familyId: REUSE_CONTENT_FAMILY_ID,
    variantKey: 'video_adapt',
    lensId: 'video',
    presentation: {
      title: '旧内容换平台',
      summary: '选择旧内容，再决定改成哪种形式',
      actionLabel: REUSE_CONTENT_ACTION_LABEL,
    },
    delivery: {
      contentPackagePlatform: 'generic',
      distributionTarget: 'export',
      deliverableKind: 'video_package',
      quantity: 1,
      aspectRatio: '9:16',
      durationSeconds: 15,
    },
    factTypes: [],
    sourceRequirements: [
      {
        slot: 'source_content',
        required: true,
        kinds: ['content', 'work', 'content_package'],
      },
    ],
    contextPatches: {
      requiresUserLensChoice: true,
      coldDefaultLens: null,
    },
    settingsPatches: { variantKey: 'video_adapt' },
    outputContractRef: 'output.reuse_video@1',
    workflowRevisionRef: 'workflow.video.adapt@1',
    promptRevisionRef: 'prompt.reuse_content.video@1',
    quotePolicyRevisionRef: 'quote.policy@1',
    cardOrder: 5,
    featured: true,
  },
];

export function recipeBodyFromSpec(spec: LaunchRecipeSeedSpec): RecipeBodyInput {
  return {
    lensId: spec.lensId,
    familyId: spec.familyId,
    presentation: { ...spec.presentation },
    delivery: { ...spec.delivery },
    contextPatches: { ...(spec.contextPatches ?? {}) },
    factTypes: [...spec.factTypes],
    sourceRequirements: spec.sourceRequirements.map((slot) => ({ ...slot })),
    modelPolicy: { mode: 'auto' },
    settingsPatches: { ...(spec.settingsPatches ?? {}) },
    ...(spec.outputContractRef
      ? { outputContractRef: spec.outputContractRef }
      : {}),
    ...(spec.quotePolicyRevisionRef
      ? { quotePolicyRevisionRef: spec.quotePolicyRevisionRef }
      : {}),
    ...(spec.workflowRevisionRef
      ? { workflowRevisionRef: spec.workflowRevisionRef }
      : {}),
    promptRevisionRef: spec.promptRevisionRef,
    skillRevisionRefs: [],
    targetWorkspaceKind: spec.lensId,
  };
}

export function matchesLaunchRecipeSpec(
  recipe: ServerRecipeRecord,
  spec: LaunchRecipeSeedSpec,
) {
  const body = recipeBodyFromSpec(spec);
  const { recipeStudioPlan: _recipeStudioPlan, ...contextPatches } =
    recipe.contextPatches;
  const {
    candidateStrategy: _candidateStrategy,
    outputKind: _outputKind,
    ...settingsPatches
  } = recipe.settingsPatches;
  return isDeepStrictEqual(
    {
      lensId: recipe.lensId,
      ...(recipe.familyId ? { familyId: recipe.familyId } : {}),
      presentation: recipe.presentation,
      delivery: recipe.delivery,
      contextPatches,
      factTypes: recipe.factTypes,
      sourceRequirements: recipe.sourceRequirements,
      modelPolicy: recipe.modelPolicy,
      settingsPatches,
      ...(recipe.outputContractRef
        ? { outputContractRef: recipe.outputContractRef }
        : {}),
      ...(recipe.quotePolicyRevisionRef
        ? { quotePolicyRevisionRef: recipe.quotePolicyRevisionRef }
        : {}),
      ...(recipe.workflowRevisionRef
        ? { workflowRevisionRef: recipe.workflowRevisionRef }
        : {}),
      promptRevisionRef: recipe.promptRevisionRef,
      skillRevisionRefs: recipe.skillRevisionRefs,
      targetWorkspaceKind: recipe.targetWorkspaceKind,
    },
    body,
  );
}

function studioOutputKind(
  deliverableKind: RecipeDeliveryDefaults['deliverableKind'],
): RecipeStudioOutputKind {
  if (deliverableKind === 'copy_document') return 'copy';
  if (deliverableKind === 'video_package') return 'video';
  if (
    deliverableKind === 'note' ||
    deliverableKind === 'image_text_package'
  ) {
    return 'image_text_note';
  }
  return 'image';
}

export function recipeStudioInputFromSpec(
  spec: LaunchRecipeSeedSpec,
  audit: CatalogAuditMeta = LAUNCH_ACTOR,
): RecipeStudioCompileInput {
  const outputKind = studioOutputKind(spec.delivery.deliverableKind);
  return {
    ...audit,
    recipeId: spec.recipeId,
    expectedRevision: null,
    industryKey: 'beauty_launch',
    familyId: spec.familyId,
    presentation: { ...spec.presentation },
    contextPatches: { ...(spec.contextPatches ?? {}) },
    settingsPatches: { ...(spec.settingsPatches ?? {}) },
    dependencies: {
      promptRevisionRef: spec.promptRevisionRef,
      skillRevisionRefs: [],
      workflowRevisionRef: spec.workflowRevisionRef!,
      outputContractRef: spec.outputContractRef!,
      quotePolicyRevisionRef: spec.quotePolicyRevisionRef!,
    },
    modelPolicy: { mode: 'auto' },
    blocks: [
      {
        id: 'intent',
        stage: 'intent_naming',
        type: 'intent_type',
        config: {
          intentTypes:
            spec.familyId === 'promotion_poster'
              ? ['promotional_material']
              : ['daily_exposure'],
        },
      },
      {
        id: 'facts',
        stage: 'context_injection',
        type: 'fact_slots',
        config: {
          factTypes: [...spec.factTypes],
          sourceRequirements: spec.sourceRequirements.map((slot) => ({
            ...slot,
          })),
        },
      },
      {
        id: 'story',
        stage: 'brief_compilation',
        type: 'story_structure',
        config: {
          segments: ['pain_point', 'service_solution', 'proof', 'cta'],
        },
      },
      {
        id: 'output',
        stage: 'brief_compilation',
        type: 'output_contract',
        config: {
          outputKind,
          deliverableKind: spec.delivery.deliverableKind,
          quantity: spec.delivery.quantity!,
          ...(spec.delivery.aspectRatio
            ? { aspectRatio: spec.delivery.aspectRatio }
            : {}),
          ...(spec.delivery.durationSeconds
            ? { durationSeconds: spec.delivery.durationSeconds }
            : {}),
          ...(spec.delivery.notePageBound
            ? { notePageBound: spec.delivery.notePageBound }
            : {}),
        },
      },
      {
        id: 'candidate',
        stage: 'execution_selection',
        type: 'candidate_strategy',
        config: {
          strategy:
            outputKind === 'image_text_note'
              ? 'dual_style_user_choice'
              : 'single_primary',
        },
      },
      {
        id: 'platform',
        stage: 'assembly_delivery',
        type: 'platform_adapter',
        config: {
          contentPackagePlatform: spec.delivery.contentPackagePlatform!,
          distributionTarget: spec.delivery.distributionTarget!,
        },
      },
    ],
  };
}

export function listLaunchRecipeSpecs(): LaunchRecipeSeedSpec[] {
  return LAUNCH_RECIPE_SPECS.map((spec) => ({
    ...spec,
    presentation: { ...spec.presentation },
    delivery: { ...spec.delivery },
    factTypes: [...spec.factTypes],
    sourceRequirements: spec.sourceRequirements.map((slot) => ({ ...slot })),
    contextPatches: { ...(spec.contextPatches ?? {}) },
    settingsPatches: { ...(spec.settingsPatches ?? {}) },
  }));
}

export function listReuseContentVariants(): LaunchRecipeSeedSpec[] {
  return listLaunchRecipeSpecs().filter(
    (spec) => spec.familyId === REUSE_CONTENT_FAMILY_ID,
  );
}

/** Cold-start card count after grouping reuse family (always 6). */
export function listLaunchCardFamilies(): string[] {
  const seen: string[] = [];
  for (const spec of LAUNCH_RECIPE_SPECS) {
    if (!seen.includes(spec.familyId)) seen.push(spec.familyId);
  }
  return seen;
}

export interface PublishLaunchCatalogResult {
  recipes: ServerRecipeRecord[];
  surface: ServerSurfaceRecord;
}

/**
 * Draft → preview → publish all formal Recipes, then the launch Surface.
 * Surface recipeRefs pin the published revision ids (session freeze later).
 *
 * Launch seeds redeem through a server-side permitting evidence seam (not the
 * browser command path). Production gates use registry-backed redeem (#396).
 */
export async function publishLaunchCatalog(
  service: CreationExperienceCatalogService,
  options: {
    surfaceId?: SurfaceId;
    actorId?: string;
    reason?: string;
    correlationId?: string;
    now?: () => string;
    skillRevisionValidation?: RecipeSkillRevisionValidationPort;
    evaluationEvidence?: RecipeEvaluationEvidencePort;
    internalTestEvidence?: RecipeInternalTestEvidencePort;
  } = {},
): Promise<PublishLaunchCatalogResult> {
  const audit = {
    actorId: options.actorId ?? LAUNCH_ACTOR.actorId,
    reason: options.reason ?? LAUNCH_ACTOR.reason,
    correlationId: options.correlationId ?? LAUNCH_ACTOR.correlationId,
  };
  const surfaceId = options.surfaceId ?? LAUNCH_SURFACE_ID;
  const now = options.now ?? (() => new Date().toISOString());
  const seedEvidence =
    options.evaluationEvidence || options.internalTestEvidence
      ? {
          evaluation: options.evaluationEvidence,
          internalTest: options.internalTestEvidence,
        }
      : createPermittingRecipeEvidencePorts({
          now,
          issuerId: LAUNCH_ACTOR.actorId,
          suiteId: 'recipe-launch-seeds',
          suiteRevision: 'recipe-launch-seeds@1',
        });
  const studio = new RecipeStudioService(
    service,
    now,
    options.skillRevisionValidation ?? {
      async listUnavailableFrozenRevisionRefs() {
        return [];
      },
    },
    seedEvidence,
  );
  const recipes: ServerRecipeRecord[] = [];
  let surface = await service.getSurfaceHead(surfaceId);
  if (surface?.status === 'draft') {
    surface = await service.previewSurface({
      surfaceId,
      expectedRevision: surface.revision,
      ...audit,
    });
  }
  if (surface?.status === 'preview') {
    surface = await service.publishSurface({
      surfaceId,
      expectedRevision: surface.revision,
      ...audit,
    });
  }
  if (surface && surface.status !== 'published') {
    throw new Error('Launch Surface cannot recover to a published revision.');
  }

  for (const spec of LAUNCH_RECIPE_SPECS) {
    let head = await service.getRecipeHead(spec.recipeId);
    if (
      !head?.studioRelease ||
      !matchesLaunchRecipeSpec(head, spec)
    ) {
      head = await studio.compile({
        ...recipeStudioInputFromSpec(spec, audit),
        expectedRevision: head?.revision ?? null,
      });
    }
    if (head.studioRelease?.phase === 'compiled') {
      head = await studio.validate({
        recipeId: spec.recipeId,
        expectedRevision: head.revision,
        ...audit,
      });
    }
    if (head.studioRelease?.phase === 'validated') {
      head = await studio.recordEvaluation({
        recipeId: spec.recipeId,
        expectedRevision: head.revision,
        evidenceReceiptId: `launch-seed-eval:${spec.variantKey}`,
        ...audit,
      });
    }
    if (head.studioRelease?.phase === 'evaluated') {
      head = await studio.recordInternalTest({
        recipeId: spec.recipeId,
        expectedRevision: head.revision,
        evidenceReceiptId: `launch-seed-internal:${spec.variantKey}`,
        ...audit,
      });
    }
    if (head.studioRelease?.phase !== 'internal_tested') {
      throw new Error(
        `Launch Recipe ${spec.recipeId} cannot recover through the Studio gates.`,
      );
    }
    if (
      head.status === 'published' &&
      surface?.recipeRefs.some(
        (reference) => reference.recipeRevisionId === head!.revisionId,
      )
    ) {
      recipes.push(head);
      continue;
    }
    const production = await studio.switchProduction({
      recipeId: spec.recipeId,
      expectedRevision: head.revision,
      surfaceId,
      expectedSurfaceRevision: surface?.revision ?? null,
      surfaceRef: {
        order: spec.cardOrder,
        featured: spec.featured,
        visible: true,
      },
      ...audit,
    });
    recipes.push(production.recipe);
    surface = production.surface;
  }

  if (!surface) {
    throw new Error('Launch catalog did not publish a production Surface.');
  }
  return { recipes, surface };
}

/** Convenience: memory repo + service + publish first-ship catalog. */
export async function seedLaunchCatalogInMemory(options?: {
  now?: () => string;
  id?: () => string;
}): Promise<{
  repository: CreationExperienceCatalogRepository;
  service: CreationExperienceCatalogService;
  result: PublishLaunchCatalogResult;
}> {
  const repository = new MemoryCreationExperienceCatalogRepository();
  const service = new CreationExperienceCatalogService(
    repository,
    options?.now ?? (() => '2026-07-20T12:00:00.000Z'),
    options?.id ?? (() => 'session-launch-1'),
  );
  const result = await publishLaunchCatalog(service, {
    now: options?.now ?? (() => '2026-07-20T12:00:00.000Z'),
  });
  return { repository, service, result };
}
