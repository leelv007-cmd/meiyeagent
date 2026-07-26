import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CANVAS_WORK_NAME,
  type PublicContentPackage,
} from '@meiye/contracts';

import type { RawCanvasWorkSummary } from '@/product/canonical-history-model';

import {
  deliveredMedia,
  workAdoptHref,
  workCopyText,
  workDetail,
  workEvidence,
  workExportability,
  workExportIdempotencyKey,
  workHandoffHref,
  workOutputShape,
  workUsageGuidance,
  worksListItems,
  worksShapeCounts,
} from './works-projection';

function ownedAsset(id: string, contentType: string) {
  return {
    contentType,
    id,
    objectKey: `workspace-1/${id}.bin`,
    sha256: `sha-${id}`,
  };
}

function packageFixture(
  overrides: Partial<PublicContentPackage> &
    Pick<PublicContentPackage, 'id' | 'kind' | 'status'>
): PublicContentPackage {
  return {
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt: '2026-07-20T08:00:00.000Z',
    currentVersionId: 'version-1',
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    lineage: {},
    revision: 3,
    rights: { state: 'authorized' },
    source: { assetIds: [], workId: 'work-1' },
    updatedAt: '2026-07-21T10:00:00.000Z',
    variants: [
      {
        currentVersionId: 'variant-version-1',
        id: 'variant-xhs',
        platform: 'xiaohongshu',
        versions: [
          {
            body: '变体正文',
            createdAt: '2026-07-20T08:00:00.000Z',
            id: 'variant-version-1',
            orderedAssetIds: [],
            title: '变体标题',
            topics: [],
          },
        ],
      },
    ],
    versions: [
      {
        body: '到店体验夏日美甲，预约有礼。',
        createdAt: '2026-07-20T08:00:00.000Z',
        id: 'version-1',
        orderedAssetIds: [],
        title: '夏日美甲新色',
        topics: ['夏日系列'],
      },
    ],
    workspaceId: 'workspace-1',
    ...overrides,
  };
}

/** 文案: words, nothing else was delivered. */
const copyPackage = packageFixture({
  id: 'package-copy',
  kind: 'image_text',
  status: 'accepted',
});

/** 图片: media with no words. */
const imagePackage = packageFixture({
  generated: {
    assetIds: ['asset-image'],
    childRuns: [],
    ownedAssets: [ownedAsset('asset-image', 'image/png')],
  },
  id: 'package-image',
  kind: 'image_text',
  source: { assetIds: [], workId: 'work-image' },
  status: 'accepted',
  updatedAt: '2026-07-22T10:00:00.000Z',
  versions: [
    {
      body: '',
      createdAt: '2026-07-22T08:00:00.000Z',
      id: 'version-1',
      orderedAssetIds: ['asset-image'],
      title: '门店门头图',
      topics: [],
    },
  ],
});

/** 图文: media and words as one deliverable. */
const notePackage = packageFixture({
  generated: {
    assetIds: ['asset-note-b', 'asset-note-a'],
    childRuns: [],
    ownedAssets: [
      ownedAsset('asset-note-a', 'image/jpeg'),
      ownedAsset('asset-note-b', 'image/jpeg'),
    ],
  },
  id: 'package-note',
  kind: 'image_text',
  source: {
    assetIds: ['upload-1'],
    groundingId: 'grounding-1',
    storeProfileId: 'store-1',
    targetPlatform: 'xiaohongshu',
    workId: 'work-note',
  },
  status: 'accepted',
  updatedAt: '2026-07-23T10:00:00.000Z',
  versions: [
    {
      body: '夏日美甲种草笔记正文。',
      createdAt: '2026-07-23T08:00:00.000Z',
      id: 'version-1',
      orderedAssetIds: ['asset-note-a', 'asset-note-b'],
      source: 'merchant_edited',
      title: '夏日美甲种草',
      topics: ['夏日系列', '美甲'],
    },
  ],
});

