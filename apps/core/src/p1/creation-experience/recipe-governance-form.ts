/**
 * Spec D / #372 — Templates-submitted Recipe governance form contract and
 * the sole server-side adapter that maps it into RecipeStudioCompileInput.
 *
 * Browser clients must never assemble studioRelease or controlled blocks
 * themselves; every governed save goes form → adapter → compile (+ validate).
 */

import type {
  ComposerContentPackagePlatform,
  ComposerDistributionTarget,
  RecipeDeliveryDefaults,
  RecipeModelPolicy,
  RecipeSourceRequirement,
  StoreFactKind,
} from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import type {
  RecipeStudioCompileInput,
  RecipeStudioIntentType,
  RecipeStudioOutputKind,
  RecipeStudioStorySegment,
} from './recipe-studio.js';
import type { CatalogAuditMeta } from './types.js';

/** Fixed block ids produced by the governance adapter (one of each type). */
export const RECIPE_GOVERNANCE_BLOCK_IDS = {
  intent: 'intent',
  facts: 'facts',
  story: 'story',
  output: 'output',
  candidate: 'candidate',
  platform: 'platform',
} as const;

export interface RecipeGovernanceOutputContract {
  outputKind: RecipeStudioOutputKind;
  deliverableKind?: RecipeDeliveryDefaults['deliverableKind'];
  quantity: number;
  aspectRatio?: string;
  durationSeconds?: number;
  notePageBound?: number;
}

export interface RecipeGovernancePlatformFields {
  contentPackagePlatform: ComposerContentPackagePlatform;
  distributionTarget: ComposerDistributionTarget;
}

/**
 * Structured form input submitted by Templates creation-experience controls.
 * Explicit fields only — no lens inference, no raw JSON blocks, no studioRelease.
 */
export interface RecipeGovernanceFormInput extends CatalogAuditMeta {
  recipeId: string;
  expectedRevision: number | null;
  industryKey: string;
  presentation: {
    title: string;
    summary: string;
    actionLabel?: string;
  };
  familyId?: string;
  contextPatches?: Record<string, unknown>;
  settingsPatches?: Record<string, unknown>;
  modelPolicy: RecipeModelPolicy;
  promptRevisionRef: string;
  skillRevisionRefs: string[];
  workflowRevisionRef: string;
  outputContractRef: string;
  quotePolicyRevisionRef: string;
  factTypes: StoreFactKind[];
  sourceRequirements: RecipeSourceRequirement[];
  intentTypes: RecipeStudioIntentType[];
  storySegments: RecipeStudioStorySegment[];
  output: RecipeGovernanceOutputContract;
  candidateStrategy: 'single_primary' | 'dual_style_user_choice';
  platform: RecipeGovernancePlatformFields;
}

const GOVERNANCE_FORBIDDEN_CLIENT_KEYS = [
  'studioRelease',
  'hiddenPromptBody',
  'passed',
  'blocks',
  'evalRun',
] as const;

function fail(message: string): never {
  throw new P1DomainError('INVALID_STATE', message);
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${label}不能为空。`);
  }
  return value.trim();
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    fail(`${label}必须是列表。`);
  }
  if (value.some((item) => typeof item !== 'string' || !item.trim())) {
    fail(`${label}必须是非空字符串列表。`);
  }
  return value.map((item) => (item as string).trim());
}

function requireObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label}不完整。`);
  }
  return value as Record<string, unknown>;
}

/**
 * Reject client-forged release / block / evidence fields on a governance form.
 * Spec D: browser-submitted studioRelease, passed, or hidden prompts are
 * discarded for ordinary draft paths; governance form attempts fail closed.
 */
export function assertRecipeGovernanceFormHasNoServerOnlyFields(
  raw: Record<string, unknown>,
): void {
  for (const key of GOVERNANCE_FORBIDDEN_CLIENT_KEYS) {
    if (key in raw && raw[key] !== undefined) {
      fail(
        `治理表单不得携带服务端专属字段“${key}”；发布态与编译回执仅由 Core 写入。`,
      );
    }
  }
  const nested = raw.body;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    assertRecipeGovernanceFormHasNoServerOnlyFields(
      nested as Record<string, unknown>,
    );
  }
}

/**
 * Parse and validate a browser payload into RecipeGovernanceFormInput.
 * Audit fields (actorId / correlationId) are supplied by the command seam.
 */
