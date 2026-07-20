import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  BEAUTY_DELIVERY_MANIFEST_SCHEMA,
  buildBeautyDeliveryManifest,
  serializeBeautyDeliveryManifest,
  validateBeautyDeliveryManifest,
} from './delivery-manifest.js';
import {
  buildDeliveryZipFileName,
  buildImageTextDeliveryPackage,
  buildVideoFullDeliveryPackage,
  packDeterministicZip,
  sanitizeDeliveryZipSegment,
} from './delivery-package.js';

function sha(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('beauty-delivery-manifest/v1 schema accepts a complete document', () => {
  const image = Uint8Array.from([1, 2, 3, 4]);
  const manifest = buildBeautyDeliveryManifest({
    contentPackageRevision: 2,
    files: [
      {
        bytes: image,
        mimeType: 'image/jpeg',
        path: 'images/01.jpg',
        role: 'image',
      },
    ],
    generatedAt: '2026-07-18T09:00:00.000Z',
    kind: 'image_text',
    packageId: 'pkg-1',
    platform: 'xiaohongshu',
    rightsSummary: {
      aigcLabelEnabled: true,
      factSummary: '价格已核对',
      state: 'authorized',
      watermarkEnabled: false,
    },
    variantVersionId: 'v1',
  });

  assert.equal(manifest.schema, BEAUTY_DELIVERY_MANIFEST_SCHEMA);
  assert.equal(manifest.files[0]?.sha256, sha(image));
  assert.equal(manifest.files[0]?.sizeBytes, 4);
  assert.equal(manifest.files[0]?.order, 0);
  const validated = validateBeautyDeliveryManifest(manifest);
  assert.equal(validated.ok, true);
});

test('validator rejects Provider/Credential/hidden prompt fields', () => {
  const base = buildBeautyDeliveryManifest({
    contentPackageRevision: 0,
    files: [
      {
        bytes: Uint8Array.from([9]),
        mimeType: 'text/plain',
        path: 'caption.txt',
        role: 'caption',
      },
    ],
    generatedAt: '2026-07-18T09:00:00.000Z',
    kind: 'image_text',
    packageId: 'pkg-2',
    platform: 'douyin',
    rightsSummary: {
      aigcLabelEnabled: false,
      state: 'authorized',
      watermarkEnabled: false,
    },
    variantVersionId: 'v2',
  });

  for (const forbidden of [
    { provider: 'openai' },
    { credential: 'secret' },
    { hiddenPrompt: 'do not leak' },
    { rightsSummary: { ...base.rightsSummary, apiKey: 'x' } },
  ]) {
    const result = validateBeautyDeliveryManifest({ ...base, ...forbidden });
    assert.equal(result.ok, false, JSON.stringify(forbidden));
  }
});

test('validator rejects unknown schema and incomplete files', () => {
  assert.equal(
    validateBeautyDeliveryManifest({
      schema: 'beauty-delivery-manifest/v0',
      packageId: 'p',
      contentPackageRevision: 0,
      generatedAt: '2026-07-18T09:00:00.000Z',
      kind: 'image_text',
      platform: 'xiaohongshu',
      variantVersionId: 'v',
      rightsSummary: {
        aigcLabelEnabled: false,
        state: 'authorized',
        watermarkEnabled: false,
      },
      files: [
        {
          path: 'a',
          role: 'caption',
          order: 0,
          mimeType: 'text/plain',
          sizeBytes: 1,
          sha256: 'a'.repeat(64),
        },
      ],
    }).ok,
    false,
  );
});

test('image_text package is byte-identical on replay and includes manifest roles', () => {
  const imageBytes = Uint8Array.from([10, 20, 30, 40]);
  const input = {
    caption: {
      body: '正文',
      conversionHook: '私信',
      title: '标题',
      topics: ['美业'],
    },
    compliance: { aigcLabelEnabled: false, watermarkEnabled: false },
    contentPackageRevision: 4,
    generatedAt: '2026-07-20T08:00:00.000Z',
    images: [
      {
        bytes: imageBytes,
        mimeType: 'image/jpeg',
        path: 'images/01.jpg',
      },
    ],
    packageId: 'pkg-img',
    platform: 'xiaohongshu' as const,
    storeName: '清风美学',
    variantVersionId: 'ver-img',
  };

  const first = buildImageTextDeliveryPackage(input);
  const second = buildImageTextDeliveryPackage(input);
  assert.deepEqual(first.zipBytes, second.zipBytes);
  assert.equal(first.fileName, second.fileName);
  assert.equal(first.fileName, '清风美学-图文-小红书-20260720-r4.zip');

  assert.ok(first.files['manifest.json']);
  assert.ok(first.files['caption.txt']);
  assert.ok(first.files['cover.jpg']);
  assert.ok(first.files['images/01.jpg']);
  assert.ok(first.files['platform-checklist.md']);
  assert.ok(first.files['evidence/rights-and-facts.json']);

  const manifestText = new TextDecoder().decode(first.files['manifest.json']);
  const validated = validateBeautyDeliveryManifest(JSON.parse(manifestText));
  assert.equal(validated.ok, true);
  if (validated.ok) {
    const roles = validated.manifest.files.map((file) => file.role);
    assert.ok(roles.includes('caption'));
    assert.ok(roles.includes('cover'));
    assert.ok(roles.includes('image'));
    assert.ok(roles.includes('checklist'));
    assert.ok(roles.includes('rights_evidence'));
  }
});

test('video full package includes video/cover/caption/subtitles/checklist', () => {
  const videoBytes = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112]);
  const coverBytes = Uint8Array.from([255, 216, 255, 224]);
  const built = buildVideoFullDeliveryPackage({
    caption: {
      body: '视频正文',
      title: '视频标题',
      topics: ['同城'],
    },
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    contentPackageRevision: 1,
    cover: { bytes: coverBytes, mimeType: 'image/jpeg' },
    generatedAt: '2026-07-19T12:00:00.000Z',
    packageId: 'pkg-vid',
    platform: 'douyin',
    storeName: '门店A',
    subtitles: { format: 'srt', text: '1\n00:00:00,000 --> 00:00:01,000\nhi\n' },
    variantVersionId: 'ver-vid',
    video: { bytes: videoBytes },
  });

  assert.deepEqual(
    buildVideoFullDeliveryPackage({
      caption: {
        body: '视频正文',
        title: '视频标题',
        topics: ['同城'],
      },
      compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
      contentPackageRevision: 1,
      cover: { bytes: coverBytes, mimeType: 'image/jpeg' },
      generatedAt: '2026-07-19T12:00:00.000Z',
      packageId: 'pkg-vid',
      platform: 'douyin',
      storeName: '门店A',
      subtitles: {
        format: 'srt',
        text: '1\n00:00:00,000 --> 00:00:01,000\nhi\n',
      },
      variantVersionId: 'ver-vid',
      video: { bytes: videoBytes },
    }).zipBytes,
    built.zipBytes,
  );

  assert.ok(built.files['video.mp4']);
  assert.ok(built.files['cover.jpg']);
  assert.ok(built.files['caption.txt']);
  assert.ok(built.files['subtitles.srt']);
  assert.ok(built.files['platform-checklist.md']);
  assert.ok(built.files['manifest.json']);
  assert.equal(built.fileName, '门店A-视频-抖音-20260719-r1.zip');
  assert.equal(built.manifest.kind, 'video');
});

