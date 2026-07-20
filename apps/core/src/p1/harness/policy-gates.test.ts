import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HARNESS_GATE_IDS,
  validateHarnessPolicy,
  type HarnessPolicyInput,
} from './policy-gates.js';

const adversarialCases: Array<{
  gateId: (typeof HARNESS_GATE_IDS)[number];
  mutate(input: HarnessPolicyInput): void;
}> = [
  {
    gateId: 'cross_workspace_lineage',
    mutate: (input) => {
      input.sourceRefs[0]!.workspaceId = 'workspace-foreign';
    },
  },
  {
    gateId: 'critical_fact_source',
    mutate: (input) => {
      delete input.candidate.factClaims[0]!.sourceRef;
    },
  },
  {
    gateId: 'subject_asset_rights',
    mutate: (input) => {
      input.rightsRefs[0]!.status = 'unknown';
    },
  },
  {
    gateId: 'expression_identity',
    mutate: (input) => {
      input.identityRefs[0]!.status = 'unregistered';
    },
  },
  {
    gateId: 'price_benefit_freshness',
    mutate: (input) => {
      input.sourceRefs[0]!.status = 'expired';
    },
  },
  {
    gateId: 'external_revision',
    mutate: (input) => {
      input.actionContext = {
        kind: 'publish',
        target: 'douyin-account-a',
        revision: 6,
      };
      input.phase = 'publish';
      input.currentRevision = 7;
    },
  },
  {
    gateId: 'external_action_approval',
    mutate: (input) => {
      input.actionContext = {
        kind: 'paid_action',
        target: 'douyin-account-a',
        revision: 7,
      };
      input.phase = 'paid_action';
      input.approvalReceipt = undefined;
    },
  },
];

for (const adversarial of adversarialCases) {
  test(`canonical gate blocks ${adversarial.gateId}`, () => {
    const input = safePolicyInput();
    adversarial.mutate(input);

    const result = validateHarnessPolicy(input);

    assert.equal(result.passed, false);
    assert.deepEqual(
      result.failures.map((failure) => failure.gateId),
      [adversarial.gateId],
    );
    assert.ok(result.failures[0]!.reason.length > 0);
    assert.ok(result.failures[0]!.alternativePath.length > 0);
  });
}
test('rights gate returns the required safe alternative order', () => {
  const input = safePolicyInput();
  input.rightsRefs[0]!.status = 'withdrawn';

  const result = validateHarnessPolicy(input);

  assert.deepEqual(result.failures[0]?.alternativePath, [
    '换安全素材',
    '匿名化',
    '请求授权',
    '放弃该表达',
  ]);
});

test('external gates are inactive during execution and exact during side effects', () => {
  const execution = safePolicyInput();
  execution.actionContext = {
    kind: 'publish',
    target: 'douyin-account-a',
    revision: 6,
  };
  execution.currentRevision = 7;
  execution.approvalReceipt = undefined;
  assert.equal(validateHarnessPolicy(execution).passed, true);

  const publish = safePolicyInput();
  publish.phase = 'publish';
  publish.actionContext = {
    kind: 'publish',
    target: 'douyin-account-a',
    revision: 7,
  };
  assert.equal(validateHarnessPolicy(publish).passed, true);
});

function safePolicyInput(): HarnessPolicyInput {
  return {
    phase: 'execution',
    bundle: { workspaceId: 'workspace-1', revision: 7 },
    brief: { unitId: 'copy-primary' },
    candidate: {
      candidateId: 'candidate-1',
      workspaceId: 'workspace-1',
      intendedUse: 'public_content',
      factClaims: [
        {
          kind: 'price',
          value: '团购价 ¥398',
          sourceRef: 'source-price-1',
        },
      ],
      assetRefs: ['asset-owner-1'],
      expressionIdentityRef: 'identity-owner-1',
    },
    sourceRefs: [
      {
        id: 'source-price-1',
        workspaceId: 'workspace-1',
        revision: 7,
        status: 'current',
      },
    ],
    rightsRefs: [
      {
        assetId: 'asset-owner-1',
        workspaceId: 'workspace-1',
        status: 'authorized',
        allowedUses: ['public_content'],
      },
    ],
    identityRefs: [
      {
        id: 'identity-owner-1',
        workspaceId: 'workspace-1',
        status: 'registered',
      },
    ],
    currentRevision: 7,
    actionContext: {
      kind: 'publish',
      target: 'douyin-account-a',
      revision: 7,
    },
    approvalReceipt: {
      status: 'approved',
      actionKind: 'publish',
      target: 'douyin-account-a',
      revision: 7,
    },
  };
}
