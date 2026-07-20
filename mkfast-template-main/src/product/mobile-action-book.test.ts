import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import type {
  ContentItem,
  ContentPackage,
  CreativeContent,
  CreativeAssetProjection,
  CreativeWorkbenchProjection,
  ProductState,
} from '@meiye/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mobileContentPackage } from './mobile-content-package';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export const env = {}',
      };
    }
    return nextResolve(specifier, context);
  },
});

const {
  MobileExampleStore,
  MobileCreationControls,
  MobileLegacyContentHistory,
  MobileHarnessCandidateResults,
  MobilePackageComposition,
  MobilePackageSharedActions,
  MobilePackageStatusCard,
  MobilePublishRoutes,
  MobileTaskHeader,
  MobileVideoComplianceNotice,
  mobileCreationPlan,
  mobileHarnessAdoptionRequest,
  mobileHarnessPackage,
  mobileRetryIdempotencyKeys,
  mobileVideoCompliance,
  mobileVideoComplianceState,
  selectMobileCreativeWork,
} = await import('./mobile-action-book');

function contentPackage(
  id: string,
  workId: string,
  updatedAt: string,
  status: ContentPackage['status'] = 'draft'
): ContentPackage {
  return {
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt: updatedAt,
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    id,
    kind: 'image_text',
    lineage: {},
    revision: 0,
    rights: { state: 'authorized' },
    source: { assetIds: [], workId },
    status,
    updatedAt,
    variants: [],
    versions: [],
    workspaceId: 'workspace-1',
  };
}

function versionedContentPackage(
  id: string,
  kind: ContentPackage['kind'],
  orderedAssetIds: string[]
): ContentPackage {
  const updatedAt = '2026-07-16T08:00:00.000Z';
  return {
    ...contentPackage(id, 'work-package', updatedAt, 'accepted'),
    currentVersionId: `${id}-version-1`,
    generated: { assetIds: orderedAssetIds, childRuns: [] },
    kind,
    versions: [
      {
        body: '本周新作',
        createdAt: updatedAt,
        id: `${id}-version-1`,
        orderedAssetIds,
        title: '夏日美甲故事',
        topics: [],
      },
    ],
  };
}

function harnessContentPackage({
  adoptedCandidateId,
  id = 'package-harness',
  workId = 'work-harness',
}: {
  adoptedCandidateId?: string;
  id?: string;
  workId?: string;
}): ContentPackage {
  const createdAt = '2026-07-19T08:00:00.000Z';
  return {
    ...contentPackage(id, workId, createdAt, 'accepted'),
    currentVersionId: `${id}-version-0`,
    harnessSelection: {
      ...(adoptedCandidateId ? { adoptedCandidateId } : {}),
      recommendedCandidateId: 'candidate-primary',
    },
    revision: 4,
    source: {
      assetIds: [],
      workId,
      workflowId: workId,
    },
    versions: [
      ['candidate-primary', '主推文案', 96],
      ['candidate-alternative-a', '温柔版文案', 91],
      ['candidate-alternative-b', '转化版文案', 87],
    ].map(([candidateId, title, score], index) => ({
      body: `${title}正文`,
      createdAt,
      harnessCandidateId: String(candidateId),
      harnessScore: Number(score),
      id: `${id}-version-${index}`,
      orderedAssetIds: [],
      title: String(title),
      topics: [],
    })),
  };
}

const exampleStore = {
  assetPreviews: [],
  assets: 0,
  contentCards: 0,
  contentPreviews: [],
  handoffPreview: {
    id: 'example-handoff',
    platform: 'xiaohongshu',
    title: '示例交付包',
  },
  hidden: true,
  id: 'example-store',
  name: '示例美甲店',
  packages: 0,
  profile: { city: '上海', confirmedPrice: 299, project: '美甲' },
  readOnly: true,
} satisfies ProductState['exampleStore'];

test('uses effective workspace compliance for a fresh mobile video', () => {
  assert.deepEqual(
    mobileVideoCompliance({
      'compliance.aigc_label.default': false,
      'compliance.regulated_mode.default': false,
      'compliance.watermark.default': true,
    }),
    {
      aigcLabelEnabled: false,
      watermarkEnabled: true,
    }
  );
  assert.deepEqual(mobileVideoCompliance(), {
    aigcLabelEnabled: true,
    watermarkEnabled: false,
  });
});

