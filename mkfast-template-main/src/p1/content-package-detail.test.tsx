import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { p1QueryKeys } from './query-keys';
import type { VideoWorkflow } from '@/product/video-workflow-model';
import {
  canStartVideoDerivative,
  ContentPackageDetail,
  contentPackageRunCapabilityLabel,
  videoDerivativeLaunchContext,
  type ContentPackageLineageProjection,
} from './content-package-detail';
import type { ContentPackageProjection } from './content-package-card';

function packageProjection(
  id: string,
  title: string,
  lineage: ContentPackageProjection['lineage'] = {}
): ContentPackageProjection {
  return {
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt: '2026-07-15T08:00:00.000Z',
    currentVersionId: `${id}-base-v1`,
    exportReceipts: [],
    generated: { assetIds: ['image-1'], childRuns: [] },
    id,
    kind: 'image_text',
    lineage,
    revision: 0,
    rights: { state: 'authorized' },
    source: { assetIds: ['image-1'] },
    status: 'accepted',
    statusGroup: 'usable',
    statusLabel: '可使用',
    updatedAt: '2026-07-15T08:05:00.000Z',
    variants: [],
    versions: [
      {
        body: `${title}正文`,
        createdAt: '2026-07-15T08:00:00.000Z',
        id: `${id}-base-v1`,
        orderedAssetIds: ['image-1'],
        title,
        topics: ['美业'],
      },
    ],
    workspaceId: 'workspace-1',
  };
}

