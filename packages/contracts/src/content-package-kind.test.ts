import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contentPackageCarrierOf,
  contentPackageCarrierSchema,
  contentPackageCarriers,
  contentPackageKindSchema,
} from './content-package.js';

test('contentPackageKindSchema stays the two-value wire/storage kind', () => {
  // 分层合同（xhs-spec §3.1「迁移方式实施时定」的实施裁决）：wire/storage 口径
  // 不动，三枚举落在产品载体口径上。存量行与导出 manifest 因此零变更。
  assert.equal(contentPackageKindSchema.parse('image_text'), 'image_text');
  assert.equal(contentPackageKindSchema.parse('video'), 'video');
  assert.equal(contentPackageKindSchema.safeParse('note').success, false);
  assert.equal(contentPackageKindSchema.safeParse('media').success, false);
  assert.equal(contentPackageKindSchema.safeParse('copy').success, false);
});

test('contentPackageCarrierSchema is the media/copy/note product口径', () => {
  assert.deepEqual([...contentPackageCarriers], ['media', 'copy', 'note']);
  for (const carrier of contentPackageCarriers) {
    assert.equal(contentPackageCarrierSchema.parse(carrier), carrier);
  }
  assert.equal(
    contentPackageCarrierSchema.safeParse('image_text').success,
    false,
  );
});

test('contentPackageCarrierOf maps video packages to the media carrier', () => {
  assert.equal(
    contentPackageCarrierOf({ kind: 'video', orderedAssetCount: 1 }),
    'media',
  );
  // 视频包的载体不随媒资计数改变。
  assert.equal(
    contentPackageCarrierOf({ kind: 'video', orderedAssetCount: 0 }),
    'media',
  );
});

test('contentPackageCarrierOf splits image_text into copy and note by ordered media', () => {
  // ContentPackage v1 用同一个 image_text kind 承载 Composer 纯文案与图文成品，
  // 纯文案版本没有有序媒资（delivery-package.ts buildCopyDeliveryPackage 注释）。
  assert.equal(
    contentPackageCarrierOf({ kind: 'image_text', orderedAssetCount: 0 }),
    'copy',
  );
  assert.equal(
    contentPackageCarrierOf({ kind: 'image_text', orderedAssetCount: 1 }),
    'note',
  );
  assert.equal(
    contentPackageCarrierOf({ kind: 'image_text', orderedAssetCount: 9 }),
    'note',
  );
});

test('contentPackageCarrierOf is total over the wire kinds', () => {
  const seen = new Set(
    contentPackageKindSchema.options.flatMap((kind) => [
      contentPackageCarrierOf({ kind, orderedAssetCount: 0 }),
      contentPackageCarrierOf({ kind, orderedAssetCount: 3 }),
    ]),
  );
  assert.deepEqual([...seen].sort(), ['copy', 'media', 'note']);
});
