import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { p1QueryKeys } from '@/p1/query-keys';

import {
  VideoWorkflowPanel,
  videoWorkflowMutationFailure,
} from './video-workflow-panel';
import type {
  VideoWorkflow,
  VideoWorkflowEnvelope,
} from './video-workflow-model';

const props = {
  aigcLabelEnabled: true,
  catalogModelId: 'seedance-2',
  catalogModelNames: {
    'seedance-2': 'Seedance 2.0',
  },
  catalogModelName: 'Seedance 2.0',
  dataClass: ['contains_face'] as const,
  intent: '记录一次真实到店体验',
  workId: 'work-a',
};

test('both hosts remount local video state when the current Work changes', () => {
  for (const file of [
    './mobile-action-book.tsx',
    './unified-creation-workbench.tsx',
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(
      source,
      /<VideoWorkflowPanel[\s\S]*?key=\{currentWork\.id\}[\s\S]*?workId=\{currentWork\.id\}/u
    );
  }
});

test('the desktop workbench freezes the confirmed store name as the video watermark', () => {
  const source = readFileSync(
    new URL('./unified-creation-workbench.tsx', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /brandWatermarkText=\{[\s\S]*?watermarkEnabled[\s\S]*?productQuery\.data\?\.store\?\.name\.trim\(\)[\s\S]*?p1_canvas_export_brand_fallback[\s\S]*?: undefined[\s\S]*?\}/u
  );
  assert.doesNotMatch(source, /watermarkEnabled \? '门店品牌'/u);
});

test('renders the local AIDA editor only after latest recovery returns empty', () => {
  const queryClient = queryClientWithLatest(null);
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(VideoWorkflowPanel, props)
    )
  );

  assert.match(html, /Attention 抓住注意/u);
  assert.match(html, /Interest 建立兴趣/u);
  assert.match(html, /Desire 激发向往/u);
  assert.match(html, /Action 引导行动/u);
  assert.match(html, /锁定分镜/u);
  assert.match(html, /Seedance 2.0/u);
});

test('restores a completed workflow and plays only its workspace BFF asset', () => {
  const workflow: VideoWorkflow = {
    aigcLabelEnabled: true,
    catalogModelId: 'seedance-2',
    composedAsset: {
      contentType: 'video/mp4',
      objectKey: 'workspace-a/composed/final video.mp4',
    },
    confirmed: true,
    derivedFromWorkflowId: 'workflow-parent',
    id: 'workflow-a',
    revision: 8,
    shots: [],
    status: 'completed',
    storyboardRevision: 'storyboard-a',
    storyboardVersion: 2,
    updatedAt: '2026-07-13T12:00:00.000Z',
    workId: 'work-a',
  };
  const envelope = { workflow, job: null };
  const queryClient = queryClientWithLatest(envelope);
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'video_workflow', {
      workflowId: workflow.id,
    }),
    envelope
  );
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(VideoWorkflowPanel, {
        ...props,
        catalogModelId: 'new-selection',
        catalogModelNames: {
          'new-selection': 'New Selection',
          'seedance-2': 'Seedance 2.0',
        },
        catalogModelName: 'New Selection',
      })
    )
  );

  assert.match(html, /成片已完成/u);
  assert.equal((html.match(/data-step-state="success"/g) ?? []).length, 5);
  assert.match(html, /Seedance 2.0/u);
  assert.doesNotMatch(html, /seedance-2/u);
  assert.doesNotMatch(html, /New Selection/u);
  assert.match(html, /分镜版本 V2/u);
  assert.match(html, /来源：分镜 V1/u);
  assert.match(
    html,
    /\/api\/core\/p1\/assets\?objectKey=workspace-a%2Fcomposed%2Ffinal%20video.mp4/u
  );
  assert.doesNotMatch(html, /CORE_SERVICE_URL|\/v1\/assets/u);
  assert.doesNotMatch(html, /% 已完成/u);
  assert.match(html, /href="\/dashboard\/content"/u);
  assert.match(html, /在内容库查看/u);

  const retiredWorkflow = {
    ...workflow,
    catalogModelId: 'retired-secret-model-id',
  };
  const retiredEnvelope = { job: null, workflow: retiredWorkflow };
  const retiredQueryClient = queryClientWithLatest(retiredEnvelope);
  retiredQueryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'video_workflow', {
      workflowId: retiredWorkflow.id,
    }),
    retiredEnvelope
  );
  const retiredHtml = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: retiredQueryClient },
      createElement(VideoWorkflowPanel, {
        ...props,
        catalogModelId: 'new-selection',
        catalogModelNames: { 'new-selection': 'New Selection' },
        catalogModelName: 'New Selection',
      })
    )
  );
  assert.match(retiredHtml, /已锁定视频模型/u);
  assert.doesNotMatch(retiredHtml, /retired-secret-model-id|New Selection/u);
});

