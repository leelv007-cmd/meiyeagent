/**
 * Creation Experience Catalog service (A1 / #88).
 *
 * Lifecycle: draft → preview → validate → publish → rollback
 * Session freeze: new published revisions only affect NEW sessions.
 * Independent of admin_config_revisions and canvas template versions (D-037/D-078).
 */

import { createHash, randomUUID } from 'node:crypto';
import { creationLensIds, type CatalogValidationResult } from '@meiye/contracts';
import { P1DomainError } from '../foundation/domain.js';
import {
  projectBrowserRecipe,
  projectBrowserSurface,
} from './browser-projection.js';
import type { CreationExperienceCatalogRepository } from './memory-repository.js';
import {
  mergePublishedRecipeWorkflowRevisionRefs,
  mergePublishedRecipeWorkflowRevisionRefsForLens,
} from './published-recipe-workflow-catalog.js';
import { validateRecipeForComposer } from './recipe-validator.js';

import { resolveThreeStateCollectionField } from './revision-field-merge.js';
import type {
  CatalogSessionFreeze,
  DraftRecipeInput,
  DraftSurfaceInput,
  FreezeSessionInput,
  ListRecipePublishedRevisionsInput,
  RecipeBodyInput,
  RecipeId,
  RecipePublishedRevisionCandidate,
  RecipePublishedRevisionsResult,
  RecipeRevisionId,
  RecipeTransitionInput,
  RollbackRecipeInput,
  RollbackSurfaceInput,
  ServerRecipeRecord,
  ServerSurfaceRecord,
  SurfaceBodyInput,
  SurfaceId,
  SurfaceRevisionId,
  SurfaceTransitionInput,
} from './types.js';
import {
  parseRecipeRevisionId,
  recipeRevisionId,
  surfaceRevisionId,
} from './types.js';

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

