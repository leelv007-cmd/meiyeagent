import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import {
  ExecutionAttemptBudget,
  ExecutionAttemptBudgetExceeded,
  withExecutionAttemptBudget,
} from './execution-attempt-budget.js';
import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
} from './structured-node-runner.js';

test('one execution attempt budget governs every physical provider callback', async () => {
  const runner = new PhysicalAttemptRunner(3);
  const budget = new ExecutionAttemptBudget({
    maxAttempts: 2,
    consumedAttempts: 0,
  });
  const bounded = withExecutionAttemptBudget(runner, budget);

  await assert.rejects(
    bounded.run({
      effectIdempotencyKey: 'effect-1',
      instructions: 'Return the object.',
      prompt: '{}',
      schema: z.object({ ok: z.boolean() }),
      schemaName: 'attempt_budget_test',
      schemaRevision: 'v1',
    }),
    (error: unknown) => {
      assert.ok(error instanceof ExecutionAttemptBudgetExceeded);
      assert.equal(error.maxAttempts, 2);
      assert.equal(error.consumedAttempts, 2);
      return true;
    },
  );

  assert.equal(runner.physicalAttempts, 2);
  assert.equal(budget.consumedAttempts, 2);
});

test('the shared budget composes the existing source fence once per physical attempt', async () => {
  const runner = new PhysicalAttemptRunner(1);
  const budget = new ExecutionAttemptBudget({
    maxAttempts: 1,
    consumedAttempts: 0,
  });
  let fences = 0;

  await withExecutionAttemptBudget(runner, budget).run({
    effectIdempotencyKey: 'effect-2',
    instructions: 'Return the object.',
    prompt: '{}',
    schema: z.object({ ok: z.boolean() }),
    schemaName: 'attempt_budget_test',
    schemaRevision: 'v1',
    async beforeProviderAttempt() {
      fences += 1;
    },
  });

  assert.equal(runner.physicalAttempts, 1);
  assert.equal(budget.consumedAttempts, 1);
  assert.equal(fences, 1);
});

test('the shared budget reports callback consumption instead of a runner estimate', async () => {
  const runner = new PhysicalAttemptRunner(1, 99);
  const budget = new ExecutionAttemptBudget({
    maxAttempts: 3,
    consumedAttempts: 1,
  });

  const result = await withExecutionAttemptBudget(runner, budget).run({
    effectIdempotencyKey: 'effect-3',
    instructions: 'Return the object.',
    prompt: '{}',
    schema: z.object({ ok: z.boolean() }),
    schemaName: 'attempt_budget_test',
    schemaRevision: 'v1',
  });

  assert.equal(result.attempts, 1);
  assert.equal(budget.consumedAttempts, 2);
});

class PhysicalAttemptRunner implements StructuredNodeRunner {
  physicalAttempts = 0;

  constructor(
    private readonly requestedAttempts: number,
    private readonly reportedAttempts?: number,
  ) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    for (let attempt = 0; attempt < this.requestedAttempts; attempt += 1) {
      await request.beforeProviderAttempt?.();
      this.physicalAttempts += 1;
    }
    return {
      output: request.schema.parse({ ok: true }),
      attempts: this.reportedAttempts ?? this.physicalAttempts,
      providerTaskRef: 'provider-attempt-budget',
      replayed: false,
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
}
