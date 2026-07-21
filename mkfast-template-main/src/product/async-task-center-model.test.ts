import assert from 'node:assert/strict';
import test from 'node:test';
import {
  asyncTaskCenterPlan,
  asyncTaskElapsedLabel,
  asyncTaskStorageKey,
  composedVideoAsyncTaskSummaries,
  markAsyncTasksRead,
  reconcileAsyncTaskReadState,
  type AsyncTaskSummary,
} from './async-task-center-model';

function task(
  id: string,
  status: AsyncTaskSummary['status'],
  updatedAt: string
): AsyncTaskSummary {
  return {
    createdAt: '2026-07-13T00:00:00.000Z',
    href: `/dashboard/jobs/${id}`,
    id,
    kind: 'image',
    label: `任务 ${id}`,
    operation: 'image.generate',
    providerJobId: id,
    source: 'creative',
    status,
    updatedAt,
  };
}

test('elapsed labels use created facts and freeze terminal task duration', () => {
  assert.equal(
    asyncTaskElapsedLabel(
      task('active', 'running', '2026-07-13T00:01:00.000Z'),
      Date.parse('2026-07-13T00:02:30.000Z')
    ),
    '已运行约 3 分钟'
  );
  assert.equal(
    asyncTaskElapsedLabel(
      task('done', 'completed', '2026-07-13T01:05:00.000Z'),
      Date.parse('2026-07-13T03:00:00.000Z')
    ),
    '总用时约 1 小时 5 分钟'
  );
});

test('the first successful load establishes a baseline without historical unread', () => {
  const result = reconcileAsyncTaskReadState(undefined, [
    task('old-completed', 'completed', '2026-07-13T00:00:00.000Z'),
    task('active', 'running', '2026-07-13T00:01:00.000Z'),
  ]);
  assert.deepEqual(result.unreadKeys, []);
  assert.deepEqual(result.recentKeys, []);
  assert.deepEqual(result.seenTerminalKeys, [
    'old-completed:completed:2026-07-13T00:00:00.000Z',
  ]);
});

test('later terminal transitions become unread once and remain recent after reading', () => {
  const baseline = reconcileAsyncTaskReadState(undefined, [
    task('active', 'running', '2026-07-13T00:00:00.000Z'),
  ]);
  const completed = reconcileAsyncTaskReadState(baseline, [
    task('active', 'completed', '2026-07-13T00:05:00.000Z'),
  ]);
  assert.deepEqual(completed.unreadKeys, [
    'active:completed:2026-07-13T00:05:00.000Z',
  ]);
  assert.deepEqual(completed.recentKeys, [
    'active:completed:2026-07-13T00:05:00.000Z',
  ]);

  const read = markAsyncTasksRead(completed);
  assert.deepEqual(read.unreadKeys, []);
  assert.deepEqual(read.recentKeys, [
    'active:completed:2026-07-13T00:05:00.000Z',
  ]);
  assert.deepEqual(
    reconcileAsyncTaskReadState(read, [
      task('active', 'completed', '2026-07-13T00:05:00.000Z'),
    ]).unreadKeys,
    []
  );
});

test('a composed-video review gate becomes one actionable unread transition', () => {
  const baseline = reconcileAsyncTaskReadState(undefined, [
    task('video-workflow', 'running', '2026-07-13T00:01:00.000Z'),
  ]);
  const awaitingReview = reconcileAsyncTaskReadState(baseline, [
    task('video-workflow', 'recoverable', '2026-07-13T00:02:00.000Z'),
  ]);

  assert.deepEqual(awaitingReview.unreadKeys, [
    'video-workflow:recoverable:2026-07-13T00:02:00.000Z',
  ]);
});

test('composed-video summaries use public projections without exposing internal ids', () => {
  const base = {
    catalogModelId: 'seedance-2',
    confirmed: true,
    revision: 2,
    shots: [],
    storyboardRevision: 'storyboard-a',
    storyboardVersion: 1,
    workId: 'merchant-work-a',
  };
  const summaries = composedVideoAsyncTaskSummaries([
    {
      ...base,
      status: 'running',
      updatedAt: '2026-07-13T00:01:00.000Z',
      workflowId: 'internal-workflow-id',
    },
    {
      ...base,
      status: 'awaiting_quality_review',
      updatedAt: '2026-07-13T00:02:00.000Z',
      workflowId: 'review-workflow-id',
    },
    {
      ...base,
      status: 'failed',
      updatedAt: '2026-07-13T00:03:00.000Z',
      workflowId: 'failed-workflow-id',
    },
    {
      ...base,
      confirmed: false,
      status: 'draft',
      updatedAt: '2026-07-13T00:00:00.000Z',
      workflowId: 'draft-workflow-id',
    },
  ]);

  assert.deepEqual(
    summaries.map((summary) => summary.status),
    ['failed', 'recoverable', 'running']
  );
  assert.ok(summaries.every((summary) => summary.source === 'video_workflow'));
  assert.equal(
    summaries.find((summary) => summary.status === 'running')?.providerJobId,
    'internal-workflow-id'
  );
  assert.ok(
    summaries.every(
      (summary) =>
        summary.label === '视频任务' &&
        summary.href === '/dashboard/results/merchant-work-a'
    )
  );
  assert.doesNotMatch(
    summaries.map(({ href, label }) => `${label} ${href}`).join(' '),
    /internal-workflow-id|model\.composed-video/u
  );
});
test('read state is isolated by authenticated user', () => {
  assert.equal(asyncTaskStorageKey('user-a'), 'meiye:async-task-center:user-a');
  assert.notEqual(asyncTaskStorageKey('user-a'), asyncTaskStorageKey('user-b'));
});

test('active observers remain planned while the task panel is closed', () => {
  const tasks = [
    task('active', 'running', '2026-07-13T00:00:00.000Z'),
    task('done', 'completed', '2026-07-13T00:01:00.000Z'),
  ];
  const closed = asyncTaskCenterPlan({
    panelOpen: false,
    recentKeys: ['done:completed:2026-07-13T00:01:00.000Z'],
    tasks,
  });
  const open = asyncTaskCenterPlan({
    panelOpen: true,
    recentKeys: ['done:completed:2026-07-13T00:01:00.000Z'],
    tasks,
  });
  assert.deepEqual(
    closed.observerTasks.map((item) => item.id),
    ['active']
  );
  assert.deepEqual(open.observerTasks, closed.observerTasks);
  assert.deepEqual(closed.panelTasks, []);
  assert.deepEqual(
    open.panelTasks.map((item) => item.id),
    ['active', 'done']
  );
});
