import assert from 'node:assert/strict';
import test from 'node:test';

import type { BoundedExecutionSnapshot } from '@meiye/contracts';

import type { AgentPrimitiveServerContext } from './runtime.js';
import {
  createGenerateHandler,
  createReadContextHandler,
  createRecordHandler,
  createReviseHandler,
  type GeneratePort,
  type ReadContextPort,
  type RecordProposalPort,
  type RevisePort,
  type ReviseTargetResolverPort,
} from './core-handlers.js';

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

const boundedExecution: BoundedExecutionSnapshot = {
  schemaVersion: 'bounded-execution-snapshot/v1',
  maxIterations: 3,
  maxCostCents: 'unset',
  maxWallClockMs: 'unset',
  maxDelegations: 'unset',
  requiredLimits: ['maxIterations'],
  consumption: {
    iterations: 2,
    costCents: 0,
    wallClockMs: 0,
    delegations: 0,
  },
  stopReason: null,
  triggeredLimit: null,
};

test('read_context preserves the bounded query and injects the server-owned workspace', async () => {
  let received: unknown;
  const port: ReadContextPort = {
    async read(input) {
      received = input;
      return { facts: ['fact-1'], nextOffset: 12 };
    },
  };

  const result = await createReadContextHandler(port)({
    input: {
      scope: 'store.current',
      query: { limit: 5, offset: 7, text: 'summer offer' },
    },
    serverContext,
  });

  assert.deepEqual(received, {
    query: { limit: 5, offset: 7, text: 'summer offer' },
    scope: 'store.current',
    workspaceId: 'workspace-1',
  });
  assert.deepEqual(result, { facts: ['fact-1'], nextOffset: 12 });
});

test('generate keeps parsing and extraction kinds open and injects server billing and tenant', async () => {
  const received: unknown[] = [];
  const port: GeneratePort = {
    async generate(input) {
      received.push(input);
      return { artifactRef: `artifact-${input.kind}` };
    },
  };
  const handler = createGenerateHandler(port);
  const billing = {
    productUsageTaskId: 'usage-task-1',
    quoteId: 'quote-1',
  };

  assert.deepEqual(
    await handler({
      input: { brief: { sourceRef: 'upload-1' }, kind: 'parsing' },
      serverContext: { ...serverContext, billing, boundedExecution },
    }),
    { artifactRef: 'artifact-parsing' },
  );
  assert.deepEqual(
    await handler({
      input: { brief: { sourceRef: 'upload-2' }, kind: 'extraction' },
      serverContext: { ...serverContext, billing, boundedExecution },
    }),
    { artifactRef: 'artifact-extraction' },
  );
  assert.deepEqual(received, [
    {
      billing,
      boundedExecution,
      brief: { sourceRef: 'upload-1' },
      kind: 'parsing',
      workspaceId: 'workspace-1',
    },
    {
      billing,
      boundedExecution,
      brief: { sourceRef: 'upload-2' },
      kind: 'extraction',
      workspaceId: 'workspace-1',
    },
  ]);
});

test('billed handlers reject missing billing before calling production ports', async () => {
  let generated = false;
  let resolved = false;

  await assert.rejects(
    createGenerateHandler({
      async generate() {
        generated = true;
      },
    })({
      input: { brief: {}, kind: 'copy' },
      serverContext,
    }),
    /server-owned billing context/u,
  );
  await assert.rejects(
    createReviseHandler({
      resolver: {
        async resolve() {
          resolved = true;
          return { expectedRevision: 1, targetRef: 'content-package:1' };
        },
      },
      writer: {
        async revise() {
          return {};
        },
      },
    })({
      input: {
        instruction: 'Shorten it.',
        target_ref: 'content-package:1@1',
      },
      serverContext,
    }),
    /server-owned billing context/u,
  );

  assert.equal(generated, false);
  assert.equal(resolved, false);
});

test('revise resolves a trusted OCC fence before calling the revision writer', async () => {
  let resolved: unknown;
  let written: unknown;
  const expected = {
    revisionRef: 'content-package-1@revision-3',
    version: 3,
  };
  const resolver: ReviseTargetResolverPort = {
    async resolve(input) {
      resolved = input;
      return {
        expectedRevision: 2,
        targetRef: 'content-package:content-package-1',
      };
    },
  };
  const writer: RevisePort = {
    async revise(input) {
      written = input;
      return expected;
    },
  };
  const billing = {
    productUsageTaskId: 'usage-task-2',
    quoteId: 'quote-2',
  };

  const result = await createReviseHandler({ resolver, writer })({
    input: {
      instruction: 'Shorten the opening sentence.',
      target_ref: 'content-package-1@revision-2',
    },
    serverContext: {
      ...serverContext,
      billing,
      boundedExecution,
      idempotencyKey: 'revise-call-1',
    },
  });

  assert.deepEqual(resolved, {
    targetRef: 'content-package-1@revision-2',
    workspaceId: 'workspace-1',
  });
  assert.deepEqual(written, {
    billing,
    boundedExecution,
    expectedRevision: 2,
    idempotencyKey: 'revise-call-1',
    instruction: 'Shorten the opening sentence.',
    targetRef: 'content-package:content-package-1',
    workspaceId: 'workspace-1',
  });
  assert.equal(result, expected);
});

