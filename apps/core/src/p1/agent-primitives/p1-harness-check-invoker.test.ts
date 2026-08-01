import assert from 'node:assert/strict';
import test from 'node:test';

import { P1ApplicationService } from '../foundation/application-service.js';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import {
  HARNESS_GATE_IDS,
  type HarnessPolicyInput,
} from '../harness/policy-gates.js';
import { CheckPrimitiveHandler } from './check-handler.js';
import { AgentPrimitiveFoundationModule } from './foundation-module.js';
import { HarnessCheckTargetScope } from './harness-check-target-scope.js';
import { P1HarnessCheckInvoker } from './p1-harness-check-invoker.js';
import { createCanonicalAgentPrimitiveRegistry } from './registry.js';
import {
  AgentPrimitiveRuntime,
  type AgentPrimitiveBindings,
  type AgentPrimitiveTraceEvent,
} from './runtime.js';

const observability = {
  axisScope: 'execution_child' as const,
  catalogRevision: { kind: 'bound' as const, value: 'catalog-2026-07-29' },
  promptVersion: { kind: 'bound' as const, value: 'marketing/copy@v4' },
  scene: { kind: 'bound' as const, value: 'copy.check' },
  skillRevision: { kind: 'bound' as const, value: 'copywriter@rev-17' },
};

