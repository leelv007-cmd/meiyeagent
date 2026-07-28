import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROMOTIONAL_MATERIAL_SPECS,
  editContentPackageVersionCommandSchema,
  hotTopicOpportunityCardSchema,
  marketingIdentityAssetSchema,
  marketingIdentityProjectionSchema,
  marketingPackageEvidenceSchema,
  promotionalMaterialReceiptExtensionSchema,
  promotionOfferCardSchema,
  quickEditExportUseDeliverySchema,
  quickEditIntentSchema,
  registerMarketingIdentityCommandSchema,
  selectMarketingIdentityForSessionCommandSchema,
  setDefaultMarketingIdentityCommandSchema,
} from './index.js';

test('an unpriced promotion cannot carry concrete discount copy', () => {
  const parsed = promotionOfferCardSchema.safeParse({
    status: 'unpriced',
    sourceRefs: [],
    priceText: '体验价 99 元',
    callToAction: {
      kind: 'contact',
      mode: 'manual',
      label: '私信了解当期价格',
    },
  });

  assert.equal(parsed.success, false);
});

test('a promotional material receipt extension preserves honest fallback provenance', () => {
  const receipt = promotionalMaterialReceiptExtensionSchema.parse({
    capabilityStatus: 'assisted',
    missingMaterialFallback: 'text_only',
    outputSha256: 'b'.repeat(64),
    provenanceRef: 'canvas-revision-2',
  });

  assert.deepEqual(receipt, {
    capabilityStatus: 'assisted',
    missingMaterialFallback: 'text_only',
    outputSha256: 'b'.repeat(64),
    provenanceRef: 'canvas-revision-2',
  });
});

test('a historical traffic package parses but transforms to current evidence', () => {
  const opportunity = hotTopicOpportunityCardSchema.parse({
    opportunityId: 'opportunity-1',
    status: 'active',
    source: 'https://example.com/trend',
    sourceType: 'user_link',
    capturedAt: '2026-07-18T00:00:00.000Z',
    expiresAt: '2026-07-19T00:00:00.000Z',
    platforms: ['xiaohongshu'],
    region: '上海',
    targetAudience: '周边有染发需求的顾客',
    matchedStoreReferences: ['store-fact:service:1'],
    relevanceExplanation: '话题与门店当期染发项目相关。',
    reusableMechanism: '保留话题结构，替换门店证据。',
    expectedAction: '咨询适合自己的发色。',
    evergreenFallback: '转为常青的发色选择指南。',
    protectedExpressionCopied: false,
  });
  const result = marketingPackageEvidenceSchema.parse({
    scene: 'traffic_opportunity',
    contextBundle: {
      bundleId: 'bundle-1',
      revision: 1,
      hash: 'a'.repeat(64),
    },
    factRefs: ['store-fact:service:1'],
    rightsRefs: [],
    identityRefs: [],
    opportunity,
  });

  assert.equal(result.declaration.taskType, 'traffic_opportunity');
  assert.equal('capabilities' in result, false);
  assert.equal('opportunity' in result, false);
});

test('a quick edit stays on the current task and exact base version', () => {
  const result = editContentPackageVersionCommandSchema.safeParse({
    baseVersionId: 'version-2',
    changes: {
      title: '新标题',
      body: '新正文',
      conversionHook: '私信咨询',
      orderedAssetIds: [],
      topics: [],
    },
    expectedRevision: 3,
    packageId: 'package-1',
    intent: {
      action: 'promotion_weaker',
      instruction: '促销感弱一点',
      target: 'package_version',
      scope: 'current_task',
      baseVersionId: 'version-1',
      preservedFactRefs: ['store-fact:price:2'],
      preservedRightsRefs: ['asset-rights:1'],
    },
  });

  assert.equal(result.success, false);
});

test('an export-use quick edit requires its differentiated route', () => {
  const base = {
    action: 'poster',
    baseVersionId: 'version-2',
    instruction: '生成海报版',
    preservedFactRefs: ['store-fact:service:1'],
    preservedRightsRefs: ['asset-rights:1'],
    scope: 'current_task',
    target: 'export_use',
  } as const;

  assert.equal(quickEditIntentSchema.safeParse(base).success, false);
  assert.equal(
    quickEditIntentSchema.safeParse({ ...base, exportUse: 'poster' }).success,
    true
  );
  assert.equal(
    quickEditIntentSchema.safeParse({
      ...base,
      exportUse: 'poster',
      target: 'package_version',
    }).success,
    false
  );
});

