import { createHash } from 'node:crypto';

import type {
  BriefBoundRevisions,
  BriefHighRiskFactSignal,
  BriefQuoteSignal,
  BriefTriggerProjection,
  CreationLensId,
} from '@meiye/contracts';
import type { Pool, QueryResultRow } from 'pg';

import { P1DomainError } from '../foundation/domain.js';
import type { CreationExperienceCatalogRepository } from './memory-repository.js';
import type { BriefRevisionResolver } from './brief-revision-resolver.js';

export interface BriefRevisionContext {
  briefContextId: string;
  draftRevisionId: string;
  lensId: CreationLensId;
  lastProjection?: Pick<
    BriefTriggerProjection,
    'bindRevisions' | 'requiresBrief'
  >;
  intentRevisionId: string;
  quoteId: string | null;
  projectionFacts: BriefProjectionFacts;
  recipeRevisionId: string | null;
  revision: number;
  sourceRevisionId: string | null;
  surfaceRevisionId: string | null;
}

export interface BriefProjectionFacts {
  aspectRatio: string | null;
  crossPlatform: boolean;
  deliverableCount: number;
  durationSeconds: number | null;
  highRiskFacts: Array<
    Pick<
      BriefHighRiskFactSignal,
      'kind' | 'participatesInDraft' | 'provenance' | 'status'
    >
  >;
  imageCount: number;
  outputCount: number;
  restrictedAssets: boolean;
}

export type SyncBriefRevisionContextInput = Pick<
  BriefRevisionContext,
  | 'briefContextId'
  | 'draftRevisionId'
  | 'lensId'
  | 'quoteId'
  | 'recipeRevisionId'
  | 'sourceRevisionId'
  | 'surfaceRevisionId'
> & { intentRevisionId?: string; projectionFacts?: BriefProjectionFacts };

const EMPTY_PROJECTION_FACTS: BriefProjectionFacts = {
  aspectRatio: null,
  crossPlatform: false,
  deliverableCount: 1,
  durationSeconds: null,
  highRiskFacts: [],
  imageCount: 0,
  outputCount: 1,
  restrictedAssets: false,
};

function revisionHash(prefix: string, value: unknown) {
  return `${prefix}:${createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')}`;
}

export function briefIntentRevisionId(intent: string) {
  return revisionHash('intent', intent.trim());
}

export function briefSourceRevisionId(sourceIds: readonly string[]) {
  return revisionHash(
    'sources',
    sourceIds.map((sourceId) => sourceId.trim()).sort(),
  );
}

export interface BriefRevisionContextRepository {
  getBriefRevisionContext(
    workspaceId: string,
    briefContextId: string,
  ): Promise<BriefRevisionContext | null>;
  syncBriefRevisionContext(
    workspaceId: string,
    context: SyncBriefRevisionContextInput,
    expectedRevision: number | null,
  ): Promise<BriefRevisionContext>;
  recordBriefProjection(
    workspaceId: string,
    briefContextId: string,
    expectedRevision: number,
    projection: Pick<BriefTriggerProjection, 'bindRevisions' | 'requiresBrief'>,
  ): Promise<void>;
}

function buildContext(
  input: SyncBriefRevisionContextInput,
  revision: number,
): BriefRevisionContext {
  return {
    ...input,
    intentRevisionId: input.intentRevisionId ?? briefIntentRevisionId(''),
    projectionFacts: input.projectionFacts ?? EMPTY_PROJECTION_FACTS,
    revision,
  };
}

function sameContext(
  left: BriefRevisionContext,
  right: SyncBriefRevisionContextInput,
) {
  return (
    left.draftRevisionId === right.draftRevisionId &&
    left.intentRevisionId ===
      (right.intentRevisionId ?? briefIntentRevisionId('')) &&
    left.lensId === right.lensId &&
    left.quoteId === right.quoteId &&
    JSON.stringify(left.projectionFacts) ===
      JSON.stringify(right.projectionFacts ?? EMPTY_PROJECTION_FACTS) &&
    left.recipeRevisionId === right.recipeRevisionId &&
    left.sourceRevisionId === right.sourceRevisionId &&
    left.surfaceRevisionId === right.surfaceRevisionId
  );
}

