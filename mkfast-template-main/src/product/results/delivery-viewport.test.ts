import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deliveryTargetForIntent,
  deliveryViewportFromWidth,
} from './delivery-viewport';

test('real mobile width selects the full-height mobile delivery surface', () => {
  assert.equal(deliveryViewportFromWidth(390), 'mobile');
  assert.equal(deliveryViewportFromWidth(768), 'desktop');
});

test('朋友圈 intent exposes the wechat_moments distribution target', () => {
  assert.equal(
    deliveryTargetForIntent('copy', '朋友圈项目介绍，分段发布'),
    'wechat_moments',
  );
  assert.equal(deliveryTargetForIntent('video', '抖音项目成片'), 'douyin');
  assert.equal(deliveryTargetForIntent('image', '小红书封面'), 'xiaohongshu');
});