export function parseRecipeGovernanceFormInput(
  raw: Record<string, unknown>,
  audit: CatalogAuditMeta,
): RecipeGovernanceFormInput {
  assertRecipeGovernanceFormHasNoServerOnlyFields(raw);

  if (!('expectedRevision' in raw)) {
    fail('expectedRevision is required.');
  }
  const expectedRevision =
    raw.expectedRevision === null
      ? null
      : typeof raw.expectedRevision === 'number' &&
          Number.isInteger(raw.expectedRevision)
        ? raw.expectedRevision
        : fail('expectedRevision must be an integer or null.');

  const presentation = requireObject(raw.presentation, '展示字段');
  const modelPolicy = requireObject(raw.modelPolicy, '模型策略');
  const output = requireObject(raw.output, '输出合同');
  const platform = requireObject(raw.platform, '平台分发字段');

  if (modelPolicy.mode !== 'auto' && modelPolicy.mode !== 'fixed') {
    fail('模型策略 mode 必须是 auto 或 fixed。');
  }
  if (
    modelPolicy.mode === 'fixed' &&
    (typeof modelPolicy.catalogModelId !== 'string' ||
      !modelPolicy.catalogModelId.trim())
  ) {
    fail('固定模型策略需要填写 Catalog model ID。');
  }

  const quantity = output.quantity;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity)) {
    fail('输出数量必须是正整数。');
  }

  const candidateStrategy = raw.candidateStrategy;
  if (
    candidateStrategy !== 'single_primary' &&
    candidateStrategy !== 'dual_style_user_choice'
  ) {
    fail('候选策略必须是 single_primary 或 dual_style_user_choice。');
  }

  const sourceRequirementsRaw = raw.sourceRequirements;
  if (!Array.isArray(sourceRequirementsRaw)) {
    fail('来源要求必须是列表。');
  }
  const sourceRequirements = sourceRequirementsRaw.map((item, index) => {
    const requirement = requireObject(item, `来源要求[${index}]`);
    return {
      slot: requireNonEmptyString(requirement.slot, `来源要求[${index}].slot`),
      required: requirement.required === true,
      ...(Array.isArray(requirement.kinds)
        ? {
            kinds: requirement.kinds.map((kind, kindIndex) =>
              requireNonEmptyString(
                kind,
                `来源要求[${index}].kinds[${kindIndex}]`,
              ),
            ),
          }
        : {}),
    } satisfies RecipeSourceRequirement;
  });

  const contextPatches =
    raw.contextPatches === undefined
      ? undefined
      : requireObject(raw.contextPatches, 'contextPatches');
  const settingsPatches =
    raw.settingsPatches === undefined
      ? undefined
      : requireObject(raw.settingsPatches, 'settingsPatches');

  return {
    recipeId: requireNonEmptyString(raw.recipeId, 'Recipe ID'),
    expectedRevision,
    actorId: audit.actorId,
    reason: audit.reason,
    correlationId: audit.correlationId,
    industryKey: requireNonEmptyString(raw.industryKey, '行业标识'),
    presentation: {
      title: requireNonEmptyString(presentation.title, 'Recipe 标题'),
      summary: requireNonEmptyString(presentation.summary, 'Recipe 摘要'),
      ...(typeof presentation.actionLabel === 'string' &&
      presentation.actionLabel.trim()
        ? { actionLabel: presentation.actionLabel.trim() }
        : {}),
    },
    ...(typeof raw.familyId === 'string' && raw.familyId.trim()
      ? { familyId: raw.familyId.trim() }
      : {}),
    ...(contextPatches ? { contextPatches: structuredClone(contextPatches) } : {}),
    ...(settingsPatches
      ? { settingsPatches: structuredClone(settingsPatches) }
      : {}),
    modelPolicy: {
      mode: modelPolicy.mode,
      ...(modelPolicy.mode === 'fixed' &&
      typeof modelPolicy.catalogModelId === 'string'
        ? { catalogModelId: modelPolicy.catalogModelId.trim() }
        : {}),
    },
    promptRevisionRef: requireNonEmptyString(
      raw.promptRevisionRef,
      'Prompt 版本引用',
    ),
    skillRevisionRefs: requireStringArray(
      raw.skillRevisionRefs,
      'Skill 版本引用',
    ),
    workflowRevisionRef: requireNonEmptyString(
      raw.workflowRevisionRef,
      'Workflow 版本引用',
    ),
    outputContractRef: requireNonEmptyString(
      raw.outputContractRef,
      '输出合同引用',
    ),
    quotePolicyRevisionRef: requireNonEmptyString(
      raw.quotePolicyRevisionRef,
      '用量策略版本引用',
    ),
    factTypes: requireStringArray(raw.factTypes, '事实类型') as StoreFactKind[],
    sourceRequirements,
    intentTypes: requireStringArray(
      raw.intentTypes,
      '意图类型',
    ) as RecipeStudioIntentType[],
    storySegments: requireStringArray(
      raw.storySegments,
      '故事段',
    ) as RecipeStudioStorySegment[],
    output: {
      outputKind: requireNonEmptyString(
        output.outputKind,
        '输出合同 outputKind',
      ) as RecipeStudioOutputKind,
      quantity,
      ...(typeof output.deliverableKind === 'string' &&
      output.deliverableKind.trim()
        ? {
            deliverableKind:
              output.deliverableKind as RecipeDeliveryDefaults['deliverableKind'],
          }
        : {}),
      ...(typeof output.aspectRatio === 'string' && output.aspectRatio.trim()
        ? { aspectRatio: output.aspectRatio.trim() }
        : {}),
      ...(typeof output.durationSeconds === 'number'
        ? { durationSeconds: output.durationSeconds }
        : {}),
      ...(typeof output.notePageBound === 'number'
        ? { notePageBound: output.notePageBound }
        : {}),
    },
    candidateStrategy,
    platform: {
      contentPackagePlatform: requireNonEmptyString(
        platform.contentPackagePlatform,
        '内容平台',
      ) as ComposerContentPackagePlatform,
      distributionTarget: requireNonEmptyString(
        platform.distributionTarget,
        '交付方式',
      ) as ComposerDistributionTarget,
    },
  };
}