export class MemoryBriefRevisionContextRepository
  implements BriefRevisionContextRepository
{
  private readonly contexts = new Map<string, BriefRevisionContext>();

  async getBriefRevisionContext(workspaceId: string, briefContextId: string) {
    return this.contexts.get(`${workspaceId}:${briefContextId}`) ?? null;
  }

  async syncBriefRevisionContext(
    workspaceId: string,
    input: SyncBriefRevisionContextInput,
    expectedRevision: number | null,
  ) {
    const key = `${workspaceId}:${input.briefContextId}`;
    const current = this.contexts.get(key) ?? null;
    if ((current?.revision ?? null) !== expectedRevision) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Brief revision context changed before the write could be applied.',
      );
    }
    if (current && sameContext(current, input)) return current;
    const context = buildContext(input, (expectedRevision ?? 0) + 1);
    this.contexts.set(key, context);
    return context;
  }

  async recordBriefProjection(
    workspaceId: string,
    briefContextId: string,
    expectedRevision: number,
    projection: Pick<BriefTriggerProjection, 'bindRevisions' | 'requiresBrief'>,
  ) {
    const key = `${workspaceId}:${briefContextId}`;
    const current = this.contexts.get(key);
    if (!current || current.revision !== expectedRevision) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Brief revision context changed before projection was recorded.',
      );
    }
    this.contexts.set(key, { ...current, lastProjection: projection });
  }
}

type ContextRow = QueryResultRow & { payload: BriefRevisionContext };

