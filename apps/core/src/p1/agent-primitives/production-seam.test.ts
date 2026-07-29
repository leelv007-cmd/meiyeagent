import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentPrimitiveId } from '@meiye/contracts';

import { P1ApplicationService } from '../foundation/application-service.js';
import { P1DomainError, type P1Context } from '../foundation/domain.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import { ExecutionAttemptBudgetExceeded } from '../model-supply/execution-attempt-budget.js';
import {
  AgentPrimitiveExecutionError,
  AgentPrimitiveFoundationModule,
} from './foundation-module.js';
import { createCanonicalAgentPrimitiveRegistry } from './registry.js';
import {
  AgentPrimitiveRequestError,
  AgentPrimitiveRuntime,
  type AgentPrimitiveBindings,
  type AgentPrimitiveTraceEvent,
} from './runtime.js';

const observability = {
  axisScope: 'execution_child' as const,
  catalogRevision: { kind: 'bound' as const, value: 'catalog-2026-07-29' },
  promptVersion: { kind: 'bound' as const, value: 'marketing/copy@v4' },
  scene: { kind: 'bound' as const, value: 'copy.generate' },
  skillRevision: { kind: 'bound' as const, value: 'copywriter@rev-17' },
};

const worker: P1Context = {
  actor: 'worker',
  correlationId: 'correlation-worker',
  userId: 'worker-agent-primitives',
  workspaceId: 'workspace-agent-primitives',
};

const modelInputByPrimitive: Record<AgentPrimitiveId, Record<string, unknown>> = {
  ask_merchant: { question: 'Which offer should we feature?' },
  check: { target_ref: 'draft-1' },
  generate: { brief: {}, kind: 'copy' },
  read_context: { scope: 'store.current' },
  record: {
    kind: 'propose_preference',
    payload: {},
    provenance: { source: 'agent' },
  },
  revise: {
    instruction: 'Shorten the headline.',
    target_ref: 'draft-1',
  },
};

function createFixture(
  writeOwner: 'legacy' | 'frozen' | 'p1' = 'p1',
  handlerError?: unknown,
) {
  const repository = new MemoryFoundationRepository();
  repository.grantOwner(worker.workspaceId, 'owner-agent-primitives');
  repository.grantMembership(
    worker.workspaceId,
    'operator-agent-primitives',
    'operator',
  );
  const executions: AgentPrimitiveId[] = [];
  const traces: AgentPrimitiveTraceEvent[] = [];
  const handler =
    (primitiveId: AgentPrimitiveId) =>
    async (): Promise<Record<string, string>> => {
      executions.push(primitiveId);
      if (handlerError) throw handlerError;
      return { primitiveId };
    };
  const bindings: AgentPrimitiveBindings = {
    ask_merchant: handler('ask_merchant'),
    check: handler('check'),
    generate: handler('generate'),
    read_context: handler('read_context'),
    record: handler('record'),
    revise: handler('revise'),
  };
  const runtime = new AgentPrimitiveRuntime({
    bindings,
    registry: createCanonicalAgentPrimitiveRegistry(),
    tracePort: {
      async append(event) {
        traces.push(event);
      },
    },
  });
  const service = new P1ApplicationService(repository, {
    operations: [new AgentPrimitiveFoundationModule(runtime)],
    writeOwnershipReader: async () => writeOwner,
  });

  return { executions, repository, service, traces };
}

function command(primitiveId: AgentPrimitiveId) {
  return {
    action: 'execute',
    payload: {
      ...(primitiveId === 'generate' || primitiveId === 'revise'
        ? {
            billing: {
              productUsageTaskId: `usage-${primitiveId}`,
              quoteId: `quote-${primitiveId}`,
            },
            ...(primitiveId === 'generate' || primitiveId === 'revise'
              ? {
                  boundedExecution: {
                    schemaVersion: 'bounded-execution-snapshot/v1',
                    maxIterations: 2,
                    maxCostCents: 'unset',
                    maxWallClockMs: 'unset',
                    maxDelegations: 'unset',
                    requiredLimits: ['maxIterations'],
                    consumption: {
                      iterations: 0,
                      costCents: 0,
                      wallClockMs: 0,
                      delegations: 0,
                    },
                    stopReason: null,
                    triggeredLimit: null,
                  },
                }
              : {}),
          }
        : {}),
      modelInput: modelInputByPrimitive[primitiveId],
      observability,
      primitiveId,
      taskId: 'task-agent-primitives',
    },
  };
}

