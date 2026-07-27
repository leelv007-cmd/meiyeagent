import assert from 'node:assert/strict';
import test from 'node:test';
import { NOTE_PLAN_CONSISTENCY_DIMENSIONS } from '@meiye/contracts';

import {
  assertCopyRevisionAssemblyComplete,
  assertImageRevisionAssemblyComplete,
  assertImageTextNoteRevisionAssemblyComplete,
  assertVideoRevisionAssemblyComplete,
  buildCopyPlatformVariants,
  buildImagePlatformVariants,
  buildImageTextNotePlatformVariants,
  buildVideoPlatformVariants,
} from './output-compiler.js';

test('video revision assembly accepts one complete current variant per platform', () => {
  const version = {
    body: '夏日护理活动短视频',
    conversionHook: '私信预约',
    createdAt: '2026-07-25T00:00:00.000Z',
    id: 'video-version-1',
    orderedAssetIds: ['asset-video-1'],
    source: 'ai_generated' as const,
    title: '夏日护理活动',
    topics: [],
  };
  const variants = buildVideoPlatformVariants({
    currentVersionId: version.id,
    packageId: 'package-video-1',
    versions: [version],
  });
  const revision = {
    marketing: {
      contextBundle: {
        bundleId: 'bundle-1',
        hash: 'a'.repeat(64),
        revision: 1,
      },
      factRefs: ['fact:service:1'],
      rightsRefs: ['asset-video-1'],
    },
    variants,
    version,
  };

  assert.doesNotThrow(() => assertVideoRevisionAssemblyComplete(revision));
});

test('video revision assembly rejects each missing required part', () => {
  const version = {
    body: '夏日护理活动短视频',
    conversionHook: '私信预约',
    createdAt: '2026-07-25T00:00:00.000Z',
    id: 'video-version-1',
    orderedAssetIds: ['asset-video-1'],
    source: 'ai_generated' as const,
    title: '夏日护理活动',
    topics: [],
  };
  const variants = buildVideoPlatformVariants({
    currentVersionId: version.id,
    packageId: 'package-video-1',
    versions: [version],
  });
  const complete = {
    marketing: {
      contextBundle: {
        bundleId: 'bundle-1',
        hash: 'a'.repeat(64),
        revision: 1,
      },
      factRefs: ['fact:service:1'],
      rightsRefs: ['asset-video-1'],
    },
    variants,
    version,
  };

  for (const incomplete of [
    {
      ...complete,
      marketing: { ...complete.marketing, contextBundle: undefined },
    },
    { ...complete, version: { ...version, conversionHook: '' } },
    { ...complete, marketing: { ...complete.marketing, rightsRefs: [] } },
    { ...complete, version: { ...version, orderedAssetIds: [] } },
    { ...complete, variants: variants.slice(0, 2) },
  ]) {
    assert.throws(() => assertVideoRevisionAssemblyComplete(incomplete));
  }
});

test('image revision assembly accepts one complete current variant per platform', () => {
  const version = {
    body: '夏日护理活动主视觉',
    conversionHook: '私信预约',
    createdAt: '2026-07-25T00:00:00.000Z',
    id: 'image-version-1',
    orderedAssetIds: ['asset-image-1'],
    source: 'ai_generated' as const,
    title: '夏日护理活动',
    topics: [],
  };
  const variants = buildImagePlatformVariants({
    currentVersionId: version.id,
    packageId: 'package-image-1',
    versions: [version],
  });
  const revision = {
    marketing: {
      contextBundle: {
        bundleId: 'bundle-1',
        hash: 'a'.repeat(64),
        revision: 1,
      },
      factRefs: ['fact:service:1'],
      rightsRefs: ['asset-image-1'],
    },
    variants,
    version,
  };

  assert.doesNotThrow(() => assertImageRevisionAssemblyComplete(revision));
});

