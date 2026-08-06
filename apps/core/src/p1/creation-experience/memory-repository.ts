/**
 * In-memory append-only Creation Experience Catalog store with CAS.
 * Mirrors admin-config MemoryAdminConfigRepository patterns (D-037 reuse).
 */

import { isDeepStrictEqual } from 'node:util';

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
  /**
   * Full-catalog read of currently published Recipe heads (status='published').
   * Append-only history is ignored once the head leaves published.
   */
  listPublishedRecipes(): Promise<ServerRecipeRecord[]>;
  /**
   * Latest published revision for every Recipe that has at least one.
   * Ordered by recipeId ascending for stable admin dropdowns (#373).
   */
  listLatestPublishedRecipes(): Promise<ServerRecipeRecord[]>;

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
    workspaceId: string,
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
  private readonly sessions = new Map<string, CatalogSessionFreeze>();

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

  async listPublishedRecipes() {
    const published: ServerRecipeRecord[] = [];
    for (const history of this.recipes.values()) {
      const head = history.at(-1);
      if (head?.status === 'published') {
        published.push(structuredClone(head));
      }
    }
    published.sort((left, right) =>
      left.recipeId < right.recipeId
        ? -1
        : left.recipeId > right.recipeId
          ? 1
          : 0,
    );
    return published;
  }

  async listLatestPublishedRecipes() {
    const heads: ServerRecipeRecord[] = [];
    for (const recipeId of [...this.recipes.keys()].sort()) {
      const latest = await this.latestPublishedRecipe(recipeId);
      if (latest) heads.push(latest);
    }
    return heads;
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
    const key = `${freeze.workspaceId}:${freeze.sessionId}`;
    const existing = this.sessions.get(key);
    if (existing) {
      if (isDeepStrictEqual(existing, freeze)) {
        return structuredClone(existing);
      }
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Creation session is already frozen to a different catalog snapshot.',
      );
    }
    const next = structuredClone(freeze);
    this.sessions.set(key, next);
    return structuredClone(next);
  }

  async getSessionFreeze(workspaceId: string, sessionId: CatalogSessionId) {
    const found = this.sessions.get(`${workspaceId}:${sessionId}`);
    return found ? structuredClone(found) : null;
  }
}