test('the production P1 seam default-denies browser and service roles while worker replay executes and audits once', async () => {
  const { executions, repository, service, traces } = createFixture();
  const forbiddenContexts: P1Context[] = [
    {
      actor: 'owner',
      correlationId: 'correlation-owner',
      userId: 'owner-agent-primitives',
      workspaceId: worker.workspaceId,
    },
    {
      actor: 'operator',
      correlationId: 'correlation-operator',
      userId: 'operator-agent-primitives',
      workspaceId: worker.workspaceId,
    },
    {
      actor: 'admin',
      correlationId: 'correlation-admin',
      userId: 'admin-agent-primitives',
      workspaceId: worker.workspaceId,
    },
    {
      actor: 'payment',
      correlationId: 'correlation-payment',
      userId: 'payment-agent-primitives',
      workspaceId: worker.workspaceId,
    },
  ];

  for (const context of forbiddenContexts) {
    await assert.rejects(
      service.executeModule(
        context,
        'agent-primitives',
        command('read_context'),
        `forbidden-${context.actor}`,
      ),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'FORBIDDEN',
    );
  }

  const first = await service.executeModule(
    worker,
    'agent-primitives',
    command('read_context'),
    'worker-read-context',
  );
  const replay = await service.executeModule(
    worker,
    'agent-primitives',
    command('read_context'),
    'worker-read-context',
  );

  assert.deepEqual(first, { primitiveId: 'read_context' });
  assert.deepEqual(replay, first);
  assert.deepEqual(executions, ['read_context']);
  assert.deepEqual(
    traces.map(({ phase, primitiveId }) => ({ phase, primitiveId })),
    [
      { phase: 'invoked', primitiveId: 'read_context' },
      { phase: 'succeeded', primitiveId: 'read_context' },
    ],
  );
  assert.deepEqual(
    (await repository.listCommandAudits(worker.workspaceId)).map(
      ({ actorId, idempotencyKey }) => ({ actorId, idempotencyKey }),
    ),
    [
      {
        actorId: worker.userId,
        idempotencyKey: 'worker-read-context',
      },
    ],
  );
});

test('invalid model input releases the P1 claim for deterministic same-key retry', async () => {
  const { executions, repository, service, traces } = createFixture();
  const invalid = command('read_context');
  invalid.payload.modelInput = {
    scope: 'store.current',
    workspaceId: 'forged-workspace',
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      service.executeModule(
        worker,
        'agent-primitives',
        invalid,
        'worker-invalid-read-context',
      ),
      (error: unknown) => error instanceof AgentPrimitiveRequestError,
    );
  }

  assert.deepEqual(executions, []);
  assert.deepEqual(
    traces.map(({ phase }) => phase),
    ['rejected', 'rejected'],
  );
  assert.deepEqual(
    await repository.listCommandAudits(worker.workspaceId),
    [],
  );
});

test('a handler 4xx after dispatch keeps the P1 claim and cannot execute twice', async () => {
  const handlerError = Object.assign(
    new Error('Provider rejected after accepting the request.'),
    { status: 400 },
  );
  const { executions, repository, service, traces } = createFixture(
    'p1',
    handlerError,
  );

  await assert.rejects(
    service.executeModule(
      worker,
      'agent-primitives',
      command('read_context'),
      'worker-uncertain-read-context',
    ),
    (error: unknown) =>
      error instanceof AgentPrimitiveExecutionError &&
      error.cause === handlerError,
  );
  await assert.rejects(
    service.executeModule(
      worker,
      'agent-primitives',
      command('read_context'),
      'worker-uncertain-read-context',
    ),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'INVALID_STATE' &&
      /still in progress/u.test(error.message),
  );

  assert.deepEqual(executions, ['read_context']);
  assert.deepEqual(
    traces.map(({ phase }) => phase),
    ['invoked', 'rejected'],
  );
  assert.deepEqual(
    await repository.listCommandAudits(worker.workspaceId),
    [],
  );
});

