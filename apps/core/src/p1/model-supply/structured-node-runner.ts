import type { ZodType } from 'zod';

import {
  ModelSupplyApplicationService,
  type Acceptance,
  type DataClass,
  type RouteSnapshot,
  type RequestedSelection,
  type StructuredObjectExecutor,
} from './index.js';
import type { StructuredObjectMeasurement } from './provider-lifecycle.js';
import {
  OpenAiCompatibleAiSdkRunner,
  type OpenAiCompatibleAiSdkOptions,
} from './ai-sdk-runner.js';
import { openAiCompatibleRunnerForRequest } from './adapters.js';
import type { ProviderExecutionRequest } from './provider-lifecycle.js';
import type { StructuredExecutionContinuation } from './execution-attempt-budget.js';

export type { StructuredObjectExecutor } from './index.js';

export interface StructuredNodeRunnerRequest<Output> {
  effectIdempotencyKey: string;
  instructions: string;
  prompt: string;
  schema: ZodType<Output>;
  schemaName: string;
  schemaRevision: string;
  abortSignal?: AbortSignal;
  /** Revalidates live execution facts immediately before every provider effect. */
  beforeProviderAttempt?: () => Promise<void>;
  onPartialOutput?: (partial: unknown) => Promise<void> | void;
}
export interface StructuredNodeRunnerResult<Output> {
  output: Output;
  attempts: number;
  /** Observed provider spend normalized to CNY cents for bounded execution. */
  observedCostCents?: number;
  providerTaskRef: string;
  replayed: boolean;
  usage: { inputTokens: number; outputTokens: number };
  firstPassSchemaValid?: boolean;
  repair?: {
    count: number;
    reasons: string[];
  };
}

export interface StructuredNodeRunner {
  run<Output>(
    request: StructuredNodeRunnerRequest<Output>,
  ): Promise<StructuredNodeRunnerResult<Output>>;
}

export class StructuredNodeRunError extends Error {
  constructor(
    readonly status: 'failed' | 'unknown',
    readonly acceptance: Acceptance,
    readonly measurement?: StructuredObjectMeasurement,
    readonly attempts = 1,
    readonly observedCostCents?: number,
  ) {
    super(
      status === 'unknown'
        ? 'Structured node outcome is unknown and must be reconciled.'
        : 'Structured node execution failed.',
    );
    this.name = 'StructuredNodeRunError';
  }
}

export class ModelSupplyStructuredNodeRunner implements StructuredNodeRunner {
  private readonly effects = new Map<
    string,
    {
      canonical: string;
      execution: Promise<Omit<StructuredNodeRunnerResult<unknown>, 'replayed'>>;
    }
  >();

  constructor(
    private readonly options: {
      application: ModelSupplyApplicationService;
      executor: StructuredObjectExecutor;
      workspaceId: string;
      actorId: string;
      selection?: RequestedSelection;
      /** Durable #240 carrier; when present it is the only route authority. */
      frozenRouteSnapshot?: RouteSnapshot;
      dataClass?: DataClass[];
      billingTaskId?: string;
      billingQuoteRevision?: string;
    },
  ) {
    if (!options.selection && !options.frozenRouteSnapshot) {
      throw new Error(
        'Structured node runner requires a selection or frozen route.',
      );
    }
  }

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    const canonical = JSON.stringify({
      instructions: request.instructions,
      prompt: request.prompt,
      schemaName: request.schemaName,
      schemaRevision: request.schemaRevision,
      frozenRouteSnapshot: this.options.frozenRouteSnapshot,
    });
    const existing = this.effects.get(request.effectIdempotencyKey);
    if (existing) {
      if (existing.canonical !== canonical) {
        throw new Error('Idempotency key conflicts with a different payload.');
      }
      const replay = await existing.execution;
      return {
        ...(replay as Omit<StructuredNodeRunnerResult<Output>, 'replayed'>),
        replayed: true,
      };
    }

