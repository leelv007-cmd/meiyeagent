/**
 * Browser-facing projections for Creation Experience Catalog.
 *
 * Hidden prompts never ship to the browser — only promptRevisionRef.
 * Serialization tests lock the allowlist.
 */

import type {
  BrowserRecipeProjection,
  BrowserSurfaceProjection,
  CreationRecipeVersion,
  CreationSurfaceRevision,
} from '@meiye/contracts';
import type { ServerRecipeRecord, ServerSurfaceRecord } from './types.js';

/** Keys that must never appear on browser-facing recipe/surface DTOs. */
export const FORBIDDEN_BROWSER_RECIPE_KEYS = [
  'hiddenPromptBody',
  'hiddenPrompt',
  'prompt',
  'promptBody',
  'systemPrompt',
  'system_prompt',
  'promptText',
  'prompt_text',
  'instructions',
  'provider',
  'deployment',
  'credential',
  'credentialRef',
  'fallbackOrder',
] as const;

const RECIPE_ALLOWLIST = [
  'recipeId',
  'revision',
  'revisionId',
  'status',
  'lensId',
  'familyId',
  'presentation',
  'delivery',
  'contextPatches',
  'factTypes',
  'sourceRequirements',
  'modelPolicy',
  'settingsPatches',
  'outputContractRef',
  'quotePolicyRevisionRef',
  'workflowRevisionRef',
  'promptRevisionRef',
  'skillRevisionRefs',
  'targetWorkspaceKind',
  'contentHash',
] as const;

const SURFACE_ALLOWLIST = [
  'surfaceId',
  'revision',
  'revisionId',
  'status',
  'recipeRefs',
  'contentHash',
  'recipes',
] as const;

function pickAllowlist<T extends Record<string, unknown>>(
  source: T,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) {
      out[key] = structuredClone(source[key]);
    }
  }
  return out;
}

/**
 * Project a server recipe record to browser DTO.
 * Strips audit fields and any hidden prompt body.
 */
export function projectBrowserRecipe(
  recipe: ServerRecipeRecord | CreationRecipeVersion,
): BrowserRecipeProjection {
  const raw = recipe as unknown as Record<string, unknown>;
  const projected = pickAllowlist(raw, RECIPE_ALLOWLIST);
  return projected as unknown as BrowserRecipeProjection;
}

/**
 * Project a server surface + nested recipes to browser DTO.
 */
export function projectBrowserSurface(
  surface: ServerSurfaceRecord | CreationSurfaceRevision,
  recipes: Array<ServerRecipeRecord | CreationRecipeVersion> = [],
): BrowserSurfaceProjection {
  const raw = surface as unknown as Record<string, unknown>;
  const base = pickAllowlist(
    raw,
    SURFACE_ALLOWLIST.filter((k) => k !== 'recipes'),
  );
  return {
    ...(base as Omit<BrowserSurfaceProjection, 'recipes'>),
    recipes: recipes.map(projectBrowserRecipe),
  };
}

/**
 * Deep-scan a projected value for forbidden prompt/provider keys.
 * Returns the first forbidden key path found, or null if clean.
 */
export function findForbiddenBrowserKey(
  value: unknown,
  path = '$',
): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findForbiddenBrowserKey(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((FORBIDDEN_BROWSER_RECIPE_KEYS as readonly string[]).includes(key)) {
      return `${path}.${key}`;
    }
    const hit = findForbiddenBrowserKey(child, `${path}.${key}`);
    if (hit) return hit;
  }
  return null;
}

/** JSON-serialize a browser projection (stable key order not required). */
export function serializeBrowserProjection(value: unknown): string {
  return JSON.stringify(value);
}