test('gates mobile video compliance until defaults settle and flags fallback', () => {
  const pending = mobileVideoComplianceState({ status: 'pending' });
  assert.deepEqual(pending, { kind: 'pending' });
  const pendingHtml = renderToStaticMarkup(
    createElement(MobileVideoComplianceNotice, { state: pending })
  );
  assert.match(pendingHtml, /aria-busy="true"/u);
  assert.match(pendingHtml, /disabled/u);
  assert.match(pendingHtml, /正在准备视频生成能力/u);

  const configured = mobileVideoComplianceState({
    defaults: {
      'compliance.aigc_label.default': false,
      'compliance.regulated_mode.default': false,
      'compliance.watermark.default': true,
    },
    status: 'success',
  });
  assert.deepEqual(configured, {
    compliance: { aigcLabelEnabled: false, watermarkEnabled: true },
    kind: 'ready',
  });
  assert.deepEqual(
    mobileVideoComplianceState({
      defaults: {
        'compliance.aigc_label.default': false,
        'compliance.watermark.default': true,
      },
      status: 'error',
    }),
    {
      compliance: { aigcLabelEnabled: false, watermarkEnabled: true },
      kind: 'ready',
    }
  );

  const fallback = mobileVideoComplianceState({ status: 'error' });
  assert.deepEqual(fallback, {
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    kind: 'fallback',
  });
  const fallbackHtml = renderToStaticMarkup(
    createElement(MobileVideoComplianceNotice, { state: fallback })
  );
  assert.match(fallbackHtml, /role="alert"/u);
  assert.match(fallbackHtml, /水印关 · AIGC 标识开/u);
});

test('keeps mobile video choice on the action composer and plans a real video Work', () => {
  const html = renderToStaticMarkup(
    createElement(MobileCreationControls, {
      intent: '把今天的夏日美甲做成竖屏视频',
      onIntentChange() {},
      onOperationChange() {},
      onSubmit() {},
      operation: 'video.generate',
      pending: false,
    })
  );

  assert.match(html, /做图文/u);
  assert.match(html, /做视频/u);
  assert.match(html, /aria-pressed="true"[\s\S]*?做视频<\/button>/u);
  assert.match(html, /把今天的夏日美甲做成竖屏视频/u);
  assert.match(html, /开始做一条/u);

  assert.deepEqual(
    mobileCreationPlan({
      intent: '  把今天的夏日美甲做成竖屏视频  ',
      operation: 'video.generate',
      referenceAssetIds: ['asset-mobile-1'],
      sessionId: 'session-mobile-1',
    }),
    {
      operation: 'video.generate',
      startsVideoWorkflow: true,
      work: {
        contentModules: ['social_cover'],
        intent: '把今天的夏日美甲做成竖屏视频',
        mode: 'agent',
        sessionId: 'session-mobile-1',
        sourceReferences: [{ id: 'asset-mobile-1', kind: 'asset' }],
      },
    }
  );
});

test('new-content mode does not fall back to the latest hot-state Work', () => {
  const recentWork = {
    contentModules: ['social_cover'],
    createdAt: '2026-07-18T08:00:00.000Z',
    id: 'work-hot-state',
    intent: '旧作品',
    mode: 'agent',
    sessionId: 'session-hot-state',
    sourceReferences: [],
    status: 'completed',
    updatedAt: '2026-07-18T08:01:00.000Z',
    workspaceId: 'workspace-1',
  } satisfies CreativeWorkbenchProjection['works'][number];

  assert.equal(
    selectMobileCreativeWork({ creatingNew: true, works: [recentWork] }),
    undefined
  );
  assert.equal(
    selectMobileCreativeWork({ creatingNew: false, works: [recentWork] })?.id,
    'work-hot-state'
  );
});

test('finds the real workspace-scoped Harness package without depending on a CreativeJob', () => {
  const work = {
    contentModules: ['social_cover'],
    createdAt: '2026-07-19T08:00:00.000Z',
    id: 'work-harness',
    intent: '今天的夏日美甲',
    mode: 'agent',
    sessionId: 'session-harness',
    sourceReferences: [],
    status: 'completed',
    updatedAt: '2026-07-19T08:01:00.000Z',
    workspaceId: 'workspace-1',
  } satisfies CreativeWorkbenchProjection['works'][number];
  const unrelated = contentPackage(
    'package-newer-but-not-harness',
    work.id,
    '2026-07-19T09:00:00.000Z',
    'accepted'
  );
  const harness = harnessContentPackage({ workId: work.id });

  assert.equal(
    mobileHarnessPackage([unrelated, harness], work)?.id,
    harness.id
  );
  assert.equal(
    mobileHarnessPackage([harness], { ...work, mode: 'direct' }),
    undefined
  );
});

