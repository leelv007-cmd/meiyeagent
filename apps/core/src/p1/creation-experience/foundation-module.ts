/**
 * Independent Creation Experience Catalog FoundationModule (A1 / #88).
 *
 * DO NOT add methods to OperationsApplicationService — integration owner
 * wires this module thinly via main.ts later.
 */

import { createHash } from 'node:crypto';

import type {
  BriefTriggerInput,
  CreationExperienceEventKind,
  CreationLensId,
  RecipeDraftFields,
} from '@meiye/contracts';
import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import {
  confirmBrief,
  projectBriefTrigger,
} from './brief-trigger-projection.js';
import {
  MemoryBriefConfirmationRepository,
  type BriefConfirmationRepository,
} from './brief-confirmation-repository.js';
import {
  MissingBriefRevisionResolver,
  type BriefRevisionResolver,
} from './brief-revision-resolver.js';
import {
  MemoryCreationExperienceEventAudit,
  type CreationExperienceEventAuditPort,
  type RecordCreationExperienceEventInput,
} from './creation-experience-events.js';
import { buildRecipePatchPreview } from './recipe-patch-preview.js';
import { CreationExperienceCatalogService } from './catalog-service.js';
import {
  MemoryBriefRevisionContextRepository,
  briefIntentRevisionId,
  briefSourceRevisionId,
  type BriefProjectionFacts,
  type BriefRevisionContextRepository,
} from './postgres-brief-revision-context.js';
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
    actorId: context.userId,
    reason: stringField(source, 'reason'),
    correlationId: context.correlationId,
  };
}