/** 视频: core states the shape outright. */
const videoPackage = packageFixture({
  generated: {
    assetIds: ['asset-video'],
    childRuns: [],
    ownedAssets: [ownedAsset('asset-video', 'video/mp4')],
  },
  id: 'package-video',
  kind: 'video',
  source: { assetIds: [], workId: 'work-video' },
  status: 'accepted',
  updatedAt: '2026-07-24T10:00:00.000Z',
  versions: [
    {
      body: '15 秒到店成片。',
      createdAt: '2026-07-24T08:00:00.000Z',
      id: 'version-1',
      orderedAssetIds: ['asset-video'],
      title: '到店体验成片',
      topics: [],
    },
  ],
});

const canvasWork: RawCanvasWorkSummary = {
  aigcLabelEnabled: true,
  brandWatermarkEnabled: false,
  createdAt: '2026-07-19T08:00:00.000Z',
  currentRevisionId: 'canvas-revision-2',
  id: 'canvas-work-1',
  name: '价格卡',
  revisions: [
    {
      createdAt: '2026-07-19T08:00:00.000Z',
      id: 'canvas-revision-1',
      revision: 1,
    },
    {
      createdAt: '2026-07-19T09:00:00.000Z',
      id: 'canvas-revision-2',
      revision: 2,
    },
  ],
  updatedAt: '2026-07-19T09:00:00.000Z',
};

const allPackages = [copyPackage, imagePackage, notePackage, videoPackage];

test('the four output shapes are read off what was delivered', () => {
  assert.equal(workOutputShape(copyPackage), 'copy');
  assert.equal(workOutputShape(imagePackage), 'image');
  assert.equal(workOutputShape(notePackage), 'note');
  assert.equal(workOutputShape(videoPackage), 'video');
});

test('a package carrying a video asset is a 视频 even under the image_text kind', () => {
  const composed = packageFixture({
    generated: {
      assetIds: ['asset-clip'],
      childRuns: [],
      ownedAssets: [ownedAsset('asset-clip', 'video/mp4')],
    },
    id: 'package-composed',
    kind: 'image_text',
    status: 'accepted',
    versions: [
      {
        body: '成片说明',
        createdAt: '2026-07-24T08:00:00.000Z',
        id: 'version-1',
        orderedAssetIds: ['asset-clip'],
        title: '成片',
        topics: [],
      },
    ],
  });
  assert.equal(workOutputShape(composed), 'video');
});

test('the gallery keeps the order the adopted version chose', () => {
  assert.deepEqual(
    deliveredMedia(notePackage).map((item) => item.assetId),
    ['asset-note-a', 'asset-note-b']
  );
  assert.equal(deliveredMedia(notePackage)[0]?.kind, 'image');
  assert.equal(deliveredMedia(videoPackage)[0]?.kind, 'video');
  assert.match(
    deliveredMedia(videoPackage)[0]?.src ?? '',
    /^\/api\/core\/p1\/assets\?objectKey=/u
  );
});

test('the list carries all four shapes plus 轻编辑 works, newest first', () => {
  const items = worksListItems({
    canvasWorks: [canvasWork],
    contentPackages: allPackages,
  });
  assert.deepEqual(
    items.map((item) => item.detailId),
    [
      'package-video',
      'package-note',
      'package-image',
      'package-copy',
      'canvas-work-1',
    ]
  );
  assert.deepEqual(
    items.map((item) => item.outputShape),
    ['video', 'note', 'image', 'copy', 'image']
  );
  assert.equal(items[0]?.revision, 3);
  assert.equal(items.at(-1)?.kind, 'canvas');
  assert.equal(items.at(-1)?.revision, 2);
});

test('a 轻编辑 work shows the merchant name, never the engineering default', () => {
  const [item] = worksListItems({
    canvasWorks: [{ ...canvasWork, name: DEFAULT_CANVAS_WORK_NAME }],
    contentPackages: [],
  });
  assert.equal(item?.title, '空白图文作品');
});

