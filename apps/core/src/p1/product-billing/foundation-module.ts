/**
 * Independent ProductBillingFoundationModule (#92 / WT-B).
 *
 * DO NOT add methods to OperationsApplicationService — integration owner
 * wires this module thinly via main.ts later (S1 freeze).
 */

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import type { ConfirmQuoteInput } from './quote-service.js';
import type { ProductBillingApplicationPort } from './durable-service.js';
import {
  composerSubmissionSignedFieldsSchema,
  type ProductQuoteSnapshot,
} from '@meiye/contracts';
import {
  publicProductQuoteOperations,
  type ProductQuoteAuthority,
  type PublicProductQuoteIntent,
  toPublicProductQuoteSnapshot,
} from './server-quote-authority.js';

export type { ProductQuoteAuthority } from './server-quote-authority.js';

function actionName(input: Record<string, unknown>) {
  if (typeof input.action !== 'string' || input.action.trim().length === 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'A product-billing action is required.',
    );
  }
  return input.action;
}

function payload(input: Record<string, unknown>) {
  const value = input.payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'A product-billing payload is required.',
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
    throw new P1DomainError('INVALID_STATE', `${key} must be a non-empty string.`);
  }
  return value.trim();
}

function numberField(
  source: Record<string, unknown>,
  key: string,
  opts: { optional?: boolean } = {},
): number | undefined {
  const value = source[key];
  if (value === undefined || value === null) {
    if (opts.optional) return undefined;
    throw new P1DomainError('INVALID_STATE', `${key} is required.`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new P1DomainError('INVALID_STATE', `${key} must be a finite number.`);
  }
  return value;
}

function executionInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new P1DomainError(
      'INVALID_STATE',
      'executionInput must be an object.',
    );
  }
  const input = value as Record<string, unknown>;
  if (typeof input.prompt !== 'string' || input.prompt.trim().length === 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      'executionInput.prompt must be a non-empty string.',
    );
  }
  if (
    input.input !== undefined &&
    (typeof input.input !== 'object' || input.input === null || Array.isArray(input.input))
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'executionInput.input must be an object when provided.',
    );
  }
  return {
    input: (input.input ?? null) as Record<string, unknown> | null,
    prompt: input.prompt,
  };
}

const SERVER_AUTHORITATIVE_QUOTE_FIELDS = [
  'authorizedCeiling',
  'billingMode',
  'creditCost',
  'catalogModelRevision',
  'canvasQuote',
  'clientQuote',
  'contract',
  'currency',
  'debitUnits',
  'failureRefundsCredits',
  'formulaExpression',
  'frozenCandidateDeploymentIds',
  'minChargeSeconds',
  'quotePolicyRevision',
  'roundingStepSeconds',
  'routeSnapshotRef',
  'source',
  'taskId',
  'unitRate',
] as const;

function publicQuoteIntent(
  value: Record<string, unknown>,
  context: P1Context,
): PublicProductQuoteIntent {
  const forged = SERVER_AUTHORITATIVE_QUOTE_FIELDS.find(
    (field) => value[field] !== undefined,
  );
  if (forged) {
    throw new P1DomainError(
      'INVALID_STATE',
      `${forged} is server-authoritative and cannot be supplied by browsers.`,
    );
  }
  const operation = stringField(value, 'operation');
  if (!publicProductQuoteOperations.includes(operation as never)) {
    throw new P1DomainError(
      'INVALID_STATE',
      `operation must be one of: ${publicProductQuoteOperations.join(', ')}.`,
    );
  }
  const aspectRatio = value.aspectRatio
    ? stringField(value, 'aspectRatio')
    : undefined;
  if (
    aspectRatio !== undefined &&
    aspectRatio !== '1:1' &&
    aspectRatio !== '3:4' &&
    aspectRatio !== '9:16'
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'aspectRatio must be 1:1, 3:4, or 9:16.',
    );
  }
  return {
    ...(aspectRatio
      ? { aspectRatio }
      : {}),
    catalogModelId: stringField(value, 'catalogModelId'),
    ...(value.executionInput !== undefined
      ? { executionInput: executionInput(value.executionInput) }
      : {}),
    operation: operation as PublicProductQuoteIntent['operation'],
    ...(numberField(value, 'quantity', { optional: true }) !== undefined
      ? { quantity: numberField(value, 'quantity', { optional: true }) }
      : {}),
    quoteId: stringField(value, 'quoteId'),
    ...(value.submission !== undefined
      ? {
          submission: composerSubmissionSignedFieldsSchema.parse(
            value.submission,
          ),
        }
      : {}),
    ...(numberField(value, 'targetSeconds', { optional: true }) !== undefined
      ? { targetSeconds: numberField(value, 'targetSeconds', { optional: true }) }
      : {}),
    workspaceId: context.workspaceId,
  };
}