test('two revise calls from one base revision produce one write and one OCC conflict', async () => {
  const conflict = new Error('Revision fence conflict.');
  let currentRevision = 2;
  const resolver: ReviseTargetResolverPort = {
    async resolve() {
      return {
        expectedRevision: 2,
        targetRef: 'content-package:content-package-1',
      };
    },
  };
  const writer: RevisePort = {
    async revise(input) {
      if (input.expectedRevision !== currentRevision) {
        throw conflict;
      }
      currentRevision += 1;
      return { revision: currentRevision };
    },
  };
  const handler = createReviseHandler({ resolver, writer });

  const outcomes = await Promise.allSettled([
    handler({
      input: {
        instruction: 'Use a warmer tone.',
        target_ref: 'content-package-1@revision-1',
      },
      serverContext: {
        ...serverContext,
        billing: {
          productUsageTaskId: 'usage-task-3',
          quoteId: 'quote-3',
        },
        boundedExecution,
        idempotencyKey: 'revise-call-a',
      },
    }),
    handler({
      input: {
        instruction: 'Use a shorter opening.',
        target_ref: 'content-package-1@revision-1',
      },
      serverContext: {
        ...serverContext,
        billing: {
          productUsageTaskId: 'usage-task-4',
          quoteId: 'quote-4',
        },
        boundedExecution,
        idempotencyKey: 'revise-call-b',
      },
    }),
  ]);

  assert.equal(
    outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    outcomes.filter(
      (outcome) =>
        outcome.status === 'rejected' && outcome.reason === conflict,
    ).length,
    1,
  );
  assert.equal(currentRevision, 3);
});

test('revise fails closed before its writer when maxIterations is missing or exhausted', async () => {
  let resolved = false;
  let written = false;
  const handler = createReviseHandler({
    resolver: {
      async resolve() {
        resolved = true;
        return {
          expectedRevision: 2,
          targetRef: 'content-package:content-package-1',
        };
      },
    },
    writer: {
      async revise() {
        written = true;
        return {};
      },
    },
  });
  const input = {
    instruction: 'Use a shorter opening.',
    target_ref: 'content-package-1@revision-2',
  };
  const billing = {
    productUsageTaskId: 'usage-task-budget',
    quoteId: 'quote-budget',
  };

  await assert.rejects(
    handler({
      input,
      serverContext: { ...serverContext, billing },
    }),
    /bounded execution snapshot/u,
  );
  await assert.rejects(
    handler({
      input,
      serverContext: {
        ...serverContext,
        billing,
        boundedExecution: {
          ...boundedExecution,
          consumption: {
            ...boundedExecution.consumption,
            iterations: 3,
          },
        },
      },
    }),
    /Execution attempt budget exhausted/u,
  );
  assert.equal(resolved, false);
  assert.equal(written, false);
});

test('record accepts a future kind when the port resolves it to a proposal and preserves provenance', async () => {
  let received: unknown;
  const provenance = {
    messageRange: { end: 19, start: 12 },
    sourceConversationId: 'conversation-7',
    sources: ['message-12', 'upload-2'],
  };
  const payload = {
    confidence: 0.82,
    insight: { palette: ['warm-white', 'tea-brown'] },
  };
  const port: RecordProposalPort = {
    async propose(input) {
      received = input;
      return {
        proposalRef: 'proposal-future-memory-1',
        status: 'proposed',
      };
    },
  };

  const result = await createRecordHandler(port)({
    input: {
      kind: 'propose_future_memory_candidate',
      payload,
      provenance,
    },
    serverContext: {
      ...serverContext,
      idempotencyKey: 'record-call-1',
    },
  });

  assert.deepEqual(received, {
    idempotencyKey: 'record-call-1',
    kind: 'propose_future_memory_candidate',
    payload,
    provenance,
    workspaceId: 'workspace-1',
  });
  assert.deepEqual(result, {
    proposalRef: 'proposal-future-memory-1',
    status: 'proposed',
  });
});

test('record rejects every non-propose kind before the proposal port', async () => {
  let proposed = false;
  const port: RecordProposalPort = {
    async propose() {
      proposed = true;
      return { proposalRef: 'should-not-exist', status: 'proposed' };
    },
  };

  for (const kind of ['confirm_preference', 'future_memory_candidate']) {
    await assert.rejects(
      createRecordHandler(port)({
        input: {
          kind,
          payload: {},
          provenance: {},
        },
        serverContext,
      }),
      /Model record kind must use the propose_ prefix/u,
    );
  }
  assert.equal(proposed, false);
});

test('record rejects any port outcome that is not a complete proposal', async () => {
  for (const outcome of [
    { proposalRef: 'confirmed-1', status: 'confirmed' },
    { proposalRef: '', status: 'proposed' },
  ]) {
    const port: RecordProposalPort = {
      async propose() {
        return outcome;
      },
    };

    await assert.rejects(
      createRecordHandler(port)({
        input: {
          kind: 'propose_future_memory_candidate',
          payload: {},
          provenance: {},
        },
        serverContext,
      }),
      /Record proposal port returned a non-proposal outcome/u,
    );
  }
});

test('record exposes only proposal state even when the port returns extra fields', async () => {
  const handler = createRecordHandler({
    async propose() {
      return {
        canonicalRecordId: 'must-not-leak',
        proposalRef: 'proposal-1',
        status: 'proposed',
      };
    },
  });

  assert.deepEqual(
    await handler({
      input: {
        kind: 'propose_future_memory_candidate',
        payload: {},
        provenance: {},
      },
      serverContext,
    }),
    {
      proposalRef: 'proposal-1',
      status: 'proposed',
    },
  );
});
