import { z } from 'zod';
import type { StructuredNodeRunner } from './structured-node-runner.js';

export const structuredExecutionContinuationSchema = z
  .object({
    kind: z.literal('schema_repair'),
    // Provider invalid-output text only. Prompts, instructions and credentials
    // are never copied into this bounded durable continuation.
    invalidText: z.string().max(8_000),
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

export function parseRecoveredStructuredExecutionContinuation(input: unknown) {
  const parsed = structuredExecutionContinuationSchema.safeParse(input);
  if (!parsed.success) {
    throw new TypeError(
      'Recovered structured execution continuation is invalid.',
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
