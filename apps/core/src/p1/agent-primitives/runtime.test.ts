import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCanonicalAgentPrimitiveRegistry,
} from './registry.js';
import {
  AgentPrimitiveRequestError,
  AgentPrimitiveRuntime,
  type AgentPrimitiveBindings,
  type AgentPrimitiveServerContext,
  type AgentPrimitiveTraceEvent,
  type AgentPrimitiveTracePort,
} from './runtime.js';

const tracePort: AgentPrimitiveTracePort = {
  async append() {},
};

function completeBindings(): AgentPrimitiveBindings {
  return {
    async read_context() {
      return { facts: [] };
    },
    async generate() {
      return { artifactRef: 'artifact-1' };
    },
    async revise() {
      return { revisionRef: 'revision-2' };
    },
    async record() {
      return { proposalRef: 'proposal-1' };
    },
    async check() {
      return { decision: 'allow' };
    },
    async ask_merchant() {
      return { questionRef: 'question-1' };
    },
  };
}

const serverContext: AgentPrimitiveServerContext = {
  actorId: 'worker-agent-primitives',
  correlationId: 'correlation-1',
  idempotencyKey: 'primitive-call-1',
  observability: {
    catalogRevision: 'catalog-2026-07-29',
    promptVersion: 'marketing/copy@v4',
    scene: 'copy.generate',
    skillRevision: 'copywriter@rev-17',
  },
  workspaceId: 'workspace-1',
};

test('construction fails closed when any canonical primitive has no binding', () => {
  const { revise: _missing, ...incomplete } = completeBindings();

  assert.throws(
    () =>
      new AgentPrimitiveRuntime({
        bindings: incomplete,
        registry: createCanonicalAgentPrimitiveRegistry(),
        tracePort,
      }),
    /Agent primitive handler is not bound: revise/u,
  );
});

test('construction snapshots bindings so later caller mutation cannot bypass completeness', async () => {
  const bindings = completeBindings();
  const runtime = new AgentPrimitiveRuntime({
    bindings,
    registry: createCanonicalAgentPrimitiveRegistry(),
    tracePort,
  });
  (bindings as Partial<AgentPrimitiveBindings>).read_context = undefined;

  assert.deepEqual(
    await runtime.execute({
      modelInput: { scope: 'store.current' },
      primitiveId: 'read_context',
      serverContext,
    }),
    { facts: [] },
  );
});

test('execute parses model input, injects the independent server context, and traces success', async () => {
  const events: AgentPrimitiveTraceEvent[] = [];
  let received: unknown;
  const bindings = completeBindings();
  bindings.read_context = async (args) => {
    received = args;
    return { facts: ['fact-1'] };
  };
  const runtime = new AgentPrimitiveRuntime({
    bindings,
    registry: createCanonicalAgentPrimitiveRegistry(),
    tracePort: {
      async append(event) {
        events.push(event);
      },
    },
  });

  const result = await runtime.execute({
    modelInput: { scope: '  store.current  ' },
    primitiveId: 'read_context',
    serverContext,
  });

  assert.deepEqual(result, { facts: ['fact-1'] });
  assert.deepEqual(received, {
    input: { scope: 'store.current' },
    serverContext,
  });
  assert.deepEqual(
    events.map(({ phase, primitiveId }) => ({ phase, primitiveId })),
    [
      { phase: 'invoked', primitiveId: 'read_context' },
      { phase: 'succeeded', primitiveId: 'read_context' },
    ],
  );
  assert.notEqual(events[0]?.serverContext, serverContext);
  assert.deepEqual(events[0]?.serverContext, serverContext);
  assert.equal(events[1]?.serverContext, events[0]?.serverContext);
});

test('server-owned identity is snapshotted and frozen before handler dispatch', async () => {
  let received: AgentPrimitiveServerContext | undefined;
  const bindings = completeBindings();
  bindings.read_context = async ({ serverContext: context }) => {
    received = context;
    assert.throws(() => {
      (context as { workspaceId: string }).workspaceId = 'mutated-workspace';
    }, TypeError);
    assert.throws(() => {
      (
        context.observability as {
          scene: string;
        }
      ).scene = 'mutated-scene';
    }, TypeError);
    return {};
  };
  const runtime = new AgentPrimitiveRuntime({
    bindings,
    registry: createCanonicalAgentPrimitiveRegistry(),
    tracePort,
  });

  await runtime.execute({
    modelInput: { scope: 'store.current' },
    primitiveId: 'read_context',
    serverContext,
  });

  assert.notEqual(received, serverContext);
  assert.equal(received?.workspaceId, 'workspace-1');
  assert.equal(received?.observability.scene, 'copy.generate');
});