test('a historical light composer carrier remains readable without trusted lineage', () => {
  const result = quickEditExportUseDeliverySchema.parse({
    exportUse: 'poster',
    kind: 'light_composer',
    materialSpecs: [
      PROMOTIONAL_MATERIAL_SPECS.find(
        (spec) => spec.purpose === 'wechat_moments_poster'
      )!,
    ],
    receiptCommand: 'export_work',
    sourceWorkId: 'historical-work-1',
    templateRole: 'poster',
  });

  assert.equal(result.kind, 'light_composer');
  assert.equal(result.sourcePackageId, undefined);
  assert.equal(result.sourceVersionId, undefined);
});

test('identity default and session selection stay separate revision-bound decisions', () => {
  const identity = { identityId: 'identity-brand', version: 3 };
  assert.deepEqual(
    setDefaultMarketingIdentityCommandSchema.parse({
      expectedDecisionRevision: 0,
      identity,
      reason: 'Remember the owner voice selected in Composer.',
    }),
    {
      expectedDecisionRevision: 0,
      identity,
      reason: 'Remember the owner voice selected in Composer.',
    }
  );
  assert.deepEqual(
    selectMarketingIdentityForSessionCommandSchema.parse({
      identity,
      reason: 'Use the owner voice for this creation only.',
      sessionId: 'composer-session-1',
    }),
    {
      identity,
      reason: 'Use the owner voice for this creation only.',
      sessionId: 'composer-session-1',
    }
  );
  assert.equal(
    setDefaultMarketingIdentityCommandSchema.safeParse({
      identity: { identityId: 'identity-brand' },
    }).success,
    false
  );
});

test('canonical identity projection carries the remembered default revision', () => {
  const projection = marketingIdentityProjectionSchema.parse({
    identities: [],
    defaultDecision: {
      decisionId: 'decision-default-2',
      decisionRevision: 2,
      identity: { identityId: 'identity-brand', version: 3 },
    },
    defaultIdentity: { identityId: 'identity-brand', version: 3 },
    decisionRevision: 2,
  });

  assert.deepEqual(projection.defaultIdentity, {
    identityId: 'identity-brand',
    version: 3,
  });
});

// W12② / D-142 — provenance is field-level, and the consent record is off
// limits to anything but the merchant.
const BRAND_REGISTRATION = {
  identityId: 'identity-brand-provenance',
  expectedVersion: 0,
  kind: 'brand',
  displayName: '青禾美业',
  owner: '青禾品牌中心',
  professionalBoundaries: ['不提供医疗诊断'],
  allowedPlatforms: ['xiaohongshu'],
  allowedScenes: ['brand_personal_ip'],
  expressionSamples: ['先看你的情况再说'],
  effectiveFrom: '2026-07-28T00:00:00.000Z',
  expiresAt: null,
  departureHandling: '撤回后停止生成新内容。',
  sourceRef: 'brand-guideline-2026',
  brandClaims: ['让专业护理更安心'],
  forbiddenClaims: [],
  visualPrinciples: [],
  seriesAnchors: [],
} as const;

test('a registered identity can say which of its lines the merchant wrote', () => {
  const command = registerMarketingIdentityCommandSchema.parse({
    ...BRAND_REGISTRATION,
    fieldProvenance: {
      displayName: 'ai_suggestion',
      brandClaims: 'document',
      owner: 'user',
      sourceRef: 'user',
      allowedPlatforms: 'user',
      allowedScenes: 'user',
    },
  });

  assert.equal(command.fieldProvenance?.displayName, 'ai_suggestion');
  assert.equal(command.fieldProvenance?.brandClaims, 'document');
});

test('an identity registered before provenance existed stays parseable', () => {
  const command = registerMarketingIdentityCommandSchema.parse(
    BRAND_REGISTRATION
  );

  // Absent means unknown. Writing `user` over that would be the same silent
  // answering on the merchant's behalf that D-142 removed.
  assert.equal(command.fieldProvenance, undefined);
});

test('the authorized reach can never be recorded as something a model proposed', () => {
  for (const field of [
    'sourceRef',
    'allowedPlatforms',
    'allowedScenes',
  ] as const) {
    for (const provenance of ['ai_suggestion', 'document'] as const) {
      const parsed = registerMarketingIdentityCommandSchema.safeParse({
        ...BRAND_REGISTRATION,
        fieldProvenance: { [field]: provenance },
      });
      assert.equal(
        parsed.success,
        false,
        `${field} must not accept ${provenance}`
      );
    }
  }
});

test('a stored identity carries the same provenance rule as the command', () => {
  const parsed = marketingIdentityAssetSchema.safeParse({
    ...BRAND_REGISTRATION,
    expectedVersion: undefined,
    workspaceId: 'workspace-1',
    version: 1,
    status: 'active',
    createdAt: '2026-07-28T00:00:00.000Z',
    createdBy: 'user-1',
    fieldProvenance: { portraitAuthorization: 'ai_suggestion' },
  });

  assert.equal(parsed.success, false);
});