/**
 * Sole seam that converts Templates form input into RecipeStudioCompileInput.
 * Produces exactly six controlled blocks; never attaches studioRelease.
 */
export function adaptRecipeGovernanceFormToCompileInput(
  form: RecipeGovernanceFormInput,
): RecipeStudioCompileInput {
  if (
    !form.recipeId?.trim() ||
    !form.industryKey?.trim() ||
    !form.presentation?.title?.trim() ||
    !form.presentation?.summary?.trim()
  ) {
    fail('治理表单输入不完整，请补齐 Recipe ID、行业标识与展示字段。');
  }
  if (
    !form.promptRevisionRef?.trim() ||
    !form.workflowRevisionRef?.trim() ||
    !form.outputContractRef?.trim() ||
    !form.quotePolicyRevisionRef?.trim() ||
    !Array.isArray(form.skillRevisionRefs) ||
    !Array.isArray(form.factTypes) ||
    !Array.isArray(form.intentTypes) ||
    !Array.isArray(form.storySegments) ||
    !form.output ||
    !form.platform ||
    !form.modelPolicy ||
    !form.candidateStrategy
  ) {
    fail(
      '治理表单输入不完整，请补齐依赖引用、事实/意图/故事/输出/候选/平台字段。',
    );
  }

  return {
    recipeId: form.recipeId.trim(),
    expectedRevision: form.expectedRevision,
    actorId: form.actorId,
    reason: form.reason,
    correlationId: form.correlationId,
    industryKey: form.industryKey.trim(),
    presentation: {
      title: form.presentation.title.trim(),
      summary: form.presentation.summary.trim(),
      ...(form.presentation.actionLabel?.trim()
        ? { actionLabel: form.presentation.actionLabel.trim() }
        : {}),
    },
    ...(form.familyId?.trim() ? { familyId: form.familyId.trim() } : {}),
    ...(form.contextPatches
      ? { contextPatches: structuredClone(form.contextPatches) }
      : {}),
    ...(form.settingsPatches
      ? { settingsPatches: structuredClone(form.settingsPatches) }
      : {}),
    dependencies: {
      promptRevisionRef: form.promptRevisionRef.trim(),
      skillRevisionRefs: form.skillRevisionRefs.map((ref) => ref.trim()),
      workflowRevisionRef: form.workflowRevisionRef.trim(),
      outputContractRef: form.outputContractRef.trim(),
      quotePolicyRevisionRef: form.quotePolicyRevisionRef.trim(),
    },
    modelPolicy: structuredClone(form.modelPolicy),
    blocks: [
      {
        id: RECIPE_GOVERNANCE_BLOCK_IDS.intent,
        stage: 'intent_naming',
        type: 'intent_type',
        config: { intentTypes: [...form.intentTypes] },
      },
      {
        id: RECIPE_GOVERNANCE_BLOCK_IDS.facts,
        stage: 'context_injection',
        type: 'fact_slots',
        config: {
          factTypes: [...form.factTypes],
          sourceRequirements: form.sourceRequirements.map((requirement) => ({
            ...requirement,
            ...(requirement.kinds ? { kinds: [...requirement.kinds] } : {}),
          })),
        },
      },
      {
        id: RECIPE_GOVERNANCE_BLOCK_IDS.story,
        stage: 'brief_compilation',
        type: 'story_structure',
        config: { segments: [...form.storySegments] },
      },
      {
        id: RECIPE_GOVERNANCE_BLOCK_IDS.output,
        stage: 'brief_compilation',
        type: 'output_contract',
        config: {
          outputKind: form.output.outputKind,
          quantity: form.output.quantity,
          ...(form.output.deliverableKind
            ? { deliverableKind: form.output.deliverableKind }
            : {}),
          ...(form.output.aspectRatio
            ? { aspectRatio: form.output.aspectRatio }
            : {}),
          ...(form.output.durationSeconds !== undefined
            ? { durationSeconds: form.output.durationSeconds }
            : {}),
          ...(form.output.notePageBound !== undefined
            ? { notePageBound: form.output.notePageBound }
            : {}),
        },
      },
      {
        id: RECIPE_GOVERNANCE_BLOCK_IDS.candidate,
        stage: 'execution_selection',
        type: 'candidate_strategy',
        config: { strategy: form.candidateStrategy },
      },
      {
        id: RECIPE_GOVERNANCE_BLOCK_IDS.platform,
        stage: 'assembly_delivery',
        type: 'platform_adapter',
        config: {
          contentPackagePlatform: form.platform.contentPackagePlatform,
          distributionTarget: form.platform.distributionTarget,
        },
      },
    ],
  };
}