test('image revision assembly rejects each missing required part', () => {
  const version = {
    body: '夏日护理活动主视觉',
    conversionHook: '私信预约',
    createdAt: '2026-07-25T00:00:00.000Z',
    id: 'image-version-1',
    orderedAssetIds: ['asset-image-1'],
    source: 'ai_generated' as const,
    title: '夏日护理活动',
    topics: [],
  };
  const variants = buildImagePlatformVariants({
    currentVersionId: version.id,
    packageId: 'package-image-1',
    versions: [version],
  });
  const complete = {
    marketing: {
      contextBundle: {
        bundleId: 'bundle-1',
        hash: 'a'.repeat(64),
        revision: 1,
      },
      factRefs: ['fact:service:1'],
      rightsRefs: ['asset-image-1'],
    },
    variants,
    version,
  };

  const missingEvidence = {
    ...complete,
    marketing: { ...complete.marketing, contextBundle: undefined },
  };
  const missingCta = {
    ...complete,
    version: { ...version, conversionHook: '' },
  };
  const missingRights = {
    ...complete,
    marketing: { ...complete.marketing, rightsRefs: [] },
  };
  const missingAsset = {
    ...complete,
    version: { ...version, orderedAssetIds: [] },
  };
  const missingVariant = {
    ...complete,
    variants: variants.slice(0, 2),
  };

  for (const incomplete of [
    missingEvidence,
    missingCta,
    missingRights,
    missingAsset,
    missingVariant,
  ]) {
    assert.throws(() => assertImageRevisionAssemblyComplete(incomplete));
  }
});

test('copy assembly prepares one non-empty version for every v1 platform', () => {
  const variants = buildCopyPlatformVariants({
    packageId: 'package-1',
    currentVersionId: 'version-1',
    versions: [
      {
        body: '介绍本店护理重点，并说明预约前需要沟通的事项。',
        conversionHook: '私信预约',
        createdAt: '2026-07-25T08:00:00.000Z',
        id: 'version-1',
        orderedAssetIds: [],
        source: 'ai_generated',
        title: '换季护理到店前先看',
        topics: [],
      },
    ],
  });

  assert.deepEqual(
    variants.map(({ platform }) => platform),
    ['xiaohongshu', 'douyin', 'video_account'],
  );
  for (const variant of variants) {
    assert.equal(variant.versions.length, 1);
    assert.ok(variant.currentVersionId);
    assert.ok(variant.versions[0]?.body);
    assert.ok(variant.versions[0]?.conversionHook);
  }
});

test('copy assembly rejects revisions missing evidence, CTA, variants, or rights references', () => {
  const version = {
    body: '介绍本店护理重点，并说明预约前需要沟通的事项。',
    conversionHook: '私信预约',
    createdAt: '2026-07-25T08:00:00.000Z',
    id: 'version-1',
    orderedAssetIds: [],
    source: 'ai_generated' as const,
    title: '换季护理到店前先看',
    topics: [],
  };
  const complete = {
    marketing: {
      contextBundle: {
        bundleId: 'bundle-1',
        hash: 'a'.repeat(64),
        revision: 1,
      },
      factRefs: ['store_fact:service-1:1'],
      rightsRefs: ['asset-1'],
    },
    variants: buildCopyPlatformVariants({
      currentVersionId: version.id,
      packageId: 'package-1',
      versions: [version],
    }),
    version,
  };
  assert.doesNotThrow(() => assertCopyRevisionAssemblyComplete(complete));

  const { marketing: _marketing, ...withoutEvidence } = complete;
  assert.throws(
    () => assertCopyRevisionAssemblyComplete(withoutEvidence),
    /requires frozen evidence/u,
  );

  const { conversionHook: _conversionHook, ...withoutConversionHook } =
    complete.version;
  assert.throws(
    () =>
      assertCopyRevisionAssemblyComplete({
        ...complete,
        version: withoutConversionHook,
      }),
    /requires a conversion CTA/u,
  );

  const { variants: _variants, ...withoutVariants } = complete;
  assert.throws(
    () => assertCopyRevisionAssemblyComplete(withoutVariants),
    /requires one complete current variant per platform/u,
  );

  const { rightsRefs: _rightsRefs, ...withoutRightsReferences } =
    complete.marketing;
  assert.throws(
    () =>
      assertCopyRevisionAssemblyComplete({
        ...complete,
        marketing: withoutRightsReferences,
      }),
    /requires rights references/u,
  );
});