/** Server-internal current draft/source/selection fact; never exposed as a command. */
export class PostgresBriefRevisionContextRepository
  implements BriefRevisionContextRepository
{
  constructor(private readonly pool: Pool) {}

  async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS p1_creation_brief_revision_contexts (
        workspace_id text NOT NULL,
        brief_context_id text NOT NULL,
        revision integer NOT NULL CHECK (revision > 0),
        payload jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, brief_context_id)
      )
    `);
  }

  async getBriefRevisionContext(
    workspaceId: string,
    briefContextId: string,
  ): Promise<BriefRevisionContext | null> {
    const result = await this.pool.query<ContextRow>(
      `SELECT payload
         FROM p1_creation_brief_revision_contexts
        WHERE workspace_id = $1 AND brief_context_id = $2`,
      [workspaceId, briefContextId],
    );
    return result.rows[0]?.payload ?? null;
  }

  async syncBriefRevisionContext(
    workspaceId: string,
    input: SyncBriefRevisionContextInput,
    expectedRevision: number | null,
  ): Promise<BriefRevisionContext> {
    const current = await this.getBriefRevisionContext(
      workspaceId,
      input.briefContextId,
    );
    if ((current?.revision ?? null) !== expectedRevision) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Brief revision context changed before the write could be applied.',
      );
    }
    if (current && sameContext(current, input)) return current;
    const revision = (expectedRevision ?? 0) + 1;
    const context = buildContext(input, revision);
    const result =
      expectedRevision === null
        ? await this.pool.query<ContextRow>(
            `INSERT INTO p1_creation_brief_revision_contexts
               (workspace_id, brief_context_id, revision, payload)
             VALUES ($1, $2, $3, $4::jsonb)
             ON CONFLICT (workspace_id, brief_context_id) DO NOTHING
             RETURNING payload`,
            [
              workspaceId,
              input.briefContextId,
              revision,
              JSON.stringify(context),
            ],
          )
        : await this.pool.query<ContextRow>(
            `UPDATE p1_creation_brief_revision_contexts
                SET revision = $3, payload = $4::jsonb, updated_at = now()
              WHERE workspace_id = $1
                AND brief_context_id = $2
                AND revision = $5
             RETURNING payload`,
            [
              workspaceId,
              input.briefContextId,
              revision,
              JSON.stringify(context),
              expectedRevision,
            ],
          );
    if (!result.rows[0]) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Brief revision context changed before the write could be applied.',
      );
    }
    return result.rows[0].payload;
  }

  async recordBriefProjection(
    workspaceId: string,
    briefContextId: string,
    expectedRevision: number,
    projection: Pick<BriefTriggerProjection, 'bindRevisions' | 'requiresBrief'>,
  ) {
    const result = await this.pool.query(
      `UPDATE p1_creation_brief_revision_contexts
          SET payload = jsonb_set(payload, '{lastProjection}', $4::jsonb, true),
              updated_at = now()
        WHERE workspace_id = $1
          AND brief_context_id = $2
          AND revision = $3`,
      [workspaceId, briefContextId, expectedRevision, JSON.stringify(projection)],
    );
    if (result.rowCount !== 1) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Brief revision context changed before projection was recorded.',
      );
    }
  }
}

export interface CurrentModelCatalogSource {
  getCurrentPublishedCatalogRevision(
    workspaceId: string,
  ): Promise<{ id: string } | null>;
}

export interface CurrentProductQuoteSource {
  getQuote(
    workspaceId: string,
    quoteId: string,
  ): Promise<{
    catalogModelRevision?: string;
    catalogModelId?: string;
    confirmedAmount?: number;
    extraConfirmThreshold?: number;
    quotePolicyRevision?: string;
    revision: string;
  } | null>;
}

/** Composes the authoritative tuple from Catalog, ModelSupply, Billing, and session facts. */
export class CompositeBriefRevisionResolver implements BriefRevisionResolver {
  constructor(
    private readonly contexts: BriefRevisionContextRepository,
    private readonly catalog: CreationExperienceCatalogRepository,
    private readonly models: CurrentModelCatalogSource,
    private readonly quotes: CurrentProductQuoteSource,
  ) {}

  async resolveCurrentRevisions(
    workspaceId: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<BriefBoundRevisions> {
    const briefContextId =
      typeof payload.briefContextId === 'string'
        ? payload.briefContextId.trim()
        : '';
    if (!briefContextId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'briefContextId is required for server revision resolution.',
      );
    }
    const context = await this.contexts.getBriefRevisionContext(
      workspaceId,
      briefContextId,
    );
    if (!context) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Brief revision context ${briefContextId} was not found.`,
      );
    }
    const [recipe, surface, model, quote] = await Promise.all([
      context.recipeRevisionId
        ? this.catalog.getRecipeByRevisionId(context.recipeRevisionId)
        : null,
      context.surfaceRevisionId
        ? this.catalog.getSurfaceByRevisionId(context.surfaceRevisionId)
        : null,
      this.models.getCurrentPublishedCatalogRevision(workspaceId),
      context.quoteId
        ? this.quotes.getQuote(workspaceId, context.quoteId)
        : null,
    ]);
    if (context.recipeRevisionId && (!recipe || recipe.status !== 'published')) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Published Recipe revision ${context.recipeRevisionId} was not found.`,
      );
    }
    if (context.surfaceRevisionId && (!surface || surface.status !== 'published')) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Published Surface revision ${context.surfaceRevisionId} was not found.`,
      );
    }
    if (context.quoteId && !quote) {
      throw new P1DomainError(
        'NOT_FOUND',
        `ProductQuote ${context.quoteId} was not found.`,
      );
    }
    if (quote && !quote.catalogModelRevision) {
      throw new P1DomainError(
        'INVALID_STATE',
        `ProductQuote ${context.quoteId} is missing its selected model revision.`,
      );
    }
    return {
      draftRevisionId: context.draftRevisionId,
      lensId: context.lensId,
      modelRevisionId: quote ? quote.catalogModelRevision! : model?.id ?? null,
      quoteRevisionId: quote?.revision ?? null,
      recipeRevisionId: recipe?.revisionId ?? null,
      sourceRevisionId: context.sourceRevisionId,
      surfaceRevisionId: surface?.revisionId ?? null,
    };
  }

  async resolveCurrentQuoteSignal(
    workspaceId: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<BriefQuoteSignal | null> {
    const context = await this.requireContext(workspaceId, payload);
    if (!context.quoteId) return null;
    const quote = await this.quotes.getQuote(workspaceId, context.quoteId);
    if (!quote) {
      throw new P1DomainError(
        'NOT_FOUND',
        `ProductQuote ${context.quoteId} was not found.`,
      );
    }
    if (!quote.catalogModelId) {
      throw new P1DomainError(
        'INVALID_STATE',
        `ProductQuote ${context.quoteId} is missing its selected model id.`,
      );
    }
    return {
      amount: quote.confirmedAmount ?? 0,
      catalogModelId: quote.catalogModelId,
      extraConfirmThreshold:
        typeof quote.extraConfirmThreshold === 'number'
          ? quote.extraConfirmThreshold
          : Number.EPSILON,
      quotePolicyRevision: quote.quotePolicyRevision ?? 'server-policy',
      quoteRevisionId: quote.revision,
    };
  }

  private async requireContext(
    workspaceId: string,
    payload: Readonly<Record<string, unknown>>,
  ) {
    const briefContextId =
      typeof payload.briefContextId === 'string'
        ? payload.briefContextId.trim()
        : '';
    if (!briefContextId) {
      throw new P1DomainError(
        'INVALID_STATE',
        'briefContextId is required for server revision resolution.',
      );
    }
    const context = await this.contexts.getBriefRevisionContext(
      workspaceId,
      briefContextId,
    );
    if (!context) {
      throw new P1DomainError(
        'NOT_FOUND',
        `Brief revision context ${briefContextId} was not found.`,
      );
    }
    return context;
  }
}