    const execution = this.execute(request);
    this.effects.set(request.effectIdempotencyKey, {
      canonical,
      execution: execution as Promise<
        Omit<StructuredNodeRunnerResult<unknown>, 'replayed'>
      >,
    });
    const result = await execution;
    return { ...result, replayed: false };
  }

  private async execute<Output>(request: StructuredNodeRunnerRequest<Output>) {
    if (
      Boolean(this.options.billingTaskId) !==
      Boolean(this.options.billingQuoteRevision)
    ) {
      throw new Error(
        'Structured model billing task and quote revision must be supplied together.',
      );
    }
    let measurement: StructuredObjectMeasurement | undefined;
    const frozenRoute = this.options.frozenRouteSnapshot;
    const selection: RequestedSelection = frozenRoute
      ? {
          mode: 'fixed',
          catalogModelId: frozenRoute.actualCatalogModelId,
        }
      : structuredClone(this.options.selection!);
    const result = await this.options.application.executeStructuredObject(
      {
        workspaceId: this.options.workspaceId,
        actorId: this.options.actorId,
        correlationId: request.effectIdempotencyKey,
        idempotencyKey: request.effectIdempotencyKey,
        operation: 'text.respond',
        selection,
        dataClass: structuredClone(
          frozenRoute?.dataClass ?? this.options.dataClass ?? [],
        ),
        ...(this.options.billingTaskId && this.options.billingQuoteRevision
          ? {
              billingTaskId: this.options.billingTaskId,
              billingQuoteRevision: this.options.billingQuoteRevision,
            }
          : {}),
        prompt: request.prompt,
        promptRevision: request.schemaRevision,
        exampleSetRevision: request.schemaName,
        productUsageQuantity: 0,
        ...(frozenRoute
          ? { frozenRouteSnapshot: structuredClone(frozenRoute) }
          : {}),
      },
      {
        abortSignal: request.abortSignal,
        instructions: request.instructions,
        onPartialOutput: request.onPartialOutput,
        prompt: request.prompt,
        schema: request.schema,
        schemaName: request.schemaName,
      },
      measuredStructuredExecutor(
        providerAttemptFencedExecutor(
          this.options.executor,
          request.beforeProviderAttempt,
        ),
        (observed) => {
          measurement = observed;
        },
      ),
    );
    measurement = result.structuredMeasurement ?? measurement;
    if (result.status !== 'completed' || result.structuredOutput === undefined) {
      throw new StructuredNodeRunError(
        result.status === 'unknown' ? 'unknown' : 'failed',
        result.attempt.acceptance,
        measurement,
        result.attempts.length +
          Math.max(0, (measurement?.providerAttempts ?? 1) - 1),
        providerCostsToCnyCents(result.providerCosts),
      );
    }
    const output = request.schema.parse(result.structuredOutput);
    return {
      output,
      attempts:
        result.attempts.length +
        Math.max(0, (measurement?.providerAttempts ?? 1) - 1),
      observedCostCents: providerCostsToCnyCents(result.providerCosts),
      providerTaskRef: result.attempt.providerTaskRef ?? result.attempt.id,
      usage:
        result.structuredCumulativeUsage ??
        {
          inputTokens: result.providerCost.usage.inputTokens ?? 0,
          outputTokens: result.providerCost.usage.outputTokens ?? 0,
        },
      ...(measurement
        ? {
            firstPassSchemaValid: measurement.firstPassSchemaValid,
            repair: {
              count: measurement.repairCount,
              reasons: measurement.repairReasons,
            },
          }
        : {}),
    };
  }
}

function providerCostsToCnyCents(
  costs: readonly { amount: number; currency: 'CNY' | 'USD' }[],
) {
  let amountCny = 0;
  for (const cost of costs) {
    if (!Number.isFinite(cost.amount) || cost.amount < 0) {
      throw new Error('Observed provider cost must be a non-negative number.');
    }
    if (cost.currency !== 'CNY' && cost.amount !== 0) return undefined;
    amountCny += cost.amount;
  }
  const cents = Math.ceil(amountCny * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new Error('Observed provider cost exceeds the bounded integer range.');
  }
  return cents;
}

function measuredStructuredExecutor(
  executor: StructuredObjectExecutor,
  observe: (
    measurement: NonNullable<
      Awaited<ReturnType<StructuredObjectExecutor['generate']>>['measurement']
    >,
  ) => void,
): StructuredObjectExecutor {
  return {
    supportsCatalogModel(catalogModelId, providerRequest) {
      return executor.supportsCatalogModel(
        catalogModelId,
        providerRequest,
      );
    },
    async generate(input) {
      const result = await executor.generate(input);
      if (result.measurement) observe(result.measurement);
      return result;
    },
    providerCost(usage, providerRequest) {
      return executor.providerCost(usage, providerRequest);
    },
  };
}