function hashBody(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function toPublishedCandidate(
  record: ServerRecipeRecord,
): RecipePublishedRevisionCandidate {
  return {
    recipeId: record.recipeId,
    revisionId: record.revisionId,
    revision: record.revision,
    title: record.presentation.title,
    lensId: record.lensId,
    publishedAt: record.publishedAt ?? record.createdAt,
  };
}

function assertExpectedRevision(
  headRevision: number | null,
  expectedRevision: number | null,
  kind: 'recipe' | 'surface',
) {
  if (headRevision !== expectedRevision) {
    throw new P1DomainError(
      'IDEMPOTENCY_CONFLICT',
      `Creation ${kind} head changed before the write could be applied.`,
    );
  }
}

function assertLens(
  lensId: string,
): asserts lensId is (typeof creationLensIds)[number] {
  if (!(creationLensIds as readonly string[]).includes(lensId)) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown creation lens "${lensId}".`,
    );
  }
}

function normalizeRecipeBody(body: RecipeBodyInput): Omit<
  ServerRecipeRecord,
  | 'recipeId'
  | 'revision'
  | 'revisionId'
  | 'status'
  | 'contentHash'
  | 'actorId'
  | 'reason'
  | 'correlationId'
  | 'rolledBackToRevision'
  | 'createdAt'
  | 'publishedAt'
> {
  assertLens(body.lensId);
  assertLens(body.targetWorkspaceKind);
  if (!body.presentation?.title?.trim()) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Recipe presentation.title is required.',
    );
  }
  if (!body.presentation?.summary?.trim()) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Recipe presentation.summary is required.',
    );
  }
  if (!body.promptRevisionRef?.trim()) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Recipe promptRevisionRef is required (hidden prompts are refs only).',
    );
  }
  if (
    body.modelPolicy?.mode === 'fixed' &&
    !body.modelPolicy.catalogModelId?.trim()
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'Fixed model policy requires catalogModelId.',
    );
  }
  if (body.modelPolicy?.mode !== 'auto' && body.modelPolicy?.mode !== 'fixed') {
    throw new P1DomainError(
      'INVALID_STATE',
      'Recipe modelPolicy.mode must be auto or fixed.',
    );
  }

  return {
    lensId: body.lensId,
    ...(body.familyId ? { familyId: body.familyId } : {}),
    presentation: {
      title: body.presentation.title.trim(),
      summary: body.presentation.summary.trim(),
      ...(body.presentation.actionLabel
        ? { actionLabel: body.presentation.actionLabel }
        : {}),
      ...(body.presentation.previewAssetRef
        ? { previewAssetRef: body.presentation.previewAssetRef }
        : {}),
    },
    delivery: { ...(body.delivery ?? {}) },
    contextPatches: { ...(body.contextPatches ?? {}) },
    factTypes: [...(body.factTypes ?? [])],
    sourceRequirements: [...(body.sourceRequirements ?? [])],
    modelPolicy: {
      mode: body.modelPolicy.mode,
      ...(body.modelPolicy.catalogModelId
        ? { catalogModelId: body.modelPolicy.catalogModelId }
        : {}),
    },
    settingsPatches: { ...(body.settingsPatches ?? {}) },
    ...(body.outputContractRef
      ? { outputContractRef: body.outputContractRef }
      : {}),
    ...(body.quotePolicyRevisionRef
      ? { quotePolicyRevisionRef: body.quotePolicyRevisionRef }
      : {}),
    ...(body.workflowRevisionRef
      ? { workflowRevisionRef: body.workflowRevisionRef }
      : {}),
    promptRevisionRef: body.promptRevisionRef.trim(),
    skillRevisionRefs: [...(body.skillRevisionRefs ?? [])],
    targetWorkspaceKind: body.targetWorkspaceKind,
    ...(body.hiddenPromptBody !== undefined
      ? { hiddenPromptBody: body.hiddenPromptBody }
      : {}),
    ...(body.studioRelease !== undefined
      ? { studioRelease: structuredClone(body.studioRelease) }
      : {}),
  };
}

function recipeContentPayload(
  body: ReturnType<typeof normalizeRecipeBody>,
): Record<string, unknown> {
  const {
    hiddenPromptBody: _hidden,
    studioRelease: _studioRelease,
    ...rest
  } = body;
  return rest;
}

function normalizeSurfaceBody(body: SurfaceBodyInput): {
  recipeRefs: ServerSurfaceRecord['recipeRefs'];
} {
  if (!Array.isArray(body.recipeRefs)) {
    throw new P1DomainError('INVALID_STATE', 'Surface recipeRefs is required.');
  }
  const recipeRefs = body.recipeRefs.map((ref, index) => {
    assertLens(ref.lensId);
    if (!ref.recipeRevisionId?.trim()) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Surface recipeRefs[${index}].recipeRevisionId is required.`,
      );
    }
    if (!Number.isInteger(ref.order)) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Surface recipeRefs[${index}].order must be an integer.`,
      );
    }
    return {
      recipeRevisionId: ref.recipeRevisionId.trim(),
      lensId: ref.lensId,
      order: ref.order,
      featured: Boolean(ref.featured),
      visible: ref.visible !== false,
    };
  });

  return { recipeRefs };
}

function bodyFromRecipe(record: ServerRecipeRecord): RecipeBodyInput {
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
    ...(record.hiddenPromptBody !== undefined
      ? { hiddenPromptBody: record.hiddenPromptBody }
      : {}),
    ...(record.studioRelease !== undefined
      ? { studioRelease: structuredClone(record.studioRelease) }
      : {}),
  };
}

function bodyFromSurface(record: ServerSurfaceRecord): SurfaceBodyInput {
  return {
    recipeRefs: structuredClone(record.recipeRefs),
  };
}

export class CreationExperienceCatalogService {
  constructor(
    private readonly repository: CreationExperienceCatalogRepository,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly id: () => string = () => randomUUID(),
  ) {}

  async draftRecipe(input: DraftRecipeInput): Promise<ServerRecipeRecord> {
    // Spec B ordering: read head + CAS, three-state merge optional collections,
    // then normalize + hash (so ?? [] is only a post-merge normalize default).
    const head = await this.repository.getRecipeHead(input.recipeId);
    assertExpectedRevision(head?.revision ?? null, input.expectedRevision, 'recipe');
    const mergedBody: RecipeBodyInput = {
      ...input.body,
      factTypes: resolveThreeStateCollectionField(
        input.body,
        'factTypes',
        head?.factTypes,
        [],
      ),
      skillRevisionRefs: resolveThreeStateCollectionField(
        input.body,
        'skillRevisionRefs',
        head?.skillRevisionRefs,
        [],
      ),
    };
    const body = normalizeRecipeBody(mergedBody);
    return this.repository.appendRecipe(
      {
        recipeId: input.recipeId,
        revision: (head?.revision ?? 0) + 1,
        revisionId: recipeRevisionId(input.recipeId, (head?.revision ?? 0) + 1),
        status: 'draft',
        ...body,
        contentHash: hashBody(recipeContentPayload(body)),
        actorId: input.actorId,
        reason: input.reason,
        correlationId: input.correlationId,
        rolledBackToRevision: null,
        createdAt: this.now(),
      },
      input.expectedRevision,
    );
  }

  async previewRecipe(input: RecipeTransitionInput): Promise<ServerRecipeRecord> {
    const head = await this.requireRecipeHead(input.recipeId);
    assertExpectedRevision(head.revision, input.expectedRevision, 'recipe');
    if (head.status !== 'draft' && head.status !== 'preview') {
      throw new P1DomainError(
        'INVALID_STATE',
        'Only draft or preview recipes can enter preview.',
      );
    }
    const body = bodyFromRecipe(head);
    const normalized = normalizeRecipeBody(body);
    return this.repository.appendRecipe(
      {
        recipeId: input.recipeId,
        revision: head.revision + 1,
        revisionId: recipeRevisionId(input.recipeId, head.revision + 1),
        status: 'preview',
        ...normalized,
        contentHash: hashBody(recipeContentPayload(normalized)),
        actorId: input.actorId,
        reason: input.reason,
        correlationId: input.correlationId,
        rolledBackToRevision: null,
        createdAt: this.now(),
      },
      input.expectedRevision,
    );
  }

  async validateRecipe(
    recipeId: RecipeId,
    revision?: number,
  ): Promise<CatalogValidationResult> {
    const record =
      revision === undefined
        ? await this.repository.getRecipeHead(recipeId)
        : await this.repository.getRecipeRevision(recipeId, revision);
    if (!record) {
      return { ok: false, errors: [`Recipe "${recipeId}" was not found.`] };
    }
    return this.validateRecipeRecord(record);
  }

  async publishRecipe(input: RecipeTransitionInput): Promise<ServerRecipeRecord> {
    const head = await this.requireRecipeHead(input.recipeId);
    assertExpectedRevision(head.revision, input.expectedRevision, 'recipe');
    if (head.status !== 'preview') {
      throw new P1DomainError(
        'INVALID_STATE',
        'Only preview recipes can be published.',
      );
    }
    const validation = this.validateRecipeRecord(head);
    if (!validation.ok) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Recipe failed validation: ${validation.errors.join('; ')}`,
      );
    }
    const body = bodyFromRecipe(head);
    const normalized = normalizeRecipeBody(body);
    const publishedAt = this.now();
    return this.repository.appendRecipe(
      {
        recipeId: input.recipeId,
        revision: head.revision + 1,
        revisionId: recipeRevisionId(input.recipeId, head.revision + 1),
        status: 'published',
        ...normalized,
        contentHash: hashBody(recipeContentPayload(normalized)),
        actorId: input.actorId,
        reason: input.reason,
        correlationId: input.correlationId,
        rolledBackToRevision: null,
        createdAt: publishedAt,
        publishedAt,
      },
      input.expectedRevision,
    );
  }

  async rollbackRecipe(input: RollbackRecipeInput): Promise<ServerRecipeRecord> {
    const head = await this.requireRecipeHead(input.recipeId);
    assertExpectedRevision(head.revision, input.expectedRevision, 'recipe');
    const target = await this.repository.getRecipeRevision(
      input.recipeId,
      input.targetRevision,
    );
    if (!target) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Recipe revision ${input.targetRevision} was not found.`,
      );
    }
    if (target.status !== 'published') {
      throw new P1DomainError(
        'INVALID_STATE',
        'Rollback target must be a previously published recipe revision.',
      );
    }
    const body = bodyFromRecipe(target);
    const normalized = normalizeRecipeBody(body);
    const publishedAt = this.now();
    return this.repository.appendRecipe(
      {
        recipeId: input.recipeId,
        revision: head.revision + 1,
        revisionId: recipeRevisionId(input.recipeId, head.revision + 1),
        status: 'published',
        ...normalized,
        contentHash: hashBody(recipeContentPayload(normalized)),
        actorId: input.actorId,
        reason: input.reason,
        correlationId: input.correlationId,
        rolledBackToRevision: target.revision,
        createdAt: publishedAt,
        publishedAt,
      },
      input.expectedRevision,
    );
  }

  async draftSurface(input: DraftSurfaceInput): Promise<ServerSurfaceRecord> {
    // Spec B ordering: read head + CAS, three-state merge, then normalize + hash.
    const head = await this.repository.getSurfaceHead(input.surfaceId);
    assertExpectedRevision(head?.revision ?? null, input.expectedRevision, 'surface');
    const mergedBody: SurfaceBodyInput = {
      recipeRefs: resolveThreeStateCollectionField(
        input.body,
        'recipeRefs',
        head?.recipeRefs,
        [],
      ),
    };
    const body = normalizeSurfaceBody(mergedBody);
    return this.repository.appendSurface(
      {
        surfaceId: input.surfaceId,
        revision: (head?.revision ?? 0) + 1,
        revisionId: surfaceRevisionId(input.surfaceId, (head?.revision ?? 0) + 1),
        status: 'draft',
        ...body,
        contentHash: hashBody(body),
        actorId: input.actorId,
        reason: input.reason,
        correlationId: input.correlationId,
        rolledBackToRevision: null,
        createdAt: this.now(),
      },
      input.expectedRevision,
    );
  }

  async previewSurface(input: SurfaceTransitionInput): Promise<ServerSurfaceRecord> {
    const head = await this.requireSurfaceHead(input.surfaceId);
    assertExpectedRevision(head.revision, input.expectedRevision, 'surface');
    if (head.status !== 'draft' && head.status !== 'preview') {
      throw new P1DomainError(
        'INVALID_STATE',
        'Only draft or preview surfaces can enter preview.',
      );
    }
    const body = normalizeSurfaceBody(bodyFromSurface(head));
    return this.repository.appendSurface(
      {
        surfaceId: input.surfaceId,
        revision: head.revision + 1,
        revisionId: surfaceRevisionId(input.surfaceId, head.revision + 1),
        status: 'preview',
        ...body,
        contentHash: hashBody(body),
        actorId: input.actorId,
        reason: input.reason,
        correlationId: input.correlationId,
        rolledBackToRevision: null,
        createdAt: this.now(),
      },
      input.expectedRevision,
    );
  }

  async validateSurface(
    surfaceId: SurfaceId,
    revision?: number,
  ): Promise<CatalogValidationResult> {
    const record =
      revision === undefined
        ? await this.repository.getSurfaceHead(surfaceId)
        : await this.repository.getSurfaceRevision(surfaceId, revision);
    if (!record) {
      return { ok: false, errors: [`Surface "${surfaceId}" was not found.`] };
    }
    return this.validateSurfaceRecord(record);
  }

  async publishSurface(input: SurfaceTransitionInput): Promise<ServerSurfaceRecord> {
    const head = await this.requireSurfaceHead(input.surfaceId);
    assertExpectedRevision(head.revision, input.expectedRevision, 'surface');
    if (head.status !== 'preview') {
      throw new P1DomainError(
        'INVALID_STATE',
        'Only preview surfaces can be published.',
      );
    }
    const validation = await this.validateSurfaceRecord(head);
    if (!validation.ok) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Surface failed validation: ${validation.errors.join('; ')}`,
      );
    }
    const body = normalizeSurfaceBody(bodyFromSurface(head));
    const publishedAt = this.now();
    return this.repository.appendSurface(
      {
        surfaceId: input.surfaceId,
        revision: head.revision + 1,
        revisionId: surfaceRevisionId(input.surfaceId, head.revision + 1),
        status: 'published',
        ...body,
        contentHash: hashBody(body),
        actorId: input.actorId,
        reason: input.reason,
        correlationId: input.correlationId,
        rolledBackToRevision: null,
        createdAt: publishedAt,
        publishedAt,
      },
      input.expectedRevision,
    );
  }

  async rollbackSurface(input: RollbackSurfaceInput): Promise<ServerSurfaceRecord> {
    const head = await this.requireSurfaceHead(input.surfaceId);
    assertExpectedRevision(head.revision, input.expectedRevision, 'surface');
    const target = await this.repository.getSurfaceRevision(
      input.surfaceId,
      input.targetRevision,
    );
    if (!target) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Surface revision ${input.targetRevision} was not found.`,
      );
    }
    if (target.status !== 'published') {
      throw new P1DomainError(
        'INVALID_STATE',
        'Rollback target must be a previously published surface revision.',
      );
    }
    const validation = await this.validateSurfaceRecord(target);
    if (!validation.ok) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Rollback target failed validation: ${validation.errors.join('; ')}`,
      );
    }
    const body = normalizeSurfaceBody(bodyFromSurface(target));
    const publishedAt = this.now();
    return this.repository.appendSurface(
      {
        surfaceId: input.surfaceId,
        revision: head.revision + 1,
        revisionId: surfaceRevisionId(input.surfaceId, head.revision + 1),
        status: 'published',
        ...body,
        contentHash: hashBody(body),
        actorId: input.actorId,
        reason: input.reason,
        correlationId: input.correlationId,
        rolledBackToRevision: target.revision,
        createdAt: publishedAt,
        publishedAt,
      },
      input.expectedRevision,
    );
  }

  async freezeSession(input: FreezeSessionInput): Promise<CatalogSessionFreeze> {
    const surface = await this.repository.getSurfaceByRevisionId(
      input.surfaceRevisionId,
    );
    if (!surface) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Surface revision "${input.surfaceRevisionId}" was not found.`,
      );
    }
    if (surface.status !== 'published') {
      throw new P1DomainError(
        'INVALID_STATE',
        'Session freeze requires a published surface revision.',
      );
    }
    const recipes = await this.resolveSurfaceRecipes(surface);
    const freeze: CatalogSessionFreeze = {
      sessionId: input.sessionId ?? this.id(),
      workspaceId: input.workspaceId,
      surfaceRevisionId: surface.revisionId,
      frozenAt: this.now(),
      surface: projectBrowserSurface(surface, recipes),
    };
    return this.repository.putSessionFreeze(freeze);
  }

  async getSessionFreeze(
    workspaceId: string,
    sessionId: string,
  ): Promise<CatalogSessionFreeze | null> {
    return this.repository.getSessionFreeze(workspaceId, sessionId);
  }

  async getRecipeHead(recipeId: RecipeId) {
    return this.repository.getRecipeHead(recipeId);
  }

  async getRecipeByRevisionId(revisionId: RecipeRevisionId) {
    return this.repository.getRecipeByRevisionId(revisionId);
  }

  async listRecipeHistory(recipeId: RecipeId) {
    return this.repository.listRecipeHistory(recipeId);
  }

  /**
   * Read-only catalog of workflow revision refs from currently published
   * Recipe heads, merged with launch-seed fallbacks (Spec B / #360).
   * Sole authority for skill-bind allowlists — no write path.
   */
  async listPublishedRecipeWorkflowRevisionRefs(): Promise<string[]> {
    const published = await this.repository.listPublishedRecipes();
    return mergePublishedRecipeWorkflowRevisionRefs(published);
  }

  /**
   * Lens-scoped published workflow catalog for merchant skill projection (#378).
   */
  async listPublishedRecipeWorkflowRevisionRefsForLens(
    lensId: string,
  ): Promise<string[]> {
    const published = await this.repository.listPublishedRecipes();
    return mergePublishedRecipeWorkflowRevisionRefsForLens(lensId, published);
  }

  /**
   * Surface version-candidate query (Spec D / #373).
   * Merges Surface head recipeRefs with caller recipeIds; groups keep empty
   * buckets for missing / unpublished recipes; availableRecipeHeads lists every
   * catalog Recipe that has a published head.
   */
  async listRecipePublishedRevisions(
    input: ListRecipePublishedRevisionsInput,
  ): Promise<RecipePublishedRevisionsResult> {
    const surfaceId = input.surfaceId.trim();
    if (!surfaceId) {
      throw new P1DomainError('INVALID_STATE', 'surfaceId is required.');
    }
    const surface = await this.repository.getSurfaceHead(surfaceId);
    if (!surface) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Surface "${surfaceId}" was not found.`,
      );
    }

    const merged = new Set<RecipeId>();
    for (const ref of surface.recipeRefs) {
      const parsed = parseRecipeRevisionId(ref.recipeRevisionId);
      if (parsed) merged.add(parsed.recipeId);
    }
    for (const raw of input.recipeIds) {
      if (typeof raw !== 'string') continue;
      const recipeId = raw.trim();
      if (recipeId) merged.add(recipeId);
    }

    const sortedRecipeIds = [...merged].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const groups = await Promise.all(
      sortedRecipeIds.map(async (recipeId) => {
        const history = await this.repository.listRecipeHistory(recipeId);
        const candidates = history
          .filter((entry) => entry.status === 'published')
          .map((entry) => toPublishedCandidate(entry))
          .sort((a, b) => b.revision - a.revision);
        return { recipeId, candidates };
      }),
    );

    const availableRecipeHeads = (
      await this.repository.listLatestPublishedRecipes()
    )
      .map((entry) => toPublishedCandidate(entry))
      .sort((a, b) =>
        a.recipeId < b.recipeId ? -1 : a.recipeId > b.recipeId ? 1 : 0,
      );

    return { groups, availableRecipeHeads };
  }

  async getSurfaceHead(surfaceId: SurfaceId) {
    return this.repository.getSurfaceHead(surfaceId);
  }

  async getSurfaceByRevisionId(revisionId: SurfaceRevisionId) {
    return this.repository.getSurfaceByRevisionId(revisionId);
  }

  async listSurfaceHistory(surfaceId: SurfaceId) {
    return this.repository.listSurfaceHistory(surfaceId);
  }

  async projectBrowserRecipe(recipeId: RecipeId, revision?: number) {
    const record =
      revision === undefined
        ? await this.repository.latestPublishedRecipe(recipeId)
        : await this.repository.getRecipeRevision(recipeId, revision);
    if (!record || record.status !== 'published') {
      throw new P1DomainError('NOT_FOUND', `Recipe "${recipeId}" was not found.`);
    }
    return projectBrowserRecipe(record);
  }

  async projectBrowserSurface(surfaceId: SurfaceId, revision?: number) {
    const record =
      revision === undefined
        ? await this.repository.latestPublishedSurface(surfaceId)
        : await this.repository.getSurfaceRevision(surfaceId, revision);
    if (!record || record.status !== 'published') {
      throw new P1DomainError('NOT_FOUND', `Surface "${surfaceId}" was not found.`);
    }
    const recipes = await this.resolveSurfaceRecipes(record);
    return projectBrowserSurface(record, recipes);
  }

  private validateRecipeRecord(record: ServerRecipeRecord): CatalogValidationResult {
    const { errors } = validateRecipeForComposer(record);
    return { ok: errors.length === 0, errors };
  }

  private async validateSurfaceRecord(
    record: ServerSurfaceRecord,
  ): Promise<CatalogValidationResult> {
    const errors: string[] = [];
    if (record.recipeRefs.length === 0) {
      errors.push('surface must reference at least one recipe revision');
    }
    for (const [index, ref] of record.recipeRefs.entries()) {
      const recipe = await this.repository.getRecipeByRevisionId(ref.recipeRevisionId);
      if (!recipe) {
        errors.push(`recipeRefs[${index}] unknown revision "${ref.recipeRevisionId}"`);
        continue;
      }
      if (recipe.status !== 'published') {
        errors.push(
          `recipeRefs[${index}] "${ref.recipeRevisionId}" is not published (status=${recipe.status})`,
        );
      }
      if (recipe.lensId !== ref.lensId) {
        errors.push(
          `recipeRefs[${index}] lens mismatch: ref=${ref.lensId} recipe=${recipe.lensId}`,
        );
      }
    }
    return { ok: errors.length === 0, errors };
  }

  private async resolveSurfaceRecipes(
    surface: ServerSurfaceRecord,
  ): Promise<ServerRecipeRecord[]> {
    const recipes: ServerRecipeRecord[] = [];
    for (const ref of surface.recipeRefs) {
      const recipe = await this.repository.getRecipeByRevisionId(ref.recipeRevisionId);
      if (recipe) recipes.push(recipe);
    }
    return recipes;
  }

  private async requireRecipeHead(recipeId: RecipeId) {
    const head = await this.repository.getRecipeHead(recipeId);
    if (!head) {
      throw new P1DomainError('NOT_FOUND', `Recipe "${recipeId}" was not found.`);
    }
    return head;
  }

  private async requireSurfaceHead(surfaceId: SurfaceId) {
    const head = await this.repository.getSurfaceHead(surfaceId);
    if (!head) {
      throw new P1DomainError('NOT_FOUND', `Surface "${surfaceId}" was not found.`);
    }
    return head;
  }
}
