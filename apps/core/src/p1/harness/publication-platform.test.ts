/**
 * Regression: offline/moments destinations must not throw in assembleAndDeliver.
 * Found by /qa on 2026-08-07
 * Report: .gstack/qa-reports/qa-report-localhost-3000-2026-08-07.md
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { publicationPlatform } from './production-stage-ports.ts';

test('publication platforms that need delivery approval stay mapped', () => {
  assert.equal(publicationPlatform('xiaohongshu'), 'xiaohongshu');
  assert.equal(publicationPlatform('douyin'), 'douyin');
  assert.equal(publicationPlatform('video_account'), 'video_account');
});

test('export and handoff destinations omit delivery-approval platform', () => {
  // Regression: ISSUE-002 — Platform offline does not support delivery approval
  assert.equal(publicationPlatform('wechat_moments'), undefined);
  assert.equal(publicationPlatform('offline'), undefined);
});

test('unknown platforms still fail closed', () => {
  assert.throws(
    () => publicationPlatform('not-a-platform'),
    /does not support delivery approval/u,
  );
});
