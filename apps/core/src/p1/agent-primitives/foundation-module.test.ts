import assert from 'node:assert/strict';
import test from 'node:test';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { FoundationStore } from '../foundation/ports.js';
import {
  AgentPrimitiveFoundationModule,
  type AgentPrimitiveExecutionPort,
} from './foundation-module.js';
import { createCanonicalAgentPrimitiveRegistry } from './registry.js';
import {
  AgentPrimitiveRequestError,
  AgentPrimitiveRuntime,
  type AgentPrimitiveBindings,
  type AgentPrimitiveExecutionRequest,
  type AgentPrimitiveTraceEvent,
} from './runtime.js';

const workerContext: P1Context = {
  actor: 'worker',
  correlationId: 'correlation-1',
  userId: 'worker-agent-primitives',
  workspaceId: 'workspace-1',
};

const observability = {
  catalogRevision: 'catalog-2026-07-29',
  promptVersion: 'marketing/copy@v4',
  scene: 'copy.generate',
  skillRevision: 'copywriter@rev-17',
};

function fixture() {
  const calls: AgentPrimitiveExecutionRequest[] = [];
  const runtime: AgentPrimitiveExecutionPort = {
    async execute(input) {
      calls.push(input);
      return { facts: ['fact-1'] };
    },
  };
  return {
    calls,
    module: new AgentPrimitiveFoundationModule(runtime),
  };
}

test('worker execution keeps model input separate from server-owned identity and observability context', async () => {
  const { calls, module } = fixture();

  const result = await module.execute({
    context: workerContext,
    idempotencyKey: 'primitive-call-1',
    input: {
      action: 'execute',
      payload: {
        billing: {
          productUsageTaskId: 'usage-task-1',
          quoteId: 'quote-1',
        },
        modelInput: {
          scope: 'store.current',
          workspaceId: 'forged-workspace',
        },
        observability,
        primitiveId: 'read_context',
      },
    },
    store: {} as FoundationStore,
  });

  assert.deepEqual(result, { facts: ['fact-1'] });
  assert.deepEqual(calls, [
    {
      modelInput: {
        scope: 'store.current',
        workspaceId: 'forged-workspace',
      },
      primitiveId: 'read_context',
      serverContext: {
        actorId: workerContext.userId,
        billing: {
          productUsageTaskId: 'usage-task-1',
          quoteId: 'quote-1',
        },
        correlationId: workerContext.correlationId,
        idempotencyKey: 'primitive-call-1',
        observability,
        workspaceId: workerContext.workspaceId,
      },
    },
  ]);
  assert.equal(module.name, 'agent-primitives');
});

test('the module rejects every non-worker context before runtime dispatch', async () => {
  for (const actor of [
    undefined,
    'owner',
    'operator',
    'reviewer',
    'admin',
    'payment',
  ] as const) {
    const { calls, module } = fixture();

    await assert.rejects(
      module.execute({
        context: { ...workerContext, actor },
        idempotencyKey: 'primitive-call-forbidden',
        input: {
          action: 'execute',
          payload: {
            modelInput: { scope: 'store.current' },
            observability,
            primitiveId: 'read_context',
          },
        },
        store: {} as FoundationStore,
      }),
      (error: unknown) =>
        error instanceof P1DomainError && error.code === 'FORBIDDEN',
    );
    assert.equal(calls.length, 0);
  }
});

test('invalid server envelope is a retry-safe request rejection', async () => {
  const { calls, module } = fixture();

  await assert.rejects(
    module.execute({
      context: workerContext,
      idempotencyKey: 'primitive-call-invalid-envelope',
      input: {
        action: 'execute',
        payload: {
          modelInput: { scope: 'store.current' },
          observability: { ...observability, scene: '' },
          primitiveId: 'read_context',
        },
      },
      store: {} as FoundationStore,
    }),
    (error: unknown) =>
      error instanceof AgentPrimitiveRequestError && error.status === 400,
  );
  assert.deepEqual(calls, []);
});

test('the production module seam rejects forged model identity through the real runtime and traces it', async () => {
  const events: AgentPrimitiveTraceEvent[] = [];
  let executions = 0;
  const inert = async () => ({});
  const bindings: AgentPrimitiveBindings = {
    ask_merchant: inert,
    check: inert,
    generate: inert,
    read_context: async () => {
      executions += 1;
      return {};
    },
    record: inert,
    revise: inert,
  };
  const module = new AgentPrimitiveFoundationModule(
    new AgentPrimitiveRuntime({
      bindings,
      registry: createCanonicalAgentPrimitiveRegistry(),
      tracePort: {
        async append(event) {
          events.push(event);
        },
      },
    }),
  );

  await assert.rejects(
    module.execute({
      context: workerContext,
      idempotencyKey: 'primitive-call-forged',
      input: {
        action: 'execute',
        payload: {
          modelInput: {
            quoteId: 'forged-quote',
            scope: 'store.current',
            workspaceId: 'forged-workspace',
          },
          observability,
          primitiveId: 'read_context',
        },
      },
      store: {} as FoundationStore,
    }),
  );
  assert.equal(executions, 0);
  assert.deepEqual(
    events.map(({ phase, serverContext }) => ({
      correlationId: serverContext.correlationId,
      phase,
    })),
    [{ correlationId: workerContext.correlationId, phase: 'rejected' }],
  );
});
