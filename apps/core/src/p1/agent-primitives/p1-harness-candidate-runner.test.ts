import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  BoundedExecutionSnapshot,
  ObservabilityAxisBinding,
} from '@meiye/contracts';
import { z } from 'zod';

import { P1ApplicationService } from '../foundation/application-service.js';
import type { P1Context } from '../foundation/domain.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
} from '../model-supply/structured-node-runner.js';
import {
  createGenerateHandler,
  createReviseHandler,
} from './core-handlers.js';
import { AgentPrimitiveFoundationModule } from './foundation-module.js';
import {
  P1HarnessCandidateRevisionConflict,
  P1HarnessCandidateRunnerScope,
  type P1HarnessCandidateApplicationPort,
} from './p1-harness-candidate-runner.js';
import { createCanonicalAgentPrimitiveRegistry } from './registry.js';
import {
  AgentPrimitiveRuntime,
  type AgentPrimitiveBindings,
  type AgentPrimitiveTraceEvent,
} from './runtime.js';

const observability = {
  axisScope: 'execution_child',
  catalogRevision: { kind: 'bound', value: 'catalog-2026-07-30' },
  promptVersion: { kind: 'bound', value: 'harness/copy-candidate@7' },
  scene: { kind: 'bound', value: 'copy.generate' },
  skillRevision: { kind: 'bound', value: 'copywriter@rev-17' },
} satisfies ObservabilityAxisBinding;

const boundedExecution = {
  schemaVersion: 'bounded-execution-snapshot/v1',
  maxIterations: 3,
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
} satisfies BoundedExecutionSnapshot;

const billing = {
  productUsageTaskId: 'usage-task-copy-1',
  quoteId: 'quote-copy-1',
};

test('one request-scoped wrapper sends the primary effect through generate and self-correction through revise', async () => {
  const scope = new P1HarnessCandidateRunnerScope('harness-copy-worker');
  const traces: AgentPrimitiveTraceEvent[] = [];
  const inert = async () => ({});
  const bindings: AgentPrimitiveBindings = {
    ask_merchant: inert,
    check: inert,
    generate: createGenerateHandler(scope),
    read_context: inert,
    record: inert,
    revise: createReviseHandler({
      resolver: scope,
      writer: scope,
    }),
  };
  const application = new P1ApplicationService(
    new MemoryFoundationRepository(),
    {
      operations: [
        new AgentPrimitiveFoundationModule(
          new AgentPrimitiveRuntime({
            bindings,
            registry: createCanonicalAgentPrimitiveRegistry(),
            tracePort: {
              async append(event) {
                traces.push(event);
              },
            },
          }),
        ),
      ],
    },
  );
  const moduleCalls: Array<{
    context: P1Context;
    input: Record<string, unknown>;
    idempotencyKey: string;
  }> = [];
  const recordingApplication: P1HarnessCandidateApplicationPort = {
    executeModule(context, name, input, idempotencyKey) {
      assert.equal(name, 'agent-primitives');
      moduleCalls.push({ context, input, idempotencyKey });
      return application.executeModule(context, name, input, idempotencyKey);
    },
  };
  const runner = new QueueRunner([
    { body: 'first body', title: 'first title' },
    { body: 'revised body', title: 'revised title' },
  ]);
  const wrapped = scope.wrap({
    application: recordingApplication,
    billing,
    boundedExecution,
    observability,
    runner,
    taskId: 'workflow-copy-1',
    workspaceId: 'workspace-copy-1',
  });
  const primaryRequest = structuredRequest(
    'wf:workflow-copy-1:s4:copy-primary:c01',
    'Generate the primary copy candidate.',
  );
  const revisionRequest = structuredRequest(
    'wf:workflow-copy-1:s4:copy-primary:c02',
    'Revise the candidate after the policy failure.',
  );

  const primary = await wrapped.run(primaryRequest);
  const primaryReplay = await wrapped.run(primaryRequest);
  const revision = await wrapped.run(revisionRequest);

  assert.deepEqual(primary.output, {
    body: 'first body',
    title: 'first title',
  });
  assert.deepEqual(primaryReplay, {
    ...primary,
    replayed: true,
  });
  assert.deepEqual(revision.output, {
    body: 'revised body',
    title: 'revised title',
  });
  assert.deepEqual(runner.requests, [primaryRequest, revisionRequest]);
  assert.deepEqual(
    moduleCalls.map(({ context, idempotencyKey, input }) => ({
      context,
      idempotencyKey,
      input,
    })),
    [
      {
        context: {
          actor: 'worker',
          correlationId: primaryRequest.effectIdempotencyKey,
          userId: 'harness-copy-worker',
          workspaceId: 'workspace-copy-1',
        },
        idempotencyKey: primaryRequest.effectIdempotencyKey,
        input: {
          action: 'execute',
          payload: {
            billing,
            boundedExecution,
            modelInput: {
              brief: {
                request_ref:
                  'harness-candidate-request:workflow-copy-1:' +
                  primaryRequest.effectIdempotencyKey,
              },
              kind: 'copy',
            },
            observability,
            primitiveId: 'generate',
            taskId: 'workflow-copy-1',
          },
        },
      },
      {
        context: {
          actor: 'worker',
          correlationId: primaryRequest.effectIdempotencyKey,
          userId: 'harness-copy-worker',
          workspaceId: 'workspace-copy-1',
        },
        idempotencyKey: primaryRequest.effectIdempotencyKey,
        input: {
          action: 'execute',
          payload: {
            billing,
            boundedExecution,
            modelInput: {
              brief: {
                request_ref:
                  'harness-candidate-request:workflow-copy-1:' +
                  primaryRequest.effectIdempotencyKey,
              },
              kind: 'copy',
            },
            observability,
            primitiveId: 'generate',
            taskId: 'workflow-copy-1',
          },
        },
      },
      {
        context: {
          actor: 'worker',
          correlationId: revisionRequest.effectIdempotencyKey,
          userId: 'harness-copy-worker',
          workspaceId: 'workspace-copy-1',
        },
        idempotencyKey: revisionRequest.effectIdempotencyKey,
        input: {
          action: 'execute',
          payload: {
            billing,
            boundedExecution,
            modelInput: {
              instruction: revisionRequest.instructions,
              target_ref:
                'harness-candidate:workflow-copy-1:' +
                primaryRequest.effectIdempotencyKey +
                '@1',
            },
            observability,
            primitiveId: 'revise',
            taskId: 'workflow-copy-1',
          },
        },
      },
    ],
  );
  assert.deepEqual(
    traces.map(({ phase, primitiveId }) => ({ phase, primitiveId })),
    [
      { phase: 'invoked', primitiveId: 'generate' },
      { phase: 'succeeded', primitiveId: 'generate' },
      { phase: 'invoked', primitiveId: 'revise' },
      { phase: 'succeeded', primitiveId: 'revise' },
    ],
  );
});

