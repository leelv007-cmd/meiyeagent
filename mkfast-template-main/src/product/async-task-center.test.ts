import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { p1QueryKeys } from '@/p1/query-keys';

import {
  AsyncTaskCenter,
  asyncTaskPanelPosition,
  createAnimationFrameScheduler,
  handleAsyncTaskPanelDismiss,
} from './async-task-center';
import type { RawCanonicalHistory } from './canonical-history-model';
import type { VideoWorkflowPublicProjection } from '@meiye/contracts';

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

test('dismisses the panel from Escape and outside clicks', async () => {
  const panelTarget = {} as Node;
  const triggerTarget = {} as Node;
  const outsideTarget = {} as Node;
  let closeCount = 0;
  let focusCount = 0;
  const panel = {
    contains: (target: Node | null) => target === panelTarget,
  } as Pick<HTMLElement, 'contains'>;
  const trigger = {
    contains: (target: Node | null) => target === triggerTarget,
    focus: () => {
      focusCount += 1;
    },
  } as Pick<HTMLElement, 'contains' | 'focus'>;
  const onClose = () => {
    closeCount += 1;
  };

  assert.equal(
    handleAsyncTaskPanelDismiss(
      { key: 'Escape', target: panelTarget, type: 'keydown' },
      panel,
      trigger,
      onClose
    ),
    true
  );
  await Promise.resolve();
  assert.equal(closeCount, 1);
  assert.equal(focusCount, 1);

  assert.equal(
    handleAsyncTaskPanelDismiss(
      { target: panelTarget, type: 'pointerdown' },
      panel,
      trigger,
      onClose
    ),
    false
  );
  assert.equal(
    handleAsyncTaskPanelDismiss(
      { target: triggerTarget, type: 'pointerdown' },
      panel,
      trigger,
      onClose
    ),
    false
  );
  assert.equal(
    handleAsyncTaskPanelDismiss(
      { target: outsideTarget, type: 'pointerdown' },
      panel,
      trigger,
      onClose
    ),
    true
  );
  await Promise.resolve();
  assert.equal(closeCount, 2);
  assert.equal(focusCount, 1);
});

test('coalesces scroll work into one animation frame and cancels pending cleanup', () => {
  let callbackCount = 0;
  let requestedFrame = 0;
  let queuedCallback: FrameRequestCallback | undefined;
  const cancelledFrames: number[] = [];
  const scheduler = createAnimationFrameScheduler(
    () => {
      callbackCount += 1;
    },
    (callback) => {
      requestedFrame += 1;
      queuedCallback = callback;
      return requestedFrame;
    },
    (frame) => cancelledFrames.push(frame)
  );

  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  assert.equal(requestedFrame, 1);
  assert.equal(callbackCount, 0);

  queuedCallback?.(0);
  assert.equal(callbackCount, 1);

  scheduler.schedule();
  scheduler.cancel();
  assert.equal(requestedFrame, 2);
  assert.deepEqual(cancelledFrames, [2]);
});

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

test('renders the task center panel through the tokenized body top layer', () => {
  const source = readFileSync(
    new URL('./async-task-center.tsx', import.meta.url),
    'utf8'
  );
  const styles = readFileSync(
    new URL('../styles.css', import.meta.url),
    'utf8'
  );

  assert.match(source, /createPortal\(/u);
  assert.match(source, /document\.body/u);
  assert.match(source, /data-layer="popover"/u);
  assert.doesNotMatch(source, /z-\[(?:60|70)\]/u);
  assert.match(styles, /--layer-base:\s*0/u);
  assert.match(styles, /--layer-sidebar:\s*20/u);
  assert.match(styles, /--layer-popover:\s*40/u);
  assert.match(styles, /--layer-toast:\s*60/u);
  assert.match(
    styles,
    /\[data-slot="sidebar-container"\][\s\S]*pointer-events:\s*none/u
  );
});

test('keeps the portalled panel inside common walkthrough viewports', () => {
  for (const viewport of [
    { height: 720, width: 1280 },
    { height: 900, width: 1440 },
  ]) {
    const trigger = {
      bottom: viewport.height - 32,
      left: 24,
      right: 288,
      top: viewport.height - 76,
    };
    const position = asyncTaskPanelPosition(trigger, viewport, false);

    assert.ok(position.left >= trigger.right);
    assert.ok(position.left + position.maxWidth <= viewport.width - 12);
    assert.ok(position.bottom >= 12);
    assert.ok(position.bottom + position.maxHeight <= viewport.height - 12);
  }
});

test('the collapsed global center includes an active video Job without exposing ids', () => {
  const projection: VideoWorkflowPublicProjection = {
    catalogModelId: 'seedance-2',
    confirmed: true,
    revision: 1,
    shots: [],
    status: 'running',
    storyboardRevision: 'storyboard-a',
    storyboardVersion: 1,
    updatedAt: '2026-07-13T00:01:00.000Z',
    workId: 'work-a',
    workflowId: 'private-workflow-id',
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
    [projection]
  );

  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(AsyncTaskCenter, { isMobile: false, userId: 'owner-a' })
    )
  );

  assert.match(html, /1 个进行中/u);
  assert.doesNotMatch(html, /private-workflow-id|model\.media-generation/u);
});
