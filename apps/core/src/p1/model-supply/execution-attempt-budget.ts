import type { StructuredNodeRunner } from './structured-node-runner.js';

export class ExecutionAttemptBudgetExceeded extends Error {
  readonly code = 'EXECUTION_ATTEMPT_BUDGET_EXCEEDED';
  readonly status = 409;

  constructor(
    readonly maxAttempts: number,
    readonly consumedAttempts: number,
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
      input.maxAttempts < 1 ||
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
          budget.consume();
        },
      });
      return {
        ...result,
        attempts: budget.consumedAttempts - consumedBefore,
      };
    },
  };
}
