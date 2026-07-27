import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PublicContentPackage } from '@meiye/contracts';

import {
  buildResultFullPackagePlan,
  probeCanShareFiles,
  sharePayloadFilesFromPlan,
} from './delivery-full-package-live';

function packageFixture(
  overrides: Partial<PublicContentPackage> = {}
): PublicContentPackage {
  return {
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt: '2026-07-20T08:00:00.000Z',
    currentVersionId: 'pkg-a-v1',
    exportReceipts: [],
    generated: {
      assetIds: [],
      childRuns: [],
      ownedAssets: [
        {
          contentType: 'image/jpeg',
          id: 'asset-1',
          objectKey: 'o/1',
          sha256: 'a'.repeat(64),
          sizeBytes: 1200,
        },
        {
          contentType: 'image/png',
          id: 'asset-2',
          objectKey: 'o/2',
          sha256: 'b'.repeat(64),
          sizeBytes: 1300,
        },
      ],
    },
    id: 'pkg-a',
    kind: 'image_text',
    revision: 3,
    rights: { state: 'authorized' },
    source: { assetIds: [] },
    status: 'accepted',
    updatedAt: '2026-07-20T09:00:00.000Z',
    variants: [],
    versions: [
      {
        body: '到店立减 50。',
        conversionHook: '私信领优惠',
        createdAt: '2026-07-20T08:30:00.000Z',
        createdBy: 'user-a',
        id: 'pkg-a-v1',
        orderedAssetIds: ['asset-1', 'asset-2'],
        source: 'ai_generated',
        title: '夏日美甲',
        topics: ['美甲'],
      },
    ],
    workspaceId: 'ws-a',
    ...overrides,
  } as unknown as PublicContentPackage;
}

/** A composed video sits first in the version's selection, as core requires. */
function videoPackageFixture(): PublicContentPackage {
  const contentPackage = packageFixture();
  contentPackage.generated.ownedAssets = [
    {
      contentType: 'video/mp4',
      id: 'asset-v',
      objectKey: 'o/v',
      sha256: 'c'.repeat(64),
      sizeBytes: 50_000,
    },
    ...(contentPackage.generated.ownedAssets ?? []),
  ];
  contentPackage.versions[0]!.orderedAssetIds = [
    'asset-v',
    'asset-1',
    'asset-2',
  ];
  return contentPackage;
}

