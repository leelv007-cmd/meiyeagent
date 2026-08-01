import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HARNESS_GATE_IDS,
  type HarnessPolicyInput,
  validateHarnessPolicy,
} from '../harness/policy-gates.js';
import type { AgentPrimitiveServerContext } from './runtime.js';
import {
  CheckPrimitiveHandler,
  type CheckTargetResolverPort,
  type CheckViolationAuditPort,
} from './check-handler.js';

const serverContext: AgentPrimitiveServerContext = {
  actorId: 'worker-agent-primitives',
  correlationId: 'correlation-check-1',
  idempotencyKey: 'primitive-check-1',
  taskId: 'task-check-1',
  observability: {
    axisScope: 'execution_child',
    catalogRevision: { kind: 'bound', value: 'catalog-2026-07-29' },
    promptVersion: { kind: 'bound', value: 'marketing/copy@v4' },
    scene: { kind: 'bound', value: 'copy.check' },
    skillRevision: { kind: 'bound', value: 'copywriter@rev-17' },
  },
  workspaceId: 'workspace-a',
};

test('check resolves a trusted target and has parity with the canonical execution policy', async () => {
  const resolved = unsafeHarnessPolicyInput();
  resolved.phase = 'publish';
  const resolverCalls: Parameters<CheckTargetResolverPort['resolve']>[0][] = [];
  const audits: Parameters<CheckViolationAuditPort['append']>[0][] = [];
  const handler = new CheckPrimitiveHandler({
    resolver: {
      async resolve(input) {
        resolverCalls.push(input);
        return resolved;
      },
    },
    violationAudit: {
      async append(input) {
        audits.push(input);
      },
    },
  });

  const result = await handler.execute({
    input: {
      rulesets: ['platform.redlines@2026-07-29'],
      target_ref: 'candidate:candidate-a',
    },
    serverContext,
  });
  const expected = validateHarnessPolicy({
    ...resolved,
    phase: 'execution',
  });

  assert.deepEqual(
    expected.failures.map(({ gateId }) => gateId),
    [
      'cross_workspace_lineage',
      'critical_fact_source',
      'subject_asset_rights',
      'expression_identity',
      'price_benefit_freshness',
    ],
  );
  assert.deepEqual(result, {
    allowed: expected.passed,
    status: 'blocked',
    strategy: 'block',
    violations: expected.failures,
  });
  assert.deepEqual(resolverCalls, [
    {
      rulesets: ['platform.redlines@2026-07-29'],
      targetRef: 'candidate:candidate-a',
      workspaceId: serverContext.workspaceId,
    },
  ]);
  assert.deepEqual(
    audits.map(({ strategy, violation }) => ({
      gateId: violation.gateId,
      strategy,
    })),
    expected.failures.map(({ gateId }) => ({
      gateId,
      strategy: 'block',
    })),
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
});

test('check waits for every violation audit before returning', async () => {
  const resolved = unsafeHarnessPolicyInput();
  const audited: string[] = [];
  let releaseAudit: () => void = () =>
    assert.fail('audit release was not initialized');
  const auditReady = new Promise<void>((resolve) => {
    releaseAudit = resolve;
  });
  const handler = new CheckPrimitiveHandler({
    resolver: {
      async resolve() {
        return resolved;
      },
    },
    violationAudit: {
      async append({ violation }) {
        await auditReady;
        audited.push(violation.gateId);
      },
    },
  });
  let settled = false;

  const pending = handler
    .execute({
      input: { target_ref: 'candidate:candidate-a' },
      serverContext,
    })
    .then((result) => {
      settled = true;
      return result;
    });

  await Promise.resolve();
  assert.equal(settled, false);
  releaseAudit();
  const result = await pending;
  assert.equal(result.status, 'blocked');
  assert.deepEqual(audited, [
    'cross_workspace_lineage',
    'critical_fact_source',
    'subject_asset_rights',
    'expression_identity',
    'price_benefit_freshness',
  ]);
});

test('check fails closed when trusted target resolution fails or resolves another workspace', async () => {
  const violationAudit: CheckViolationAuditPort = {
    async append() {
      assert.fail('policy evaluation must not run after target resolution fails');
    },
  };
  const resolverFailure = new Error('trusted target unavailable');
  const failing = new CheckPrimitiveHandler({
    resolver: {
      async resolve() {
        throw resolverFailure;
      },
    },
    violationAudit,
  });

  await assert.rejects(
    failing.execute({
      input: { target_ref: 'candidate:missing' },
      serverContext,
    }),
    resolverFailure,
  );

  const foreign = unsafeHarnessPolicyInput();
  foreign.bundle.workspaceId = 'workspace-foreign';
  const mismatched = new CheckPrimitiveHandler({
    resolver: {
      async resolve() {
        return foreign;
      },
    },
    violationAudit,
  });

  await assert.rejects(
    mismatched.execute({
      input: { target_ref: 'candidate:foreign' },
      serverContext,
    }),
    /does not belong to the execution workspace/u,
  );
});

function unsafeHarnessPolicyInput(): HarnessPolicyInput {
  return {
    phase: 'execution',
    evaluatedAt: '2026-07-29T00:00:00.000Z',
    bundle: { revision: 1, workspaceId: 'workspace-a' },
    brief: {},
    candidate: {
      assetRefs: ['asset-unauthorized'],
      candidateId: 'candidate-a',
      expressionIdentityRef: 'identity-unregistered',
      factClaims: [
        {
          kind: 'price',
          sourceRef: 'source-expired',
          value: '¥99',
        },
        {
          kind: 'offer',
          value: 'New customer offer',
        },
      ],
      intendedUse: 'public_content',
      workspaceId: 'workspace-foreign',
    },
    identityRefs: [
      {
        id: 'identity-unregistered',
        status: 'unregistered',
        workspaceId: 'workspace-a',
      },
    ],
    rightsRefs: [
      {
        allowedUses: ['internal_draft'],
        assetId: 'asset-unauthorized',
        status: 'authorized',
        workspaceId: 'workspace-a',
      },
    ],
    sourceRefs: [
      {
        expiresAt: '2026-07-28T00:00:00.000Z',
        id: 'source-expired',
        revision: 1,
        status: 'expired',
        workspaceId: 'workspace-a',
      },
    ],
  };
}
