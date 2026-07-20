/**
 * Three-modal full package download fixtures (#101 acceptance).
 * 小红书包 / 抖音视频包 / 朋友圈分段
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { BEAUTY_DELIVERY_MANIFEST_SCHEMA } from './delivery-b3-types';
import {
  buildDeliveryZipFileName,
  douyinVideoPackageFixture,
  recordFullPackageDownload,
  wechatMomentsSegmentsFixture,
  xiaohongshuPackageFixture,
} from './delivery-full-package';

test('xiaohongshu image_text full package: manifest/v1 + ordered images + ZIP name', () => {
  const plan = xiaohongshuPackageFixture();

  assert.equal(plan.modality, 'xiaohongshu_image_text');
  assert.equal(plan.kind, 'image_text');
  assert.equal(plan.target, 'xiaohongshu');
  assert.equal(plan.schema, BEAUTY_DELIVERY_MANIFEST_SCHEMA);
  assert.ok(plan.manifest);
  assert.equal(plan.manifest?.schema, BEAUTY_DELIVERY_MANIFEST_SCHEMA);
  assert.equal(plan.manifest?.platform, 'xiaohongshu');
  assert.equal(plan.manifest?.kind, 'image_text');

  const paths = plan.files.map((f) => f.path);
  assert.ok(paths.includes('caption.txt'));
  assert.ok(paths.includes('cover.jpg'));
  assert.ok(paths.includes('images/01.jpg'));
  assert.ok(paths.includes('images/02.jpg'));
  assert.ok(paths.includes('platform-checklist.md'));
  assert.ok(paths.includes('evidence/rights-and-facts.json'));

  // Image order preserved in manifest (publish order, not FS order).
  const imageEntries = plan.manifest!.files.filter((f) => f.role === 'image');
  assert.equal(imageEntries[0]?.path, 'images/01.jpg');
  assert.equal(imageEntries[1]?.path, 'images/02.jpg');
  assert.ok(imageEntries[0]!.order < imageEntries[1]!.order);

  assert.equal(
    plan.zipFileName,
    buildDeliveryZipFileName({
      contentPackageRevision: 3,
      generatedAt: '2026-07-18T09:00:00.000Z',
      kind: 'image_text',
      platform: 'xiaohongshu',
      storeName: '花间美甲',
    }),
  );
  assert.match(plan.zipFileName!, /花间美甲-图文-小红书-20260718-r3\.zip$/u);

  const download = recordFullPackageDownload(plan);
  assert.equal(download.downloadStarted, true);
  assert.equal(download.deliveredAs, 'full_package_download');
  assert.equal(download.modality, 'xiaohongshu_image_text');
  assert.equal(download.fileName, plan.zipFileName);
});

test('douyin video full package: video/cover/caption/subtitles + manifest/v1', () => {
  const plan = douyinVideoPackageFixture();

  assert.equal(plan.modality, 'douyin_video');
  assert.equal(plan.kind, 'video');
  assert.equal(plan.target, 'douyin');
  assert.equal(plan.schema, BEAUTY_DELIVERY_MANIFEST_SCHEMA);
  assert.equal(plan.manifest?.platform, 'douyin');
  assert.equal(plan.manifest?.kind, 'video');

  const paths = plan.files.map((f) => f.path);
  assert.ok(paths.includes('video.mp4'));
  assert.ok(paths.includes('cover.jpg'));
  assert.ok(paths.includes('caption.txt'));
  assert.ok(paths.includes('subtitles.srt'));
  assert.ok(paths.includes('platform-checklist.md'));
  assert.ok(paths.includes('evidence/rights-and-facts.json'));

  const roles = new Set(plan.manifest!.files.map((f) => f.role));
  assert.ok(roles.has('video'));
  assert.ok(roles.has('cover'));
  assert.ok(roles.has('caption'));
  assert.ok(roles.has('subtitles'));
  assert.ok(roles.has('checklist'));
  assert.ok(roles.has('rights_evidence'));

  assert.match(plan.zipFileName!, /花间美甲-视频-抖音-20260718-r5\.zip$/u);

  const download = recordFullPackageDownload(plan);
  assert.equal(download.downloadStarted, true);
  assert.equal(download.deliveredAs, 'full_package_download');
  assert.equal(download.modality, 'douyin_video');
});

test('wechat_moments segments package: sequential caption + media, not ZIP platform', () => {
  const plan = wechatMomentsSegmentsFixture();

  assert.equal(plan.modality, 'wechat_moments_segments');
  assert.equal(plan.kind, 'moments_segments');
  assert.equal(plan.target, 'wechat_moments');
  assert.equal(plan.schema, 'moments-segments/v1');
  assert.equal(plan.manifest, undefined);
  assert.equal(plan.zipFileName, undefined);

  assert.ok(plan.segments);
  assert.ok(plan.segments!.length >= 3);

  const segmentIds = plan.segments!.map((s) => s.id);
  assert.ok(segmentIds.includes('title'));
  assert.ok(segmentIds.includes('body'));
  assert.ok(segmentIds.includes('media'));

  const title = plan.segments!.find((s) => s.id === 'title');
  assert.equal(title?.text, '本周活动');

  const media = plan.segments!.find((s) => s.id === 'media');
  assert.ok(media?.media);
  assert.equal(media!.media!.length, 2);
  assert.equal(media!.media![0]?.path, 'media/01.jpg');

  const download = recordFullPackageDownload(plan);
  assert.equal(download.downloadStarted, true);
  assert.equal(download.deliveredAs, 'full_package_download');
  assert.equal(download.modality, 'wechat_moments_segments');
  assert.match(download.fileName, /朋友圈分段/u);
});

test('three modalities each produce a downloadable full package outcome', () => {
  const modalities = [
    xiaohongshuPackageFixture(),
    douyinVideoPackageFixture(),
    wechatMomentsSegmentsFixture(),
  ];

  const outcomes = modalities.map(recordFullPackageDownload);
  assert.equal(outcomes.length, 3);
  for (const outcome of outcomes) {
    assert.equal(outcome.downloadStarted, true);
    assert.equal(outcome.deliveredAs, 'full_package_download');
    assert.ok(outcome.fileName.length > 0);
    assert.ok(outcome.packageId.length > 0);
  }

  const kinds = new Set(outcomes.map((o) => o.modality));
  assert.deepEqual(
    [...kinds].sort(),
    [
      'douyin_video',
      'wechat_moments_segments',
      'xiaohongshu_image_text',
    ].sort(),
  );
});

test('manifest must not claim published; download is local file delivery only', () => {
  const plan = xiaohongshuPackageFixture();
  const download = recordFullPackageDownload(plan);
  assert.notEqual(download.deliveredAs, 'published');
  assert.equal(download.deliveredAs, 'full_package_download');
});
