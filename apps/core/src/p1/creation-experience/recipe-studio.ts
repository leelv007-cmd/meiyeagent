import { createHash } from 'node:crypto';

import {
  STORE_FACT_KINDS,
  evalRunSchema,
  type ComposerContentPackagePlatform,
  type ComposerDistributionTarget,
  type EvalRun,
  type RecipeModelPolicy,
  type StoreFactKind,
} from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import { CreationExperienceCatalogService } from './catalog-service.js';
import type {
  CatalogAuditMeta,
  RecipeBodyInput,
  ServerRecipeRecord,
  ServerSurfaceRecord,
} from './types.js';

export const RECIPE_STUDIO_STAGES = [
  'intent_naming',
  'context_injection',
  'brief_compilation',
  'execution_selection',
  'assembly_delivery',
] as const;

export type RecipeStudioStage = (typeof RECIPE_STUDIO_STAGES)[number];
export type RecipeStudioIntentType =
  | 'daily_exposure'
  | 'trend_response'
  | 'personal_brand'
  | 'promotional_material'
  | 'conversion';
export type RecipeStudioStorySegment =
  | 'pain_point'
  | 'professional_insight'
  | 'service_solution'
  | 'proof'
  | 'offer'
  | 'cta';
export type RecipeStudioOutputKind =
  | 'copy'
  | 'image'
  | 'image_text_note'
  | 'video';

export type RecipeStudioBlock =
  | {
      id: string;
      stage: 'intent_naming';
      type: 'intent_type';
      config: { intentTypes: RecipeStudioIntentType[] };
    }
  | {
      id: string;
      stage: 'context_injection';
      type: 'fact_slots';
      config: { factTypes: StoreFactKind[] };
    }
  | {
      id: string;
      stage: 'brief_compilation';
      type: 'story_structure';
      config: { segments: RecipeStudioStorySegment[] };
    }
  | {
      id: string;
      stage: 'brief_compilation';
      type: 'output_contract';
      config: {
        outputKind: RecipeStudioOutputKind;
        quantity: number;
        aspectRatio?: string;
        durationSeconds?: number;
      };
    }
  | {
      id: string;
      stage: 'execution_selection';
      type: 'candidate_strategy';
      config: { strategy: 'single_primary' | 'dual_style_user_choice' };
    }
  | {
      id: string;
      stage: 'assembly_delivery';
      type: 'platform_adapter';
      config: {
        contentPackagePlatform: ComposerContentPackagePlatform;
        distributionTarget: ComposerDistributionTarget;
      };
    };

export interface RecipeStudioCompileInput extends CatalogAuditMeta {
  recipeId: string;
  expectedRevision: number | null;
  industryKey: string;
  presentation: {
    title: string;
    summary: string;
  };
  dependencies: {
    promptRevisionRef: string;
    skillRevisionRefs: string[];
    workflowRevisionRef: string;
    outputContractRef: string;
    quotePolicyRevisionRef: string;
  };
  modelPolicy: RecipeModelPolicy;
  blocks: RecipeStudioBlock[];
}

export interface RecipeStudioTransitionInput extends CatalogAuditMeta {
  recipeId: string;
  expectedRevision: number;
}

export interface RecipeStudioEvaluationInput
  extends RecipeStudioTransitionInput {
  evalRun: EvalRun;
}

export interface RecipeStudioInternalTestInput
  extends RecipeStudioTransitionInput {
  label: 'internal-test';
  runId: string;
  passed: boolean;
}

export interface RecipeStudioProductionInput
  extends RecipeStudioTransitionInput {
  surfaceId: string;
  expectedSurfaceRevision: number;
}

export interface RecipeStudioRollbackInput
  extends RecipeStudioProductionInput {
  targetRevision: number;
}

export interface RecipeSkillRevisionValidationPort {
  listUnavailableFrozenRevisionRefs(
    skillRevisionRefs: readonly string[],
  ): Promise<string[]>;
}

const BLOCK_STAGE = {
  intent_type: 'intent_naming',
  fact_slots: 'context_injection',
  story_structure: 'brief_compilation',
  output_contract: 'brief_compilation',
  candidate_strategy: 'execution_selection',
  platform_adapter: 'assembly_delivery',
} as const satisfies Record<RecipeStudioBlock['type'], RecipeStudioStage>;