test('a fresh wrapper rehydrates the candidate fence from a durable generate replay', async () => {
  const scope = new P1HarnessCandidateRunnerScope('harness-copy-worker');
  const traces: AgentPrimitiveTraceEvent[] = [];
  const inert = async () => ({});
  const application = new P1ApplicationService(
    new MemoryFoundationRepository(),
    {
      operations: [
        new AgentPrimitiveFoundationModule(
          new AgentPrimitiveRuntime({
            bindings: {
              ask_merchant: inert,
              check: inert,
              generate: createGenerateHandler(scope),
              read_context: inert,
              record: inert,
              revise: createReviseHandler({
                resolver: scope,
                writer: scope,
              }),
            },
            registry: createCanonicalAgentPrimitiveRegistry(),
            tracePort: {
              async append(event) {
                traces.push(event);
              },
            },
          }),
        ),
      ],
    },
  );
  const runner = new QueueRunner([
    { body: 'first body', title: 'first title' },
    { body: 'revised body', title: 'revised title' },
  ]);
  const wrapperInput = {
    application,
    billing,
    boundedExecution,
    observability,
    runner,
    taskId: 'workflow-copy-resume',
    workspaceId: 'workspace-copy-1',
  };
  const primaryRequest = structuredRequest(
    'effect-resume-primary',
    'Generate the primary candidate.',
  );
  const revisionRequest = structuredRequest(
    'effect-resume-revise',
    'Revise the candidate after recovery.',
  );

  await scope.wrap(wrapperInput).run(primaryRequest);
  const resumed = scope.wrap(wrapperInput);
  const primaryReplay = await resumed.run(primaryRequest);
  const revision = await resumed.run(revisionRequest);

  assert.equal(primaryReplay.output.title, 'first title');
  assert.equal(primaryReplay.replayed, true);
  assert.equal(revision.output.title, 'revised title');
  assert.deepEqual(runner.requests, [primaryRequest, revisionRequest]);
  assert.deepEqual(
    traces.map(({ phase, primitiveId }) => ({ phase, primitiveId })),
    [
      { phase: 'invoked', primitiveId: 'generate' },
      { phase: 'succeeded', primitiveId: 'generate' },
      { phase: 'invoked', primitiveId: 'revise' },
      { phase: 'succeeded', primitiveId: 'revise' },
    ],
  );
});

