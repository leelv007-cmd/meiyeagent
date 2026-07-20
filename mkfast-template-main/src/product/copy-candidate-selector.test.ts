import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CreativeAssetProjection,
  CreativeContent,
  CreativeJob,
} from '@meiye/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { CopyCandidateSelector } from './copy-candidate-selector';

const job: CreativeJob = {
  batchNumber: 1,
  batchRootJobId: 'job-copy',
  contract: {
    aigcLabelEnabled: true,
    catalogModelId: 'copy-model',
    catalogRevision: 'catalog-v1',
    currency: 'CNY',
    dataClass: [],
    estimatedAmount: 3,
    operation: 'copy.generate',
    outputCount: 3,
    outputLabel: '3 条内容候选',
    quoteAcceptedAt: '2026-07-13T08:00:00.000Z',
    quoteRevision: 'quote-v1',
    watermarkEnabled: false,
  },
  createdAt: '2026-07-13T08:00:00.000Z',
  id: 'job-copy',
  outputAssetIds: ['asset-a', 'asset-b', 'asset-c'],
  outputContentIds: [],
  productUsageQuantity: 1,
  qualityRetryNumber: 0,
  status: 'completed',
  submissionKey: 'copy-submit',
  updatedAt: '2026-07-13T08:00:01.000Z',
  workId: 'work-copy',
  workspaceId: 'workspace-copy',
};

const assets: CreativeAssetProjection[] = [0, 1, 2].map((candidateIndex) => ({
  body: `**候选 ${candidateIndex} 正文**`,
  candidateIndex,
  conversionHook: `转化钩子 ${candidateIndex}`,
  createdAt: '2026-07-13T08:00:01.000Z',
  id: `asset-${String.fromCharCode(97 + candidateIndex)}`,
  jobId: job.id,
  kind: 'text',
  title: `候选标题 ${candidateIndex}`,
  workId: job.workId,
  workspaceId: job.workspaceId,
}));

const decisionTrace = {
  complianceStatus: '本店事实与素材权利均已校验',
  customerAction: '引导顾客私信预约',
  deliverables: ['小红书文案', '可复用成品包'],
  expressionIdentity: '门店主理人',
  factReferences: ['299 元显白猫眼', '门店实拍图'],
  platforms: ['小红书'],
  whyPost: '用换季话题提醒老客复购',
};

function render(
  contents: CreativeContent[] = [],
  compact = false,
  recommendation?: {
    decisionTrace: typeof decisionTrace;
    recommendedAssetId: string;
  }
) {
  return renderToStaticMarkup(
    createElement(CopyCandidateSelector, {
      assets,
      compact,
      contents,
      job: {
        ...job,
        outputContentIds: contents.map((content) => content.id),
        ...recommendation,
      },
      onChanged() {},
      productVisualAssets: recommendation
        ? [{ id: 'image-1', title: '门店实拍图' }]
        : undefined,
    })
  );
}

test('renders one shared A/B/C radio group and one disabled accept action', () => {
  const html = render();

  assert.match(html, /候选 A/);
  assert.match(html, /候选 B/);
  assert.match(html, /候选 C/);
  assert.equal((html.match(/data-candidate-label=/g) ?? []).length, 3);
  assert.match(html, /采用所选文案/);
  assert.match(html, /确认换一批（付费）/);
  assert.match(html, /data-requires-confirmation="true"/);
  assert.match(html, /质量不达标，免费重试/);
  assert.match(html, /质量重试已用 0\/2/);
  assert.match(html, /剩余 2\/2/);
  assert.match(html, /将消耗 1 次/);
  assert.match(html, /额外消耗 0 次/);
  assert.match(html, /disabled=""[^>]*>采用所选文案/);
});

test('renders one trace-backed primary recommendation and keeps alternatives collapsed', () => {
  const html = render([], false, {
    decisionTrace,
    recommendedAssetId: 'asset-b',
  });

  assert.match(html, /主推荐/);
  assert.match(html, /候选标题 1/);
  assert.doesNotMatch(html, /候选标题 0/);
  assert.doesNotMatch(html, /候选标题 2/);
  assert.equal((html.match(/data-candidate-label=/g) ?? []).length, 1);
  assert.match(html, /展开 2 个备选/);
  assert.match(html, /为什么发/);
  assert.match(html, /谁在表达/);
  assert.match(html, /用了什么/);
  assert.match(html, /适合平台/);
  assert.match(html, /希望顾客做什么/);
  assert.match(html, /事实与权利状态/);
  assert.match(html, /可得到的交付物/);
  assert.match(html, /用换季话题提醒老客复购/);
  assert.match(html, /checked="" value="asset-b"/);
  assert.match(html, /已按服务端择优，可直接采用/);
});

test('keeps the legacy candidate contract when the server has no recommendation', () => {
  const html = render();

  assert.doesNotMatch(html, /主推荐/);
  assert.match(html, /候选 A/);
  assert.match(html, /候选 B/);
  assert.match(html, /候选 C/);
});

test('renders the persisted accepted candidate and locks every action', () => {
  const content: CreativeContent = {
    acceptedAt: '2026-07-13T08:05:00.000Z',
    assetIds: ['asset-b'],
    body: '候选 1 正文',
    createdAt: '2026-07-13T08:05:00.000Z',
    id: 'content-b',
    jobId: job.id,
    status: 'accepted',
    title: '候标题 1',
    workId: job.workId,
    workspaceId: job.workspaceId,
  };
  const html = render([content], true);

  assert.match(html, /已采用/);
  assert.match(html, /data-compact="true"/);
  assert.match(html, /data-mobile-sticky-actions="true"/);
  assert.equal(
    (html.match(/data-mobile-sticky-actions="true"/g) ?? []).length,
    1
  );
  assert.match(html, /本批已采用 1 条文案/);
  assert.equal((html.match(/disabled=""/g) ?? []).length >= 6, true);
});