test('renders all three persisted Harness candidates and keeps alternatives switchable on mobile', () => {
  const contentPackage = harnessContentPackage({
    adoptedCandidateId: 'candidate-alternative-a',
  });
  const html = renderToStaticMarkup(
    createElement(MobileHarnessCandidateResults, {
      busy: false,
      contentPackage,
      onAdopt() {},
    })
  );

  assert.match(html, /data-testid="mobile-harness-candidates"/u);
  assert.match(html, /主推文案/u);
  assert.match(html, /温柔版文案/u);
  assert.match(html, /转化版文案/u);
  assert.equal((html.match(/data-harness-candidate-id=/gu) ?? []).length, 3);
  assert.equal((html.match(/aria-pressed="true"/gu) ?? []).length, 1);
  assert.equal((html.match(/<button(?=[^>]* disabled="")/gu) ?? []).length, 1);
  assert.equal((html.match(/min-h-touch-target/gu) ?? []).length, 3);
  const candidateButtons = html.match(
    /<button[^>]*data-harness-priority[^>]*>/gu
  );
  assert.equal(candidateButtons?.length, 3);
  const primaryButton = candidateButtons?.find((button) =>
    button.includes('data-harness-priority="primary"')
  );
  const alternativeButtons = candidateButtons?.filter((button) =>
    button.includes('data-harness-priority="alternative"')
  );
  assert.match(primaryButton ?? '', /bg-primary/u);
  assert.equal(alternativeButtons?.length, 2);
  for (const button of alternativeButtons ?? []) {
    assert.doesNotMatch(button, /bg-primary/u);
  }
});

test('keeps the mobile task header readable over the ambient image at every breakpoint', () => {
  const html = renderToStaticMarkup(
    createElement(MobileTaskHeader, {
      description: '一次只做一个动作',
      nextAction: '采集素材',
    })
  );

  assert.match(html, /class="meiye-ambient-copy"/u);
  assert.match(html, /移动工作台/u);
  assert.match(html, /采集素材/u);
  assert.match(html, /一次只做一个动作/u);
});

test('keeps Harness adoption workspace-scoped through package OCC and revision-aware idempotency', () => {
  const contentPackage = harnessContentPackage({});

  assert.deepEqual(
    mobileHarnessAdoptionRequest(contentPackage, 'candidate-alternative-b'),
    {
      action: 'adopt_harness_candidate',
      key: 'mobile-adopt-harness-candidate-package-harness-4-candidate-alternative-b',
      payload: {
        candidateId: 'candidate-alternative-b',
        expectedRevision: 4,
        packageId: 'package-harness',
      },
    }
  );
  assert.notEqual(
    mobileHarnessAdoptionRequest(contentPackage, 'candidate-primary').key,
    mobileHarnessAdoptionRequest(contentPackage, 'candidate-alternative-b').key
  );
});

test('binds mobile editing to an explicit package or Work without first-item guessing', () => {
  const unrelated = contentPackage(
    'package-unrelated',
    'work-unrelated',
    '2026-07-15T09:00:00.000Z'
  );
  const older = contentPackage(
    'package-work-old',
    'work-selected',
    '2026-07-15T08:00:00.000Z'
  );
  const latest = contentPackage(
    'package-work-latest',
    'work-selected',
    '2026-07-15T08:30:00.000Z'
  );
  const packages = [unrelated, older, latest];

  assert.equal(
    mobileContentPackage(packages, { workId: 'work-selected' })?.id,
    'package-work-latest'
  );
  assert.equal(
    mobileContentPackage(packages, {
      packageId: 'package-work-old',
      workId: 'work-selected',
    })?.id,
    'package-work-old'
  );
  assert.equal(
    mobileContentPackage(packages, { packageId: 'package-missing' }),
    undefined
  );
  assert.equal(
    mobileContentPackage(packages, {
      packageId: 'package-unrelated',
      workId: 'work-selected',
    }),
    undefined
  );
});

