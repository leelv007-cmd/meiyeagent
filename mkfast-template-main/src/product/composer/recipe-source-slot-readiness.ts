/**
 * Compare a recipe's required source slots with the sources this run would
 * submit. Mirrors Core `assertSourceRequirements` so the Composer can stop
 * before Brief / confirm / 400 (V31-73).
 */

import type {
  BrowserRecipeProjection,
  CreationLensId,
  RecipeSourceRequirement,
} from '@meiye/contracts';

import { p1ErrorCode } from '@/p1/client';

/** Viral adapt is slot-optional but has its own sourcing journey. */
const SPECIAL_JOURNEY_RECIPE_IDS = new Set(['recipe.viral_adapt']);

const REQUIRED_SLOT_ERROR =
  /Required source slot (\S+) is not satisfied by the current workspace sources\./u;

export function contentTypeMatches(kind: string, contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  const normalizedKind = kind.trim().toLowerCase();
  return (
    normalizedKind === normalized ||
    (normalizedKind.endsWith('/*') &&
      normalized.startsWith(normalizedKind.slice(0, -1))) ||
    (normalizedKind === 'image' && normalized.startsWith('image/')) ||
    (normalizedKind === 'video' && normalized.startsWith('video/')) ||
    (normalizedKind === 'text' && normalized.startsWith('text/'))
  );
}

export function resolveSourceContentTypes(
  sources: unknown[],
  workspaceAssets: readonly {
    id: string;
    mediaType?: string;
    contentType?: string;
  }[] = []
): string[] {
  const assetsById = new Map(
    workspaceAssets.map((asset) => [asset.id, asset] as const)
  );
  const types: string[] = [];
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      continue;
    }
    const value = source as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id : undefined;
    const kind = typeof value.kind === 'string' ? value.kind : undefined;
    const explicit =
      typeof value.contentType === 'string' ? value.contentType : undefined;
    const workspace = id ? assetsById.get(id) : undefined;
    const mediaType = workspace?.contentType ?? workspace?.mediaType;

    if (explicit) {
      types.push(explicit);
      continue;
    }
    if (kind === 'image' || mediaType === 'image') {
      types.push('image/png');
      continue;
    }
    if (kind === 'video' || mediaType === 'video') {
      types.push('video/mp4');
      continue;
    }
    if (mediaType === 'audio') {
      types.push('audio/mpeg');
      continue;
    }
    if (kind === 'text') {
      types.push('text/plain');
    }
  }
  return types;
}

export function hasContentPackageSource(sources: unknown[]): boolean {
  return sources.some((source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      return false;
    }
    const kind = (source as { kind?: unknown }).kind;
    return kind === 'content' || kind === 'content_package' || kind === 'work';
  });
}

export function listUnsatisfiedRequiredSlots(input: {
  requirements: readonly RecipeSourceRequirement[] | undefined;
  sources: unknown[];
  workspaceAssets?: readonly {
    id: string;
    mediaType?: string;
    contentType?: string;
  }[];
}): RecipeSourceRequirement[] {
  const requirements = input.requirements ?? [];
  const assetContentTypes = resolveSourceContentTypes(
    input.sources,
    input.workspaceAssets
  );
  const hasContentPackage = hasContentPackageSource(input.sources);
  const missing: RecipeSourceRequirement[] = [];
  for (const requirement of requirements) {
    if (!requirement.required) continue;
    const kinds =
      requirement.kinds
        ?.map((kind) => kind.trim().toLowerCase())
        .filter(Boolean) ?? [];
    const hasMatchingAsset = assetContentTypes.some((contentType) =>
      kinds.length === 0
        ? true
        : kinds.some((kind) => contentTypeMatches(kind, contentType))
    );
    const contentPackageMatches =
      hasContentPackage &&
      (kinds.length === 0 ||
        kinds.includes('content') ||
        kinds.includes('content_package') ||
        kinds.includes('work'));
    if (!hasMatchingAsset && !contentPackageMatches) {
      missing.push(requirement);
    }
  }
  return missing;
}

export type SlotFreeFallbackRecipe = Pick<
  BrowserRecipeProjection,
  'recipeId' | 'lensId' | 'status' | 'sourceRequirements' | 'revisionId'
>;

export function findSlotFreeFallbackRecipe(input: {
  recipes: readonly SlotFreeFallbackRecipe[];
  lensId: CreationLensId;
  excludeRecipeId?: string;
  visibleRevisionIds?: ReadonlySet<string>;
}): SlotFreeFallbackRecipe | null {
  for (const recipe of input.recipes) {
    if (recipe.lensId !== input.lensId) continue;
    if (recipe.status !== 'published') continue;
    if (recipe.recipeId === input.excludeRecipeId) continue;
    if (SPECIAL_JOURNEY_RECIPE_IDS.has(recipe.recipeId)) continue;
    if (
      input.visibleRevisionIds &&
      !input.visibleRevisionIds.has(recipe.revisionId)
    ) {
      continue;
    }
    if ((recipe.sourceRequirements ?? []).some((slot) => slot.required)) {
      continue;
    }
    return recipe;
  }
  return null;
}

export function requiredSourceSlotFromError(
  error: unknown
): { slot: string } | null {
  if (p1ErrorCode(error) !== 'INVALID_STATE') return null;
  const message = error instanceof Error ? error.message : '';
  const match = REQUIRED_SLOT_ERROR.exec(message);
  if (!match?.[1]) return null;
  return { slot: match[1] };
}