test('a package with no delivered version reports no revision', () => {
  const generating = packageFixture({
    currentVersionId: undefined,
    id: 'package-generating',
    kind: 'image_text',
    status: 'generating',
    versions: [],
  });
  const [item] = worksListItems({ contentPackages: [generating] });
  assert.equal(item?.revision, null);
  assert.equal(item?.title, '未命名文案');
});

test('the shape filter and the search narrow the same list', () => {
  assert.deepEqual(
    worksListItems({
      contentPackages: allPackages,
      shape: 'note',
    }).map((item) => item.detailId),
    ['package-note']
  );
  assert.deepEqual(
    worksListItems({
      contentPackages: allPackages,
      query: '门头',
    }).map((item) => item.detailId),
    ['package-image']
  );
  assert.deepEqual(worksShapeCounts({ contentPackages: allPackages }), {
    copy: 1,
    image: 1,
    note: 1,
    video: 1,
  });
});

test('detail resolves by package id and by the workId the 交付卡 hands over', () => {
  const byPackage = workDetail({
    contentPackages: allPackages,
    id: 'package-note',
  });
  const byWork = workDetail({ contentPackages: allPackages, id: 'work-note' });
  assert.equal(byPackage.kind, 'package');
  assert.deepEqual(byWork, byPackage);
  assert.equal(
    byPackage.kind === 'package' ? byPackage.confirmedRevision?.revision : null,
    3
  );
  assert.equal(
    byPackage.kind === 'package'
      ? byPackage.confirmedRevision?.versionId
      : null,
    'version-1'
  );
});

test('a workId with several packages resolves to the newest one', () => {
  const older = packageFixture({
    id: 'package-old',
    kind: 'image_text',
    status: 'accepted',
    updatedAt: '2026-07-01T10:00:00.000Z',
  });
  const detail = workDetail({
    contentPackages: [older, copyPackage],
    id: 'work-1',
  });
  assert.equal(
    detail.kind === 'package' ? detail.packageId : null,
    'package-copy'
  );
});

test('a canvas work resolves to the 轻编辑 branch, an unknown id to missing', () => {
  assert.deepEqual(
    workDetail({
      canvasWorks: [canvasWork],
      contentPackages: allPackages,
      id: 'canvas-work-1',
    }),
    { kind: 'canvas', workId: 'canvas-work-1' }
  );
  assert.deepEqual(workDetail({ contentPackages: allPackages, id: 'nope' }), {
    kind: 'missing',
  });
});

test('生成依据 states canonical provenance and no internal identifiers', () => {
  const chips = workEvidence(notePackage);
  const labels = chips.map((chip) => chip.label);
  assert.deepEqual(labels, [
    '用了本店已确认的门店事实',
    '内容基于本次确认的创作依据',
    '用了你上传的真实素材',
    '按小红书的发布习惯适配',
    '这一版含你自己的修改',
  ]);
  for (const label of labels) {
    assert.doesNotMatch(
      label,
      /package|version|work|asset|grounding|store-1/iu
    );
  }
  assert.deepEqual(workEvidence(copyPackage), []);
});

test('an unselected identity is stated as the neutral store voice, not seeded', () => {
  const fallback = packageFixture({
    id: 'package-fallback',
    kind: 'image_text',
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
        revision: 1,
      },
      factRefs: [],
      identityFallback: 'brand_official',
      identityRefs: [],
      rightsRefs: [],
      scene: 'daily_service_exposure',
    },
    status: 'accepted',
  });
  assert.deepEqual(
    workEvidence(fallback).map((chip) => chip.id),
    ['identity-fallback']
  );
});

test('使用导购 leads with the blocking sentence when rights are revoked', () => {
  const revoked = packageFixture({
    id: 'package-revoked',
    kind: 'image_text',
    rights: { revokedAt: '2026-07-25T10:00:00.000Z', state: 'revoked' },
    status: 'needs_replacement',
  });
  assert.deepEqual(
    workUsageGuidance(revoked, 'note', workExportability(revoked)),
    ['这份作品里的素材授权已撤回，先换掉素材再导出。']
  );
  const guidance = workUsageGuidance(
    videoPackage,
    'video',
    workExportability(videoPackage)
  );
  assert.equal(guidance.length, 2);
  assert.match(guidance[1] ?? '', /成片/u);
});