test('image-text note assembly accepts only a complete page-mapped revision', () => {
  const version = imageTextNoteVersion();
  const variants = buildImageTextNotePlatformVariants({
    currentVersionId: version.id,
    packageId: 'package-note-1',
    versions: [version],
  });
  const complete = {
    marketing: {
      contextBundle: {
        bundleId: 'bundle-note-1',
        hash: 'a'.repeat(64),
        revision: 1,
      },
      factRefs: ['fact:service:1'],
      rightsRefs: ['rights-r1'],
    },
    variants,
    version,
  };

  assert.doesNotThrow(() =>
    assertImageTextNoteRevisionAssemblyComplete(complete),
  );
  for (const incomplete of [
    {
      ...complete,
      marketing: { ...complete.marketing, contextBundle: undefined },
    },
    { ...complete, version: { ...version, conversionHook: '' } },
    { ...complete, marketing: { ...complete.marketing, rightsRefs: [] } },
    { ...complete, variants: variants.slice(0, 2) },
    {
      ...complete,
      version: {
        ...version,
        note: {
          ...version.note,
          plan: {
            ...version.note.plan,
            pages: version.note.plan.pages.map((page, index) =>
              index === 0 ? { ...page, imageAssetId: undefined } : page,
            ),
          },
        },
      },
    },
    { ...complete, version: { ...version, orderedAssetIds: ['asset-page-2'] } },
    {
      ...complete,
      version: {
        ...version,
        note: { ...version.note, evaluation: undefined },
      },
    },
  ]) {
    assert.throws(() =>
      assertImageTextNoteRevisionAssemblyComplete(incomplete),
    );
  }
});

function imageTextNoteVersion() {
  const page = (
    id: string,
    order: number,
    pageRole: 'cover' | 'cta_guide',
    pagePurpose: 'capture_attention' | 'drive_action',
    imageAssetId: string,
  ) => ({
    id,
    order,
    revision: 1,
    pageRole,
    pagePurpose,
    imageIntent: {
      operation: 'image.generate' as const,
      purpose: `${pageRole}配图`,
      subject: '护理项目',
      scene: '真实门店场景',
      composition: '主体清晰',
      references: [],
      exactText: [],
      changes: [],
      invariants: [],
      factRefs: [],
      rightsRefs: [],
      outputPlan: { kind: 'single' as const },
    },
    textBlock: {
      title: `${pageRole}标题`,
      body: `${pageRole}正文`,
      exactText: [],
    },
    dependencies:
      order === 1
        ? []
        : [{ pageId: 'page-1', kind: 'text_sequence' as const }],
    imageAssetId,
  });
  return {
    body: '封面正文\n\n行动正文',
    conversionHook: '私信预约',
    createdAt: '2026-07-26T00:00:00.000Z',
    id: 'note-version-1',
    orderedAssetIds: ['asset-page-1', 'asset-page-2'],
    source: 'ai_generated' as const,
    title: '护理项目怎么选',
    topics: [],
    note: {
      schema: 'image-text-note-version/v1' as const,
      plan: {
        schema: 'note-plan/v1' as const,
        themeAnchor: '护理项目怎么选',
        style: {
          id: 'practical_guide',
          name: '干货科普版',
          positioning: '适合收藏',
        },
        pages: [
          page(
            'page-1',
            1,
            'cover',
            'capture_attention',
            'asset-page-1',
          ),
          page(
            'page-2',
            2,
            'cta_guide',
            'drive_action',
            'asset-page-2',
          ),
        ],
      },
      evaluation: {
        evaluatedAt: '2026-07-26T00:00:00.000Z',
        dimensions: NOTE_PLAN_CONSISTENCY_DIMENSIONS.map((dimension) => ({
          dimension,
          passed: true,
          reason: `${dimension}通过`,
          pageIds: [],
        })),
        regenerationPageIds: [],
      },
      regenerationReceipts: [],
    },
  };
}