test('uses the latest package regardless of status when mobile dashboard has no explicit binding', () => {
  const packages = [
    contentPackage('package-new-draft', 'work-new', '2026-07-15T09:30:00.000Z'),
    contentPackage(
      'package-accepted',
      'work-accepted',
      '2026-07-15T09:00:00.000Z',
      'accepted'
    ),
    contentPackage(
      'package-review-ready',
      'work-review',
      '2026-07-15T09:15:00.000Z',
      'review_ready'
    ),
    contentPackage(
      'package-partial',
      'work-partial',
      '2026-07-15T09:45:00.000Z',
      'partial'
    ),
  ];

  assert.equal(mobileContentPackage(packages, {})?.id, 'package-partial');
  assert.deepEqual(
    packages.map((contentPackage) => contentPackage.id),
    [
      'package-new-draft',
      'package-accepted',
      'package-review-ready',
      'package-partial',
    ]
  );
});

test('renders every legacy content as read-only history without restoring write actions', () => {
  const productContents: ContentItem[] = [
    ['legacy-product-a', '旧 Product A', '旧正文 A'],
    ['legacy-product-b', '旧 Product B', '旧正文 B'],
  ].map(([id, title, body], index) => ({
    assetIds: [],
    complianceStatus: 'clear',
    createdAt: `2026-07-1${index + 1}T08:00:00.000Z`,
    id: id!,
    projectId: 'project-legacy',
    scenario: '历史场景',
    selected: false,
    status: 'candidate',
    variants: [
      {
        aiDefaultVersionId: `${id}-version`,
        currentVersionId: `${id}-version`,
        id: `${id}-variant`,
        platform: 'xiaohongshu',
        versions: [
          {
            assetOrder: [],
            body: body!,
            conversionHook: '',
            createdAt: `2026-07-1${index + 1}T08:00:00.000Z`,
            id: `${id}-version`,
            source: 'merchant',
            title: title!,
            topics: [],
          },
        ],
      },
    ],
  }));
  const creativeContents: CreativeContent[] = [
    {
      acceptedAt: '2026-07-13T08:00:00.000Z',
      assetIds: [],
      body: 'P1 历史正文',
      createdAt: '2026-07-13T07:00:00.000Z',
      id: 'legacy-creative-a',
      jobId: 'job-legacy',
      status: 'accepted',
      title: 'P1 历史 A',
      workId: 'work-legacy',
      workspaceId: 'workspace-1',
    },
  ];

  const html = renderToStaticMarkup(
    createElement(MobileLegacyContentHistory, {
      creativeContents,
      productContents,
    })
  );

  assert.match(html, /历史内容（只读）· 3 条/u);
  assert.match(html, /旧 Product A/u);
  assert.match(html, /旧 Product B/u);
  assert.match(html, /P1 历史 A/u);
  assert.match(html, /旧正文 A/u);
  assert.match(html, /旧正文 B/u);
  assert.match(html, /P1 历史正文/u);
  assert.equal((html.match(/历史内容 · 只读/g) ?? []).length, 3);
  assert.doesNotMatch(html, /<button|quick_edit|select_content/u);
});

test('renders honest mobile publishing routes before any publish action', () => {
  const html = renderToStaticMarkup(
    createElement(MobilePublishRoutes, {
      canCreateL3: true,
      douyinIntegrated: false,
      onCreateL3() {},
    })
  );

  assert.match(html, /未接入/u);
  assert.match(html, /<button[^>]*disabled[^>]*>[^<]*L1/u);
  assert.match(
    html,
    /<button(?![^>]* disabled="")[^>]*>L3 生成人工发布包<\/button>/u
  );
});

test('renders the current image package count and ordered thumbnails in the handoff composition', () => {
  const imagePackage = versionedContentPackage('package-images', 'image_text', [
    'image-a',
    'image-b',
  ]);
  const creativeAssets: CreativeAssetProjection[] = ['image-a', 'image-b'].map(
    (id) => ({
      createdAt: '2026-07-16T08:00:00.000Z',
      id,
      jobId: 'job-images',
      kind: 'image',
      objectKey: `workspace-1/${id}.png`,
      title: id,
      workId: 'work-package',
      workspaceId: 'workspace-1',
    })
  );

  const html = renderToStaticMarkup(
    createElement(MobilePackageComposition, {
      contentPackage: imagePackage,
      creativeAssets,
      productAssets: [],
    })
  );

  assert.match(html, /成品组成/u);
  assert.match(html, /2 张图片/u);
  assert.equal((html.match(/<img/g) ?? []).length, 2);
  assert.match(html, /workspace-1%2Fimage-a\.png/u);
});