describe('full package plan producer', () => {
  it('builds a manifest-backed image_text plan from owned images', () => {
    const plan = buildResultFullPackagePlan({
      contentPackage: packageFixture(),
      nowIso: '2026-07-21T00:00:00.000Z',
      storeName: '花间美甲',
      target: 'xiaohongshu',
    });
    assert.ok(plan);
    assert.equal(plan.modality, 'xiaohongshu_image_text');
    assert.equal(plan.manifest?.contentPackageRevision, 3);
    assert.equal(plan.manifest?.files.length, plan.files.length);
    // Deterministic order: caption, cover, images, checklist, evidence.
    assert.deepEqual(
      plan.files.map((file) => file.role),
      ['caption', 'cover', 'image', 'image', 'checklist', 'rights_evidence']
    );
    assert.ok(plan.zipFileName);
  });

  it('builds the video plan when the package owns a composed video', () => {
    const contentPackage = videoPackageFixture();
    const plan = buildResultFullPackagePlan({
      contentPackage,
      nowIso: '2026-07-21T00:00:00.000Z',
      storeName: '花间美甲',
      target: 'douyin',
    });
    assert.equal(plan?.modality, 'douyin_video');
    assert.equal(plan?.target, 'douyin');
    assert.equal(plan?.manifest?.platform, 'douyin');
  });

  it('names a 视频号 package 视频号, not 抖音', () => {
    const plan = buildResultFullPackagePlan({
      contentPackage: videoPackageFixture(),
      nowIso: '2026-07-21T00:00:00.000Z',
      storeName: '花间美甲',
      target: 'video_account',
    });
    assert.equal(plan?.target, 'video_account');
    assert.equal(plan?.manifest?.platform, 'video_account');
    assert.match(plan?.zipFileName ?? '', /视频号/u);
    assert.doesNotMatch(plan?.zipFileName ?? '', /抖音/u);

    const imageText = buildResultFullPackagePlan({
      contentPackage: packageFixture(),
      nowIso: '2026-07-21T00:00:00.000Z',
      storeName: '花间美甲',
      target: 'video_account',
    });
    assert.equal(imageText?.manifest?.platform, 'video_account');
    assert.doesNotMatch(imageText?.zipFileName ?? '', /小红书/u);
  });

  it('carries only the assets this version delivers, never the package history', () => {
    const contentPackage = packageFixture();
    contentPackage.generated.ownedAssets = [
      ...(contentPackage.generated.ownedAssets ?? []),
      {
        contentType: 'image/jpeg',
        id: 'asset-dropped',
        objectKey: 'o/dropped',
        sha256: 'd'.repeat(64),
        sizeBytes: 9_000,
      },
    ];
    // Another platform's variant keeps its own selection; it is not this
    // version's material and must not reach this version's manifest.
    contentPackage.variants = [
      {
        currentVersionId: 'pkg-a-douyin-v1',
        id: 'pkg-a-douyin',
        platform: 'douyin',
        versions: [
          {
            body: '抖音版正文',
            createdAt: '2026-07-20T08:40:00.000Z',
            id: 'pkg-a-douyin-v1',
            orderedAssetIds: ['asset-dropped'],
            source: 'ai_generated',
            title: '抖音版',
            topics: [],
          },
        ],
      },
    ] as unknown as PublicContentPackage['variants'];

    const plan = buildResultFullPackagePlan({
      contentPackage,
      nowIso: '2026-07-21T00:00:00.000Z',
      storeName: '花间美甲',
      target: 'xiaohongshu',
    })!;
    assert.deepEqual(
      plan.files
        .filter((file) => file.role === 'image')
        .map((f) => f.sizeBytes),
      [1200, 1300]
    );
    assert.equal(
      plan.manifest?.files.some((file) => file.sizeBytes === 9_000),
      false
    );
    // cover + the two selected images only.
    assert.equal(sharePayloadFilesFromPlan(plan)?.[0]?.sizeBytes, 3700);

    // The 抖音 variant delivers its own one image and its own copy.
    const variantPlan = buildResultFullPackagePlan({
      contentPackage,
      nowIso: '2026-07-21T00:00:00.000Z',
      storeName: '花间美甲',
      target: 'douyin',
      variantVersionId: 'pkg-a-douyin-v1',
    })!;
    assert.deepEqual(
      variantPlan.files
        .filter((file) => file.role === 'image')
        .map((f) => f.sizeBytes),
      [9_000]
    );
    assert.equal(variantPlan.caption.body, '抖音版正文');
  });

  it('builds moments segments rather than a ZIP for 朋友圈', () => {
    const plan = buildResultFullPackagePlan({
      contentPackage: packageFixture(),
      nowIso: '2026-07-21T00:00:00.000Z',
      storeName: '花间美甲',
      target: 'wechat_moments',
    });
    assert.equal(plan?.modality, 'wechat_moments_segments');
    assert.equal(plan?.zipFileName, undefined);
    assert.ok((plan?.segments ?? []).length > 0);
  });

  it('produces nothing for a copy-only package on a ZIP platform', () => {
    const contentPackage = packageFixture();
    contentPackage.generated.ownedAssets = [];
    assert.equal(
      buildResultFullPackagePlan({
        contentPackage,
        nowIso: '2026-07-21T00:00:00.000Z',
        storeName: '花间美甲',
        target: 'xiaohongshu',
      }),
      undefined
    );
  });

  it('fills the share files array the payload declared and never carried', () => {
    const plan = buildResultFullPackagePlan({
      contentPackage: packageFixture(),
      nowIso: '2026-07-21T00:00:00.000Z',
      storeName: '花间美甲',
      target: 'xiaohongshu',
    });
    const files = sharePayloadFilesFromPlan(plan);
    assert.equal(files?.length, 1);
    assert.equal(files?.[0]?.mimeType, 'application/zip');
    // cover + two images: the cover entry restates the first image's bytes.
    assert.equal(files?.[0]?.sizeBytes, 3700);
  });

  it('probes the device against the files, not against the API existing', () => {
    const files = [
      { mimeType: 'application/zip', name: 'a.zip', sizeBytes: 10 },
    ];
    assert.equal(probeCanShareFiles(files, undefined), false);
    assert.equal(
      probeCanShareFiles(undefined, { canShare: () => true }),
      false
    );
    assert.equal(probeCanShareFiles(files, { canShare: () => false }), false);
    assert.equal(probeCanShareFiles(files, { canShare: () => true }), true);
    assert.equal(
      probeCanShareFiles(files, {
        canShare: () => {
          throw new Error('unsupported');
        },
      }),
      false
    );
  });
});
