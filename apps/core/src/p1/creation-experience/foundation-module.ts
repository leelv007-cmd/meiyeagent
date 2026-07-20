/**
 * Independent Creation Experience Catalog FoundationModule (A1 / #88).
 *
 * DO NOT add methods to OperationsApplicationService — integration owner
 * wires this module thinly via main.ts later.
 */

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import { CreationExperienceCatalogService } from './catalog-service.js';
import type { CreationExperienceCatalogRepository } from './memory-repository.js';
import { MemoryCreationExperienceCatalogRepository } from './memory-repository.js';
import {
  listCreationLensSeeds,
  listToolEntrySeeds,
} from './static-seeds.js';
import type {
  DraftRecipeInput,
  DraftSurfaceInput,
  RecipeBodyInput,
  RecipeTransitionInput,
  RollbackRecipeInput,
  RollbackSurfaceInput,
  SurfaceBodyInput,
  SurfaceTransitionInput,
} from './types.js';

function action(input: Record<string, unknown>) {
  if (typeof input.action !== 'string' || input.action.trim().length === 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'A creation-experience action is required.',
    );
  }
  return input.action;
}

function payload(input: Record<string, unknown>) {
  const value = input.payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'A creation-experience payload is required.',
    );
  }
  return value as Record<string, unknown>;
}

function stringField(
  source: Record<string, unknown>,
  key: string,
  opts: { optional?: boolean } = {},
): string {
  const value = source[key];
  if (value === undefined || value === null) {
    if (opts.optional) return '';
    throw new P1DomainError('INVALID_STATE', `${key} is required.`);
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      `${key} must be a non-empty string.`,
    );
  }
  return value.trim();
}

function numberField(
  source: Record<string, unknown>,
  key: string,
  opts: { optional?: boolean; nullable?: boolean } = {},
): number | null {
  const value = source[key];
  if (value === undefined) {
    if (opts.optional || opts.nullable) return null;
    throw new P1DomainError('INVALID_STATE', `${key} is required.`);
  }
  if (value === null) {
    if (opts.nullable) return null;
    throw new P1DomainError('INVALID_STATE', `${key} is required.`);
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new P1DomainError('INVALID_STATE', `${key} must be an integer.`);
  }
  return value;
}

function auditFrom(
  context: P1Context,
  source: Record<string, unknown>,
): { actorId: string; reason: string; correlationId: string } {
  return {
    actorId:
      stringField(source, 'actorId', { optional: true }) || context.userId,
    reason: stringField(source, 'reason'),
    correlationId:
      stringField(source, 'correlationId', { optional: true }) ||
      context.correlationId,
  };
}

function expectedRevisionOf(source: Record<string, unknown>): number | null {
  if (!('expectedRevision' in source)) {
    throw new P1DomainError('INVALID_STATE', 'expectedRevision is required.');
  }
  if (source.expectedRevision === null) return null;
  return numberField(source, 'expectedRevision');
}

export class CreationExperienceFoundationModule implements P1OperationModule {
  readonly name = 'creation-experience';
  private readonly service: CreationExperienceCatalogService;

  constructor(
    repository: CreationExperienceCatalogRepository = new MemoryCreationExperienceCatalogRepository(),
    service?: CreationExperienceCatalogService,
  ) {
    this.service =
      service ?? new CreationExperienceCatalogService(repository);
  }

