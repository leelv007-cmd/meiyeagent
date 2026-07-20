/**
 * Independent ProductBillingFoundationModule (#92 / WT-B).
 *
 * DO NOT add methods to OperationsApplicationService — integration owner
 * wires this module thinly via main.ts later (S1 freeze).
 */

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { P1OperationModule } from '../foundation/ports.js';
import {
  adaptCanvasPersistedQuote,
  adaptClientQuoteFor,
  adaptCreativeExecutionQuote,
  type CanvasPersistedQuoteSource,
  type ClientQuoteForSource,
  type CreativeExecutionQuoteSource,
} from './canvas-quote-adapter.js';
import {
  type ConfirmQuoteInput,
  type DispatchQuoteInput,
  type FallbackDispatchInput,
  type ReserveQuoteInput,
  type SettleQuoteInput,
  type TrustedUsageEvidence,
} from './quote-service.js';
import type { ProductBillingApplicationPort } from './durable-service.js';
import type { BuildProductQuoteInput, ProductBillingMode } from '@meiye/contracts';

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

function billingModeField(source: Record<string, unknown>): ProductBillingMode {
  const value = stringField(source, 'billingMode');
  if (value !== 'per_request' && value !== 'per_output_second') {
    throw new P1DomainError(
      'INVALID_STATE',
      'billingMode must be per_request or per_output_second.',
    );
  }
  return value;
}

function buildInputFromPayload(
  value: Record<string, unknown>,
  context: P1Context,
): BuildProductQuoteInput {
  const source = stringField(value, 'source', { optional: true }) || 'direct';

  if (source === 'creative_execution') {
    const contract = value.contract;
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'creative_execution source requires contract object.',
      );
    }
    return adaptCreativeExecutionQuote(
      contract as CreativeExecutionQuoteSource,
      {
        quoteId: stringField(value, 'quoteId'),
        ...(value.billingMode
          ? { billingMode: billingModeField(value) }
          : {}),
        ...(numberField(value, 'minChargeSeconds', { optional: true }) !==
        undefined
          ? {
              minChargeSeconds: numberField(value, 'minChargeSeconds', {
                optional: true,
              }),
            }
          : {}),
        ...(numberField(value, 'roundingStepSeconds', { optional: true }) !==
        undefined
          ? {
              roundingStepSeconds: numberField(value, 'roundingStepSeconds', {
                optional: true,
              }),
            }
          : {}),
        ...(value.routeSnapshotRef
          ? { routeSnapshotRef: stringField(value, 'routeSnapshotRef') }
          : {}),
        ...(Array.isArray(value.frozenCandidateDeploymentIds)
          ? {
              frozenCandidateDeploymentIds:
                value.frozenCandidateDeploymentIds as string[],
            }
          : {}),
        ...(value.taskId ? { taskId: stringField(value, 'taskId') } : {}),
        workspaceId: context.workspaceId,
      },
    );
  }

  if (source === 'canvas') {
    const canvas = value.canvasQuote;
    if (!canvas || typeof canvas !== 'object' || Array.isArray(canvas)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'canvas source requires canvasQuote object.',
      );
    }
    return adaptCanvasPersistedQuote(canvas as CanvasPersistedQuoteSource, {
      ...(numberField(value, 'targetSeconds', { optional: true }) !== undefined
        ? {
            targetSeconds: numberField(value, 'targetSeconds', {
              optional: true,
            }),
          }
        : {}),
      ...(numberField(value, 'minChargeSeconds', { optional: true }) !==
      undefined
        ? {
            minChargeSeconds: numberField(value, 'minChargeSeconds', {
              optional: true,
            }),
          }
        : {}),
      ...(numberField(value, 'roundingStepSeconds', { optional: true }) !==
      undefined
        ? {
            roundingStepSeconds: numberField(value, 'roundingStepSeconds', {
              optional: true,
            }),
          }
        : {}),
      ...(value.billingMode ? { billingMode: billingModeField(value) } : {}),
      ...(numberField(value, 'unitRate', { optional: true }) !== undefined
        ? { unitRate: numberField(value, 'unitRate', { optional: true }) }
        : {}),
      ...(value.taskId ? { taskId: stringField(value, 'taskId') } : {}),
    });
  }

  if (source === 'client_quote_for') {
    const client = value.clientQuote;
    if (!client || typeof client !== 'object' || Array.isArray(client)) {
      throw new P1DomainError(
        'INVALID_STATE',
        'client_quote_for source requires clientQuote object.',
      );
    }
    return adaptClientQuoteFor(client as ClientQuoteForSource, {
      quoteId: stringField(value, 'quoteId'),
      ...(numberField(value, 'minChargeSeconds', { optional: true }) !==
      undefined
        ? {
            minChargeSeconds: numberField(value, 'minChargeSeconds', {
              optional: true,
            }),
          }
        : {}),
      ...(numberField(value, 'roundingStepSeconds', { optional: true }) !==
      undefined
        ? {
            roundingStepSeconds: numberField(value, 'roundingStepSeconds', {
              optional: true,
            }),
          }
        : {}),
      ...(value.routeSnapshotRef
        ? { routeSnapshotRef: stringField(value, 'routeSnapshotRef') }
        : {}),
      workspaceId: context.workspaceId,
    });
  }

  // Direct BuildProductQuoteInput
  return {
    quoteId: stringField(value, 'quoteId'),
    catalogModelId: stringField(value, 'catalogModelId'),
    ...(value.catalogModelRevision
      ? { catalogModelRevision: stringField(value, 'catalogModelRevision') }
      : {}),
    quotePolicyRevision: stringField(value, 'quotePolicyRevision'),
    billingMode: billingModeField(value),
    unitRate: numberField(value, 'unitRate') as number,
    ...(value.currency ? { currency: stringField(value, 'currency') } : {}),
    ...(value.formulaExpression
      ? { formulaExpression: stringField(value, 'formulaExpression') }
      : {}),
    ...(numberField(value, 'targetSeconds', { optional: true }) !== undefined
      ? { targetSeconds: numberField(value, 'targetSeconds', { optional: true }) }
      : {}),
    ...(numberField(value, 'minChargeSeconds', { optional: true }) !== undefined
      ? {
          minChargeSeconds: numberField(value, 'minChargeSeconds', {
            optional: true,
          }),
        }
      : {}),
    ...(numberField(value, 'roundingStepSeconds', { optional: true }) !==
    undefined
      ? {
          roundingStepSeconds: numberField(value, 'roundingStepSeconds', {
            optional: true,
          }),
        }
      : {}),
    ...(value.routeSnapshotRef
      ? { routeSnapshotRef: stringField(value, 'routeSnapshotRef') }
      : {}),
    ...(Array.isArray(value.frozenCandidateDeploymentIds)
      ? {
          frozenCandidateDeploymentIds:
            value.frozenCandidateDeploymentIds as string[],
        }
      : {}),
    workspaceId: context.workspaceId,
    ...(value.taskId ? { taskId: stringField(value, 'taskId') } : {}),
    ...(numberField(value, 'authorizedCeiling', { optional: true }) !==
    undefined
      ? {
          authorizedCeiling: numberField(value, 'authorizedCeiling', {
            optional: true,
          }),
        }
      : {}),
  };
}