test('ZIP name sanitizes illegal characters and empty store names', () => {
  assert.equal(sanitizeDeliveryZipSegment('../evil\\name*', '门店'), 'evilname');
  assert.equal(sanitizeDeliveryZipSegment('   ', '门店'), '门店');
  assert.equal(
    buildDeliveryZipFileName({
      contentPackageRevision: 0,
      generatedAt: '2026-01-02T00:00:00.000Z',
      kind: 'image_text',
      platform: 'video_account',
      storeName: '',
    }),
    '门店-图文-视频号-20260102-r0.zip',
  );
});

test('packDeterministicZip is order-independent for the same file map', () => {
  const a = packDeterministicZip({
    'b.txt': new Uint8Array([2]),
    'a.txt': new Uint8Array([1]),
  });
  const b = packDeterministicZip({
    'a.txt': new Uint8Array([1]),
    'b.txt': new Uint8Array([2]),
  });
  assert.deepEqual(a, b);
});

test('serializeBeautyDeliveryManifest is stable', () => {
  const manifest = buildBeautyDeliveryManifest({
    contentPackageRevision: 1,
    files: [
      {
        bytes: Uint8Array.from([1]),
        mimeType: 'text/plain',
        path: 'caption.txt',
        role: 'caption',
      },
    ],
    generatedAt: '2026-07-18T09:00:00.000Z',
    kind: 'image_text',
    packageId: 'pkg',
    platform: 'xiaohongshu',
    rightsSummary: {
      aigcLabelEnabled: false,
      state: 'authorized',
      watermarkEnabled: false,
    },
    variantVersionId: 'v',
  });
  assert.equal(
    serializeBeautyDeliveryManifest(manifest),
    serializeBeautyDeliveryManifest(manifest),
  );
});