test('renders free editing, version comparison, rollback, export receipts, reuse, and bidirectional lineage in the existing detail surface', () => {
  const contentPackage = packageProjection('package-2', '夏日美甲新色', {
    reusedFromPackageId: 'package-1',
  });
  contentPackage.marketing = {
    scene: 'traffic_opportunity',
    capabilities: {
      mainRecommendation: true,
      platformDeliverables: true,
      factsAndRights: true,
      quickEdit: true,
      publishExport: true,
      asyncRecovery: true,
      remix: true,
    },
    contextBundle: {
      bundleId: 'bundle-opportunity-1',
      revision: 1,
      hash: 'b'.repeat(64),
    },
    factRefs: ['store_fact:service-1:2'],
    rightsRefs: ['asset:hair-color-1'],
    identityRefs: [],
    identityFallback: 'brand_official',
    opportunity: {
      opportunityId: 'opportunity-1',
      status: 'active',
      source: 'https://example.com/city-hair-color',
      sourceType: 'user_link',
      capturedAt: '2026-07-18T08:00:00.000Z',
      expiresAt: '2026-07-19T08:00:00.000Z',
      platforms: ['xiaohongshu'],
      region: '上海静安',
      targetAudience: '准备换夏季发色的同城顾客',
      matchedStoreReferences: ['store_fact:service-1:2', 'asset:hair-color-1'],
      relevanceExplanation: '门店本周主推低损伤染发，并有已授权案例素材。',
      reusableMechanism: '借夏季显白发色问题给出本店原创选择建议。',
      expectedAction: '私信预约发质判断。',
      evergreenFallback: '转为常青发色选择指南。',
      protectedExpressionCopied: false,
    },
  };
  contentPackage.variants = [
    {
      currentVersionId: 'xhs-v2',
      id: 'package-2-xiaohongshu',
      platform: 'xiaohongshu',
      versions: [
        {
          body: '第一版正文',
          createdAt: '2026-07-15T08:01:00.000Z',
          id: 'xhs-v1',
          orderedAssetIds: ['image-2', 'image-1'],
          source: 'ai_generated',
          title: '第一版标题',
          topics: ['美甲'],
        },
        {
          body: '当前自由编辑正文',
          conversionHook: '立即预约',
          createdAt: '2026-07-15T08:02:00.000Z',
          id: 'xhs-v2',
          orderedAssetIds: ['image-1', 'image-2'],
          source: 'merchant_edited',
          title: '当前自由编辑标题',
          topics: ['美甲', '同城'],
        },
      ],
    },
    {
      currentVersionId: 'douyin-v1',
      id: 'package-2-douyin',
      platform: 'douyin',
      versions: [
        {
          body: '抖音正文',
          createdAt: '2026-07-15T08:01:00.000Z',
          id: 'douyin-v1',
          orderedAssetIds: ['image-1'],
          title: '抖音标题',
          topics: [],
        },
      ],
    },
    {
      currentVersionId: 'video-account-v1',
      id: 'package-2-video-account',
      platform: 'video_account',
      versions: [
        {
          body: '视频号正文',
          createdAt: '2026-07-15T08:01:00.000Z',
          id: 'video-account-v1',
          orderedAssetIds: ['image-1'],
          title: '视频号标题',
          topics: [],
        },
      ],
    },
  ];
  contentPackage.generated.ownedAssets = [
    {
      contentType: 'image/png',
      id: 'image-1',
      objectKey: 'workspace-1/images/first.png',
      sha256: '1'.repeat(64),
    },
    {
      contentType: 'image/png',
      id: 'image-2',
      objectKey: 'workspace-1/images/second.png',
      sha256: '2'.repeat(64),
    },
  ];
  contentPackage.exportReceipts = [
    {
      appliedCompliance: {
        aigcLabelEnabled: true,
        watermarkEnabled: true,
        watermarkText: '清风美学',
      },
      artifactAssetId: 'export-asset-1',
      artifactObjectKey: 'workspace-1/exports/小红书 package.zip',
      contentType: 'application/zip',
      createdAt: '2026-07-15T08:03:00.000Z',
      id: 'receipt-1',
      platform: 'xiaohongshu',
      sha256: 'a'.repeat(64),
      sizeBytes: 512,
      status: 'succeeded',
      variantVersionId: 'xhs-v2',
    },
  ];
  const lineage: ContentPackageLineageProjection = {
    ancestors: [packageProjection('package-1', '春日来源成品')],
    children: [
      packageProjection('package-3', '秋日衍生成品', {
        reusedFromPackageId: 'package-2',
      }),
    ],
    truncated: false,
  };

  const html = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={contentPackage}
      deliveryCapabilities={[
        {
          mode: 'assisted',
          platform: 'xiaohongshu',
          reason: 'automatic_publish_not_fully_verified',
        },
      ]}
      deliveryTimeline={[
        {
          actorId: 'owner-a',
          id: 'manual-result-a',
          occurredAt: '2026-07-15T08:04:00.000Z',
          platform: 'xiaohongshu',
          platformUrl: 'https://www.xiaohongshu.com/explore/published-a',
          source: 'native',
          status: 'published',
          type: 'manual_publish_result',
          variantVersionId: 'xhs-v2',
        },
      ]}
      lineage={lineage}
      onEdit={() => undefined}
      onExport={() => undefined}
      onGenerateVariants={() => undefined}
      onOpenPackage={() => undefined}
      onRecordManualResult={() => undefined}
      onReuse={() => undefined}
      onRollback={() => undefined}
    />
  );

  assert.match(html, /内容详情/);
  assert.match(html, /热点机会卡/);
  assert.match(html, /进行中/);
  assert.match(html, /上海静安/);
  assert.match(html, /建议角度/);
  assert.match(html, /夏季显白发色/u);
  assert.match(html, /本次使用品牌官方口吻（未配置主理人 IP）/u);
  assert.match(html, /当前自由编辑标题/);
  assert.match(html, /当前自由编辑正文/);
  assert.match(html, /保存为新版本/);
  assert.match(html, /版本历史/);
  assert.match(html, /商户编辑/);
  assert.match(html, /2026-07-15/);
  assert.match(html, /第一版标题/);
  assert.match(html, /与当前版本对比/);
  assert.match(html, /已变更/);
  assert.match(html, /视觉顺序/);
  assert.match(
    html,
    /data-visual-order="xhs-v1"[\s\S]*?second\.png[\s\S]*?first\.png/u
  );
  assert.match(
    html,
    /data-visual-order="xhs-v2"[\s\S]*?first\.png[\s\S]*?second\.png/u
  );
  assert.match(html, /回滚为新版本/);
  assert.match(html, /导出小红书/);
  assert.match(html, /导出与发布记录/);
  assert.match(html, /辅助完成/);
  assert.match(html, /记录已发布/);
  assert.match(html, /人工发布结果/);
  assert.match(html, /xiaohongshu\.com\/explore\/published-a/u);
  assert.match(html, /xhs-v2/);
  assert.match(html, /512 B/);
  assert.match(html, /a{12}/);
  assert.match(html, /品牌水印：开 · AI 生成标识：开/u);
  assert.match(html, /品牌水印：清风美学/u);
  assert.match(
    html,
    /\/api\/core\/p1\/assets\?objectKey=workspace-1%2Fexports%2F%E5%B0%8F%E7%BA%A2%E4%B9%A6%20package\.zip/
  );
  assert.match(html, /做同款/);
  assert.match(html, /春日来源成品/);
  assert.match(html, /秋日衍生成品/);
  assert.doesNotMatch(html, /accepted|review_ready|export_failed/);
});

