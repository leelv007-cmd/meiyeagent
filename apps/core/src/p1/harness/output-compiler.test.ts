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

test('video revision assembly accepts source-free AI output only with one complete generation chain', () => {
  const version = {
    body: '夏日护理活动短视频',
    conversionHook: '私信预约',
    createdAt: '2026-07-25T00:00:00.000Z',
    id: 'video-version-source-free',
    orderedAssetIds: ['asset-video-source-free'],
    source: 'ai_generated' as const,
    title: '夏日护理活动',
    topics: [],
  };
  const variants = buildVideoPlatformVariants({
    currentVersionId: version.id,
    packageId: 'package-video-source-free',
    versions: [version],
  });
  const generated = completeVideoGenerationEvidence();
  const complete = {
    generated,
    marketing: {
      contextBundle: {
        bundleId: 'bundle-source-free',
        hash: 'b'.repeat(64),
        revision: 1,
      },
      factRefs: [],
      rightsRefs: [],
    },
    sourceAssetIds: [],
    variants,
    version,
  };

  assert.doesNotThrow(() => assertVideoRevisionAssemblyComplete(complete));

  for (const incomplete of [
    { ...complete, sourceAssetIds: ['source-asset-unauthorized'] },
    {
      ...complete,
      generated: {
        ...generated,
        ownedAssets: [
          {
            ...generated.ownedAssets[0]!,
            sourceTaskRef: undefined,
          },
        ],
      },
    },
    {
      ...complete,
      generated: {
        ...generated,
        childRuns: [
          {
            ...generated.childRuns[0]!,
            providerAttempts: [
              {
                ...generated.childRuns[0]!.providerAttempts[0]!,
                providerTaskRef: 'provider-task-mismatch',
              },
            ],
          },
        ],
      },
    },
    {
      ...complete,
      generated: {
        ...generated,
        childRuns: [
          {
            ...generated.childRuns[0]!,
            status: 'failed' as const,
          },
        ],
      },
    },
  ]) {
    assert.throws(() => assertVideoRevisionAssemblyComplete(incomplete));
  }
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

function completeVideoGenerationEvidence() {
  return {
    assetIds: ['asset-video-source-free'],
    childRuns: [
      {
        actualCatalogModelId: 'model-video-source-free',
        assetIds: ['asset-video-source-free'],
        providerAttempts: [
          {
            acceptance: 'accepted' as const,
            catalogModelId: 'model-video-source-free',
            createdAt: '2026-07-25T00:00:00.000Z',
            deploymentId: 'deployment-video-source-free',
            id: 'attempt-video-source-free',
            jobId: 'run-video-source-free',
            providerTaskRef: 'provider-task-video-source-free',
            status: 'completed' as const,
          },
        ],
        routeSnapshot: {
          actualCatalogModelId: 'model-video-source-free',
          catalogRevisionId: 'catalog-video-source-free',
          deploymentId: 'deployment-video-source-free',
          id: 'route-video-source-free',
        },
        routeSnapshotId: 'route-video-source-free',
        runId: 'run-video-source-free',
        runType: 'model_job' as const,
        status: 'succeeded' as const,
      },
    ],
    ownedAssets: [
      {
        contentType: 'video/mp4',
        id: 'asset-video-source-free',
        objectKey: 'owned/asset-video-source-free.mp4',
        sha256: 'a'.repeat(64),
        sourceTaskRef: 'provider-task-video-source-free',
      },
    ],
  };
}

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

test('image-text note assembly accepts an explicitly unconfigured enhancement judge without weakening required assembly facts', () => {
  const evaluatedVersion = imageTextNoteVersion();
  const version = {
    ...evaluatedVersion,
    note: {
      ...evaluatedVersion.note,
      evaluation: undefined,
    },
  };
  const variants = buildImageTextNotePlatformVariants({
    currentVersionId: version.id,
    packageId: 'package-note-no-enhancement-judge',
    versions: [version],
  });
  const complete = {
    enhancementJudge: {
      status: 'unconfigured' as const,
      reason: 'self_correction_judge_unconfigured' as const,
    },
    marketing: {
      contextBundle: {
        bundleId: 'bundle-note-no-enhancement-judge',
        hash: 'a'.repeat(64),
        revision: 1,
      },
      factRefs: ['fact:service:1'],
      rightsRefs: ['rights-r1'],
    },
    variants,
    version,
  };
  const failedEvaluationVersion = {
    ...evaluatedVersion,
    note: {
      ...evaluatedVersion.note,
      evaluation: {
        ...evaluatedVersion.note.evaluation!,
        dimensions: evaluatedVersion.note.evaluation!.dimensions.map(
          (dimension, index) =>
            index === 0 ? { ...dimension, passed: false } : dimension,
        ),
      },
    },
  };

  assert.doesNotThrow(() =>
    assertImageTextNoteRevisionAssemblyComplete(complete),
  );
  for (const incomplete of [
    {
      ...complete,
      marketing: { ...complete.marketing, rightsRefs: [] },
    },
    { ...complete, variants: variants.slice(0, 2) },
    {
      ...complete,
      partial: {
        unresolvedPageIds: ['page-2'],
        reason: 'consistency_remained_incomplete' as const,
      },
    },
    {
      ...complete,
      variants: buildImageTextNotePlatformVariants({
        currentVersionId: failedEvaluationVersion.id,
        packageId: 'package-note-failed-enhancement-evaluation',
        versions: [failedEvaluationVersion],
      }),
      version: failedEvaluationVersion,
    },
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
  ]) {
    assert.throws(() =>
      assertImageTextNoteRevisionAssemblyComplete(incomplete),
    );
  }
});

test('image-text note assembly keeps an unresolved page on the explicit partial track', () => {
  const version = imageTextNoteVersion();
  const partialVersion = {
    ...version,
    body: `${version.body}\n\n【待复核】page-2`,
    note: {
      ...version.note,
      evaluation: {
        ...version.note.evaluation!,
        dimensions: version.note.evaluation!.dimensions.map((dimension) =>
          dimension.dimension === 'visual_consistency'
            ? { ...dimension, passed: false, pageIds: ['page-2'] }
            : dimension,
        ),
        regenerationPageIds: ['page-2'],
      },
    },
  };
  const variants = buildImageTextNotePlatformVariants({
    currentVersionId: partialVersion.id,
    packageId: 'package-note-partial',
    versions: [partialVersion],
  });

  assert.doesNotThrow(() =>
    assertImageTextNoteRevisionAssemblyComplete({
      marketing: {
        contextBundle: {
          bundleId: 'bundle-note-partial',
          hash: 'a'.repeat(64),
          revision: 1,
        },
        factRefs: ['fact:service:1'],
        rightsRefs: ['rights-r1'],
      },
      partial: {
        unresolvedPageIds: ['page-2'],
        reason: 'consistency_remained_incomplete',
      },
      variants,
      version: partialVersion,
    }),
  );
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