/**
 * Independent FoundationModule for product quote / settle.
 * Does not add methods to OperationsApplicationService (S1 freeze).
 */
export class ProductBillingFoundationModule implements P1OperationModule {
  readonly name = 'product-billing';

  constructor(
    private readonly quotes: ProductBillingApplicationPort,
    private readonly authority: ProductQuoteAuthority,
  ) {}

  private assertWorkspaceQuote(
    context: P1Context,
    quote: ProductQuoteSnapshot,
  ) {
    if (!quote.workspaceId) {
      throw new P1DomainError(
        'INVALID_STATE',
        `Quote ${quote.quoteId} is missing workspace ownership.`,
      );
    }
    if (quote.workspaceId !== context.workspaceId) {
      throw new P1DomainError(
        'FORBIDDEN',
        'Quote belongs to another workspace.',
      );
    }
    return quote;
  }

  private async requireWorkspaceQuote(context: P1Context, quoteId: string) {
    const quote = await this.quotes.getQuote(quoteId, context.workspaceId);
    if (!quote) {
      throw new P1DomainError('NOT_FOUND', `Quote ${quoteId} was not found.`);
    }
    return this.assertWorkspaceQuote(context, quote);
  }

  private async requireWorkspaceQuoteByTask(context: P1Context, taskId: string) {
    const quote = await this.quotes.getQuoteByTask(taskId, context.workspaceId);
    if (!quote) {
      throw new P1DomainError('NOT_FOUND', `No quote for task ${taskId}.`);
    }
    return this.assertWorkspaceQuote(context, quote);
  }

  async execute(args: {
    context: P1Context;
    idempotencyKey: string;
    input: Record<string, unknown>;
  }) {
    const action = actionName(args.input);
    const value = payload(args.input);

    switch (action) {
      case 'quote': {
        const buildInput = await this.authority.resolve(
          publicQuoteIntent(value, args.context),
        );
        const existing = await this.quotes.getQuote(
          buildInput.quoteId,
          args.context.workspaceId,
        );
        if (existing) {
          this.assertWorkspaceQuote(args.context, existing);
        }
        buildInput.workspaceId = args.context.workspaceId;
        return toPublicProductQuoteSnapshot(
          await this.quotes.buildQuote(buildInput),
        );
      }
      case 'confirm': {
        if (value.authorizedCeiling !== undefined) {
          throw new P1DomainError(
            'INVALID_STATE',
            'authorizedCeiling is server-authoritative and cannot be supplied by browsers.',
          );
        }
        const quoteId = stringField(value, 'quoteId');
        await this.requireWorkspaceQuote(args.context, quoteId);
        const input: ConfirmQuoteInput = {
          quoteId,
          taskId: stringField(value, 'taskId'),
        };
        return toPublicProductQuoteSnapshot(
          await this.quotes.confirm({
            ...input,
            workspaceId: args.context.workspaceId,
          }),
        );
      }
      default:
        throw new P1DomainError(
          'INVALID_STATE',
          `Unknown product-billing command ${action}.`,
        );
    }
  }

  async query(args: {
    context: P1Context;
    input: Record<string, unknown>;
  }) {
    const action = actionName(args.input);
    const value = payload(args.input);

    switch (action) {
      case 'get_quote': {
        const quoteId = stringField(value, 'quoteId');
        return toPublicProductQuoteSnapshot(
          await this.requireWorkspaceQuote(args.context, quoteId),
        );
      }
      case 'get_quote_by_task': {
        const taskId = stringField(value, 'taskId');
        return toPublicProductQuoteSnapshot(
          await this.requireWorkspaceQuoteByTask(args.context, taskId),
        );
      }
      case 'get_usage': {
        const taskId = stringField(value, 'taskId');
        await this.requireWorkspaceQuoteByTask(args.context, taskId);
        const usage = await this.quotes.getUsage(
          taskId,
          args.context.workspaceId,
        );
        if (!usage) {
          throw new P1DomainError(
            'NOT_FOUND',
            `No product usage for task ${taskId}.`,
          );
        }
        return usage;
      }
      default:
        throw new P1DomainError(
          'INVALID_STATE',
          `Unknown product-billing query ${action}.`,
        );
    }
  }
}