test('quick-edit buttons expose action-owned targets and six differentiated export uses', () => {
  const html = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={packageProjection('package-quick-edit', '快捷改稿')}
      onEdit={() => undefined}
      onExport={() => undefined}
      onGenerateVariants={() => undefined}
      onOpenPackage={() => undefined}
      onReuse={() => undefined}
      onRollback={() => undefined}
    />
  );

  // Primary rewrite chips stay visible; natural_language is textarea-only.
  assert.match(html, /data-quick-edit-target="package_version"/u);
  assert.match(html, /data-quick-edit-target="platform_variant"/u);

  // Export chips live in a collapsed <details> group but remain in markup.
  assert.match(html, /<details[\s\S]*?导出与物料/u);
  assert.match(
    html,
    /data-export-use="wechat_moments"[^>]*data-quick-edit-target="export_use"/u
  );
  assert.match(html, /data-export-use="offline_material"/u);
  assert.match(html, /data-export-use="poster"/u);
  assert.match(html, /data-export-use="image_set"/u);
  assert.match(html, /data-export-use="spoken_script"/u);
  assert.match(html, /data-export-use="appointment_card"/u);
});

test('trusted return anchor renders only for allowlisted from ids', () => {
  const withAnchor = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={packageProjection('package-return', '返回锚')}
      returnFrom="workbench"
      onEdit={() => undefined}
      onExport={() => undefined}
      onGenerateVariants={() => undefined}
      onOpenPackage={() => undefined}
      onReuse={() => undefined}
      onRollback={() => undefined}
    />
  );
  assert.match(withAnchor, /data-testid="trusted-return-anchor"/u);
  assert.match(withAnchor, /data-trusted-return="workbench"/u);
  assert.match(withAnchor, /href="[^"]*\/dashboard"/u);

  const withoutAnchor = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={packageProjection('package-return-bad', '无锚')}
      returnFrom="https://evil.com"
      onEdit={() => undefined}
      onExport={() => undefined}
      onGenerateVariants={() => undefined}
      onOpenPackage={() => undefined}
      onReuse={() => undefined}
      onRollback={() => undefined}
    />
  );
  assert.doesNotMatch(withoutAnchor, /data-testid="trusted-return-anchor"/u);
  assert.doesNotMatch(withoutAnchor, /https:\/\/evil\.com/u);
});

test('device relay entry appears when a relay target is provided', () => {
  const html = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={packageProjection('package-relay', '手机接力')}
      relayTarget={{ kind: 'package', packageId: 'package-relay' }}
      onEdit={() => undefined}
      onExport={() => undefined}
      onGenerateVariants={() => undefined}
      onOpenPackage={() => undefined}
      onReuse={() => undefined}
      onRollback={() => undefined}
    />
  );
  assert.match(html, /data-testid="device-relay-trigger"/u);
  assert.match(html, /用手机继续|Continue on phone/u);
});

test('shows export carrier actions only for versions with a delivery', () => {
  const withCarrier = packageProjection('package-export-carrier', '朋友圈成品');
  withCarrier.versions[0]!.exportUseDelivery = {
    contentType: 'text/plain;charset=utf-8',
    exportUse: 'wechat_moments',
    fileName: 'moments-copy.txt',
    kind: 'formatted_text',
    text: '朋友圈完整文案',
  };
  withCarrier.variants = [
    {
      currentVersionId: 'package-export-carrier-xhs-v1',
      id: 'package-export-carrier-xhs',
      platform: 'xiaohongshu',
      versions: [
        {
          body: '小红书版本正文',
          createdAt: '2026-07-15T08:01:00.000Z',
          id: 'package-export-carrier-xhs-v1',
          orderedAssetIds: ['image-1'],
          title: '小红书版本',
          topics: [],
        },
      ],
    },
  ];
  const render = (contentPackage: ContentPackageProjection) =>
    renderToStaticMarkup(
      <ContentPackageDetail
        contentPackage={contentPackage}
        onEdit={() => undefined}
        onExport={() => undefined}
        onGenerateVariants={() => undefined}
        onOpenPackage={() => undefined}
        onReuse={() => undefined}
        onRollback={() => undefined}
      />
    );

  assert.match(render(withCarrier), /复制朋友圈文案/u);
  assert.match(render(withCarrier), /下载朋友圈文案/u);

  const ordinary = render(
    packageProjection('package-ordinary-version', '普通编辑版本')
  );
  assert.doesNotMatch(ordinary, /复制朋友圈文案/u);
  assert.doesNotMatch(ordinary, /下载口播稿/u);
  assert.doesNotMatch(ordinary, /去做门店海报/u);
});