  async execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
    idempotencyKey: string;
  }) {
    const name = action(args.input);
    const value = payload(args.input);
    const audit = () => auditFrom(args.context, value);

    switch (name) {
      case 'recipe_draft': {
        const body = value.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new P1DomainError('INVALID_STATE', 'body is required.');
        }
        const input: DraftRecipeInput = {
          recipeId: stringField(value, 'recipeId'),
          expectedRevision: expectedRevisionOf(value),
          ...audit(),
          body: body as RecipeBodyInput,
        };
        return this.service.draftRecipe(input);
      }
      case 'recipe_preview': {
        const input: RecipeTransitionInput = {
          recipeId: stringField(value, 'recipeId'),
          expectedRevision: expectedRevisionOf(value),
          ...audit(),
        };
        return this.service.previewRecipe(input);
      }
      case 'recipe_publish': {
        const input: RecipeTransitionInput = {
          recipeId: stringField(value, 'recipeId'),
          expectedRevision: expectedRevisionOf(value),
          ...audit(),
        };
        return this.service.publishRecipe(input);
      }
      case 'recipe_rollback': {
        const expected = numberField(value, 'expectedRevision');
        if (expected === null) {
          throw new P1DomainError(
            'INVALID_STATE',
            'expectedRevision is required for rollback.',
          );
        }
        const target = numberField(value, 'targetRevision');
        if (target === null) {
          throw new P1DomainError(
            'INVALID_STATE',
            'targetRevision is required for rollback.',
          );
        }
        const input: RollbackRecipeInput = {
          recipeId: stringField(value, 'recipeId'),
          expectedRevision: expected,
          targetRevision: target,
          ...audit(),
        };
        return this.service.rollbackRecipe(input);
      }
      case 'surface_draft': {
        const body = value.body;
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          throw new P1DomainError('INVALID_STATE', 'body is required.');
        }
        const input: DraftSurfaceInput = {
          surfaceId: stringField(value, 'surfaceId'),
          expectedRevision: expectedRevisionOf(value),
          ...audit(),
          body: body as SurfaceBodyInput,
        };
        return this.service.draftSurface(input);
      }
      case 'surface_preview': {
        const input: SurfaceTransitionInput = {
          surfaceId: stringField(value, 'surfaceId'),
          expectedRevision: expectedRevisionOf(value),
          ...audit(),
        };
        return this.service.previewSurface(input);
      }
      case 'surface_publish': {
        const input: SurfaceTransitionInput = {
          surfaceId: stringField(value, 'surfaceId'),
          expectedRevision: expectedRevisionOf(value),
          ...audit(),
        };
        return this.service.publishSurface(input);
      }
      case 'surface_rollback': {
        const expected = numberField(value, 'expectedRevision');
        if (expected === null) {
          throw new P1DomainError(
            'INVALID_STATE',
            'expectedRevision is required for rollback.',
          );
        }
        const target = numberField(value, 'targetRevision');
        if (target === null) {
          throw new P1DomainError(
            'INVALID_STATE',
            'targetRevision is required for rollback.',
          );
        }
        const input: RollbackSurfaceInput = {
          surfaceId: stringField(value, 'surfaceId'),
          expectedRevision: expected,
          targetRevision: target,
          ...audit(),
        };
        return this.service.rollbackSurface(input);
      }
      case 'session_freeze': {
        return this.service.freezeSession({
          surfaceRevisionId: stringField(value, 'surfaceRevisionId'),
          ...(typeof value.sessionId === 'string'
            ? { sessionId: value.sessionId }
            : {}),
        });
      }
      default:
        throw new P1DomainError(
          'INVALID_STATE',
          `Unknown creation-experience action "${name}".`,
        );
    }
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }) {
    const name = action(args.input);
    const value =
      args.input.payload &&
      typeof args.input.payload === 'object' &&
      !Array.isArray(args.input.payload)
        ? (args.input.payload as Record<string, unknown>)
        : {};

    switch (name) {
      case 'recipe_get': {
        const recipeId = stringField(value, 'recipeId');
        if (typeof value.revisionId === 'string') {
          return this.service.getRecipeByRevisionId(value.revisionId);
        }
        return this.service.getRecipeHead(recipeId);
      }
      case 'recipe_history':
        return this.service.listRecipeHistory(stringField(value, 'recipeId'));
      case 'recipe_validate': {
        const revision =
          typeof value.revision === 'number' ? value.revision : undefined;
        return this.service.validateRecipe(
          stringField(value, 'recipeId'),
          revision,
        );
      }
      case 'recipe_browser': {
        const revision =
          typeof value.revision === 'number' ? value.revision : undefined;
        return this.service.projectBrowserRecipe(
          stringField(value, 'recipeId'),
          revision,
        );
      }
      case 'surface_get': {
        const surfaceId = stringField(value, 'surfaceId');
        if (typeof value.revisionId === 'string') {
          return this.service.getSurfaceByRevisionId(value.revisionId);
        }
        return this.service.getSurfaceHead(surfaceId);
      }
      case 'surface_history':
        return this.service.listSurfaceHistory(stringField(value, 'surfaceId'));
      case 'surface_validate': {
        const revision =
          typeof value.revision === 'number' ? value.revision : undefined;
        return this.service.validateSurface(
          stringField(value, 'surfaceId'),
          revision,
        );
      }
      case 'surface_browser': {
        const revision =
          typeof value.revision === 'number' ? value.revision : undefined;
        return this.service.projectBrowserSurface(
          stringField(value, 'surfaceId'),
          revision,
        );
      }
      case 'session_get':
        return this.service.getSessionFreeze(stringField(value, 'sessionId'));
      case 'lens_list':
        return listCreationLensSeeds();
      case 'tool_list':
        return listToolEntrySeeds();
      default:
        throw new P1DomainError(
          'INVALID_STATE',
          `Unknown creation-experience query "${name}".`,
        );
    }
  }
}