test('复制 carries the merchant words and nothing structural', () => {
  const detail = workDetail({
    contentPackages: allPackages,
    id: 'package-note',
  });
  assert.equal(detail.kind, 'package');
  if (detail.kind !== 'package') return;
  assert.equal(
    workCopyText(detail),
    '夏日美甲种草\n\n夏日美甲种草笔记正文。\n\n#夏日系列 #美甲'
  );
});

test('导出 and 协办交接 bind the revision the detail is showing', () => {
  const detail = workDetail({
    contentPackages: allPackages,
    id: 'package-note',
  });
  assert.equal(detail.kind, 'package');
  if (detail.kind !== 'package') return;
  assert.equal(detail.platform, 'xiaohongshu');
  assert.equal(
    workExportIdempotencyKey(detail),
    // Same namespace Result Center issues, so one revision exports once.
    'export:package-note:3:xiaohongshu'
  );
  assert.equal(
    workHandoffHref(detail),
    '/dashboard/results/work-note?contentId=package-note&panel=delivery&versionId=version-1'
  );
});

test('导出 is only offered where core would honour it', () => {
  /** A 图文 variant core can actually build a delivery ZIP from. */
  const withDeliverableVariant = (
    overrides: Parameters<typeof packageFixture>[0]
  ) =>
    packageFixture({
      generated: {
        assetIds: ['asset-image'],
        childRuns: [],
        ownedAssets: [ownedAsset('asset-image', 'image/png')],
      },
      variants: [
        {
          currentVersionId: 'variant-version-1',
          id: 'variant-xhs',
          platform: 'xiaohongshu',
          versions: [
            {
              body: '变体正文',
              createdAt: '2026-07-20T08:00:00.000Z',
              id: 'variant-version-1',
              orderedAssetIds: ['asset-image'],
              title: '变体标题',
              topics: [],
            },
          ],
        },
      ],
      ...overrides,
    });
  const exportability = (contentPackage: PublicContentPackage) => {
    const detail = workDetail({
      contentPackages: [contentPackage],
      id: contentPackage.id,
    });
    return detail.kind === 'package' ? detail.exportability : null;
  };

  // Straight out of a run the 成品 is delivered but not adopted; core rejects
  // an export here, so the surface must not offer one.
  assert.equal(
    exportability(
      withDeliverableVariant({
        id: 'p1',
        kind: 'image_text',
        status: 'review_ready',
      })
    ),
    'needs_adoption'
  );
  assert.equal(
    exportability(
      withDeliverableVariant({
        id: 'p2',
        kind: 'image_text',
        status: 'accepted',
      })
    ),
    'ready'
  );
  // A failed export keeps the 成品; only the export is retried.
  assert.equal(
    exportability(
      withDeliverableVariant({
        id: 'p3',
        kind: 'image_text',
        status: 'export_failed',
      })
    ),
    'ready'
  );
  assert.equal(
    exportability(
      withDeliverableVariant({
        id: 'p4',
        kind: 'image_text',
        rights: { revokedAt: '2026-07-25T10:00:00.000Z', state: 'revoked' },
        status: 'accepted',
      })
    ),
    'blocked'
  );
  assert.equal(
    exportability(
      withDeliverableVariant({
        id: 'p5',
        kind: 'image_text',
        status: 'needs_replacement',
      })
    ),
    'blocked'
  );
  // 文案: core builds the delivery ZIP out of the variant's images and refuses
  // to build one without any, so 导出 is not on offer at all — 复制文字 is.
  assert.equal(
    exportability(
      packageFixture({ id: 'p6', kind: 'image_text', status: 'accepted' })
    ),
    'text_only'
  );
  // Media on the package but not yet on the variant core would export is still
  // nothing to package.
  assert.equal(
    exportability(
      packageFixture({
        generated: {
          assetIds: ['asset-image'],
          childRuns: [],
          ownedAssets: [ownedAsset('asset-image', 'image/png')],
        },
        id: 'p7',
        kind: 'image_text',
        status: 'accepted',
      })
    ),
    'text_only'
  );
  // Video is not exempt: core's video delivery reads the same variant version's
  // orderedAssetIds for the composed file, so an empty variant is a dead 导出
  // button there too.
  assert.equal(
    exportability(
      packageFixture({ id: 'p8', kind: 'video', status: 'accepted' })
    ),
    'text_only'
  );
  assert.equal(
    exportability(
      withDeliverableVariant({ id: 'p9', kind: 'video', status: 'accepted' })
    ),
    'ready'
  );
});