test('shows when a deep lineage projection is truncated to the nearest 20 levels', () => {
  const html = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={packageProjection('package-deep-lineage', '深层同款')}
      lineage={{ ancestors: [], children: [], truncated: true }}
      onEdit={() => undefined}
      onExport={() => undefined}
      onGenerateVariants={() => undefined}
      onOpenPackage={() => undefined}
      onReuse={() => undefined}
      onRollback={() => undefined}
    />
  );

  assert.match(html, /做同款关系层级较深，仅显示最近 20 层/);
  assert.doesNotMatch(html, /热点机会卡/);
  assert.doesNotMatch(html, /品牌官方口吻|未配置主理人 IP/u);
});

test('shows the exact one-time approval card only for verified automatic publishing', () => {
  const contentPackage = packageProjection('package-automatic', '自动发布');
  contentPackage.variants = [
    {
      currentVersionId: 'automatic-xhs-v1',
      id: 'automatic-xhs',
      platform: 'xiaohongshu',
      versions: [
        {
          body: '正文',
          createdAt: '2026-07-15T08:01:00.000Z',
          id: 'automatic-xhs-v1',
          orderedAssetIds: ['image-1'],
          title: '标题',
          topics: [],
        },
      ],
    },
  ];
  contentPackage.approvalRequests = [
    {
      actionKind: 'publish',
      contentPackageRevision: contentPackage.revision,
      createdAt: '2026-07-15T08:02:00.000Z',
      id: 'approval-request-automatic',
      nodeId: 'approval:package-automatic',
      packageId: contentPackage.id,
      platform: 'xiaohongshu',
      purpose: 'publish_current_variant',
      status: 'pending',
      taskId: 'task-automatic',
      variantVersionId: 'automatic-xhs-v1',
      workflowId: 'task-automatic',
      workflowRevision: 1,
      workspaceId: contentPackage.workspaceId,
    },
  ];

  const html = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={contentPackage}
      deliveryCapabilities={[
        {
          mode: 'automatic_verified',
          platform: 'xiaohongshu',
          reason: 'live_adapter_and_revision_evidence_verified',
        },
      ]}
      onApproveAndDeliver={() => undefined}
      onEdit={() => undefined}
      onExport={() => undefined}
      onGenerateVariants={() => undefined}
      onOpenPackage={() => undefined}
      onRecordManualResult={() => undefined}
      onReuse={() => undefined}
      onRollback={() => undefined}
    />
  );

  assert.match(html, /本次发布确认/u);
  assert.match(html, /发布账号/u);
  assert.match(html, /计划发布时间/u);
  assert.match(html, /本次费用（CNY）/u);
  assert.match(html, /确认并发布/u);
  assert.doesNotMatch(html, /记录已发布/u);
});

