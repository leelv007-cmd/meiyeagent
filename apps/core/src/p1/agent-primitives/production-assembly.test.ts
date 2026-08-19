import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentPrimitiveId } from '@meiye/contracts';

import { MemoryObservabilityEventAudit } from '../creation-experience/observability-events.js';
import {
  arrayPropertyElements,
  constructors,
  hasCall,
  objectLiteralProps,
  parseProductionSource,
  parseSourceText,
  propertyValues,
} from '../testing/ast-boundary.js';
import {
  createProductionAgentPrimitiveAssembly,
  type ProductionAgentPrimitiveAssemblyPorts,
} from './production-assembly.js';

const observability = {
  axisScope: 'execution_child' as const,
  catalogRevision: { kind: 'bound' as const, value: 'catalog-r1' },
  promptVersion: { kind: 'bound' as const, value: 'harness/copy@1' },
  scene: { kind: 'bound' as const, value: 'copy.selection' },
  skillRevision: { kind: 'absent' as const },
};

function ports(calls: string[] = []): ProductionAgentPrimitiveAssemblyPorts {
  const called = (name: string): never => {
    calls.push(name);
    throw new Error(`called:${name}`);
  };
  return {
    audit: new MemoryObservabilityEventAudit(),
    askMerchant: { async request() { return called('ask_merchant'); } },
    checkTarget: { async resolve() { return called('check'); } },
    checkViolationAudit: { async append() { calls.push('check_audit'); } },
    generate: { async generate() { return called('generate'); } },
    readContext: { async read() { return called('read_context'); } },
    recordProposal: { async propose() { return called('record'); } },
    revise: { async revise() { return called('revise'); } },
    reviseTarget: {
      async resolve() {
        return { expectedRevision: 1, targetRef: 'candidate:candidate-1' };
      },
    },
  };
}

test('production assembly fails closed when any production port is absent', () => {
  for (const key of [
    'audit',
    'askMerchant',
    'checkTarget',
    'checkViolationAudit',
    'generate',
    'readContext',
    'recordProposal',
    'revise',
    'reviseTarget',
  ] as const) {
    const incomplete = { ...ports() } as Record<string, unknown>;
    delete incomplete[key];
    assert.throws(
      () =>
        createProductionAgentPrimitiveAssembly(
          incomplete as unknown as ProductionAgentPrimitiveAssemblyPorts,
        ),
      new RegExp(key, 'u'),
    );
  }
});

test('production assembly binds every canonical primitive to its real handler', async () => {
  const calls: string[] = [];
  const assembly = createProductionAgentPrimitiveAssembly(ports(calls));
  assert.equal(assembly.foundationModule.name, 'agent-primitives');

  const modelInput: Record<AgentPrimitiveId, unknown> = {
    read_context: { scope: 'workspace' },
    generate: { brief: {}, kind: 'copy' },
    revise: {
      instruction: 'Shorten it.',
      target_ref: 'candidate:candidate-1',
    },
    record: {
      kind: 'propose_preference',
      payload: {},
      provenance: { source_ref: 'message:1' },
    },
    check: { target_ref: 'candidate:candidate-1' },
    ask_merchant: { question: 'Which offer?' },
  };
  const boundedExecution = {
    schemaVersion: 'bounded-execution-snapshot/v1' as const,
    maxIterations: 2,
    maxCostCents: 'unset' as const,
    maxWallClockMs: 'unset' as const,
    maxDelegations: 'unset' as const,
    requiredLimits: ['maxIterations' as const],
    consumption: {
      iterations: 0,
      costCents: 0,
      wallClockMs: 0,
      delegations: 0,
    },
    stopReason: null,
    triggeredLimit: null,
  };

  for (const primitiveId of Object.keys(modelInput) as AgentPrimitiveId[]) {
    await assert.rejects(
      assembly.runtime.execute({
        primitiveId,
        modelInput: modelInput[primitiveId],
        serverContext: {
          actorId: 'worker-1',
          correlationId: `correlation-${primitiveId}`,
          idempotencyKey: `primitive-${primitiveId}`,
          observability,
          taskId: 'task-1',
          workspaceId: 'workspace-1',
          ...(primitiveId === 'generate' || primitiveId === 'revise'
            ? {
                billing: {
                  productUsageTaskId: `usage-${primitiveId}`,
                  quoteId: `quote-${primitiveId}`,
                },
                boundedExecution,
              }
            : {}),
        },
      }),
      new RegExp(`called:${primitiveId}`, 'u'),
    );
  }

  assert.deepEqual(calls, [
    'read_context',
    'generate',
    'revise',
    'record',
    'check',
    'ask_merchant',
  ]);
});

test('unwired assembly snippets fail the production boundary', () => {
  const preFix = parseSourceText(
    'pre-fix.ts',
    'const operations = [creationExperienceRuntime.foundationModule];',
  );
  assert.equal(
    arrayPropertyElements(preFix, 'operations').some((elements) =>
      elements.includes('agentPrimitiveAssembly.foundationModule'),
    ),
    false,
  );
});

test('main registers the production module and all three Harness callers', () => {
  const parsed = parseProductionSource(
    new URL('../../assembly/api-runtime.ts', import.meta.url),
  );

  assert.equal(hasCall(parsed, 'createProductionAgentPrimitiveAssembly'), true);
  assert.ok(
    arrayPropertyElements(parsed, 'operations').some((elements) =>
      elements.includes('agentPrimitiveAssembly.foundationModule'),
    ),
    'operations must register the production agent-primitive module',
  );

  const observability = objectLiteralProps(parsed, 'observability').find(
    (props) =>
      props.children === 'harnessExecutionChildObservability' &&
      props.primitiveCheck === 'p1HarnessCheckInvoker' &&
      props.candidateRunner === 'p1HarnessCandidateRunner',
  );
  assert.ok(
    observability,
    'Harness child observability/check/candidate runner must be named ports',
  );

  assert.ok(
    constructors(parsed).includes('TaskRecallDueProducer'),
  );
  assert.ok(
    propertyValues(parsed, 'taskRecallDue').some((value) =>
      value.includes('TaskRecallDueProducer'),
    ),
  );
  assert.ok(propertyValues(parsed, 'askMerchant').includes('p1HarnessAskInvoker'));
});