test('a bounded resume seeds the durable candidate fence and starts through revise', async () => {
  const scope = new P1HarnessCandidateRunnerScope('harness-copy-worker');
  const calls: DirectPrimitiveCall[] = [];
  const runner = new QueueRunner([
    { body: 'resumed revision', title: 'resumed revision' },
  ]);
  const wrapped = scope.wrap({
    application: directPrimitiveApplication(scope, {
      onCall(call) {
        calls.push(call);
      },
    }),
    billing,
    boundedExecution: {
      ...boundedExecution,
      consumption: {
        ...boundedExecution.consumption,
        iterations: 1,
      },
    },
    observability,
    resumeCandidate: {
      revision: 1,
      sourceEffectIdempotencyKey: 'effect-resume-primary',
    },
    runner,
    taskId: 'workflow-copy-bounded-resume',
    workspaceId: 'workspace-copy-1',
  });

  const result = await wrapped.run(
    structuredRequest(
      'effect-resume-revise',
      'Revise the durable candidate after a raised limit.',
    ),
  );

  assert.equal(result.output.title, 'resumed revision');
  assert.deepEqual(calls, [
    {
      primitiveId: 'revise',
      targetRef:
        'harness-candidate:workflow-copy-bounded-resume:' +
        'effect-resume-primary@1',
      workspaceId: 'workspace-copy-1',
    },
  ]);
  assert.equal(runner.requests.length, 1);
});

test('a stale server-owned candidate revision fails closed before another provider effect', async () => {
  const scope = new P1HarnessCandidateRunnerScope('harness-copy-worker');
  let reviseCalls = 0;
  const application = directPrimitiveApplication(scope, {
    targetRef(targetRef) {
      reviseCalls += 1;
      return reviseCalls === 2
        ? targetRef.replace(/@\d+$/u, '@1')
        : targetRef;
    },
  });
  const runner = new QueueRunner([
    { body: 'first body', title: 'first title' },
    { body: 'revised body', title: 'revised title' },
  ]);
  const wrapped = scope.wrap({
    application,
    billing,
    boundedExecution,
    observability,
    runner,
    taskId: 'workflow-copy-occ',
    workspaceId: 'workspace-copy-1',
  });

  await wrapped.run(
    structuredRequest('effect-primary', 'Generate the primary candidate.'),
  );
  await wrapped.run(
    structuredRequest('effect-revise-1', 'Apply the first correction.'),
  );
  await assert.rejects(
    wrapped.run(
      structuredRequest('effect-revise-stale', 'Apply a stale correction.'),
    ),
    (error: unknown) => {
      assert.ok(error instanceof P1HarnessCandidateRevisionConflict);
      assert.equal(error.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal(error.status, 409);
      return true;
    },
  );
  assert.equal(runner.requests.length, 2);
});

test('concurrent request scopes keep candidate revisions and workspaces isolated across async dispatch', async () => {
  const scope = new P1HarnessCandidateRunnerScope('harness-copy-worker');
  const calls: DirectPrimitiveCall[] = [];
  const application = directPrimitiveApplication(scope, {
    onCall(call) {
      calls.push(call);
    },
  });
  const runnerA = new QueueRunner([
    { body: 'workspace A primary', title: 'A1' },
    { body: 'workspace A revision', title: 'A2' },
  ]);
  const runnerB = new QueueRunner([
    { body: 'workspace B primary', title: 'B1' },
    { body: 'workspace B revision', title: 'B2' },
  ]);
  const wrappedA = scope.wrap({
    application,
    billing,
    boundedExecution,
    observability,
    runner: runnerA,
    taskId: 'workflow-a',
    workspaceId: 'workspace-a',
  });
  const wrappedB = scope.wrap({
    application,
    billing,
    boundedExecution,
    observability,
    runner: runnerB,
    taskId: 'workflow-b',
    workspaceId: 'workspace-b',
  });

  await Promise.all([
    wrappedA.run(structuredRequest('effect-a-primary', 'Generate A.')),
    wrappedB.run(structuredRequest('effect-b-primary', 'Generate B.')),
  ]);
  const [revisedA, revisedB] = await Promise.all([
    wrappedA.run(structuredRequest('effect-a-revise', 'Revise A.')),
    wrappedB.run(structuredRequest('effect-b-revise', 'Revise B.')),
  ]);

  assert.equal(revisedA.output.title, 'A2');
  assert.equal(revisedB.output.title, 'B2');
  assert.equal(runnerA.requests.length, 2);
  assert.equal(runnerB.requests.length, 2);
  assert.deepEqual(
    calls
      .filter(({ primitiveId }) => primitiveId === 'revise')
      .map(({ targetRef, workspaceId }) => ({ targetRef, workspaceId })),
    [
      {
        targetRef:
          'harness-candidate:workflow-a:effect-a-primary@1',
        workspaceId: 'workspace-a',
      },
      {
        targetRef:
          'harness-candidate:workflow-b:effect-b-primary@1',
        workspaceId: 'workspace-b',
      },
    ],
  );
});

function structuredRequest(
  effectIdempotencyKey: string,
  instructions: string,
): StructuredNodeRunnerRequest<{ body: string; title: string }> {
  return {
    effectIdempotencyKey,
    instructions,
    prompt: 'Write grounded beauty-business copy.',
    schema: z.object({
      body: z.string(),
      title: z.string(),
    }),
    schemaName: 'harness_copy_candidate_v1',
    schemaRevision: 'copy-candidate-v1',
  };
}

class QueueRunner implements StructuredNodeRunner {
  readonly requests: StructuredNodeRunnerRequest<unknown>[] = [];

  constructor(
    private readonly outputs: Array<{
      body: string;
      title: string;
    }>,
  ) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    this.requests.push(request as StructuredNodeRunnerRequest<unknown>);
    const output = this.outputs.shift();
    assert.ok(output);
    return {
      attempts: 1,
      output: output as Output,
      providerTaskRef: `provider-${this.requests.length}`,
      replayed: false,
      usage: { inputTokens: 10, outputTokens: 20 },
    };
  }
}