test('shows retry delivery for an approved receipt after its inbox request is consumed', () => {
  const contentPackage = packageProjection(
    'package-approved-undelivered',
    '待重试发布'
  );
  contentPackage.revision = 7;
  contentPackage.variants = [
    {
      currentVersionId: 'approved-undelivered-douyin-v1',
      id: 'approved-undelivered-douyin',
      platform: 'douyin',
      versions: [
        {
          body: '正文',
          createdAt: '2026-07-18T08:00:00.000Z',
          id: 'approved-undelivered-douyin-v1',
          orderedAssetIds: ['image-1'],
          title: '标题',
          topics: [],
        },
      ],
    },
  ];
  contentPackage.approvalRequests = [
    {
      actionKind: 'publish',
      consumedAt: '2026-07-18T08:30:00.000Z',
      contentPackageRevision: 4,
      createdAt: '2026-07-18T08:20:00.000Z',
      id: 'request-approved-undelivered',
      nodeId: 'approval:package-approved-undelivered',
      packageId: contentPackage.id,
      platform: 'douyin',
      purpose: 'publish_current_variant',
      receiptId: 'receipt-approved-undelivered',
      status: 'consumed',
      taskId: 'task-approved-undelivered',
      variantVersionId: 'approved-undelivered-douyin-v1',
      workflowId: 'task-approved-undelivered',
      workflowRevision: 1,
      workspaceId: contentPackage.workspaceId,
    },
  ];
  contentPackage.approvalReceipts = [
    {
      binding: {
        accountId: 'douyin-account-a',
        actionKind: 'publish',
        actionScheduledAt: '2026-07-18T09:00:00.000Z',
        contentRevision: 1,
        contextBundle: {
          bundleId: 'bundle-approved-undelivered',
          hash: 'bundle-hash-approved-undelivered',
          revision: 1,
        },
        cost: { amount: 0, currency: 'CNY' },
        packageId: contentPackage.id,
        platform: 'douyin',
        purpose: 'publish_current_variant',
        variantVersionId: 'approved-undelivered-douyin-v1',
        workspaceId: contentPackage.workspaceId,
      },
      events: [
        {
          actorId: 'owner-a',
          eventId: 'receipt-approved-undelivered:approved',
          occurredAt: '2026-07-18T08:30:00.000Z',
          type: 'approved',
        },
      ],
      id: 'receipt-approved-undelivered',
      idempotencyKey: 'approve-approved-undelivered',
      payloadFingerprint: 'fingerprint-approved-undelivered',
      status: 'approved',
    },
  ];

  const html = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={contentPackage}
      deliveryCapabilities={[
        {
          mode: 'automatic_verified',
          platform: 'douyin',
          reason: 'live_adapter_and_revision_evidence_verified',
        },
      ]}
      onEdit={() => undefined}
      onExport={() => undefined}
      onGenerateVariants={() => undefined}
      onOpenPackage={() => undefined}
      onRetryDelivery={() => undefined}
      onReuse={() => undefined}
      onRollback={() => undefined}
    />
  );

  assert.match(html, /重试交付/u);
  assert.doesNotMatch(html, /确认并发布/u);
});

test('shows output quota instead of provider USD for three-platform generation', () => {
  const html = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={packageProjection('package-1', '夏日内容')}
      onEdit={() => undefined}
      onExport={() => undefined}
      onGenerateVariants={() => undefined}
      onOpenPackage={() => undefined}
      onReuse={() => undefined}
      onRollback={() => undefined}
      variantQuota={{ allowance: 30, available: 21 }}
    />
  );

  assert.match(html, /生成三平台版本/u);
  assert.match(html, /消耗 1 条文案额度/u);
  assert.match(html, /可用 21\/30/u);
  assert.doesNotMatch(html, /US\$|USD|0\.06/u);
});

test('offers an optional video derivative only on Douyin and Video Account copy variants', () => {
  assert.equal(canStartVideoDerivative('image_text', 'douyin', 'work-1'), true);
  assert.equal(
    canStartVideoDerivative('image_text', 'video_account', 'work-1'),
    true
  );
  assert.equal(
    canStartVideoDerivative('image_text', 'xiaohongshu', 'work-1'),
    false
  );
  assert.equal(canStartVideoDerivative('video', 'douyin', 'work-1'), false);

  const contentPackage = packageProjection('package-video-entry', '夏日内容');
  contentPackage.source.workId = 'work-video-source';
  contentPackage.variants = [
    {
      currentVersionId: 'douyin-video-entry-v1',
      id: 'douyin-video-entry',
      platform: 'douyin',
      versions: [
        {
          body: '适合门店实拍的抖音正文',
          createdAt: '2026-07-18T08:00:00.000Z',
          id: 'douyin-video-entry-v1',
          orderedAssetIds: ['image-1'],
          title: '抖音夏日新作',
          topics: [],
        },
      ],
    },
  ];

  assert.deepEqual(videoDerivativeLaunchContext(contentPackage, 'douyin'), {
    intent: '抖音夏日新作\n\n适合门店实拍的抖音正文',
    referenceAssetIds: ['image-1'],
    workId: 'work-video-source',
  });

  const html = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={contentPackage}
      onEdit={() => undefined}
      onExport={() => undefined}
      onGenerateVariants={() => undefined}
      onOpenPackage={() => undefined}
      onReuse={() => undefined}
      onRollback={() => undefined}
    />
  );

  assert.match(html, /生成视频成片/u);
  assert.doesNotMatch(html, /升级|降级/u);
});

