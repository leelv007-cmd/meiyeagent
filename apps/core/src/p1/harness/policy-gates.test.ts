import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractVisibleClaims,
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

test('delivery blocks malicious visible copy even when reported claims are empty', () => {
  const input = safePolicyInput();
  input.phase = 'export';
  input.candidate.factClaims = [];
  input.candidate.visibleText = [
    { field: 'title', text: '国家认证五星机构，团购价398元' },
    { field: 'body', text: '到店即送全年护理' },
    { field: 'cta', text: '立即抢购' },
  ];

  const result = validateHarnessPolicy(input);

  assert.equal(result.passed, false);
  assert.equal(result.failures[0]?.gateId, 'critical_fact_source');
  assert.equal(
    result.failures[0]?.reason,
    '成品文案含有未被门店已确认资料支持的资质、价格或权益，暂不能交付。',
  );
});

test('visible claim extraction is deterministic for the same delivery fields', () => {
  const visibleText = [
    { field: 'title', text: '国家认证五星机构，团购价398元' },
    { field: 'body', text: '到店即送全年护理' },
    { field: 'cta', text: '立即抢购' },
  ];

  const first = extractVisibleClaims(visibleText);
  const second = extractVisibleClaims(visibleText);

  assert.deepEqual(first, second);
  assert.equal(first.revision, 'visible-claim-extractor-v1');
  assert.match(first.inputHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(
    first.claims.map(({ field, kind }) => ({ field, kind })),
    [
      { field: 'title', kind: 'qualification' },
      { field: 'title', kind: 'qualification' },
      { field: 'title', kind: 'price' },
      { field: 'body', kind: 'benefit' },
    ],
  );
});

test('visible claim extraction does not add a generation-time block', () => {
  const input = safePolicyInput();
  input.candidate.factClaims = [];
  input.candidate.visibleText = [
    { field: 'title', text: '国家认证五星机构，团购价398元' },
    { field: 'body', text: '到店即送全年护理' },
  ];

  const result = validateHarnessPolicy(input);

  assert.equal(result.passed, true);
  assert.equal(result.claimExtraction, undefined);
});

test('delivery accepts a visible price backed by a trusted current fact', () => {
  const input = safePolicyInput();
  input.phase = 'delivery';
  input.candidate.factClaims = [];
  input.candidate.visibleText = [
    { field: 'title', text: '团购价398元' },
  ];
  input.trustedFactClaims = [
    { kind: 'price', value: '398', sourceRef: 'source-price-1' },
  ];

  const result = validateHarnessPolicy(input);

  assert.equal(result.passed, true);
});

test('delivery uses the production offer vocabulary for common promotion rewrites', () => {
  const samples = [
    '秒杀价388',
    '限时价 ¥298 起',
    '只要398块钱',
    '全场3.8折',
    '满1000减300',
    '买一送一',
    '第2件半价',
    '卫健委批准',
    '三甲医院合作',
  ];

  for (const text of samples) {
    const extraction = extractVisibleClaims([{ field: 'body', text }]);
    assert.ok(extraction.claims.length > 0, text);

    const input = safePolicyInput();
    input.phase = 'delivery';
    input.candidate.factClaims = [];
    input.candidate.visibleText = [{ field: 'body', text }];
    const result = validateHarnessPolicy(input);
    assert.equal(result.passed, false, text);
    assert.equal(result.failures[0]?.gateId, 'critical_fact_source', text);
  }
});

test('trusted numeric facts support only complete matching visible numbers', () => {
  const trustedValue = JSON.stringify({
    amount: 398,
    currency: 'CNY',
    item: '光子嫩肤单次',
    validUntil: '2026-07-31',
  });

  for (const [amount, expectedPassed] of [
    [398, true],
    [1, false],
    [3, false],
    [7, false],
    [8, false],
    [9, false],
    [31, false],
    [39, false],
    [2026, false],
    [1288, false],
  ] as const) {
    const input = safePolicyInput();
    input.phase = 'delivery';
    input.candidate.factClaims = [];
    input.candidate.visibleText = [
      { field: 'title', text: `团购价${amount}元` },
    ];
    input.trustedFactClaims = [
      { kind: 'price', value: trustedValue, sourceRef: 'source-price-1' },
    ];

    assert.equal(
      validateHarnessPolicy(input).passed,
      expectedPassed,
      `visible amount ${amount}`,
    );
  }
});

test('delivery accepts legitimate promotion copy backed by confirmed facts', () => {
  const input = safePolicyInput();
  input.phase = 'delivery';
  input.candidate.factClaims = [];
  input.candidate.visibleText = [
    { field: 'title', text: '光子嫩肤团购价398元' },
    { field: 'body', text: '限时优惠，立减50元，效果自然' },
    { field: 'cta', text: '立即预约' },
  ];
  input.trustedFactClaims = [
    {
      kind: 'price',
      value: JSON.stringify({ amount: 398, currency: 'CNY' }),
      sourceRef: 'source-price-1',
    },
    {
      kind: 'benefit',
      value: JSON.stringify({ amount: 50, kind: 'discount' }),
      sourceRef: 'source-price-1',
    },
  ];

  assert.equal(validateHarnessPolicy(input).passed, true);
});

test('critical fact rejection names the triggering visible claim family', () => {
  const qualification = safePolicyInput();
  qualification.phase = 'delivery';
  qualification.candidate.factClaims = [];
  qualification.candidate.visibleText = [
    { field: 'title', text: '卫健委批准的正规医美机构' },
  ];
  const qualificationResult = validateHarnessPolicy(qualification);

  assert.equal(qualificationResult.passed, false);
  assert.match(qualificationResult.failures[0]?.reason ?? '', /资质/);
  assert.doesNotMatch(qualificationResult.failures[0]?.reason ?? '', /价格或权益/);

  const offer = safePolicyInput();
  offer.phase = 'delivery';
  offer.candidate.factClaims = [];
  offer.candidate.visibleText = [
    { field: 'body', text: '满1000减300' },
  ];
  const offerResult = validateHarnessPolicy(offer);

  assert.equal(offerResult.passed, false);
  assert.match(offerResult.failures[0]?.reason ?? '', /价格或优惠/);
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
