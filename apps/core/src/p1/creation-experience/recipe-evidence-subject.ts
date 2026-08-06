/**
 * Build a recipe-governance subject from a durable Recipe revision.
 * Used by the Templates evaluation run trigger (#397) so the suite runner
 * never trusts browser-assembled subjects.
 */

import type { StoreFactKind } from '@meiye/contracts';

import type { RecipeGovernanceSubject } from '../../evals/recipe-governance/subject.js';
import { P1DomainError } from '../foundation/domain.js';
import type {
  RecipeStudioIntentType,
  RecipeStudioOutputKind,
} from './recipe-studio.js';
import type { ServerRecipeRecord } from './types.js';

const INTENT_TYPES = new Set<RecipeStudioIntentType>([
  'daily_exposure',
  'trend_response',
  'personal_brand',
  'promotional_material',
  'conversion',
]);

const OUTPUT_KINDS = new Set<RecipeStudioOutputKind>([
  'copy',
  'image',
  'image_text_note',
  'video',
]);

/**
 * Compile-frozen Prompt for evidence binding: prefer compilation receipt.
 */
export function resolveRecipeEvidencePromptRevisionRef(
  recipe: ServerRecipeRecord,
): string {
  const fromReceipt =
    recipe.studioRelease?.compilationReceipt.promptRevisionRef?.trim() ?? '';
  if (fromReceipt) return fromReceipt;
  const fromHead = recipe.promptRevisionRef.trim();
  if (fromHead) return fromHead;
  throw new P1DomainError(
    'INVALID_STATE',
    '当前 Recipe revision 没有可用的 Prompt revision，无法判定或签发评测证据。',
  );
}

export function buildRecipeGovernanceSubjectFromRecipe(
  recipe: ServerRecipeRecord,
): RecipeGovernanceSubject {
  const promptRevisionRef = resolveRecipeEvidencePromptRevisionRef(recipe);
  const plan = readStudioPlan(recipe.contextPatches);
  const intentTypes = readIntentTypes(plan);
  const outputKind = readOutputKind(recipe);
  const delivery = recipe.delivery;

  return {
    recipeId: recipe.recipeId,
    recipeRevision: recipe.revision,
    promptRevisionRef,
    factTypes: [...recipe.factTypes] as StoreFactKind[],
    intentTypes,
    output: {
      outputKind,
      quantity:
        typeof delivery.quantity === 'number' && delivery.quantity > 0
          ? delivery.quantity
          : 1,
      ...(delivery.aspectRatio ? { aspectRatio: delivery.aspectRatio } : {}),
      ...(typeof delivery.durationSeconds === 'number'
        ? { durationSeconds: delivery.durationSeconds }
        : {}),
      ...(typeof delivery.notePageBound === 'number'
        ? { notePageBound: delivery.notePageBound }
        : {}),
    },
  };
}

function readStudioPlan(
  contextPatches: Record<string, unknown>,
): Record<string, unknown> | null {
  const plan = contextPatches?.recipeStudioPlan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
  return plan as Record<string, unknown>;
}

function readIntentTypes(
  plan: Record<string, unknown> | null,
): RecipeStudioIntentType[] {
  const raw = plan?.intentTypes;
  if (!Array.isArray(raw)) return ['daily_exposure'];
  const intents = raw.filter(
    (value): value is RecipeStudioIntentType =>
      typeof value === 'string' &&
      INTENT_TYPES.has(value as RecipeStudioIntentType),
  );
  return intents.length > 0 ? intents : ['daily_exposure'];
}

function readOutputKind(recipe: ServerRecipeRecord): RecipeStudioOutputKind {
  const fromSettings = recipe.settingsPatches?.outputKind;
  if (
    typeof fromSettings === 'string' &&
    OUTPUT_KINDS.has(fromSettings as RecipeStudioOutputKind)
  ) {
    return fromSettings as RecipeStudioOutputKind;
  }
  // Fall back from delivery shape when settings were not written by governance.
  const kind = recipe.delivery?.deliverableKind;
  if (kind === 'copy_document') return 'copy';
  if (kind === 'video_package') return 'video';
  if (kind === 'note') return 'image_text_note';
  return 'image_text_note';
}