test('shows the package compliance settings next to the platform export action', () => {
  const watermarkOnly = packageProjection(
    'package-compliance-watermark',
    '只开水印'
  );
  watermarkOnly.compliance = {
    aigcLabelEnabled: false,
    watermarkEnabled: true,
    watermarkText: '清风美学',
  };
  watermarkOnly.variants = [
    {
      currentVersionId: 'compliance-watermark-xhs-v1',
      id: 'compliance-watermark-xhs',
      platform: 'xiaohongshu',
      versions: [
        {
          body: '正文',
          createdAt: '2026-07-15T08:01:00.000Z',
          id: 'compliance-watermark-xhs-v1',
          orderedAssetIds: ['image-1'],
          title: '标题',
          topics: [],
        },
      ],
    },
  ];
  const aigcOnly = packageProjection('package-compliance-aigc', '只开 AI 标识');
  aigcOnly.compliance = {
    aigcLabelEnabled: true,
    watermarkEnabled: false,
  };
  aigcOnly.variants = [
    {
      currentVersionId: 'compliance-aigc-xhs-v1',
      id: 'compliance-aigc-xhs',
      platform: 'xiaohongshu',
      versions: [
        {
          body: '正文',
          createdAt: '2026-07-15T08:01:00.000Z',
          id: 'compliance-aigc-xhs-v1',
          orderedAssetIds: ['image-1'],
          title: '标题',
          topics: [],
        },
      ],
    },
  ];
  const render = (contentPackage: ContentPackageProjection) =>
    renderToStaticMarkup(
      <ContentPackageDetail
        contentPackage={contentPackage}
        onEdit={() => undefined}
        onExport={() => undefined}
        onGenerateVariants={() => undefined}
        onOpenPackage={() => undefined}
        onReuse={() => undefined}
        onRollback={() => undefined}
      />
    );

  assert.match(
    render(watermarkOnly),
    /导出小红书[\s\S]*品牌水印：开 · AI 生成标识：关/u
  );
  assert.match(
    render(aigcOnly),
    /导出小红书[\s\S]*品牌水印：关 · AI 生成标识：开/u
  );
});

test('shows explicit loading and retry states when three-platform pricing is unavailable', () => {
  const loading = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={packageProjection('package-loading', '夏日内容')}
      onEdit={() => undefined}
      onExport={() => undefined}
      onGenerateVariants={() => undefined}
      onOpenPackage={() => undefined}
      onReuse={() => undefined}
      onRollback={() => undefined}
      variantCatalogState="loading"
    />
  );
  const unavailable = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={packageProjection('package-unavailable', '秋日内容')}
      onEdit={() => undefined}
      onExport={() => undefined}
      onGenerateVariants={() => undefined}
      onOpenPackage={() => undefined}
      onRetryVariantCatalog={() => undefined}
      onReuse={() => undefined}
      onRollback={() => undefined}
      variantCatalogState="unavailable"
    />
  );

  assert.match(loading, /正在读取三平台报价/);
  assert.match(unavailable, /三平台版本暂时不可用/);
  assert.match(unavailable, /重新读取/);
});

test('renders an adopted Product photo in the package visual order', () => {
  const contentPackage = packageProjection('package-product-photo', '门店实拍');
  contentPackage.generated.ownedAssets = [];

  const html = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={contentPackage}
      media={[
        {
          assetId: 'image-1',
          href: '/dashboard/assets/image-1',
          kind: 'image',
          src: '/api/storage/file?key=workspace-1%2Fassets%2Fstore.jpg',
          title: '门店实拍',
        },
      ]}
      onEdit={() => undefined}
      onExport={() => undefined}
      onGenerateVariants={() => undefined}
      onOpenPackage={() => undefined}
      onReuse={() => undefined}
      onRollback={() => undefined}
    />
  );

  assert.match(html, /workspace-1%2Fassets%2Fstore\.jpg/);
});