const BLOCK_TYPES = Object.keys(BLOCK_STAGE) as RecipeStudioBlock['type'][];
const INTENT_TYPES = new Set<RecipeStudioIntentType>([
  'daily_exposure',
  'trend_response',
  'personal_brand',
  'promotional_material',
  'conversion',
]);
const STORY_SEGMENTS = new Set<RecipeStudioStorySegment>([
  'pain_point',
  'professional_insight',
  'service_solution',
  'proof',
  'offer',
  'cta',
]);
const FACT_TYPES = new Set<string>(STORE_FACT_KINDS);
const EXACT_REVISION = /@(?:v)?\d+(?:\.\d+\.\d+)?$/u;

function fail(message: string): never {
  throw new P1DomainError('INVALID_STATE', message);
}

function exactRevision(value: string, label: string) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    /(?:^|[@:/._-])latest(?:$|[@:/._-])/iu.test(value) ||
    !EXACT_REVISION.test(value)
  ) {
    fail(`${label}必须引用精确版本，不能使用 latest 或未版本化引用。`);
  }
  return value.trim();
}

function oneBlock<T extends RecipeStudioBlock['type']>(
  blocks: RecipeStudioBlock[],
  type: T,
): Extract<RecipeStudioBlock, { type: T }> {
  const matches = blocks.filter(
    (block): block is Extract<RecipeStudioBlock, { type: T }> =>
      block.type === type,
  );
  if (matches.length !== 1) {
    fail(`受控积木“${type}”必须且只能出现一次。`);
  }
  return matches[0]!;
}

function uniqueNonEmpty(values: string[], label: string) {
  if (
    values.length === 0 ||
    values.some((value) => typeof value !== 'string' || !value.trim()) ||
    new Set(values).size !== values.length
  ) {
    fail(`${label}必须是非空且不重复的受控值列表。`);
  }
}

