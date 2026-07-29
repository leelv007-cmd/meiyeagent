import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { StructuredNodeRunner } from './structured-node-runner.js';

export const structuredExecutionRequestFingerprintSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/u);

export const structuredExecutionContinuationSchema = z
  .object({
    kind: z.literal('schema_repair'),
    requestFingerprint: structuredExecutionRequestFingerprintSchema,
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        outputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      })
      .strict(),
  })
  .strict();

export type StructuredExecutionContinuation = z.infer<
  typeof structuredExecutionContinuationSchema
>;

export interface ObservedExecutionProviderCost {
  amount: number;
  currency: 'CNY' | 'USD';
  usage: { inputTokens: number; outputTokens: number };
}

export function parseRecoveredStructuredExecutionContinuation(input: unknown) {
  const parsed = structuredExecutionContinuationSchema.safeParse(input);
  if (!parsed.success) {
    throw new TypeError(
      'Recovered structured execution continuation is invalid.',
    );
  }
  return parsed.data;
}

export function structuredExecutionRequestFingerprint(input: {
  actorId: string;
  dataClass: unknown;
  instructions: string;
  operation: string;
  prompt: string;
  schema: unknown;
  schemaName: string;
  schemaRevision: string;
  selection: unknown;
  streaming: boolean;
  workspaceId: string;
}) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        actorId: input.actorId,
        dataClass: input.dataClass,
        instructions: input.instructions,
        operation: input.operation,
        prompt: input.prompt,
        schema: input.schema,
        schemaName: input.schemaName,
        schemaRevision: input.schemaRevision,
        selection: input.selection,
        streaming: input.streaming,
        workspaceId: input.workspaceId,
      }),
    )
    .digest('hex');
}

export function parseRecoveredStructuredExecutionRequestFingerprint(
  input: unknown,
) {
  const parsed = structuredExecutionRequestFingerprintSchema.safeParse(input);
  if (!parsed.success) {
    throw new TypeError(
      'Recovered attempt-budget request fingerprint is invalid.',
    );
  }
  return parsed.data;
}

export class ExecutionAttemptBudgetExceeded extends Error {
  readonly code = 'EXECUTION_ATTEMPT_BUDGET_EXCEEDED';
  readonly status = 409;

  constructor(
    readonly maxAttempts: number,
    readonly consumedAttempts: number,
    readonly completedAttemptsInRun?: number,
    readonly structuredContinuation?: StructuredExecutionContinuation,
    readonly observedProviderCost?: ObservedExecutionProviderCost,
  ) {
    super(
      `Execution attempt budget exhausted after ${consumedAttempts} of ${maxAttempts} attempts.`,
    );
    this.name = 'ExecutionAttemptBudgetExceeded';
  }
}

export class ExecutionAttemptBudget {
  readonly maxAttempts: number;
  private consumed: number;

  constructor(input: {
    maxAttempts: number;
    consumedAttempts: number;
  }) {
    if (
      !Number.isSafeInteger(input.maxAttempts) ||
      input.maxAttempts < 0 ||
      !Number.isSafeInteger(input.consumedAttempts) ||
      input.consumedAttempts < 0 ||
      input.consumedAttempts > input.maxAttempts
    ) {
      throw new TypeError('Execution attempt budget is invalid.');
    }
    this.maxAttempts = input.maxAttempts;
    this.consumed = input.consumedAttempts;
  }

  get consumedAttempts() {
    return this.consumed;
  }

  consume() {
    if (this.consumed >= this.maxAttempts) {
      throw new ExecutionAttemptBudgetExceeded(
        this.maxAttempts,
        this.consumed,
      );
    }
    this.consumed += 1;
  }
}

export function withExecutionAttemptBudget(
  runner: StructuredNodeRunner,
  budget: ExecutionAttemptBudget,
): StructuredNodeRunner {
  return {
    async run(request) {
      const beforeProviderAttempt = request.beforeProviderAttempt;
      const consumedBefore = budget.consumedAttempts;
      const result = await runner.run({
        ...request,
        async beforeProviderAttempt() {
          await beforeProviderAttempt?.();
          try {
            budget.consume();
          } catch (error) {
            if (error instanceof ExecutionAttemptBudgetExceeded) {
              throw new ExecutionAttemptBudgetExceeded(
                error.maxAttempts,
                error.consumedAttempts,
                budget.consumedAttempts - consumedBefore,
                error.structuredContinuation,
                error.observedProviderCost,
              );
            }
            throw error;
          }
        },
      });
      return {
        ...result,
        attempts: budget.consumedAttempts - consumedBefore,
      };
    },
  };
}
