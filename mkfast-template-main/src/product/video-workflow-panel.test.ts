import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  CreativeExecutionContract,
  VideoWorkflowPublicProjection,
} from '@meiye/contracts';

import { p1QueryKeys } from '@/p1/query-keys';

import {
  publicProjectionFromWorkflow,
  syncVideoWorkflowMutationSuccess,
  VideoWorkflowPanel,
  videoWorkflowMutationFailure,
  videoWorkflowPollingFallback,
} from './video-workflow-panel';
import type { VideoWorkflow } from './video-workflow-model';

const executionContract: CreativeExecutionContract = {
  aigcLabelEnabled: true,
  aspectRatio: '9:16',
  catalogModelId: 'seedance-2',
  catalogRevision: 'catalog-video-v1',
  currency: 'CNY',
  dataClass: ['contains_face'],
  durationSeconds: 15,
  estimatedAmount: 12,
  operation: 'video.generate',
  outputCount: 1,
  outputLabel: '15 秒视频成片',
  quoteAcceptedAt: '2026-07-18T00:00:00.000Z',
  quoteRevision: 'quote-video-v1',
  watermarkEnabled: false,
};

const props = {
  aigcLabelEnabled: true,
  catalogModelId: 'seedance-2',
  catalogModelNames: {
    'seedance-2': 'Seedance 2.0',
  },
  catalogModelName: 'Seedance 2.0',
  dataClass: ['contains_face'] as const,
  executionContract,
  intent: '记录一次真实到店体验',
  workId: 'work-a',
};

function publicProjection(
  overrides: Partial<VideoWorkflowPublicProjection> &
    Pick<VideoWorkflowPublicProjection, 'workflowId' | 'status'>
): VideoWorkflowPublicProjection {
  return {
    catalogModelId: 'seedance-2',
    confirmed: overrides.status !== 'draft',
    revision: 2,
    shots: [],
    storyboardRevision: 'storyboard-a',
    storyboardVersion: 1,
    updatedAt: '2026-07-18T08:00:00.000Z',
    workId: props.workId,
    ...overrides,
  };
}

test('polling is only a temporary fallback while SSE is degraded', () => {
  const running = publicProjection({
    confirmed: true,
    workflowId: 'workflow-polling-a',
    status: 'running',
  });

  assert.equal(videoWorkflowPollingFallback('open', running), false);
  assert.equal(videoWorkflowPollingFallback('degraded', running), true);
  assert.equal(
    videoWorkflowPollingFallback(
      'degraded',
      publicProjection({
        workflowId: 'workflow-polling-a',
        status: 'completed',
      })
    ),
    false
  );
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

test('restores a completed workflow and routes to Result Center without durable media blobs', () => {
  const projection = publicProjection({
    catalogModelId: 'seedance-2',
    confirmed: true,
    revision: 8,
    storyboardVersion: 2,
    status: 'completed',
    updatedAt: '2026-07-13T12:00:00.000Z',
    workflowId: 'workflow-a',
  });
  const queryClient = queryClientWithLatest(projection);
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'video_workflow', {
      workflowId: projection.workflowId,
    }),
    projection
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
  // Public projection no longer carries composed object keys.
  assert.doesNotMatch(html, /objectKey|\/api\/core\/p1\/assets/u);
  assert.doesNotMatch(html, /CORE_SERVICE_URL|\/v1\/assets/u);
  assert.doesNotMatch(html, /% 已完成/u);
  assert.match(html, /href="\/dashboard\/results\/work-a"/u);
  assert.match(html, /在内容库查看/u);

  const retired = publicProjection({
    catalogModelId: 'retired-secret-model-id',
    confirmed: true,
    status: 'completed',
    workflowId: 'workflow-retired',
  });
  const retiredQueryClient = queryClientWithLatest(retired);
  retiredQueryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'video_workflow', {
      workflowId: retired.workflowId,
    }),
    retired
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
  const latest = publicProjection({
    confirmed: true,
    status: 'completed',
    storyboardRevision: 'storyboard-latest',
    storyboardVersion: 2,
    updatedAt: '2026-07-13T12:10:00.000Z',
    workflowId: 'workflow-latest',
  });
  const requested = publicProjection({
    confirmed: true,
    status: 'completed',
    storyboardRevision: 'storyboard-requested',
    storyboardVersion: 1,
    updatedAt: '2026-07-13T12:00:00.000Z',
    workflowId: 'workflow-requested',
  });
  const queryClient = queryClientWithLatest(latest);
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'video_workflow', {
      workflowId: requested.workflowId,
    }),
    requested
  );

  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(VideoWorkflowPanel, {
        mode: 'progress',
        workflowId: requested.workflowId,
        workId: props.workId,
      })
    )
  );

  assert.match(html, /分镜版本 V1/u);
  assert.doesNotMatch(html, /分镜版本 V2/u);
});

test('a server draft can return to local editing without overwriting it', () => {
  const projection = publicProjection({
    confirmed: false,
    revision: 1,
    shots: [
      {
        candidateCount: 0,
        candidatesPerShot: 1,
        promptPreview: '真实开场',
        shotId: 'aida-attention',
      },
    ],
    status: 'draft',
    workflowId: 'workflow-draft-a',
  });
  const queryClient = queryClientWithLatest(projection);
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'video_workflow', {
      workflowId: projection.workflowId,
    }),
    projection
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

test('renders a failed public workflow as stopped with one clear recovery action', () => {
  const projection = publicProjection({
    confirmed: true,
    revision: 4,
    shots: [
      {
        candidateCount: 0,
        candidatesPerShot: 1,
        promptPreview: '真实开场',
        shotId: 'aida-attention',
      },
    ],
    status: 'failed',
    storyboardVersion: 2,
    workflowId: 'workflow-failed-a',
  });
  const queryClient = queryClientWithLatest(projection);
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'video_workflow', {
      workflowId: projection.workflowId,
    }),
    projection
  );
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(VideoWorkflowPanel, props)
    )
  );

  assert.match(html, /视频任务未完成/u);
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

test('successful video workflow mutations refresh the content package cache', async () => {
  const queryClient = new QueryClient();
  const latestKey = p1QueryKeys.request(
    'model-supply',
    'video_workflow_latest',
    { workId: props.workId }
  );
  const contentPackagesKey = p1QueryKeys.request(
    'operations',
    'content_packages'
  );
  const workflow: VideoWorkflow = {
    aigcLabelEnabled: true,
    catalogModelId: 'seedance-2',
    confirmed: true,
    id: 'workflow-mutation-a',
    revision: 2,
    shots: [],
    status: 'running',
    storyboardRevision: 'storyboard-mutation-a',
    storyboardVersion: 1,
    updatedAt: '2026-07-13T12:00:00.000Z',
    workId: props.workId,
  };
  const projection = publicProjectionFromWorkflow(workflow);
  queryClient.setQueryData(contentPackagesKey, []);

  await syncVideoWorkflowMutationSuccess(queryClient, latestKey, projection);

  assert.deepEqual(queryClient.getQueryData(latestKey), projection);
  assert.deepEqual(
    queryClient.getQueryData(
      p1QueryKeys.request('model-supply', 'video_workflow', {
        workflowId: projection.workflowId,
      })
    ),
    projection
  );
  assert.equal(
    queryClient.getQueryState(contentPackagesKey)?.isInvalidated,
    true
  );
});

function queryClientWithLatest(value: VideoWorkflowPublicProjection | null) {
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