test('a typed request error after dispatch cannot release the P1 claim', async () => {
  const handlerError = new AgentPrimitiveRequestError(
    'The handler rejected after dispatch.',
  );
  const { executions, service, traces } = createFixture('p1', handlerError);
  const idempotencyKey = 'worker-dispatched-request-error';

  await assert.rejects(
    service.executeModule(
      worker,
      'agent-primitives',
      command('read_context'),
      idempotencyKey,
    ),
    (error: unknown) => error instanceof AgentPrimitiveExecutionError,
  );
  await assert.rejects(
    service.executeModule(
      worker,
      'agent-primitives',
      command('read_context'),
      idempotencyKey,
    ),
    (error: unknown) =>
      error instanceof P1DomainError &&
      error.code === 'INVALID_STATE' &&
      /still in progress/u.test(error.message),
  );
  assert.deepEqual(executions, ['read_context']);
  assert.deepEqual(
    traces.map(({ phase }) => phase),
    ['invoked', 'rejected'],
  );
});

test('exhausted billed primitive budgets release the P1 claim before dispatch', async () => {
  for (const primitiveId of ['generate', 'revise'] as const) {
    const { executions, repository, service, traces } = createFixture();
    const exhausted = command(primitiveId);
    const boundedExecution = exhausted.payload.boundedExecution as {
      maxIterations: number;
      consumption: { iterations: number };
    };
    boundedExecution.maxIterations = 1;
    boundedExecution.consumption.iterations = 1;
    const idempotencyKey = `worker-${primitiveId}-budget`;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(
        service.executeModule(
          worker,
          'agent-primitives',
          exhausted,
          idempotencyKey,
        ),
        (error: unknown) =>
          error instanceof ExecutionAttemptBudgetExceeded &&
          error.maxAttempts === 1 &&
          error.consumedAttempts === 1,
      );
    }
    assert.deepEqual(executions, []);
    assert.deepEqual(
      traces.map(({ phase }) => phase),
      ['rejected', 'rejected'],
    );
    assert.deepEqual(
      await repository.listCommandAudits(worker.workspaceId),
      [],
    );
  }
});

test('the P1 cutover gate blocks only generating and bounded-write primitives before runtime dispatch', async () => {
  for (const testCase of [
    {
      expectedCode: 'COMMANDS_FROZEN',
      primitiveId: 'generate',
      writeOwner: 'frozen',
    },
    {
      expectedCode: 'P1_WRITE_DISABLED',
      primitiveId: 'revise',
      writeOwner: 'legacy',
    },
    {
      expectedCode: 'COMMANDS_FROZEN',
      primitiveId: 'record',
      writeOwner: 'frozen',
    },
  ] as const) {
    const { executions, repository, service, traces } = createFixture(
      testCase.writeOwner,
    );

    await assert.rejects(
      service.executeModule(
        worker,
        'agent-primitives',
        command(testCase.primitiveId),
        `blocked-${testCase.primitiveId}`,
      ),
      (error: unknown) =>
        error instanceof P1DomainError &&
        error.code === testCase.expectedCode,
    );

    assert.deepEqual(executions, []);
    assert.deepEqual(traces, []);
    assert.deepEqual(
      await repository.listCommandAudits(worker.workspaceId),
      [],
    );
  }
});

test('read, deterministic check, and merchant question primitives remain reachable during freeze and legacy ownership', async () => {
  for (const primitiveId of [
    'read_context',
    'check',
    'ask_merchant',
  ] as const) {
    for (const writeOwner of ['frozen', 'legacy'] as const) {
      const { executions, service, traces } = createFixture(writeOwner);

      assert.deepEqual(
        await service.executeModule(
          worker,
          'agent-primitives',
          command(primitiveId),
          `allowed-${writeOwner}-${primitiveId}`,
        ),
        { primitiveId },
      );
      assert.deepEqual(executions, [primitiveId]);
      assert.deepEqual(
        traces.map(({ phase }) => phase),
        ['invoked', 'succeeded'],
      );
    }
  }
});