/**
 * 导购 and the action row must never disagree, because the action row is what
 * the merchant can actually press. This walks the projection state matrix for
 * the copy lens — composer's default, so the 文案 主路径 — and holds one rule at
 * every state: a line may only name an action that the state also renders.
 *
 * The dead end this replaces: an un-adopted 文案 作品 read 「先采用这一版」 while
 * `exportability` was `text_only`, which renders neither 采用 nor 导出.
 */
test('文案主路径的导购只说得出动作区真有的动作', () => {
  const ACTION_WORDS = [
    { pattern: /导出/u, rendered: (state: string) => state === 'ready' },
    {
      pattern: /采用/u,
      rendered: (state: string) => state === 'needs_adoption',
    },
  ];
  const states: Array<{
    contentPackage: PublicContentPackage;
    label: string;
  }> = [
    'review_ready',
    'accepted',
    'export_failed',
    'partial',
    'needs_replacement',
  ].map((status) => ({
    contentPackage: packageFixture({
      id: `copy-${status}`,
      kind: 'image_text',
      status: status as PublicContentPackage['status'],
    }),
    label: status,
  }));

  for (const { contentPackage, label } of states) {
    const exportability = workExportability(contentPackage);
    const shape = workOutputShape(contentPackage);
    assert.equal(shape, 'copy', `${label} must stay a 文案 作品`);
    const guidance = workUsageGuidance(contentPackage, shape, exportability);
    const text = guidance.join(' ');
    for (const { pattern, rendered } of ACTION_WORDS) {
      if (pattern.test(text) && !rendered(exportability)) {
        assert.fail(
          `${label}: 导购 "${text}" names ${pattern} but exportability=${exportability} renders no such button`
        );
      }
    }
    // Whatever the state, the copy path always has a way to use the words.
    assert.match(
      text,
      /复制/u,
      `${label}: a 文案 作品 must always be told it can be copied`
    );
  }
});

test('使用导购 stops promising 导出 to a 文案 作品', () => {
  const copy = packageFixture({
    id: 'p-copy',
    kind: 'image_text',
    status: 'accepted',
  });
  assert.deepEqual(
    workUsageGuidance(copy, workOutputShape(copy), workExportability(copy)),
    [
      '这一版的文字已经能直接用，复制走或交给同事去发都行。',
      '复制正文就能贴到平台或发给顾客。',
    ]
  );
});

test('采用 and 协办交接 doorways carry the same revision to Result Center', () => {
  const detail = workDetail({
    contentPackages: allPackages,
    id: 'package-note',
  });
  assert.equal(detail.kind, 'package');
  if (detail.kind !== 'package') return;
  assert.equal(
    workAdoptHref(detail),
    '/dashboard/results/work-note?contentId=package-note&panel=result&versionId=version-1'
  );
});

test('with no confirmed revision there is nothing to export or hand over', () => {
  const generating = packageFixture({
    currentVersionId: undefined,
    id: 'package-generating',
    kind: 'image_text',
    status: 'generating',
    versions: [],
  });
  const detail = workDetail({
    contentPackages: [generating],
    id: 'package-generating',
  });
  assert.equal(detail.kind, 'package');
  if (detail.kind !== 'package') return;
  assert.equal(detail.confirmedRevision, null);
  assert.equal(workExportIdempotencyKey(detail), null);
  assert.equal(workHandoffHref(detail), null);
});