function trustedUsageFrom(
  value: Record<string, unknown> | undefined,
): TrustedUsageEvidence | undefined {
  if (!value) return undefined;
  const kind = stringField(value, 'kind');
  if (
    kind !== 'provider_usage' &&
    kind !== 'provider_bill' &&
    kind !== 'media_duration'
  ) {
    throw new P1DomainError(
      'INVALID_STATE',
      'trustedUsage.kind must be provider_usage, provider_bill, or media_duration.',
    );
  }
  return {
    kind,
    actualSeconds: numberField(value, 'actualSeconds') as number,
    ...(value.evidenceRef
      ? { evidenceRef: stringField(value, 'evidenceRef') }
      : {}),
  };
}

/**
 * Independent FoundationModule for product quote / settle.
 * Does not add methods to OperationsApplicationService (S1 freeze).
 */
export class ProductBillingFoundationModule implements P1OperationModule {
  readonly name = 'product-billing';

  constructor(private readonly quotes: ProductBillingApplicationPort) {}

  async execute(args: {
    context: P1Context;
    idempotencyKey: string;
    input: Record<string, unknown>;
  }) {
    const action = actionName(args.input);
    const value = payload(args.input);

    switch (action) {
      case 'quote': {
        const buildInput = buildInputFromPayload(value, args.context);
        if (!buildInput.workspaceId) {
          buildInput.workspaceId = args.context.workspaceId;
        }
        return this.quotes.buildQuote(buildInput);
      }
      case 'confirm': {
        const input: ConfirmQuoteInput = {
          quoteId: stringField(value, 'quoteId'),
          taskId: stringField(value, 'taskId'),
          ...(numberField(value, 'authorizedCeiling', { optional: true }) !==
          undefined
            ? {
                authorizedCeiling: numberField(value, 'authorizedCeiling', {
                  optional: true,
                }),
              }
            : {}),
        };
        return this.quotes.confirm({ ...input, workspaceId: args.context.workspaceId });
      }
      case 'reserve': {
        const input: ReserveQuoteInput = {
          quoteId: stringField(value, 'quoteId'),
          ...(value.usageId ? { usageId: stringField(value, 'usageId') } : {}),
          ...(value.resource
            ? {
                resource: stringField(value, 'resource') as
                  | 'copy'
                  | 'image'
                  | 'video'
                  | 'audio',
              }
            : {}),
        };
        return this.quotes.reserve({ ...input, workspaceId: args.context.workspaceId });
      }
      case 'dispatch': {
        const input: DispatchQuoteInput = {
          quoteId: stringField(value, 'quoteId'),
          deploymentId: stringField(value, 'deploymentId'),
          attemptId: stringField(value, 'attemptId'),
          ...(value.providerCost &&
          typeof value.providerCost === 'object' &&
          !Array.isArray(value.providerCost)
            ? {
                providerCost: value.providerCost as NonNullable<
                  DispatchQuoteInput['providerCost']
                >,
              }
            : {}),
        };
        return this.quotes.dispatch({ ...input, workspaceId: args.context.workspaceId });
      }
      case 'fallback_dispatch': {
        const input: FallbackDispatchInput = {
          quoteId: stringField(value, 'quoteId'),
          deploymentId: stringField(value, 'deploymentId'),
          attemptId: stringField(value, 'attemptId'),
          ...(value.providerCost &&
          typeof value.providerCost === 'object' &&
          !Array.isArray(value.providerCost)
            ? {
                providerCost: value.providerCost as NonNullable<
                  FallbackDispatchInput['providerCost']
                >,
              }
            : {}),
          ...(numberField(value, 'supplyCostDeltaMicros', { optional: true }) !==
          undefined
            ? {
                supplyCostDeltaMicros: numberField(
                  value,
                  'supplyCostDeltaMicros',
                  { optional: true },
                ),
              }
            : {}),
        };
        return this.quotes.fallbackDispatch({ ...input, workspaceId: args.context.workspaceId });
      }
      case 'settle': {
        const trustedRaw =
          value.trustedUsage &&
          typeof value.trustedUsage === 'object' &&
          !Array.isArray(value.trustedUsage)
            ? (value.trustedUsage as Record<string, unknown>)
            : undefined;
        const input: SettleQuoteInput = {
          quoteId: stringField(value, 'quoteId'),
          ...(trustedRaw ? { trustedUsage: trustedUsageFrom(trustedRaw) } : {}),
          ...(value.attemptId
            ? { attemptId: stringField(value, 'attemptId') }
            : {}),
          ...(numberField(value, 'overproductionUnitCostMicros', {
            optional: true,
          }) !== undefined
            ? {
                overproductionUnitCostMicros: numberField(
                  value,
                  'overproductionUnitCostMicros',
                  { optional: true },
                ),
              }
            : {}),
        };
        return this.quotes.settle({ ...input, workspaceId: args.context.workspaceId });
      }
      case 'fail_and_refund': {
        const trustedRaw =
          value.trustedUsage &&
          typeof value.trustedUsage === 'object' &&
          !Array.isArray(value.trustedUsage)
            ? (value.trustedUsage as Record<string, unknown>)
            : undefined;
        return this.quotes.failAndRefund({
          quoteId: stringField(value, 'quoteId'),
          ...(trustedRaw ? { trustedUsage: trustedUsageFrom(trustedRaw) } : {}),
          ...(value.reason ? { reason: stringField(value, 'reason') } : {}),
          workspaceId: args.context.workspaceId,
        });
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
        const quote = await this.quotes.getQuote(quoteId, args.context.workspaceId);
        if (!quote) {
          throw new P1DomainError('NOT_FOUND', `Quote ${quoteId} was not found.`);
        }
        if (
          quote.workspaceId &&
          quote.workspaceId !== args.context.workspaceId
        ) {
          throw new P1DomainError('FORBIDDEN', 'Quote belongs to another workspace.');
        }
        return quote;
      }
      case 'get_quote_by_task': {
        const taskId = stringField(value, 'taskId');
        const quote = await this.quotes.getQuoteByTask(taskId, args.context.workspaceId);
        if (!quote) {
          throw new P1DomainError(
            'NOT_FOUND',
            `No quote for task ${taskId}.`,
          );
        }
        return quote;
      }
      case 'get_usage': {
        const taskId = stringField(value, 'taskId');
        const usage = await this.quotes.getUsage(taskId, args.context.workspaceId);
        if (!usage) {
          throw new P1DomainError(
            'NOT_FOUND',
            `No product usage for task ${taskId}.`,
          );
        }
        return usage;
      }
      case 'list_provider_costs': {
        const taskId = stringField(value, 'taskId');
        return this.quotes.listProviderCosts(taskId, args.context.workspaceId);
      }
      default:
        throw new P1DomainError(
          'INVALID_STATE',
          `Unknown product-billing query ${action}.`,
        );
    }
  }
}