test('Harness invokes canonical check through P1 once and awaits its violation audit before replay', async () => {
  const repository = new MemoryFoundationRepository();
  const scope = new HarnessCheckTargetScope();
  const traces: AgentPrimitiveTraceEvent[] = [];
  const violationAudits: Array<{
    gateId: string;
    targetRef: string;
  }> = [];
  let handlerExecutions = 0;
  let releaseAudit: () => void = () =>
    assert.fail('audit release was not initialized');
  let markAuditStarted: () => void = () =>
    assert.fail('audit start was not initialized');
  const auditRelease = new Promise<void>((resolve) => {
    releaseAudit = resolve;
  });
  const auditStarted = new Promise<void>((resolve) => {
    markAuditStarted = resolve;
  });
  const check = new CheckPrimitiveHandler({
    resolver: scope,
    violationAudit: {
      async append({ targetRef, violation }) {
        markAuditStarted();
        await auditRelease;
        violationAudits.push({
          gateId: violation.gateId,
          targetRef,
        });
      },
    },
  });
  const inert = async () => ({});
  const bindings: AgentPrimitiveBindings = {
    ask_merchant: inert,
    check: async (args) => {
      handlerExecutions += 1;
      return check.execute(args);
    },
    generate: inert,
    read_context: inert,
    record: inert,
    revise: inert,
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
  const application = new P1ApplicationService(repository, {
    operations: [new AgentPrimitiveFoundationModule(runtime)],
  });
  const invoker = new P1HarnessCheckInvoker(
    application,
    scope,
    'worker-harness-check',
  );
  const firstPolicy = canonicalViolation();
  const secondPolicy = canonicalPass('candidate-b');
  const changedFirstPolicy = canonicalPass('candidate-a');
  const input = {
    correlationId: 'correlation-harness-check',
    observability,
    policyInput: firstPolicy,
    rulesets: ['external_action_approval'],
    taskId: 'task-check-1',
    workflowId: 'workflow-check-1',
    workflowRevision: 3,
    workspaceId: 'workspace-a',
  };
  let settled = false;

  const pending = invoker.execute(input).then((result) => {
    settled = true;
    return result;
  });
  await auditStarted;
  assert.equal(settled, false);
  releaseAudit();
  const first = await pending;
  const replay = await invoker.execute(input);
  const secondCandidate = await invoker.execute({
    ...input,
    policyInput: secondPolicy,
  });
  const recheckedFirstCandidate = await invoker.execute({
    ...input,
    policyInput: changedFirstPolicy,
  });

  assert.deepEqual(first, {
    allowed: false,
    status: 'blocked',
    strategy: 'block',
    violations: [
      {
        alternativePath: [
          '移除跨店引用',
          '重新编译当前门店 ContextBundle',
        ],
        gateId: 'cross_workspace_lineage',
        reason: '候选引用了其他门店或其他表达主体的数据，已停止该候选。',
      },
    ],
  });
  assert.deepEqual(replay, first);
  assert.deepEqual(secondCandidate, {
    allowed: true,
    status: 'passed',
    strategy: 'block',
    violations: [],
  });
  assert.deepEqual(recheckedFirstCandidate, secondCandidate);
  assert.equal(handlerExecutions, 3);
  assert.deepEqual(violationAudits, [
    {
      gateId: 'cross_workspace_lineage',
      targetRef: 'harness-candidate:candidate-a@bundle-3',
    },
  ]);
  assert.deepEqual(
    traces.map(({ phase, primitiveId, serverContext }) => ({
      idempotencyKey: serverContext.idempotencyKey,
      phase,
      primitiveId,
    })),
    [
      {
        idempotencyKey:
          checkIdempotencyKey('candidate-a', firstPolicy),
        phase: 'invoked',
        primitiveId: 'check',
      },
      {
        idempotencyKey:
          checkIdempotencyKey('candidate-a', firstPolicy),
        phase: 'succeeded',
        primitiveId: 'check',
      },
      {
        idempotencyKey:
          checkIdempotencyKey('candidate-b', secondPolicy),
        phase: 'invoked',
        primitiveId: 'check',
      },
      {
        idempotencyKey:
          checkIdempotencyKey('candidate-b', secondPolicy),
        phase: 'succeeded',
        primitiveId: 'check',
      },
      {
        idempotencyKey:
          checkIdempotencyKey('candidate-a', changedFirstPolicy),
        phase: 'invoked',
        primitiveId: 'check',
      },
      {
        idempotencyKey:
          checkIdempotencyKey('candidate-a', changedFirstPolicy),
        phase: 'succeeded',
        primitiveId: 'check',
      },
    ],
  );
  assert.deepEqual(
    (await repository.listCommandAudits(input.workspaceId)).map(
      ({ actorId, idempotencyKey }) => ({ actorId, idempotencyKey }),
    ),
    [
      {
        actorId: 'worker-harness-check',
        idempotencyKey:
          checkIdempotencyKey('candidate-a', firstPolicy),
      },
      {
        actorId: 'worker-harness-check',
        idempotencyKey:
          checkIdempotencyKey('candidate-b', secondPolicy),
      },
      {
        actorId: 'worker-harness-check',
        idempotencyKey:
          checkIdempotencyKey('candidate-a', changedFirstPolicy),
      },
    ],
  );
  assert.deepEqual(HARNESS_GATE_IDS, [
    'cross_workspace_lineage',
    'critical_fact_source',
    'subject_asset_rights',
    'expression_identity',
    'price_benefit_freshness',
    'sensitive_words',
    'external_revision',
    'external_action_approval',
  ]);
  assert.equal(
    first.violations.some(
      ({ gateId }) => gateId === input.rulesets[0],
    ),
    false,
  );
});

function canonicalViolation(): HarnessPolicyInput {
  return {
    phase: 'delivery',
    brief: {},
    bundle: {
      revision: 3,
      workspaceId: 'workspace-a',
    },
    candidate: {
      assetRefs: [],
      candidateId: 'candidate-a',
      factClaims: [],
      intendedUse: 'public_content',
      workspaceId: 'workspace-foreign',
    },
    identityRefs: [],
    rightsRefs: [],
    sourceRefs: [],
  };
}

function canonicalPass(candidateId: string): HarnessPolicyInput {
  return {
    ...canonicalViolation(),
    candidate: {
      ...canonicalViolation().candidate,
      candidateId,
      workspaceId: 'workspace-a',
    },
  };
}

function checkIdempotencyKey(
  candidateId: string,
  policyInput: HarnessPolicyInput,
) {
  return (
    `wf:workflow-check-1:s4:agent-check:r3:b3:${candidateId}:` +
    fingerprintValue(policyInput)
  );
}