function providerAttemptFencedExecutor(
  executor: StructuredObjectExecutor,
  beforeProviderAttempt?: () => Promise<void>,
): StructuredObjectExecutor {
  if (!beforeProviderAttempt) return executor;
  return {
    supportsCatalogModel(catalogModelId, providerRequest) {
      return executor.supportsCatalogModel(
        catalogModelId,
        providerRequest,
      );
    },
    async generate<Output>(input: {
      abortSignal?: AbortSignal;
      beforeProviderAttempt?: () => Promise<void>;
      instructions: string;
      onPartialOutput?: (partial: unknown) => Promise<void> | void;
      prompt: string;
      schema: ZodType<Output>;
      schemaName: string;
      structuredContinuation?: StructuredExecutionContinuation;
      structuredRequestFingerprint?: string;
    }) {
      await beforeProviderAttempt();
      return executor.generate({
        ...input,
        beforeProviderAttempt: input.structuredContinuation
          ? undefined
          : beforeProviderAttempt,
      });
    },
    providerCost(usage, providerRequest) {
      return executor.providerCost(usage, providerRequest);
    },
  };
}

export class AiSdkStructuredObjectExecutor
  implements StructuredObjectExecutor
{
  private readonly runner: OpenAiCompatibleAiSdkRunner;

  constructor(private readonly options: OpenAiCompatibleAiSdkOptions) {
    this.runner = new OpenAiCompatibleAiSdkRunner(options);
  }

  supportsCatalogModel(
    catalogModelId: string,
    providerRequest?: ProviderExecutionRequest,
  ) {
    if (providerRequest?.submission.frozenRouteSnapshot) {
      return (
        providerRequest.submission.frozenRouteSnapshot.actualCatalogModelId ===
          catalogModelId &&
        providerRequest.model.id === catalogModelId
      );
    }
    return this.runner.supportsCatalogModel(catalogModelId);
  }

  async generate<Output>(input: {
    abortSignal?: AbortSignal;
    beforeProviderAttempt?: () => Promise<void>;
    instructions: string;
    onPartialOutput?: (partial: unknown) => Promise<void> | void;
    prompt: string;
    providerRequest?: ProviderExecutionRequest;
    schema: ZodType<Output>;
    schemaName: string;
  }) {
    const { providerRequest, ...structuredInput } = input;
    const runner = providerRequest?.submission.frozenRouteSnapshot
      ? this.pinnedRunner(providerRequest)
      : this.runner;
    const generated = await runner.generateStructured({
      ...structuredInput,
      telemetryContext: providerRequest
        ? {
            actorId: providerRequest.submission.actorId,
            modality: providerRequest.model.modality,
            operation: providerRequest.submission.operation,
            taskId: providerRequest.submission.billingTaskId,
            workspaceId: providerRequest.submission.workspaceId,
          }
        : undefined,
    });
    const providerUsage =
      'providerUsage' in generated
        ? generated.providerUsage
        : undefined;
    return {
      ...generated,
      providerCost: runner.providerCost(
        providerUsage ?? generated.usage,
      ),
    };
  }

  providerCost(
    usage: { inputTokens: number; outputTokens: number },
    providerRequest?: ProviderExecutionRequest,
  ) {
    const runner = providerRequest?.submission.frozenRouteSnapshot
      ? this.pinnedRunner(providerRequest)
      : this.runner;
    return runner.providerCost(usage);
  }

  private pinnedRunner(request: ProviderExecutionRequest) {
    const route = request.submission.frozenRouteSnapshot;
    const binding = request.runtimeBinding;
    if (!route?.capabilityRevisionId) {
      throw new Error(
        'Pinned structured execution requires a capability revision.',
      );
    }
    if (
      request.deployment.id !== route.deploymentId ||
      request.model.id !== route.actualCatalogModelId ||
      request.routeSnapshot?.deploymentId !== route.deploymentId
    ) {
      throw new Error(
        'Pinned structured provider request conflicts with its frozen route.',
      );
    }
    if (
      !binding ||
      binding.deploymentId !== route.deploymentId ||
      binding.capabilityRevisionId !== route.capabilityRevisionId
    ) {
      throw new Error(
        'Pinned structured runtime binding conflicts with its frozen route.',
      );
    }
    if (
      binding.adapterKey !== 'direct-llm' ||
      !binding.adapterBindingRevision ||
      !binding.adapterConfig ||
      !binding.credential?.secret.trim()
    ) {
      throw new Error(
        'Pinned structured execution requires a published direct-llm adapter binding and credential.',
      );
    }
    if (
      binding.adapterConfig.providerModel !==
        request.deployment.providerModel ||
      binding.adapterConfig.endpointRevision !==
        request.deployment.endpointRevision
    ) {
      throw new Error(
        'Pinned structured adapter config conflicts with frozen deployment facts.',
      );
    }
    return openAiCompatibleRunnerForRequest(
      request,
      {
        ...this.options,
        catalogModelId: request.model.id,
      },
      this.runner,
    );
  }
}