function compileBody(
  input: RecipeStudioCompileInput,
  now: string,
): RecipeBodyInput {
  if (
    !input.presentation ||
    !input.dependencies ||
    !input.modelPolicy ||
    !Array.isArray(input.blocks)
  ) {
    fail('Recipe Studio 编译输入不完整，请补齐展示、依赖、模型策略与受控积木。');
  }
  if (!input.recipeId.trim() || !input.industryKey.trim()) {
    fail('Recipe ID 与行业标识不能为空。');
  }
  if (!input.presentation.title.trim() || !input.presentation.summary.trim()) {
    fail('Recipe 标题与摘要不能为空。');
  }
  uniqueNonEmpty(
    input.blocks.map((block) => block.id),
    '积木 ID',
  );
  for (const block of input.blocks) {
    if (!BLOCK_TYPES.includes(block.type)) {
      fail(`积木“${block.id}”不是平台允许的受控积木。`);
    }
    if (block.stage !== BLOCK_STAGE[block.type]) {
      fail(`积木“${block.id}”不能放在阶段“${block.stage}”。`);
    }
  }

  const intent = oneBlock(input.blocks, 'intent_type');
  const facts = oneBlock(input.blocks, 'fact_slots');
  const story = oneBlock(input.blocks, 'story_structure');
  const output = oneBlock(input.blocks, 'output_contract');
  const candidate = oneBlock(input.blocks, 'candidate_strategy');
  const platform = oneBlock(input.blocks, 'platform_adapter');
  uniqueNonEmpty(intent.config.intentTypes, '意图类型');
  if (intent.config.intentTypes.some((value) => !INTENT_TYPES.has(value))) {
    fail('意图类型必须来自平台受控目录。');
  }
  uniqueNonEmpty(facts.config.factTypes, '事实槽');
  const invalidFact = facts.config.factTypes.find(
    (value) => !FACT_TYPES.has(value),
  );
  if (invalidFact) {
    fail(`事实槽“${invalidFact}”不在门店事实分类中，请选择已有分类。`);
  }
  uniqueNonEmpty(story.config.segments, '故事结构');
  if (story.config.segments.some((value) => !STORY_SEGMENTS.has(value))) {
    fail('故事结构只能使用平台审核过的叙事段。');
  }
  if (
    !Number.isInteger(output.config.quantity) ||
    output.config.quantity < 1
  ) {
    fail('输出数量必须是正整数。');
  }
  if (
    output.config.outputKind === 'image_text_note' &&
    candidate.config.strategy !== 'dual_style_user_choice'
  ) {
    fail('图文笔记必须使用双风格用户选择策略。');
  }
  if (
    output.config.outputKind !== 'image_text_note' &&
    candidate.config.strategy !== 'single_primary'
  ) {
    fail('文案、图片和视频必须使用单主候选策略。');
  }

  const promptRevisionRef = exactRevision(
    input.dependencies.promptRevisionRef,
    'Prompt',
  );
  uniqueNonEmpty(input.dependencies.skillRevisionRefs, 'Skill 依赖');
  const skillRevisionRefs = input.dependencies.skillRevisionRefs.map((ref) =>
    exactRevision(ref, 'Skill'),
  );
  const workflowRevisionRef = exactRevision(
    input.dependencies.workflowRevisionRef,
    'Workflow',
  );
  const outputContractRef = exactRevision(
    input.dependencies.outputContractRef,
    '输出合同',
  );
  const quotePolicyRevisionRef = exactRevision(
    input.dependencies.quotePolicyRevisionRef,
    '用量策略',
  );

  const outputMapping = {
    copy: { lensId: 'copy', deliverableKind: 'copy_document' },
    image: { lensId: 'image_text', deliverableKind: 'poster' },
    image_text_note: { lensId: 'image_text', deliverableKind: 'note' },
    video: { lensId: 'video', deliverableKind: 'video_package' },
  } as const;
  const mapped = outputMapping[output.config.outputKind];
  const receiptPayload = {
    industryKey: input.industryKey.trim(),
    stageRegistryRevision: 'recipe-studio-stage-registry@1' as const,
    validatorRevision: 'recipe-validator@1' as const,
    promptRevisionRef,
    skillRevisionRefs,
    workflowRevisionRef,
    outputContractRef,
    quotePolicyRevisionRef,
  };

  return {
    lensId: mapped.lensId,
    presentation: {
      title: input.presentation.title.trim(),
      summary: input.presentation.summary.trim(),
      actionLabel:
        mapped.lensId === 'copy'
          ? '选择文案并套用'
          : mapped.lensId === 'video'
            ? '选择视频并套用'
            : '选择图文并套用',
    },
    delivery: {
      contentPackagePlatform: platform.config.contentPackagePlatform,
      distributionTarget: platform.config.distributionTarget,
      deliverableKind: mapped.deliverableKind,
      quantity: output.config.quantity,
      ...(output.config.aspectRatio
        ? { aspectRatio: output.config.aspectRatio }
        : {}),
      ...(output.config.durationSeconds
        ? { durationSeconds: output.config.durationSeconds }
        : {}),
    },
    contextPatches: {
      recipeStudioPlan: {
        industryKey: input.industryKey.trim(),
        intentTypes: [...intent.config.intentTypes],
        storySegments: [...story.config.segments],
      },
    },
    factTypes: [...facts.config.factTypes],
    sourceRequirements: [],
    modelPolicy: structuredClone(input.modelPolicy),
    settingsPatches: {
      candidateStrategy: candidate.config.strategy,
      outputKind: output.config.outputKind,
    },
    outputContractRef,
    quotePolicyRevisionRef,
    workflowRevisionRef,
    promptRevisionRef,
    skillRevisionRefs,
    targetWorkspaceKind: mapped.lensId,
    studioRelease: {
      phase: 'compiled',
      compilationReceipt: {
        receiptId: createHash('sha256')
          .update(JSON.stringify(receiptPayload))
          .digest('hex'),
        compiledAt: now,
        ...receiptPayload,
      },
      validation: null,
      evaluation: null,
      internalTest: null,
    },
  };
}

function bodyFromRecord(record: ServerRecipeRecord): RecipeBodyInput {
  return {
    lensId: record.lensId,
    ...(record.familyId ? { familyId: record.familyId } : {}),
    presentation: structuredClone(record.presentation),
    delivery: structuredClone(record.delivery),
    contextPatches: structuredClone(record.contextPatches),
    factTypes: structuredClone(record.factTypes),
    sourceRequirements: structuredClone(record.sourceRequirements),
    modelPolicy: structuredClone(record.modelPolicy),
    settingsPatches: structuredClone(record.settingsPatches),
    ...(record.outputContractRef
      ? { outputContractRef: record.outputContractRef }
      : {}),
    ...(record.quotePolicyRevisionRef
      ? { quotePolicyRevisionRef: record.quotePolicyRevisionRef }
      : {}),
    ...(record.workflowRevisionRef
      ? { workflowRevisionRef: record.workflowRevisionRef }
      : {}),
    promptRevisionRef: record.promptRevisionRef,
    skillRevisionRefs: structuredClone(record.skillRevisionRefs),
    targetWorkspaceKind: record.targetWorkspaceKind,
    ...(record.studioRelease
      ? { studioRelease: structuredClone(record.studioRelease) }
      : {}),
  };
}

