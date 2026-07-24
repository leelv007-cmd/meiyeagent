import {
  contextContributionSchema,
  storeFactKindSchema,
  storeFactScopeSchema,
  storeFactSourceSchema,
} from '@meiye/contracts';
import { z } from 'zod';
import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import type { ContextBundleRepository } from './context-bundle-repository.js';
import {
  compileContextBundle,
  contextSourceChanges,
} from './context-compiler.js';
import type { StoreFactLedger } from './store-fact-ledger.js';
import type { ContextSourceRevisionRepository } from './context-source-revisions.js';
import { storeFactContextRevision } from './store-fact-ledger.js';

const idSchema = z.string().trim().min(1);
const timestampSchema = z.iso.datetime();
const appendFactSchema = z
  .object({
    factId: idSchema,
    kind: storeFactKindSchema,
    key: idSchema,
    value: z.json(),
    scope: storeFactScopeSchema,
    source: storeFactSourceSchema,
    effectiveFrom: timestampSchema,
    expiresAt: timestampSchema.nullable(),
    revisionKind: z.literal('revocation').optional(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
const compileSchema = z
  .object({
    bundleId: idSchema,
    taskId: idSchema,
    scope: storeFactScopeSchema,
    at: timestampSchema,
    expectedRevision: z.number().int().nonnegative(),
    contributions: z.array(contextContributionSchema).max(1_000),
    reason: z.string().trim().min(1),
  })
  .strict();
const bundleIdentitySchema = z
  .object({
    bundleId: idSchema,
    revision: z.number().int().positive().optional(),
  })
  .strict();
const activeFactsSchema = z
  .object({ scope: storeFactScopeSchema, at: timestampSchema })
  .strict();
const factHistorySchema = z.object({ factId: idSchema }).strict();
const fenceSchema = z
  .object({
    bundleId: idSchema,
    revision: z.number().int().positive().optional(),
    scope: storeFactScopeSchema,
    at: timestampSchema,
  })
  .strict();
function payload(input: Record<string, unknown>) {
  const value = input.payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new P1DomainError('INVALID_STATE', 'A context payload is required.');
  }
  return value;
}

function action(input: Record<string, unknown>) {
  if (typeof input.action !== 'string' || input.action.trim().length === 0) {
    throw new P1DomainError('INVALID_STATE', 'A context action is required.');
  }
  return input.action;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new P1DomainError('INVALID_STATE', 'Invalid context payload.');
  }
  return parsed.data;
}

export class ContextFoundationModule implements P1OperationModule {
  readonly name = 'context';

  constructor(
    private readonly facts: StoreFactLedger,
    private readonly bundles: ContextBundleRepository,
    private readonly sourceRevisions: ContextSourceRevisionRepository,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly recipeRevision?: (workspaceId: string) => Promise<number>,
  ) {}

  private async currentSourceRevisions(workspaceId: string) {
    const revisions = await this.sourceRevisions.current(workspaceId);
    if (this.recipeRevision) {
      revisions.recipe = await this.recipeRevision(workspaceId);
    }
    return revisions;
  }

  async execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
    idempotencyKey: string;
  }) {
    const name = action(args.input);
    if (name === 'store_fact_append') {
      const input = parse(appendFactSchema, payload(args.input));
      return this.facts.append({
        ...input,
        workspaceId: args.context.workspaceId,
        recordedAt: this.now(),
        recordedBy: args.context.userId,
      });
    }
    if (name !== 'context_bundle_compile') {
      throw new P1DomainError(
        'INVALID_STATE',
        `Unknown context command ${name}.`,
      );
    }
    const input = parse(compileSchema, payload(args.input));
    if (
      input.contributions.some(
        (item) =>
          item.factRevision !== undefined ||
          (item.layer === 'current_fact' && item.pool !== 'current_signal'),
      )
    ) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Business fact values and references must come from the fact ledger.',
      );
    }
    const factQuery = {
      workspaceId: args.context.workspaceId,
      scope: input.scope,
      at: input.at,
    };
    const [activeFacts, sourceRevisions] = await Promise.all([
      this.facts.listActive(factQuery),
      this.currentSourceRevisions(args.context.workspaceId),
    ]);
    const factsRevision = storeFactContextRevision(activeFacts);
    const compiled = compileContextBundle({
      workspaceId: args.context.workspaceId,
      taskId: input.taskId,
      sourceRevisions: {
        ...sourceRevisions,
        facts: factsRevision,
      },
      contributions: [
        ...input.contributions,
        ...activeFacts.map((fact) => ({
          dimension: 'store_facts_assets' as const,
          key: fact.key,
          value: fact.value,
          layer: 'current_fact' as const,
          pool: 'store_personal' as const,
          sourceRef: `store_fact:${fact.factId}:${fact.revision}`,
          factRevision: { factId: fact.factId, revision: fact.revision },
          factSnapshot: {
            factId: fact.factId,
            kind: fact.kind,
            revision: fact.revision,
            source: fact.source,
            effectiveFrom: fact.effectiveFrom,
            expiresAt: fact.expiresAt,
            ...(fact.revisionKind ? { revisionKind: fact.revisionKind } : {}),
          },
        })),
      ],
    });
    return this.bundles.freeze({
      workspaceId: args.context.workspaceId,
      bundleId: input.bundleId,
      compiled,
      expectedRevision: input.expectedRevision,
      frozenAt: this.now(),
      frozenBy: args.context.userId,
      idempotencyKey: args.idempotencyKey,
      reason: input.reason,
    });
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }) {
    const name = action(args.input);
    if (name === 'store_facts_active') {
      const input = parse(activeFactsSchema, payload(args.input));
      return this.facts.listActive({
        workspaceId: args.context.workspaceId,
        ...input,
      });
    }
    if (name === 'store_fact_history') {
      const input = parse(factHistorySchema, payload(args.input));
      return this.facts.history(args.context.workspaceId, input.factId);
    }
    if (name === 'context_bundle_get') {
      const input = parse(bundleIdentitySchema, payload(args.input));
      return this.bundles.get(
        args.context.workspaceId,
        input.bundleId,
        input.revision,
      );
    }
    if (name === 'context_bundle_history') {
      const input = parse(bundleIdentitySchema, payload(args.input));
      return this.bundles.history(args.context.workspaceId, input.bundleId);
    }
    if (name === 'context_bundle_recompile_events') {
      const input = parse(bundleIdentitySchema, payload(args.input));
      return this.bundles.listRecompileEvents(
        args.context.workspaceId,
        input.bundleId,
      );
    }
    if (name === 'context_bundle_fence') {
      const input = parse(fenceSchema, payload(args.input));
      const bundle = await this.bundles.get(
        args.context.workspaceId,
        input.bundleId,
        input.revision,
      );
      if (!bundle) {
        throw new P1DomainError('NOT_FOUND', 'ContextBundle was not found.');
      }
      const [sourceRevisions, factsRevision] = await Promise.all([
        this.currentSourceRevisions(args.context.workspaceId),
        this.facts.contextRevision({
          workspaceId: args.context.workspaceId,
          scope: input.scope,
          at: input.at,
        }),
      ]);
      const currentSourceRevisions = {
        ...sourceRevisions,
        facts: factsRevision,
      };
      const changedSources = contextSourceChanges(
        bundle.sourceRevisions,
        currentSourceRevisions,
      );
      return {
        bundleId: bundle.bundleId,
        revision: bundle.revision,
        stale: changedSources.length > 0,
        changedSources,
        currentSourceRevisions,
      };
    }
    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown context query ${name}.`,
    );
  }
}
