import assert from 'node:assert/strict';
import test from 'node:test';
import { QUICK_EDIT_ACTIONS } from '@meiye/contracts';

import {
  buildContentPackageQuickEdit,
  CONTENT_PACKAGE_QUICK_EDIT_ACTION_CONFIG,
} from './content-package-quick-edit';

const baseVersion = {
  body: '夏日美甲新色上新，限时优惠，立即抢购。适合想要清透显白效果的顾客，到店可以先做色卡对比。',
  conversionHook: '立即抢购',
  createdAt: '2026-07-18T00:00:00.000Z',
  id: 'version-2',
  orderedAssetIds: ['asset-1', 'asset-2'],
  title: '夏日美甲新色',
  topics: ['美甲', '同城'],
};

const contentPackage = {
  generated: {
    assetIds: ['asset-2', 'asset-3'],
    childRuns: [],
  },
  marketing: {
    capabilities: {
      asyncRecovery: true,
      factsAndRights: true,
      mainRecommendation: true,
      platformDeliverables: true,
      publishExport: true,
      quickEdit: true,
      remix: true,
    },
    contextBundle: {
      bundleId: 'bundle-1',
      hash: 'a'.repeat(64),
      revision: 2,
    },
    factRefs: ['store_fact:price-1:2'],
    identityFallback: 'none' as const,
    identityRefs: [],
    promotionOffer: {
      callToAction: {
        kind: 'contact' as const,
        label: '私信预约',
        mode: 'manual' as const,
      },
      priceText: '398 元',
      sourceRefs: ['store_fact:price-1:2'],
      status: 'verified' as const,
    },
    rightsRefs: ['asset-rights:1'],
    scene: 'promotion_groupbuy_conversion' as const,
  },
  source: { assetIds: ['asset-1'] },
};

const expectedRoutes = {
  appointment_card: { exportUse: 'appointment_card', target: 'export_use' },
  identity_brand: { target: 'package_version' },
  identity_person: { target: 'package_version' },
  image_set: { exportUse: 'image_set', target: 'export_use' },
  natural_language: { target: 'package_version' },
  offline_material_export: {
    exportUse: 'offline_material',
    target: 'export_use',
  },
  platform_variant: { target: 'platform_variant' },
  poster: { exportUse: 'poster', target: 'export_use' },
  promotion_stronger: { target: 'package_version' },
  promotion_weaker: { target: 'package_version' },
  replace_assets: { target: 'package_version' },
  spoken_script: { exportUse: 'spoken_script', target: 'export_use' },
  wechat_moments_export: {
    exportUse: 'wechat_moments',
    target: 'export_use',
  },
} as const;

const editableFields = [
  'body',
  'conversionHook',
  'orderedAssetIds',
  'title',
  'topics',
] as const;

test('every quick action emits its declared route and a non-empty allowed change set', () => {
  for (const action of QUICK_EDIT_ACTIONS) {
    const result = buildContentPackageQuickEdit({
      action,
      baseVersion,
      contentPackage,
      instruction:
        action === 'natural_language' ? '改成更短的项目介绍' : undefined,
    });
    const changedFields = editableFields.filter(
      (field) =>
        JSON.stringify(result.changes[field]) !==
        JSON.stringify(baseVersion[field])
    );

    assert.deepEqual(
      {
        ...(result.intent.exportUse
          ? { exportUse: result.intent.exportUse }
          : {}),
        target: result.intent.target,
      },
      expectedRoutes[action],
      action
    );
    assert.ok(changedFields.length > 0, `${action} must change content`);
    assert.ok(
      changedFields.every((field) =>
        CONTENT_PACKAGE_QUICK_EDIT_ACTION_CONFIG[action].allowedFields.includes(
          field
        )
      ),
      `${action} changed a field outside its declaration`
    );
    assert.deepEqual(result.intent.preservedFactRefs, ['store_fact:price-1:2']);
    assert.deepEqual(result.intent.preservedRightsRefs, ['asset-rights:1']);
  }
});

test('the six export and material actions have distinct export-use routes', () => {
  const exportUses = QUICK_EDIT_ACTIONS.flatMap((action) => {
    const config = CONTENT_PACKAGE_QUICK_EDIT_ACTION_CONFIG[action];
    return config.target === 'export_use' ? [config.exportUse] : [];
  });

  assert.deepEqual(exportUses, [
    'wechat_moments',
    'offline_material',
    'poster',
    'image_set',
    'spoken_script',
    'appointment_card',
  ]);
  assert.equal(new Set(exportUses).size, 6);
});

test('quick edit remains bound to the exact base version and frozen references', () => {
  const result = buildContentPackageQuickEdit({
    action: 'promotion_weaker',
    baseVersion,
    contentPackage,
  });

  assert.equal(result.intent.scope, 'current_task');
  assert.equal(result.intent.baseVersionId, 'version-2');
  assert.deepEqual(result.intent.preservedFactRefs, ['store_fact:price-1:2']);
  assert.deepEqual(result.intent.preservedRightsRefs, ['asset-rights:1']);
});