test('mobile progress mode renders nothing until this Work has a workflow', () => {
  const queryClient = queryClientWithLatest(null);
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(VideoWorkflowPanel, {
        mode: 'progress',
        workId: props.workId,
      })
    )
  );

  assert.equal(html, '');
});

test('progress mode restores the requested workflow instead of a newer one', () => {
  const latestWorkflow: VideoWorkflow = {
    aigcLabelEnabled: true,
    catalogModelId: 'seedance-2',
    composedAsset: {
      contentType: 'video/mp4',
      objectKey: 'workspace-a/composed/latest.mp4',
    },
    confirmed: true,
    id: 'workflow-latest',
    revision: 2,
    shots: [],
    status: 'completed',
    storyboardRevision: 'storyboard-latest',
    storyboardVersion: 2,
    updatedAt: '2026-07-13T12:10:00.000Z',
    workId: props.workId,
  };
  const requestedWorkflow: VideoWorkflow = {
    ...latestWorkflow,
    composedAsset: {
      contentType: 'video/mp4',
      objectKey: 'workspace-a/composed/requested.mp4',
    },
    id: 'workflow-requested',
    storyboardRevision: 'storyboard-requested',
    storyboardVersion: 1,
  };
  const queryClient = queryClientWithLatest({
    job: null,
    workflow: latestWorkflow,
  });
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'video_workflow', {
      workflowId: requestedWorkflow.id,
    }),
    { job: null, workflow: requestedWorkflow }
  );

  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(VideoWorkflowPanel, {
        mode: 'progress',
        workflowId: requestedWorkflow.id,
        workId: props.workId,
      })
    )
  );

  assert.match(html, /requested\.mp4/u);
  assert.doesNotMatch(html, /latest\.mp4/u);
});

test('a server draft can return to local editing without overwriting it', () => {
  const workflow: VideoWorkflow = {
    aigcLabelEnabled: true,
    catalogModelId: 'seedance-2',
    confirmed: false,
    id: 'workflow-draft-a',
    revision: 1,
    shots: [
      {
        candidates: [],
        candidatesPerShot: 1,
        id: 'aida-attention',
        prompt: '真实开场',
      },
    ],
    status: 'draft',
    storyboardRevision: 'storyboard-a',
    storyboardVersion: 1,
    updatedAt: '2026-07-13T12:00:00.000Z',
    workId: 'work-a',
  };
  const queryClient = queryClientWithLatest({ workflow, job: null });
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'video_workflow', {
      workflowId: workflow.id,
    }),
    { workflow, job: null }
  );
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(VideoWorkflowPanel, props)
    )
  );

  assert.match(html, /以此新建分镜版本/u);
  assert.match(html, /确认分镜并开始生成/u);
});

test('renders a failed Tracer Job as stopped with one clear recovery action', () => {
  const workflow: VideoWorkflow = {
    aigcLabelEnabled: true,
    catalogModelId: 'seedance-2',
    confirmed: true,
    derivedFromWorkflowId: 'workflow-parent',
    id: 'workflow-failed-a',
    revision: 4,
    shots: [
      {
        candidates: [],
        candidatesPerShot: 1,
        id: 'aida-attention',
        prompt: '真实开场',
      },
    ],
    status: 'running',
    storyboardRevision: 'storyboard-a',
    storyboardVersion: 2,
    updatedAt: '2026-07-13T12:00:00.000Z',
    workId: 'work-a',
  };
  const envelope: VideoWorkflowEnvelope = {
    workflow,
    job: {
      error: 'raw provider timeout payload',
      status: 'failed',
    },
  };
  const queryClient = queryClientWithLatest(envelope);
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'video_workflow', {
      workflowId: workflow.id,
    }),
    envelope
  );
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(VideoWorkflowPanel, props)
    )
  );

  assert.match(html, /视频任务未完成/u);
  assert.equal((html.match(/data-step-state="failed"/g) ?? []).length, 5);
  assert.doesNotMatch(html, /data-step-state="running"/u);
  assert.match(html, /返回分镜并新建版本/u);
  assert.match(html, /不会自动重投/u);
  assert.doesNotMatch(html, /raw provider timeout payload/u);
  assert.doesNotMatch(html, /取消视频任务/u);
});

test('redacts raw mutation errors and preserves only a safe correlation id', () => {
  const failure = videoWorkflowMutationFailure(
    new Error(
      'provider 500: secret upstream payload\n关联 ID：corr-video-safe-123'
    )
  );

  assert.match(failure.description, /操作未完成/u);
  assert.match(failure.description, /不会自动重投/u);
  assert.equal(failure.correlationId, 'corr-video-safe-123');
  assert.doesNotMatch(
    `${failure.description} ${failure.correlationId}`,
    /provider 500|secret upstream payload/u
  );
});

function queryClientWithLatest(value: VideoWorkflowEnvelope | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'video_workflow_latest', {
      workId: props.workId,
    }),
    value
  );
  return queryClient;
}
