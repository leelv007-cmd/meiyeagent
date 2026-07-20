/**
 * In-memory append-only Creation Experience Catalog store with CAS.
 * Mirrors admin-config MemoryAdminConfigRepository patterns (D-037 reuse).
 */

import { P1DomainError } from '../foundation/domain.js';
import type {
  CatalogSessionFreeze,
  CatalogSessionId,
  RecipeId,
  RecipeRevisionId,
  ServerRecipeRecord,
  ServerSurfaceRecord,
  SurfaceId,
  SurfaceRevisionId,
} from './types.js';
import { parseRecipeRevisionId } from './types.js';

export interface CreationExperienceCatalogRepository {
  appendRecipe(
    record: ServerRecipeRecord,
    expectedRevision: number | null,
  ): Promise<ServerRecipeRecord>;
  getRecipeHead(recipeId: RecipeId): Promise<ServerRecipeRecord | null>;
  getRecipeRevision(
    recipeId: RecipeId,
    revision: number,
  ): Promise<ServerRecipeRecord | null>;
  getRecipeByRevisionId(
    revisionId: RecipeRevisionId,
  ): Promise<ServerRecipeRecord | null>;
  listRecipeHistory(recipeId: RecipeId): Promise<ServerRecipeRecord[]>;
  latestPublishedRecipe(
    recipeId: RecipeId,
  ): Promise<ServerRecipeRecord | null>;

  appendSurface(
    record: ServerSurfaceRecord,
    expectedRevision: number | null,
  ): Promise<ServerSurfaceRecord>;
  getSurfaceHead(surfaceId: SurfaceId): Promise<ServerSurfaceRecord | null>;
  getSurfaceRevision(
    surfaceId: SurfaceId,
    revision: number,
  ): Promise<ServerSurfaceRecord | null>;
  getSurfaceByRevisionId(
    revisionId: SurfaceRevisionId,
  ): Promise<ServerSurfaceRecord | null>;
  listSurfaceHistory(surfaceId: SurfaceId): Promise<ServerSurfaceRecord[]>;
  latestPublishedSurface(
    surfaceId: SurfaceId,
  ): Promise<ServerSurfaceRecord | null>;

  putSessionFreeze(freeze: CatalogSessionFreeze): Promise<CatalogSessionFreeze>;
  getSessionFreeze(
    sessionId: CatalogSessionId,
  ): Promise<CatalogSessionFreeze | null>;
}

function assertCas(
  currentRevision: number | null,
  expectedRevision: number | null,
  kind: 'recipe' | 'surface',
) {
  if (currentRevision !== expectedRevision) {
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      `Creation ${kind} head changed before the write could be applied.`,
    );
  }
}

export class MemoryCreationExperienceCatalogRepository
  implements CreationExperienceCatalogRepository
{
  private readonly recipes = new Map<RecipeId, ServerRecipeRecord[]>();
  private readonly surfaces = new Map<SurfaceId, ServerSurfaceRecord[]>();
  private readonly sessions = new Map<CatalogSessionId, CatalogSessionFreeze>();

  async appendRecipe(
    record: ServerRecipeRecord,
    expectedRevision: number | null,
  ) {
    const history = this.recipes.get(record.recipeId) ?? [];
    const current = history.at(-1) ?? null;
    assertCas(current?.revision ?? null, expectedRevision, 'recipe');
    const next = structuredClone(record);
    this.recipes.set(record.recipeId, [...history, next]);
    return structuredClone(next);
  }

  async getRecipeHead(recipeId: RecipeId) {
    const head = this.recipes.get(recipeId)?.at(-1);
    return head ? structuredClone(head) : null;
  }

  async getRecipeRevision(recipeId: RecipeId, revision: number) {
    const found = this.recipes
      .get(recipeId)
      ?.find((entry) => entry.revision === revision);
    return found ? structuredClone(found) : null;
  }

  async getRecipeByRevisionId(revisionId: RecipeRevisionId) {
    const parsed = parseRecipeRevisionId(revisionId);
    if (!parsed) return null;
    return this.getRecipeRevision(parsed.recipeId, parsed.revision);
  }

  async listRecipeHistory(recipeId: RecipeId) {
    return structuredClone(this.recipes.get(recipeId) ?? []);
  }

  async latestPublishedRecipe(recipeId: RecipeId) {
    const history = this.recipes.get(recipeId) ?? [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i]?.status === 'published') {
        return structuredClone(history[i]!);
      }
    }
    return null;
  }

  async appendSurface(
    record: ServerSurfaceRecord,
    expectedRevision: number | null,
  ) {
    const history = this.surfaces.get(record.surfaceId) ?? [];
    const current = history.at(-1) ?? null;
    assertCas(current?.revision ?? null, expectedRevision, 'surface');
    const next = structuredClone(record);
    this.surfaces.set(record.surfaceId, [...history, next]);
    return structuredClone(next);
  }

  async getSurfaceHead(surfaceId: SurfaceId) {
    const head = this.surfaces.get(surfaceId)?.at(-1);
    return head ? structuredClone(head) : null;
  }

  async getSurfaceRevision(surfaceId: SurfaceId, revision: number) {
    const found = this.surfaces
      .get(surfaceId)
      ?.find((entry) => entry.revision === revision);
    return found ? structuredClone(found) : null;
  }

  async getSurfaceByRevisionId(revisionId: SurfaceRevisionId) {
    const at = revisionId.lastIndexOf('@');
    if (at <= 0) return null;
    const surfaceId = revisionId.slice(0, at);
    const revision = Number(revisionId.slice(at + 1));
    if (!surfaceId || !Number.isInteger(revision) || revision < 1) return null;
    return this.getSurfaceRevision(surfaceId, revision);
  }

  async listSurfaceHistory(surfaceId: SurfaceId) {
    return structuredClone(this.surfaces.get(surfaceId) ?? []);
  }

  async latestPublishedSurface(surfaceId: SurfaceId) {
    const history = this.surfaces.get(surfaceId) ?? [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i]?.status === 'published') {
        return structuredClone(history[i]!);
      }
    }
    return null;
  }

  async putSessionFreeze(freeze: CatalogSessionFreeze) {
    const next = structuredClone(freeze);
    this.sessions.set(freeze.sessionId, next);
    return structuredClone(next);
  }

  async getSessionFreeze(sessionId: CatalogSessionId) {
    const found = this.sessions.get(sessionId);
    return found ? structuredClone(found) : null;
  }
}
