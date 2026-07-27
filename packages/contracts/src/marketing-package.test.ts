import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROMOTIONAL_MATERIAL_SPECS,
  editContentPackageVersionCommandSchema,
  hotTopicOpportunityCardSchema,
  marketingIdentityProjectionSchema,
  marketingPackageEvidenceSchema,
  promotionalMaterialReceiptExtensionSchema,
  promotionOfferCardSchema,
  quickEditExportUseDeliverySchema,
  quickEditIntentSchema,
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

test('a traffic package requires the complete sourced opportunity card', () => {
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

  assert.equal(result.opportunity?.protectedExpressionCopied, false);
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
