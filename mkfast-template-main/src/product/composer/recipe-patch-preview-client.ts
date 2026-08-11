/**
 * Client RecipePatchPreview adapter (C2 / #96, D-083).
 *
 * The shared contract owns the pure projection. This wrapper keeps the
 * historical browser fallback for runtime targets that omit modelPolicy.
 */

import {
  buildRecipePatchPreview,
  composerContentPackagePlatformSchema,
  composerDeliverableKindSchema,
  type BuildRecipePatchPreviewInput,
  type RecipeDraftFields,
  type RecipePatchPreview,
  type RecipeRevisionId,
  type SurfaceRevisionId,
} from '@meiye/contracts';

import type { RecipeCardTarget } from './launch-card-seeds';
import type { ComposerLensState } from './lens-state-machine';

type RuntimeRecipeCardTarget = Omit<RecipeCardTarget, 'modelPolicy'> & {
  modelPolicy?: RecipeCardTarget['modelPolicy'];
};

export type BuildClientPatchPreviewInput = Omit<
  BuildRecipePatchPreviewInput,
  'recipe'
> & {
  recipe: RecipeCardTarget;
};

export function buildClientRecipePatchPreview(
  input: BuildClientPatchPreviewInput
): RecipePatchPreview {
  const recipe = input.recipe as RuntimeRecipeCardTarget;
  return buildRecipePatchPreview({
    ...input,
    recipe: {
      ...recipe,
      modelPolicy: recipe.modelPolicy ?? { mode: 'auto' },
    },
  });
}

// ---------------------------------------------------------------------------
// Composer draft → RecipeDraftFields
// ---------------------------------------------------------------------------

export function composerDraftToRecipeFields(
  state: ComposerLensState
): RecipeDraftFields {
  const draft = state.draft;
  const contentPackagePlatform = composerContentPackagePlatformSchema.safeParse(
    draft.delivery.platform
  );
  const deliverableKind = composerDeliverableKindSchema.safeParse(
    draft.delivery.deliverableKind
  );
  return {
    userText: draft.userText,
    sources: draft.sources,
    lensId: state.lensId,
    recipeRevisionId: draft.recipeRevisionId as RecipeRevisionId | null,
    surfaceRevisionId: draft.surfaceRevisionId as SurfaceRevisionId | null,
    delivery: {
      ...(contentPackagePlatform.success
        ? { contentPackagePlatform: contentPackagePlatform.data }
        : {}),
      ...(deliverableKind.success
        ? { deliverableKind: deliverableKind.data }
        : {}),
      quantity: draft.settings.quantity ?? undefined,
      aspectRatio: draft.settings.aspectRatio ?? undefined,
      durationSeconds: draft.settings.durationSeconds ?? undefined,
    },
    modelPolicy: {
      mode: draft.modelPolicyMode,
      ...(draft.settings.catalogModelId
        ? { catalogModelId: draft.settings.catalogModelId }
        : {}),
    },
    dirtySettings: { ...draft.dirtySettings },
    settings: {
      ...draft.settings.params,
      ...(draft.settings.catalogModelId
        ? { catalogModelId: draft.settings.catalogModelId }
        : {}),
      ...(draft.settings.aspectRatio
        ? { aspectRatio: draft.settings.aspectRatio }
        : {}),
      ...(draft.settings.quantity != null
        ? { quantity: draft.settings.quantity }
        : {}),
    },
    confirmedQuoteRef: draft.quoteRevisionId,
  };
}
