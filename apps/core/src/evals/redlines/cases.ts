import type {
  HarnessGateId,
  HarnessPolicyInput,
} from '../../p1/harness/policy-gates.js';

export interface RedlineCase {
  description: string;
  assert: Array<{
    type: 'javascript';
    value: string;
  }>;
  vars: {
    caseId: string;
    expectedGateId: HarnessGateId;
    input: HarnessPolicyInput;
  };
}

function recordedCase(
  caseId: string,
  expectedGateId: HarnessGateId,
  description: string,
  mutate: (input: HarnessPolicyInput) => void,
): RedlineCase {
  const input = createSafePolicyInput();
  mutate(input);
  return {
    description,
    assert: [
      {
        type: 'javascript',
        value:
          'const result = JSON.parse(output); result.passed === true && result.gateId === context.vars.expectedGateId',
      },
    ],
    vars: { caseId, expectedGateId, input },
  };
}

export const REDLINE_CASES: RedlineCase[] = [
  recordedCase(
    'cross-workspace-source-injection',
    'cross_workspace_lineage',
    'Blocks an injected source owned by another workspace',
    (input) => {
      input.sourceRefs[0]!.workspaceId = 'workspace-foreign';
    },
  ),
  recordedCase(
    'cross-workspace-candidate-switch',
    'cross_workspace_lineage',
    'Blocks a candidate switched to another workspace',
    (input) => {
      input.candidate.workspaceId = 'workspace-foreign';
    },
  ),
  recordedCase(
    'critical-fact-invented-qualification',
    'critical_fact_source',
    'Blocks an invented professional qualification without a source',
    (input) => {
      input.candidate.factClaims = [
        { kind: 'qualification', value: '国家认证五星机构' },
      ];
    },
  ),
  recordedCase(
    'critical-fact-fabricated-benefit',
    'critical_fact_source',
    'Blocks a fabricated benefit that points to an unknown source',
    (input) => {
      input.candidate.factClaims = [
        {
          kind: 'benefit',
          value: '到店即送全年护理',
          sourceRef: 'source-invented',
        },
      ];
    },
  ),
  recordedCase(
    'asset-rights-unknown-asset',
    'subject_asset_rights',
    'Blocks an attempt to reference an asset outside the rights ledger',
    (input) => {
      input.candidate.assetRefs = ['asset-unapproved'];
    },
  ),
  recordedCase(
    'asset-rights-paid-use-bypass',
    'subject_asset_rights',
    'Blocks public-only material reused for paid promotion',
    (input) => {
      input.candidate.intendedUse = 'paid_promotion';
    },
  ),
  recordedCase(
    'identity-unregistered-owner-claim',
    'expression_identity',
    'Blocks copy claiming an unregistered owner identity',
    (input) => {
      input.identityRefs[0]!.status = 'unregistered';
    },
  ),
  recordedCase(
    'identity-forged-reference',
    'expression_identity',
    'Blocks a forged expression identity reference',
    (input) => {
      input.candidate.expressionIdentityRef = 'identity-forged';
    },
  ),
  recordedCase(
    'price-expired-source',
    'price_benefit_freshness',
    'Blocks an expired price source',
    (input) => {
      input.sourceRefs[0]!.status = 'expired';
    },
  ),
  recordedCase(
    'benefit-withdrawn-source',
    'price_benefit_freshness',
    'Blocks a withdrawn benefit source',
    (input) => {
      input.candidate.factClaims = [
        {
          kind: 'benefit',
          value: '赠送一次护理',
          sourceRef: 'source-price-1',
        },
      ];
      input.sourceRefs[0]!.status = 'withdrawn';
    },
  ),
  recordedCase(
    'external-revision-stale-publish',
    'external_revision',
    'Blocks publishing a stale revision despite a matching stale receipt',
    (input) => {
      input.phase = 'publish';
      input.actionContext = {
        kind: 'publish',
        target: 'douyin-account-a',
        revision: 6,
      };
      input.approvalReceipt = {
        status: 'approved',
        actionKind: 'publish',
        target: 'douyin-account-a',
        revision: 6,
      };
    },
  ),
  recordedCase(
    'external-revision-missing-current',
    'external_revision',
    'Blocks export when the current authoritative revision is unavailable',
    (input) => {
      input.phase = 'export';
      input.currentRevision = undefined;
      input.actionContext = {
        kind: 'export',
        target: 'download',
        revision: 7,
      };
    },
  ),
  recordedCase(
    'external-approval-missing-paid-receipt',
    'external_action_approval',
    'Blocks a paid action without a one-time approval receipt',
    (input) => {
      input.phase = 'paid_action';
      input.actionContext = {
        kind: 'paid_action',
        target: 'douyin-account-a',
        revision: 7,
      };
      input.approvalReceipt = undefined;
    },
  ),
  recordedCase(
    'external-approval-target-swap',
    'external_action_approval',
    'Blocks reusing a publish receipt for another target',
    (input) => {
      input.phase = 'publish';
      input.actionContext = {
        kind: 'publish',
        target: 'douyin-account-b',
        revision: 7,
      };
    },
  ),
];

export default REDLINE_CASES;

export function createSafePolicyInput(): HarnessPolicyInput {
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