function expectedRevisionOf(source: Record<string, unknown>): number | null {
  if (!('expectedRevision' in source)) {
    throw new P1DomainError('INVALID_STATE', 'expectedRevision is required.');
  }
  if (source.expectedRevision === null) return null;
  return numberField(source, 'expectedRevision');
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function revisionHash(prefix: string, value: unknown) {
  return `${prefix}:${createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')}`;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonNegativeInteger(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

/** Derive only safety-relevant, non-body facts from the revision-bound draft. */
function projectionFactsFromDraft(
  draft: Record<string, unknown>,
  lensId: CreationLensId,
): BriefProjectionFacts {
  const delivery = recordValue(draft.delivery);
  const settings = recordValue(draft.settings);
  const deliverableKindValues = Array.isArray(delivery?.deliverableKinds)
    ? delivery.deliverableKinds
    : Array.isArray(draft.deliverableKinds)
      ? draft.deliverableKinds
      : typeof delivery?.deliverableKind === 'string'
        ? [delivery.deliverableKind]
        : [];
  const distinctDeliverableKinds = new Set(
    deliverableKindValues.flatMap((item) =>
      typeof item === 'string' && item.trim() ? [item.trim()] : [],
    ),
  );
  const deliverableCount = nonNegativeInteger(
    delivery?.deliverableCount ?? draft.deliverableCount,
    Math.max(1, distinctDeliverableKinds.size),
  );
  const outputCount = nonNegativeInteger(
    settings?.quantity ?? draft.outputCount,
    1,
  );
  const platformValues = Array.isArray(delivery?.platforms)
    ? delivery.platforms
    : typeof delivery?.platform === 'string'
      ? [delivery.platform]
      : Array.isArray(draft.platforms)
        ? draft.platforms
        : [];
  const platforms = new Set(
    platformValues.flatMap((item) =>
      typeof item === 'string' && item.trim() ? [item.trim()] : [],
    ),
  );
  const sources = Array.isArray(draft.sources) ? draft.sources : [];
  const restrictedCategories = new Set([
    'customer_case',
    'before_after',
    'review',
    'testimonial',
    'customer_review',
    'rating',
  ]);
  const restrictedAssets = sources.some((source) => {
    const value = recordValue(source);
    if (!value) return false;
    return (
      value.restricted === true ||
      value.containsPerson === true ||
      (typeof value.category === 'string' &&
        restrictedCategories.has(value.category.toLowerCase()))
    );
  });
  const allowedKinds = new Set(['price', 'term', 'effect', 'qualification']);
  const allowedStatuses = new Set(['present', 'missing', 'conflict']);
  const allowedProvenance = new Set([
    'system_suggested',
    'source_extracted',
    'user_entered',
  ]);
  const highRiskFacts = (Array.isArray(draft.highRiskFacts)
    ? draft.highRiskFacts
    : []
  ).flatMap((fact) => {
    const value = recordValue(fact);
    if (
      !value ||
      typeof value.kind !== 'string' ||
      !allowedKinds.has(value.kind) ||
      typeof value.status !== 'string' ||
      !allowedStatuses.has(value.status)
    ) {
      return [];
    }
    return [
      {
        kind: value.kind as 'price' | 'term' | 'effect' | 'qualification',
        status: value.status as 'present' | 'missing' | 'conflict',
        ...(typeof value.provenance === 'string' &&
        allowedProvenance.has(value.provenance)
          ? {
              provenance: value.provenance as
                | 'system_suggested'
                | 'source_extracted'
                | 'user_entered',
            }
          : {}),
        ...(value.participatesInDraft === true
          ? { participatesInDraft: true }
          : {}),
      },
    ];
  });
  const body = typeof draft.userText === 'string' ? draft.userText : '';
  const inferredRisks = [
    ['price', /价格|价目|团购|优惠|\d+\s*元/u],
    ['term', /限时|期限|有效期|截至/u],
    ['effect', /效果|功效|治愈|改善|保证/u],
    ['qualification', /资质|认证|证书|执业/u],
  ] as const;
  for (const [kind, pattern] of inferredRisks) {
    if (
      pattern.test(body) &&
      !highRiskFacts.some((fact) => fact.kind === kind)
    ) {
      highRiskFacts.push({ kind, status: 'missing' });
    }
  }
  return {
    aspectRatio:
      typeof settings?.aspectRatio === 'string'
        ? settings.aspectRatio
        : lensId === 'video'
          ? '9:16'
          : lensId === 'image_text'
            ? '3:4'
            : null,
    crossPlatform: platforms.size > 1,
    deliverableCount,
    durationSeconds:
      lensId === 'video'
        ? nonNegativeInteger(settings?.durationSeconds, 15)
        : null,
    highRiskFacts,
    imageCount:
      lensId === 'image_text'
        ? nonNegativeInteger(settings?.quantity ?? draft.imageCount, 1)
        : 0,
    outputCount,
    // Restricted only from explicit rights signals on draft sources
    // (restricted / containsPerson / restricted categories). Mere attachment
    // of sourceIds must not force Brief.
    restrictedAssets,
  };
}

function serverBriefInput(
  context: NonNullable<
    Awaited<
      ReturnType<BriefRevisionContextRepository['getBriefRevisionContext']>
    >
  >,
  currentRevisions: Awaited<
    ReturnType<BriefRevisionResolver['resolveCurrentRevisions']>
  >,
  quote: Awaited<
    ReturnType<BriefRevisionResolver['resolveCurrentQuoteSignal']>
  >,
): BriefTriggerInput {
  if (!context) {
    throw new P1DomainError('NOT_FOUND', 'Brief revision context was not found.');
  }
  const facts = context.projectionFacts;
  return {
    briefContextId: context.briefContextId,
    currentRevisions,
    deliverableCount: facts.deliverableCount,
    deliverableKind:
      context.lensId === 'video'
        ? 'video'
        : context.lensId === 'image_text'
          ? 'image'
          : 'copy',
    highRiskFacts: facts.highRiskFacts,
    imageCount: facts.imageCount,
    lensId: context.lensId,
    platforms: facts.crossPlatform ? ['platform:1', 'platform:2'] : [],
    quote,
    sources: facts.restrictedAssets
      ? [{ id: 'server-restricted-source', restricted: true }]
      : [],
  };
}

export class CreationExperienceFoundationModule implements P1OperationModule {
  readonly name = 'creation-experience';
  private readonly service: CreationExperienceCatalogService;
  private readonly briefConfirmations: BriefConfirmationRepository;
  private readonly briefRevisionContexts: BriefRevisionContextRepository;
  private readonly briefRevisionResolver: BriefRevisionResolver;
  private readonly eventAudit: CreationExperienceEventAuditPort;

  constructor(
    repository: CreationExperienceCatalogRepository = new MemoryCreationExperienceCatalogRepository(),
    service?: CreationExperienceCatalogService,
    options: {
      briefConfirmations?: BriefConfirmationRepository;
      briefRevisionContexts?: BriefRevisionContextRepository;
      briefRevisionResolver?: BriefRevisionResolver;
      eventAudit?: CreationExperienceEventAuditPort;
    } = {},
  ) {
    this.service =
      service ?? new CreationExperienceCatalogService(repository);
    this.briefConfirmations =
      options.briefConfirmations ?? new MemoryBriefConfirmationRepository();
    this.briefRevisionContexts =
      options.briefRevisionContexts ??
      new MemoryBriefRevisionContextRepository();
    this.briefRevisionResolver =
      options.briefRevisionResolver ?? new MissingBriefRevisionResolver();
    this.eventAudit =
      options.eventAudit ?? new MemoryCreationExperienceEventAudit();
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
        // Browser/command path must never set server-only hidden prompts.
        const safeBody = { ...(body as RecipeBodyInput) };
        delete safeBody.hiddenPromptBody;
        const input: DraftRecipeInput = {
          recipeId: stringField(value, 'recipeId'),
          expectedRevision: expectedRevisionOf(value),
          ...audit(),
          body: safeBody,
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
          workspaceId: args.context.workspaceId,
          surfaceRevisionId: stringField(value, 'surfaceRevisionId'),
          ...(typeof value.sessionId === 'string'
            ? { sessionId: value.sessionId }
            : {}),
        });
      }
      case 'brief_context_sync': {
        if ('draftRevisionId' in value || 'sourceRevisionId' in value) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Brief draft/source revisions are generated by the server.',
          );
        }
        const nullableId = (key: string) => {
          const candidate = value[key];
          if (candidate === undefined || candidate === null) return null;
          return stringField(value, key);
        };
        const lensId = stringField(value, 'lensId');
        if (
          lensId !== 'copy' &&
          lensId !== 'image_text' &&
          lensId !== 'video'
        ) {
          throw new P1DomainError('INVALID_STATE', 'lensId is invalid.');
        }
        const draft = value.draft;
        if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
          throw new P1DomainError('INVALID_STATE', 'draft is required.');
        }
        const sourceIds = value.sourceIds;
        if (
          !Array.isArray(sourceIds) ||
          sourceIds.some(
            (sourceId) =>
              typeof sourceId !== 'string' || sourceId.trim().length === 0,
          )
        ) {
          throw new P1DomainError(
            'INVALID_STATE',
            'sourceIds must be an array of stable identifiers.',
          );
        }
        const normalizedSourceIds = sourceIds.map((sourceId) => sourceId.trim());
        const draftRecord = draft as Record<string, unknown>;
        const context = await this.briefRevisionContexts.syncBriefRevisionContext(
          args.context.workspaceId,
          {
            briefContextId: stringField(value, 'briefContextId'),
            draftRevisionId: revisionHash('draft', draft),
            intentRevisionId: briefIntentRevisionId(
              typeof draftRecord.userText === 'string'
                ? draftRecord.userText
                : '',
            ),
            lensId,
            projectionFacts: projectionFactsFromDraft(draftRecord, lensId),
            quoteId: nullableId('quoteId'),
            recipeRevisionId: nullableId('recipeRevisionId'),
            sourceRevisionId: briefSourceRevisionId(normalizedSourceIds),
            surfaceRevisionId: nullableId('surfaceRevisionId'),
          },
          expectedRevisionOf(value),
        );
        const currentRevisions =
          await this.briefRevisionResolver.resolveCurrentRevisions(
            args.context.workspaceId,
            { briefContextId: context.briefContextId },
          );
        return { ...context, currentRevisions };
      }
      case 'brief_confirm': {
        const confirmationId = stringField(value, 'confirmationId');
        const briefContextId = stringField(value, 'briefContextId');
        const revisionContext =
          await this.briefRevisionContexts.getBriefRevisionContext(
            args.context.workspaceId,
            briefContextId,
          );
        if (!revisionContext) {
          throw new P1DomainError(
            'NOT_FOUND',
            `Brief revision context ${briefContextId} was not found.`,
          );
        }
        const [currentRevisions, quote] = await Promise.all([
          this.briefRevisionResolver.resolveCurrentRevisions(
            args.context.workspaceId,
            { briefContextId },
          ),
          this.briefRevisionResolver.resolveCurrentQuoteSignal(
            args.context.workspaceId,
            { briefContextId },
          ),
        ]);
        const projection = projectBriefTrigger({
          ...serverBriefInput(revisionContext, currentRevisions, quote),
          confirmedRevisions: null,
        });
        if (!projection.requiresBrief) {
          throw new P1DomainError(
            'INVALID_STATE',
            'Brief confirmation is only valid while confirmation is required.',
          );
        }
        const confirmation = confirmBrief({ projection });
        await this.briefRevisionContexts.recordBriefProjection(
          args.context.workspaceId,
          briefContextId,
          revisionContext.revision,
          {
            bindRevisions: projection.bindRevisions,
            requiresBrief:
              projection.requiresBrief || projection.confirmationValid,
          },
        );
        const stored = await this.briefConfirmations.putBriefConfirmation(
          args.context.workspaceId,
          confirmationId,
          confirmation,
        );
        return { confirmationId, ...stored };
      }
      case 'event_append': {
        const kind = stringField(value, 'kind') as CreationExperienceEventKind;
        const lensId = stringField(value, 'lensId');
        if (
          lensId !== 'copy' &&
          lensId !== 'image_text' &&
          lensId !== 'video'
        ) {
          throw new P1DomainError('INVALID_STATE', 'lensId is invalid.');
        }
        const optionalId = (key: string) =>
          typeof value[key] === 'string' && value[key].trim()
            ? value[key].trim()
            : null;
        const recipeRevisionId = optionalId('recipeRevisionId');
        const surfaceRevisionId = optionalId('surfaceRevisionId');
        const [recipe, surface] = await Promise.all([
          recipeRevisionId
            ? this.service.getRecipeByRevisionId(recipeRevisionId)
            : null,
          surfaceRevisionId
            ? this.service.getSurfaceByRevisionId(surfaceRevisionId)
            : null,
        ]);
        if (recipeRevisionId && (!recipe || recipe.status !== 'published')) {
          throw new P1DomainError(
            'NOT_FOUND',
            `Published Recipe revision ${recipeRevisionId} was not found.`,
          );
        }
        if (recipe && recipe.lensId !== lensId) {
          throw new P1DomainError(
            'INVALID_STATE',
            `Event Lens ${lensId} does not match Recipe revision ${recipeRevisionId}.`,
          );
        }
        if (surfaceRevisionId && (!surface || surface.status !== 'published')) {
          throw new P1DomainError(
            'NOT_FOUND',
            `Published Surface revision ${surfaceRevisionId} was not found.`,
          );
        }
        const actionId = stringField(value, 'actionId');
        const input: RecordCreationExperienceEventInput = {
          kind,
          actorId: revisionHash('ref', args.context.userId),
          correlationId: revisionHash('ref', args.context.correlationId),
          lensId,
          lensRevisionId: 'lens.static@1',
          ...(surfaceRevisionId ? { surfaceRevisionId } : {}),
          ...(recipeRevisionId ? { recipeRevisionId } : {}),
          actionId,
          actionRevisionId: `${actionId}@1`,
          ...(typeof value.sessionId === 'string'
            ? { sessionId: revisionHash('ref', value.sessionId) }
            : {}),
          ...(value.meta &&
          typeof value.meta === 'object' &&
          !Array.isArray(value.meta)
            ? { meta: value.meta as Record<string, unknown> }
            : {}),
        };
        return this.eventAudit.append(args.context.workspaceId, input);
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
        return this.service.getSessionFreeze(
          args.context.workspaceId,
          stringField(value, 'sessionId'),
        );
      case 'lens_list':
        return listCreationLensSeeds();
      case 'tool_list':
        return listToolEntrySeeds();
      case 'brief_project': {
        const briefContextId = stringField(value, 'briefContextId');
        const revisionContext =
          await this.briefRevisionContexts.getBriefRevisionContext(
            args.context.workspaceId,
            briefContextId,
          );
        if (!revisionContext) {
          throw new P1DomainError(
            'NOT_FOUND',
            `Brief revision context ${briefContextId} was not found.`,
          );
        }
        const [currentRevisions, quote] = await Promise.all([
          this.briefRevisionResolver.resolveCurrentRevisions(
            args.context.workspaceId,
            { briefContextId },
          ),
          this.briefRevisionResolver.resolveCurrentQuoteSignal(
            args.context.workspaceId,
            { briefContextId },
          ),
        ]);
        const confirmationId =
          typeof value.confirmationId === 'string'
            ? value.confirmationId.trim()
            : '';
        const confirmedRevisions = confirmationId
          ? (
              await this.briefConfirmations.getBriefConfirmation(
                args.context.workspaceId,
                confirmationId,
              )
            )?.boundRevisions
          : undefined;
        if (confirmationId && !confirmedRevisions) {
          throw new P1DomainError(
            'NOT_FOUND',
            `Brief confirmation ${confirmationId} was not found.`,
          );
        }
        const projection = projectBriefTrigger({
          ...serverBriefInput(revisionContext, currentRevisions, quote),
          confirmedRevisions: confirmedRevisions ?? null,
        });
        await this.briefRevisionContexts.recordBriefProjection(
          args.context.workspaceId,
          briefContextId,
          revisionContext.revision,
          {
            bindRevisions: projection.bindRevisions,
            requiresBrief:
              projection.requiresBrief || projection.confirmationValid,
          },
        );
        return projection;
      }
      case 'recipe_patch_preview': {
        const draft = value.draft;
        if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
          throw new P1DomainError('INVALID_STATE', 'draft is required.');
        }
        const recipeRevisionId = stringField(value, 'recipeRevisionId');
        const recipe = await this.service.getRecipeByRevisionId(
          recipeRevisionId,
        );
        if (!recipe || recipe.status !== 'published') {
          throw new P1DomainError(
            'NOT_FOUND',
            `Published recipe revision ${recipeRevisionId} was not found.`,
          );
        }
        const currentLens = value.currentLens;
        if (
          currentLens !== null &&
          currentLens !== undefined &&
          currentLens !== 'copy' &&
          currentLens !== 'image_text' &&
          currentLens !== 'video'
        ) {
          throw new P1DomainError('INVALID_STATE', 'currentLens is invalid.');
        }
        return buildRecipePatchPreview({
          draft: draft as RecipeDraftFields,
          recipe,
          ...(currentLens !== undefined
            ? { currentLens: currentLens as CreationLensId | null }
            : {}),
          ...(typeof value.surfaceRevisionId === 'string'
            ? { surfaceRevisionId: value.surfaceRevisionId }
            : {}),
        });
      }
      default:
        throw new P1DomainError(
          'INVALID_STATE',
          `Unknown creation-experience query "${name}".`,
        );
    }
  }
}