interface DirectPrimitiveCall {
  primitiveId: 'generate' | 'revise';
  targetRef?: string;
  workspaceId: string;
}

function directPrimitiveApplication(
  scope: P1HarnessCandidateRunnerScope,
  options: {
    onCall?: (call: DirectPrimitiveCall) => void;
    targetRef?: (targetRef: string) => string;
  } = {},
): P1HarnessCandidateApplicationPort {
  const generate = createGenerateHandler(scope);
  const revise = createReviseHandler({
    resolver: scope,
    writer: scope,
  });
  return {
    async executeModule<TInput extends Record<string, unknown>, TOutput>(
      context: P1Context,
      _name: string,
      input: TInput,
      idempotencyKey: string,
    ): Promise<TOutput> {
      const payload = input.payload as {
        billing: typeof billing;
        boundedExecution: BoundedExecutionSnapshot;
        modelInput: {
          brief?: { request_ref: string };
          instruction?: string;
          kind?: string;
          target_ref?: string;
        };
        observability: ObservabilityAxisBinding;
        primitiveId: 'generate' | 'revise';
        taskId: string;
      };
      await new Promise<void>((resolve) => setImmediate(resolve));
      const targetRef = payload.modelInput.target_ref
        ? (options.targetRef?.(payload.modelInput.target_ref) ??
          payload.modelInput.target_ref)
        : undefined;
      options.onCall?.({
        primitiveId: payload.primitiveId,
        ...(targetRef ? { targetRef } : {}),
        workspaceId: context.workspaceId,
      });
      const serverContext = {
        actorId: context.userId,
        billing: payload.billing,
        boundedExecution: payload.boundedExecution,
        correlationId: context.correlationId,
        idempotencyKey,
        observability: payload.observability,
        taskId: payload.taskId,
        workspaceId: context.workspaceId,
      };
      if (payload.primitiveId === 'generate') {
        return (await generate({
          input: {
            brief: payload.modelInput.brief!,
            kind: payload.modelInput.kind!,
          },
          serverContext,
        })) as TOutput;
      }
      return (await revise({
        input: {
          instruction: payload.modelInput.instruction!,
          target_ref: targetRef!,
        },
        serverContext,
      })) as TOutput;
    },
  };
}
