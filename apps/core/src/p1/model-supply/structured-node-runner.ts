import type { ZodType } from 'zod';

import {
  ModelSupplyApplicationService,
  type Acceptance,
  type DataClass,
  type RequestedSelection,
  type StructuredObjectExecutor,
} from './index.js';
import {
  OpenAiCompatibleAiSdkRunner,
  type OpenAiCompatibleAiSdkOptions,
} from './ai-sdk-runner.js';

export type { StructuredObjectExecutor } from './index.js';

export interface StructuredNodeRunnerRequest<Output> {
  effectIdempotencyKey: string;
  instructions: string;
  prompt: string;
  schema: ZodType<Output>;
  schemaName: string;
  schemaRevision: string;
  abortSignal?: AbortSignal;
  onPartialOutput?: (partial: unknown) => Promise<void> | void;
}
export interface StructuredNodeRunnerResult<Output> {
  output: Output;
  attempts: number;
  providerTaskRef: string;
  replayed: boolean;
  usage: { inputTokens: number; outputTokens: number };
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
      selection: RequestedSelection;
      dataClass?: DataClass[];
      productUsageQuantity?: 0 | 1;
    },
  ) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    const canonical = JSON.stringify({
      instructions: request.instructions,
      prompt: request.prompt,
      schemaName: request.schemaName,
      schemaRevision: request.schemaRevision,
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
    const result = await this.options.application.executeStructuredObject(
      {
        workspaceId: this.options.workspaceId,
        actorId: this.options.actorId,
        correlationId: request.effectIdempotencyKey,
        idempotencyKey: request.effectIdempotencyKey,
        operation: 'text.respond',
        selection: structuredClone(this.options.selection),
        dataClass: structuredClone(this.options.dataClass ?? []),
        prompt: request.prompt,
        promptRevision: request.schemaRevision,
        exampleSetRevision: request.schemaName,
        productUsageQuantity: this.options.productUsageQuantity ?? 1,
      },
      {
        abortSignal: request.abortSignal,
        instructions: request.instructions,
        onPartialOutput: request.onPartialOutput,
        prompt: request.prompt,
        schema: request.schema,
        schemaName: request.schemaName,
      },
      this.options.executor,
    );
    if (result.status !== 'completed' || result.structuredOutput === undefined) {
      throw new StructuredNodeRunError(
        result.status === 'unknown' ? 'unknown' : 'failed',
        result.attempt.acceptance,
      );
    }
    const output = request.schema.parse(result.structuredOutput);
    return {
      output,
      attempts: result.attempts.length,
      providerTaskRef: result.attempt.providerTaskRef ?? result.attempt.id,
      usage: {
        inputTokens: result.providerCost.usage.inputTokens ?? 0,
        outputTokens: result.providerCost.usage.outputTokens ?? 0,
      },
    };
  }
}

export class AiSdkStructuredObjectExecutor
  implements StructuredObjectExecutor
{
  private readonly runner: OpenAiCompatibleAiSdkRunner;

  constructor(options: OpenAiCompatibleAiSdkOptions) {
    this.runner = new OpenAiCompatibleAiSdkRunner(options);
  }

  supportsCatalogModel(catalogModelId: string) {
    return this.runner.supportsCatalogModel(catalogModelId);
  }

  generate<Output>(input: {
    abortSignal?: AbortSignal;
    instructions: string;
    onPartialOutput?: (partial: unknown) => Promise<void> | void;
    prompt: string;
    schema: ZodType<Output>;
    schemaName: string;
  }) {
    return this.runner.generateStructured(input);
  }

  providerCost(usage: { inputTokens: number; outputTokens: number }) {
    return this.runner.providerCost(usage);
  }
}