test('renders the video marker for a video package handoff composition', () => {
  const html = renderToStaticMarkup(
    createElement(MobilePackageComposition, {
      contentPackage: versionedContentPackage('package-video', 'video', [
        'video-a',
      ]),
      creativeAssets: [],
      productAssets: [],
    })
  );

  assert.match(html, /成品组成/u);
  assert.match(html, /视频成片/u);
});

test('renders the frozen shared actions for mobile packages that need attention', () => {
  const partialHtml = renderToStaticMarkup(
    createElement(MobilePackageSharedActions, {
      contentPackage: contentPackage(
        'package-partial',
        'work-partial',
        '2026-07-16T08:00:00.000Z',
        'partial'
      ),
      onCancel() {},
      pending: false,
    })
  );

  assert.match(
    partialHtml,
    /dashboard\?packageId=package-partial(?:&|&amp;)stage=action/u
  );
  assert.match(partialHtml, /<button[^>]*>取消<\/button>/u);
  assert.doesNotMatch(partialHtml, /更换素材并重新创作/u);

  const replacementHtml = renderToStaticMarkup(
    createElement(MobilePackageSharedActions, {
      contentPackage: contentPackage(
        'package-replacement',
        'work-replacement',
        '2026-07-16T08:00:00.000Z',
        'needs_replacement'
      ),
      onCancel() {},
      pending: false,
    })
  );

  assert.match(replacementHtml, /dashboard\?workId=work-replacement/u);
  assert.match(replacementHtml, /更换素材并重新创作/u);
  assert.match(replacementHtml, /<button[^>]*>取消<\/button>/u);
});

test('renders a versionless partial package with its real mobile status and actions', () => {
  const html = renderToStaticMarkup(
    createElement(MobilePackageStatusCard, {
      contentPackage: contentPackage(
        'package-partial',
        'work-partial',
        '2026-07-16T08:00:00.000Z',
        'partial'
      ),
      onCancel() {},
      pending: false,
    })
  );

  assert.match(html, /内容详情/u);
  assert.match(html, /需处理/u);
  assert.match(
    html,
    /dashboard\?packageId=package-partial(?:&|&amp;)stage=action/u
  );
  assert.match(html, /<button[^>]*>取消<\/button>/u);
  assert.doesNotMatch(html, /暂无已接受内容/u);
});

test('keeps paid retry keys stable for one failure and rotates them for the next failure', () => {
  const failedJob = {
    failureCode: 'provider_timeout',
    id: 'job-paid-retry',
    updatedAt: '2026-07-16T08:00:00.000Z',
  };

  const firstClick = mobileRetryIdempotencyKeys(failedJob);
  const secondClick = mobileRetryIdempotencyKeys(failedJob);
  const nextFailure = mobileRetryIdempotencyKeys({
    ...failedJob,
    updatedAt: '2026-07-16T08:05:00.000Z',
  });

  assert.deepEqual(secondClick, firstClick);
  assert.notEqual(nextFailure.submissionKey, firstClick.submissionKey);
  assert.notEqual(nextFailure.idempotencyKey, firstClick.idempotencyKey);
});

test('uses the unified ContentPackage count when deciding whether to render the example store', () => {
  const renderExampleStore = (contentPackages: ContentPackage[]) =>
    renderToStaticMarkup(
      createElement(MobileExampleStore, {
        assetCount: 0,
        contentPackages,
        example: exampleStore,
        hiding: false,
        legacyContents: [],
        onHide() {},
        onOpen() {},
        onRemix() {},
        opened: true,
        queriesReady: true,
        taskCount: 0,
        workCount: 0,
      })
    );

  assert.match(renderExampleStore([]), /示例美甲店/u);
  assert.doesNotMatch(
    renderExampleStore([
      versionedContentPackage('package-only', 'image_text', ['image-a']),
    ]),
    /示例美甲店/u
  );
});

test('keeps the default hidden example opt-in and lets mobile reveal it locally', () => {
  const renderExample = (opened: boolean) =>
    renderToStaticMarkup(
      createElement(MobileExampleStore, {
        assetCount: 0,
        contentPackages: [],
        example: exampleStore,
        hiding: false,
        legacyContents: [],
        onHide() {},
        onOpen() {},
        onRemix() {},
        opened,
        queriesReady: true,
        taskCount: 0,
        workCount: 0,
      })
    );

  assert.match(renderExample(false), /查看示例/u);
  assert.doesNotMatch(renderExample(false), /示例美甲店/u);
  assert.match(renderExample(true), /示例美甲店/u);
});
