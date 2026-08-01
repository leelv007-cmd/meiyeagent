import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deliveryTargetForIntent,
  deliveryViewportFromWidth,
  resolveCanonicalDeliveryPlatform,
} from './delivery-viewport';

test('real mobile width selects the full-height mobile delivery surface', () => {
  assert.equal(deliveryViewportFromWidth(390), 'mobile');
  assert.equal(deliveryViewportFromWidth(768), 'desktop');
});

test('朋友圈 intent exposes the wechat_moments distribution target', () => {
  assert.equal(
    deliveryTargetForIntent('copy', '朋友圈项目介绍，分段发布'),
    'wechat_moments'
  );
  assert.equal(deliveryTargetForIntent('video', '抖音项目成片'), 'douyin');
  assert.equal(
    deliveryTargetForIntent('video', '微信视频号项目成片'),
    'video_account'
  );
  assert.equal(deliveryTargetForIntent('image', '小红书封面'), 'xiaohongshu');
});

test('durable package platform wins over mutable intent with a legacy fallback', () => {
  const durablePackage = {
    source: { targetPlatform: 'xiaohongshu' as const },
  };
  const genericPackage = {
    source: {},
    variants: [{ platform: 'xiaohongshu' as const }],
  };
  const legacyPackage = {
    legacySource: {
      mappingConfidence: 'exact' as const,
      sourceId: 'legacy-content-1',
      sourceType: 'product_content_item' as const,
    },
    source: {},
  };

  assert.equal(
    resolveCanonicalDeliveryPlatform(durablePackage, 'douyin'),
    'xiaohongshu'
  );
  assert.equal(
    resolveCanonicalDeliveryPlatform(genericPackage, 'xiaohongshu'),
    null
  );
  assert.equal(
    resolveCanonicalDeliveryPlatform(legacyPackage, 'video_account'),
    'video_account'
  );
  assert.equal(
    resolveCanonicalDeliveryPlatform(undefined, 'xiaohongshu'),
    'xiaohongshu'
  );
  assert.equal(
    resolveCanonicalDeliveryPlatform(legacyPackage, 'wechat_moments'),
    null
  );
});