function operatorValidationMessage(errors: string[]) {
  if (
    errors.some(
      (error) =>
        error.includes('contentPackagePlatform') ||
        error.includes('distributionTarget'),
    )
  ) {
    return '输出位必须同时声明内容平台和交付方式，请补齐后再校验。';
  }
  return `Recipe 未通过生产同源校验：${errors.join('；')}`;
}

export class RecipeStudioService {
  constructor(
    private readonly catalog: CreationExperienceCatalogService,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly skillRevisions: RecipeSkillRevisionValidationPort = {
      async listUnavailableFrozenRevisionRefs(skillRevisionRefs) {
        return [...skillRevisionRefs];
      },
    },
  ) {}

  async compile(
    input: RecipeStudioCompileInput,
  ): Promise<ServerRecipeRecord> {
    return this.catalog.draftRecipe({
      recipeId: input.recipeId,
      expectedRevision: input.expectedRevision,
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
      body: compileBody(input, this.now()),
    });
  }

  async validate(
    input: RecipeStudioTransitionInput,
  ): Promise<ServerRecipeRecord> {
    const head = await this.requireStudioHead(input);
    const unavailable =
      await this.skillRevisions.listUnavailableFrozenRevisionRefs(
        head.skillRevisionRefs,
      );
    if (unavailable.length > 0) {
      fail(
        `以下 Skill 版本不存在或尚未受理冻结：${unavailable.join('、')}。`,
      );
    }
    const validation = await this.catalog.validateRecipe(
      input.recipeId,
      head.revision,
    );
    if (!validation.ok) {
      fail(operatorValidationMessage(validation.errors));
    }
    const body = bodyFromRecord(head);
    body.studioRelease = {
      ...structuredClone(head.studioRelease!),
      phase: 'validated',
      validation: {
        checkedAt: this.now(),
        passed: true,
      },
    };
    return this.catalog.draftRecipe({
      ...input,
      body,
    });
  }

  async recordEvaluation(
    input: RecipeStudioEvaluationInput,
  ): Promise<ServerRecipeRecord> {
    const head = await this.requireStudioHead(input);
    if (head.studioRelease?.phase !== 'validated') {
      fail('Recipe 必须先通过生产同源校验，才能记录评测结果。');
    }
    const parsed = evalRunSchema.safeParse(input.evalRun);
    if (!parsed.success) {
      fail('评测结果不符合 EvalRun v1 合同。');
    }
    if (!parsed.data.passed) {
      fail('评测未通过，不能进入内测试跑。');
    }
    if (
      parsed.data.results.some(
        (result) =>
          result.promptRevision !==
          head.studioRelease?.compilationReceipt.promptRevisionRef,
      )
    ) {
      fail('评测结果没有使用本次编译冻结的 Prompt 版本。');
    }
    const body = bodyFromRecord(head);
    body.studioRelease = {
      ...structuredClone(head.studioRelease),
      phase: 'evaluated',
      evaluation: {
        checkedAt: this.now(),
        runId: parsed.data.runId,
        suiteId: parsed.data.suiteId,
        suiteRevision: parsed.data.suiteRevision,
        passed: true,
      },
    };
    return this.catalog.draftRecipe({
      ...input,
      body,
    });
  }

  async recordInternalTest(
    input: RecipeStudioInternalTestInput,
  ): Promise<ServerRecipeRecord> {
    const head = await this.requireStudioHead(input);
    if (head.studioRelease?.phase !== 'evaluated') {
      fail('Recipe 必须先通过评测门，才能记录内测试跑。');
    }
    if (
      input.label !== 'internal-test' ||
      !input.runId.trim() ||
      input.passed !== true
    ) {
      fail('内测试跑必须在 internal-test 标签下真实通过。');
    }
    const body = bodyFromRecord(head);
    body.studioRelease = {
      ...structuredClone(head.studioRelease),
      phase: 'internal_tested',
      internalTest: {
        checkedAt: this.now(),
        label: 'internal-test',
        runId: input.runId.trim(),
        passed: true,
      },
    };
    return this.catalog.draftRecipe({
      ...input,
      body,
    });
  }

