import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { p1QueryKeys } from '@/p1/query-keys';

import { AsyncTaskCenter } from './async-task-center';
import type { RawCanonicalHistory } from './canonical-history-model';
import type { ComposedVideoTaskEnvelope } from './async-task-center-model';

const emptyHistory: RawCanonicalHistory = {
  assets: [],
  canvasWorks: [],
  contents: [],
  creativeWorks: [],
  exportReceipts: [],
  imageJobs: [],
  jobs: [],
  sessions: [],
  tasks: [],
};

test('closing one notification dismisses only that task without closing the panel', () => {
  const source = readFileSync(
    new URL('./async-task-center.tsx', import.meta.url),
    'utf8'
  );

  assert.match(source, /useState<Set<string>>\(\s*\(\) => new Set\(\)\s*\)/u);
  assert.match(
    source,
    /panelTasks\.filter\(\s*\(task\) => !dismissedTaskIds\.has\(task\.id\)\s*\)/u
  );
  assert.match(source, /next\.add\(taskId\)/u);
  assert.match(source, /onClose=\{\(\) => dismissTask\(task\.id\)\}/u);
  assert.doesNotMatch(source, /onClose=\{toggle\}/u);
});

test('the collapsed global center includes an active composed-video Job without exposing ids', () => {
  const envelope: ComposedVideoTaskEnvelope = {
    job: {
      createdAt: '2026-07-13T00:00:00.000Z',
      jobId: 'model.composed-video:private-workflow-id',
      status: 'running',
      updatedAt: '2026-07-13T00:01:00.000Z',
    },
    workflow: {
      actorId: 'owner-a',
      aigcLabelEnabled: true,
      catalogModelId: 'seedance-2',
      confirmed: true,
      createdAt: '2026-07-13T00:00:00.000Z',
      id: 'private-workflow-id',
      revision: 1,
      shots: [],
      status: 'running',
      storyboardRevision: 'storyboard-a',
      storyboardVersion: 1,
      updatedAt: '2026-07-13T00:01:00.000Z',
      workId: 'work-a',
      workspaceId: 'workspace-a',
    },
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(
    p1QueryKeys.request('operations', 'canonical_history'),
    emptyHistory
  );
  queryClient.setQueryData(
    p1QueryKeys.request('model-supply', 'video_workflows'),
    [envelope]
  );

  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(AsyncTaskCenter, { isMobile: false, userId: 'owner-a' })
    )
  );

  assert.match(html, /1 个进行中/u);
  assert.doesNotMatch(html, /private-workflow-id|model\.composed-video/u);
});
