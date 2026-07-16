import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { CreativeJob, ProductState } from '@meiye/contracts';

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

const { CreativeJobFailureNotice } = await import(
  './unified-creation-workbench'
);

const messages = {
  action: () => '去素材页处理照片',
  authorization: ({ photo }: { photo: string }) =>
    `照片「${photo}」：公开营销授权已失效；请恢复授权或换一张已授权照片。`,
  deleted: ({ photo }: { photo: string }) =>
    `照片「${photo}」：素材库中已找不到；请重新上传并完成授权。`,
  description: () => '逐张检查以下参考照片后再重新生成。',
  fallbackPhoto: ({ index }: { index: number }) => `第 ${index} 张照片`,
  title: () => '这些参考照片需要处理',
  unreadable: ({ photo }: { photo: string }) =>
    `照片「${photo}」：素材与授权仍有效，但任务没有返回具体是哪张无法读取；若处理其他异常照片后仍失败，请重新上传这张 JPG/PNG 原图。`,
};

function failedJob(): CreativeJob {
  return {
    contract: {
      aigcLabelEnabled: true,
      aspectRatio: '1:1',
      catalogModelId: 'image-model',
      catalogRevision: 'catalog-v1',
      currency: 'USD',
      dataClass: [],
      estimatedAmount: 0.1,
      operation: 'image.generate',
      outputCount: 1,
      outputLabel: '1 张图片',
      quoteAcceptedAt: '2026-07-15T08:00:00.000Z',
      quoteRevision: 'quote-v1',
      watermarkEnabled: true,
    },
    createdAt: '2026-07-15T08:00:00.000Z',
    failureCode: 'reference_asset_resolution_required',
    groundingSnapshot: {
      assets: [
        {
          authorizationStatus: 'authorized',
          consentScope: 'public_marketing',
          containsPerson: false,
          containsSensitiveData: false,
          id: 'asset-deleted',
          minorStatus: 'none',
          rightsEvidenceRecorded: true,
          sourceType: 'real',
          tags: ['门店门头.jpg'],
        },
        {
          authorizationStatus: 'authorized',
          consentScope: 'public_marketing',
          containsPerson: false,
          containsSensitiveData: false,
          id: 'asset-withdrawn',
          minorStatus: 'none',
          rightsEvidenceRecorded: true,
          sourceType: 'real',
          tags: ['护理室.jpg'],
        },
        {
          authorizationStatus: 'authorized',
          consentScope: 'public_marketing',
          containsPerson: false,
          containsSensitiveData: false,
          id: 'asset-unreadable',
          minorStatus: 'none',
          rightsEvidenceRecorded: true,
          sourceType: 'real',
          tags: ['项目近照.png'],
        },
      ],
      capturedAt: '2026-07-15T08:00:00.000Z',
      store: {
        address: '人民路 1 号',
        booking: '电话预约',
        brandVoice: '真实、克制',
        city: '成都',
        confirmedAt: '2026-07-15T07:00:00.000Z',
        district: '锦江区',
        name: '示例门店',
        prohibitions: [],
        projects: [
          {
            durationMinutes: 60,
            id: 'project-1',
            name: '护理项目',
            price: 299,
          },
        ],
        regulated: false,
      },
    },
    id: 'job-failed',
    outputAssetIds: [],
    outputContentIds: [],
    status: 'failed',
    submissionKey: 'submission-failed',
    updatedAt: '2026-07-15T08:01:00.000Z',
    workId: 'work-1',
    workspaceId: 'workspace-1',
  };
}

function currentAsset(
  id: string,
  authorizationStatus: ProductState['assets'][number]['authorizationStatus'],
  rightsEvidence?: string
): ProductState['assets'][number] {
  return {
    aigcStatus: 'not_ai',
    authorizationStatus,
    category: 'store',
    consentScope: 'public_marketing',
    containsPerson: false,
    containsSensitiveData: false,
    createdAt: '2026-07-15T07:00:00.000Z',
    id,
    mediaType: 'image',
    minorStatus: 'none',
    objectKey: `workspace-1/${id}.png`,
    replacementRequired: false,
    rightsEvidence,
    rightsOwner: '示例门店',
    sourceType: 'real',
    tags: [],
  };
}

test('reference failure names every affected photo, explains the current gap, and gives a repair action', () => {
  for (const failureCode of [
    'reference_asset_resolution_required',
    'REFERENCE_ASSET_UNRESOLVED',
  ]) {
    const job = failedJob();
    job.failureCode = failureCode;
    const html = renderToStaticMarkup(
      <CreativeJobFailureNotice
        currentAssets={[
          currentAsset('asset-withdrawn', 'withdrawn', 'receipt-1'),
          currentAsset('asset-unreadable', 'authorized', 'receipt-2'),
        ]}
        job={job}
        messages={messages}
      />
    );

    assert.match(html, /这些参考照片需要处理/);
    assert.match(html, /门店门头\.jpg[^<]*素材库中已找不到[^<]*重新上传/);
    assert.match(html, /护理室\.jpg[^<]*公开营销授权已失效[^<]*恢复授权/);
    assert.match(
      html,
      /项目近照\.png[^<]*没有返回具体是哪张无法读取[^<]*JPG\/PNG/
    );
    assert.match(
      html,
      /href="\/dashboard\/assets"[^>]*>去素材页处理照片/
    );
    assert.equal((html.match(/data-reference-photo=/g) ?? []).length, 3);
  }
});

test('non-reference failures do not claim that an input photo is broken', () => {
  const job = failedJob();
  job.failureCode = 'PROVIDER_TIMEOUT';

  const html = renderToStaticMarkup(
    <CreativeJobFailureNotice
      currentAssets={[]}
      job={job}
      messages={messages}
    />
  );

  assert.equal(html, '');
});