test('billed primitives require server-owned billing context before tracing or handler execution', async () => {
  for (const primitiveId of ['generate', 'revise'] as const) {
    const events: AgentPrimitiveTraceEvent[] = [];
    let executions = 0;
    const bindings = completeBindings();
    bindings[primitiveId] = async () => {
      executions += 1;
      return {};
    };
    const runtime = new AgentPrimitiveRuntime({
      bindings,
      registry: createCanonicalAgentPrimitiveRegistry(),
      tracePort: {
        async append(event) {
          events.push(event);
        },
      },
    });

    await assert.rejects(
      runtime.execute({
        modelInput:
          primitiveId === 'generate'
            ? { brief: {}, kind: 'copy' }
            : { instruction: 'Shorten it.', target_ref: 'draft-1' },
        primitiveId,
        serverContext,
      }),
      (error: unknown) =>
        error instanceof AgentPrimitiveRequestError &&
        error.status === 400 &&
        error.message ===
          `Billed agent primitive requires billing context: ${primitiveId}`,
    );
    assert.equal(executions, 0);
    assert.deepEqual(
      events.map(({ phase }) => phase),
      ['rejected'],
    );
  }
});

test('model payload cannot forge tenant, billing, idempotency, or observability context', async () => {
  for (const field of [
    'workspaceId',
    'actorId',
    'productUsageTaskId',
    'quoteId',
    'idempotencyKey',
    'observability',
  ]) {
    const events: AgentPrimitiveTraceEvent[] = [];
    let executions = 0;
    const bindings = completeBindings();
    bindings.read_context = async () => {
      executions += 1;
      return {};
    };
    const runtime = new AgentPrimitiveRuntime({
      bindings,
      registry: createCanonicalAgentPrimitiveRegistry(),
      tracePort: {
        async append(event) {
          events.push(event);
        },
      },
    });

    await assert.rejects(
      runtime.execute({
        modelInput: { [field]: `forged-${field}`, scope: 'store.current' },
        primitiveId: 'read_context',
        serverContext,
      }),
    );
    assert.equal(executions, 0);
    assert.deepEqual(
      events.map(({ phase }) => phase),
      ['rejected'],
    );
  }
});

test('unknown and merchant-only identifiers are rejected and traced before any handler', async () => {
  for (const primitiveId of ['unknown_tool', 'confirm_publish']) {
    const events: AgentPrimitiveTraceEvent[] = [];
    let executions = 0;
    const bindings = completeBindings();
    bindings.read_context = async () => {
      executions += 1;
      return {};
    };
    const runtime = new AgentPrimitiveRuntime({
      bindings,
      registry: createCanonicalAgentPrimitiveRegistry(),
      tracePort: {
        async append(event) {
          events.push(event);
        },
      },
    });

    await assert.rejects(
      runtime.execute({
        modelInput: {},
        primitiveId: primitiveId as 'read_context',
        serverContext,
      }),
      (error: unknown) =>
        error instanceof AgentPrimitiveRequestError &&
        error.status === 400 &&
        error.message === `Agent primitive is not registered: ${primitiveId}`,
    );
    assert.equal(executions, 0);
    assert.deepEqual(
      events.map(({ phase }) => phase),
      ['rejected'],
    );
  }
});

test('a handler failure is traced after invocation and preserves the original error', async () => {
  const events: AgentPrimitiveTraceEvent[] = [];
  const expected = new Error('read context unavailable');
  const bindings = completeBindings();
  bindings.read_context = async () => {
    throw expected;
  };
  const runtime = new AgentPrimitiveRuntime({
    bindings,
    registry: createCanonicalAgentPrimitiveRegistry(),
    tracePort: {
      async append(event) {
        events.push(event);
      },
    },
  });

  await assert.rejects(
    runtime.execute({
      modelInput: { scope: 'store.current' },
      primitiveId: 'read_context',
      serverContext,
    }),
    expected,
  );
  assert.deepEqual(
    events.map(({ error, phase }) => ({ error, phase })),
    [
      { error: undefined, phase: 'invoked' },
      { error: expected.message, phase: 'rejected' },
    ],
  );
});

test('non-billed primitives remain callable without quote context', async () => {
  const runtime = new AgentPrimitiveRuntime({
    bindings: completeBindings(),
    registry: createCanonicalAgentPrimitiveRegistry(),
    tracePort,
  });

  for (const execution of [
    runtime.execute({
      modelInput: { scope: 'store.current' },
      primitiveId: 'read_context',
      serverContext,
    }),
    runtime.execute({
      modelInput: {
        kind: 'propose_preference',
        payload: {},
        provenance: {},
      },
      primitiveId: 'record',
      serverContext,
    }),
    runtime.execute({
      modelInput: { target_ref: 'draft-1' },
      primitiveId: 'check',
      serverContext,
    }),
    runtime.execute({
      modelInput: { question: 'Which offer should lead?' },
      primitiveId: 'ask_merchant',
      serverContext,
    }),
  ]) {
    await assert.doesNotReject(execution);
  }
});

test('billed primitive handlers receive billing context only from the server envelope', async () => {
  let received: unknown;
  const bindings = completeBindings();
  bindings.generate = async (args) => {
    received = args.serverContext.billing;
    return { artifactRef: 'artifact-1' };
  };
  const runtime = new AgentPrimitiveRuntime({
    bindings,
    registry: createCanonicalAgentPrimitiveRegistry(),
    tracePort,
  });
  const billing = {
    productUsageTaskId: 'usage-task-1',
    quoteId: 'quote-1',
  };

  await runtime.execute({
    modelInput: { brief: {}, kind: 'copy' },
    primitiveId: 'generate',
    serverContext: { ...serverContext, billing },
  });

  assert.notEqual(received, billing);
  assert.deepEqual(received, billing);
});