test('restores an exact unfinished video workflow from its package detail', () => {
  const contentPackage = packageProjection('package-video', '待复核视频');
  contentPackage.kind = 'video';
  contentPackage.currentVersionId = undefined;
  contentPackage.versions = [];
  contentPackage.source = {
    assetIds: [],
    workflowId: 'workflow-video-review',
    workId: 'work-video-review',
  };
  contentPackage.status = 'review_ready';
  contentPackage.statusGroup = 'needs_attention';
  contentPackage.statusLabel = '需处理';

  const workflow: VideoWorkflow = {
    aigcLabelEnabled: true,
    catalogModelId: 'seedance-2',
    confirmed: true,
    id: 'workflow-video-review',
    revision: 2,
    shots: [
      {
        candidates: [
          {
            asset: {
              contentType: 'video/mp4',
              objectKey: 'workspace-1/video/candidate-1.mp4',
            },
            index: 0,
            status: 'completed',
          },
          {
            asset: {
              contentType: 'video/mp4',
              objectKey: 'workspace-1/video/candidate-2.mp4',
            },
            index: 1,
            status: 'completed',
          },
        ],
        candidatesPerShot: 2,
        id: 'shot-review',
        prompt: '真实门店环境镜头',
      },
    ],
    status: 'awaiting_quality_review',
    storyboardRevision: 'storyboard-review',
    storyboardVersion: 1,
    updatedAt: '2026-07-15T08:05:00.000Z',
    workId: 'work-video-review',
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'video_workflow', {
      workflowId: workflow.id,
    }),
    { job: null, workflow }
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ContentPackageDetail
        contentPackage={contentPackage}
        onEdit={() => undefined}
        onExport={() => undefined}
        onGenerateVariants={() => undefined}
        onOpenPackage={() => undefined}
        onReuse={() => undefined}
        onRollback={() => undefined}
      />
    </QueryClientProvider>
  );

  assert.match(html, /等待镜头复核/u);
  assert.match(html, /选择这一个/u);
});

test('links a failed video package back to its exact Work for recovery', () => {
  const contentPackage = packageProjection('package-video-failed', '失败视频');
  contentPackage.kind = 'video';
  contentPackage.currentVersionId = undefined;
  contentPackage.versions = [];
  contentPackage.source = {
    assetIds: [],
    workflowId: 'workflow-video-failed',
    workId: 'work/video failed',
  };
  contentPackage.status = 'needs_input';
  contentPackage.statusGroup = 'needs_attention';
  contentPackage.statusLabel = '需处理';

  const workflow: VideoWorkflow = {
    aigcLabelEnabled: true,
    catalogModelId: 'seedance-2',
    confirmed: true,
    failureCode: 'COMPOSED_VIDEO_TECHNICAL_VALIDATION_FAILED',
    id: 'workflow-video-failed',
    revision: 3,
    shots: [],
    status: 'failed',
    storyboardRevision: 'storyboard-failed',
    storyboardVersion: 1,
    updatedAt: '2026-07-15T08:05:00.000Z',
    workId: 'work/video failed',
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'video_workflow', {
      workflowId: workflow.id,
    }),
    { job: { status: 'failed' }, workflow }
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ContentPackageDetail
        contentPackage={contentPackage}
        onEdit={() => undefined}
        onExport={() => undefined}
        onGenerateVariants={() => undefined}
        onOpenPackage={() => undefined}
        onReuse={() => undefined}
        onRollback={() => undefined}
      />
    </QueryClientProvider>
  );

  assert.match(html, /返回分镜并新建版本/u);
  assert.match(html, /href="\/dashboard\?workId=work%2Fvideo%20failed"/u);
});

test('renders completed MP4 Assets as video and keeps the exact workflow status visible', () => {
  const contentPackage = packageProjection('package-video-done', '已完成视频');
  contentPackage.kind = 'video';
  contentPackage.source = {
    assetIds: ['asset-storefront'],
    workflowId: 'workflow-video-done',
    workId: 'work-video-done',
  };
  contentPackage.currentVersionId = 'video-v2';
  contentPackage.versions = [
    {
      body: '旧版分镜',
      createdAt: '2026-07-15T08:00:00.000Z',
      id: 'video-v1',
      orderedAssetIds: ['owned-video'],
      title: '旧版视频',
      topics: [],
    },
    {
      body: '当前分镜',
      createdAt: '2026-07-15T08:05:00.000Z',
      id: 'video-v2',
      orderedAssetIds: ['owned-video'],
      title: '当前视频',
      topics: [],
    },
  ];
  contentPackage.generated = {
    assetIds: ['owned-video'],
    childRuns: [],
    ownedAssets: [
      {
        contentType: 'video/mp4',
        id: 'owned-video',
        objectKey: 'workspace-1/composed/final.mp4',
        sha256: '3'.repeat(64),
      },
    ],
  };
  const workflow: VideoWorkflow = {
    aigcLabelEnabled: true,
    catalogModelId: 'seedance-2',
    composedAsset: {
      contentType: 'video/mp4',
      objectKey: 'workspace-1/composed/final.mp4',
    },
    confirmed: true,
    id: 'workflow-video-done',
    revision: 3,
    shots: [],
    status: 'completed',
    storyboardRevision: 'storyboard-done',
    storyboardVersion: 1,
    updatedAt: '2026-07-15T08:05:00.000Z',
    workId: 'work-video-done',
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'video_workflow', {
      workflowId: workflow.id,
    }),
    { job: { status: 'completed' }, workflow }
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ContentPackageDetail
        contentPackage={contentPackage}
        onEdit={() => undefined}
        onExport={() => undefined}
        onGenerateVariants={() => undefined}
        onOpenPackage={() => undefined}
        onReuse={() => undefined}
        onRollback={() => undefined}
      />
    </QueryClientProvider>
  );

  assert.match(html, /data-visual-order="video-v1"[\s\S]*?<video/u);
  assert.doesNotMatch(html, /<img[^>]+final\.mp4/u);
  assert.match(html, /成片已完成/u);
});

