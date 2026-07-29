import {
  storeFactKindSchema,
  storeFactScopeSchema,
  storeFactSourceSchema,
} from '@meiye/contracts';
import { z } from 'zod';
import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import type { StoreFactLedger } from './store-fact-ledger.js';
import { StoreFactSemanticMutationPolicy } from './store-fact-semantic-mutation-policy.js';

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
const activeFactsSchema = z
  .object({ scope: storeFactScopeSchema, at: timestampSchema })
  .strict();
const factHistorySchema = z.object({ factId: idSchema }).strict();
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
  private readonly factMutations: StoreFactSemanticMutationPolicy;

  constructor(
    private readonly facts: StoreFactLedger,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.factMutations = new StoreFactSemanticMutationPolicy(facts);
  }

  async execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
    idempotencyKey: string;
  }) {
    const name = action(args.input);
    if (name === 'store_fact_append') {
      const input = parse(appendFactSchema, payload(args.input));
      return this.factMutations.append({
        ...input,
        workspaceId: args.context.workspaceId,
        recordedAt: this.now(),
        recordedBy: args.context.userId,
      });
    }
    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown context command ${name}.`,
    );
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
    throw new P1DomainError(
      'INVALID_STATE',
      `Unknown context query ${name}.`,
    );
  }
}