  async switchProduction(input: RecipeStudioProductionInput): Promise<{
    recipe: ServerRecipeRecord;
    surface: ServerSurfaceRecord;
  }> {
    const head = await this.requireStudioHead(input);
    if (head.studioRelease?.phase !== 'internal_tested') {
      fail('Recipe 必须依次通过校验、评测和内测试跑后才能切换生产。');
    }
    const validation = await this.catalog.validateRecipe(
      input.recipeId,
      head.revision,
    );
    if (!validation.ok) {
      fail(operatorValidationMessage(validation.errors));
    }
    await this.requireProductionSurface(
      input.surfaceId,
      input.expectedSurfaceRevision,
    );
    const preview = await this.catalog.previewRecipe({
      recipeId: input.recipeId,
      expectedRevision: head.revision,
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
    });
    const recipe = await this.catalog.publishRecipe({
      recipeId: input.recipeId,
      expectedRevision: preview.revision,
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
    });
    const surface = await this.publishSurfaceReference({
      ...input,
      recipe,
    });
    return { recipe, surface };
  }

  async rollbackProduction(input: RecipeStudioRollbackInput) {
    const head = await this.requireStudioHead(input);
    if (head.status !== 'published') {
      fail('只有当前生产中的 Recipe 才能执行生产回滚。');
    }
    await this.requireProductionSurface(
      input.surfaceId,
      input.expectedSurfaceRevision,
    );
    const recipe = await this.catalog.rollbackRecipe({
      recipeId: input.recipeId,
      expectedRevision: input.expectedRevision,
      targetRevision: input.targetRevision,
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
    });
    const surface = await this.publishSurfaceReference({
      ...input,
      recipe,
    });
    return { recipe, surface };
  }

  private async publishSurfaceReference(
    input: RecipeStudioProductionInput & { recipe: ServerRecipeRecord },
  ) {
    const head = await this.requireProductionSurface(
      input.surfaceId,
      input.expectedSurfaceRevision,
    );
    const recipeRefs = [];
    let replaced = false;
    for (const ref of head.recipeRefs) {
      const referenced = await this.catalog.getRecipeByRevisionId(
        ref.recipeRevisionId,
      );
      if (referenced?.recipeId === input.recipe.recipeId) {
        recipeRefs.push({
          ...ref,
          lensId: input.recipe.lensId,
          recipeRevisionId: input.recipe.revisionId,
        });
        replaced = true;
      } else {
        recipeRefs.push({ ...ref });
      }
    }
    if (!replaced) {
      recipeRefs.push({
        recipeRevisionId: input.recipe.revisionId,
        lensId: input.recipe.lensId,
        order: Math.max(-1, ...recipeRefs.map((ref) => ref.order)) + 1,
        featured: false,
        visible: true,
      });
    }
    const draft = await this.catalog.draftSurface({
      surfaceId: input.surfaceId,
      expectedRevision: head.revision,
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
      body: {
        recipeRefs,
        toolEntryRefs: head.toolEntryRefs.map((ref) => ({ ...ref })),
      },
    });
    const preview = await this.catalog.previewSurface({
      surfaceId: input.surfaceId,
      expectedRevision: draft.revision,
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
    });
    return this.catalog.publishSurface({
      surfaceId: input.surfaceId,
      expectedRevision: preview.revision,
      actorId: input.actorId,
      reason: input.reason,
      correlationId: input.correlationId,
    });
  }

  private async requireProductionSurface(
    surfaceId: string,
    expectedRevision: number,
  ): Promise<ServerSurfaceRecord> {
    const head = await this.catalog.getSurfaceHead(surfaceId);
    if (!head || head.status !== 'published') {
      fail('生产 Composer Surface 不存在或尚未发布。');
    }
    if (head.revision !== expectedRevision) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Composer Surface changed before the production switch.',
      );
    }
    return head;
  }

  private async requireStudioHead(
    input: Pick<RecipeStudioTransitionInput, 'expectedRevision' | 'recipeId'>,
  ) {
    const head = await this.catalog.getRecipeHead(input.recipeId);
    if (!head) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Recipe "${input.recipeId}" was not found.`,
      );
    }
    if (head.revision !== input.expectedRevision) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Recipe Studio revision changed before this operation.',
      );
    }
    if (!head.studioRelease) {
      fail('该 Recipe 不是由 Recipe Studio 编译，不能进入受控发布链。');
    }
    return head;
  }
}