test('shows Product Usage without exposing internal provider cost settlement', () => {
  const contentPackage = packageProjection('package-ledger', '账本可见成品');
  contentPackage.generated.childRuns = [
    {
      actualCatalogModelId: 'workspace-copy-adapt',
      productUsage: { quantity: 1, status: 'committed' },
      providerCost: {
        amount: 0.0034,
        currency: 'USD',
        status: 'observed',
      },
      runId: 'job-ledger-1',
      runType: 'model_job',
      status: 'succeeded',
    },
  ];

  const html = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={contentPackage}
      onEdit={() => undefined}
      onExport={() => undefined}
      onGenerateVariants={() => undefined}
      onOpenPackage={() => undefined}
      onReuse={() => undefined}
      onRollback={() => undefined}
    />
  );

  assert.match(html, /产品用量/);
  assert.match(html, /已结算/);
  assert.match(html, /1/);
  assert.match(html, /文案生成/);
  assert.doesNotMatch(html, /workspace-copy-adapt|llm-openai/u);
  assert.doesNotMatch(html, /供应商成本/);
  assert.doesNotMatch(html, /USD 0\.0034/);
});

test('maps internal child runs to merchant-facing capability labels', () => {
  assert.equal(contentPackageRunCapabilityLabel('model_job'), '文案生成');
  assert.equal(
    contentPackageRunCapabilityLabel('durable_video_workflow'),
    '视频生成'
  );
  assert.equal(
    contentPackageRunCapabilityLabel('canvas_image_job'),
    '图片生成'
  );
  assert.equal(contentPackageRunCapabilityLabel('creative_job'), '内容生成');
});

test('shows failed export recovery and blocks export and reuse after rights revocation', () => {
  const contentPackage = packageProjection('package-revoked', '已撤权成品');
  contentPackage.rights = {
    reason: 'asset_withdrawn:asset-123',
    revokedAt: '2026-07-15T09:00:00.000Z',
    state: 'revoked',
  };
  contentPackage.status = 'needs_replacement';
  contentPackage.statusGroup = 'needs_attention';
  contentPackage.statusLabel = '需处理';
  contentPackage.source.workId = 'work-replace-assets';
  contentPackage.variants = [
    {
      currentVersionId: 'revoked-xhs-v1',
      id: 'revoked-xhs',
      platform: 'xiaohongshu',
      versions: [
        {
          body: '正文',
          createdAt: '2026-07-15T08:01:00.000Z',
          id: 'revoked-xhs-v1',
          orderedAssetIds: ['image-1'],
          title: '标题',
          topics: [],
        },
      ],
    },
  ];
  contentPackage.exportReceipts = [
    {
      createdAt: '2026-07-15T08:03:00.000Z',
      failureCategory: 'export_adapter_failed',
      id: 'failed-receipt',
      platform: 'xiaohongshu',
      status: 'failed',
      variantVersionId: 'revoked-xhs-v1',
    },
  ];

  const html = renderToStaticMarkup(
    <ContentPackageDetail
      contentPackage={contentPackage}
      onEdit={() => undefined}
      onExport={() => undefined}
      onGenerateVariants={() => undefined}
      onOpenPackage={() => undefined}
      onReuse={() => undefined}
      onRollback={() => undefined}
    />
  );

  assert.match(html, /导出服务暂时不可用/);
  assert.match(html, /重试导出/);
  assert.match(html, /引用素材已撤回授权/);
  assert.match(html, /更换素材并重新创作/);
  assert.match(html, /dashboard\?workId=work-replace-assets/);
  assert.match(html, /<button[^>]*disabled[^>]*>重试导出<\/button>/);
  assert.match(html, /<button[^>]*disabled[^>]*>[\s\S]*?做同款<\/button>/u);
});
