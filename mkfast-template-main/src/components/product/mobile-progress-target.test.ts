import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { AsyncTaskSummary } from '@/product/async-task-center-model';

import { mobileProgressTarget } from './mobile-progress-target';

const runningTask = {
  createdAt: '2026-07-22T09:00:00.000Z',
  href: '/dashboard/jobs/job-1',
  id: 'job-1',
  kind: 'image',
  label: '图片',
  operation: 'image.generate',
  providerJobId: 'provider-job-1',
  source: 'creative',
  status: 'running',
  updatedAt: '2026-07-22T09:01:00.000Z',
  workId: 'work-in-flight',
} satisfies AsyncTaskSummary;

test('mobile progress enters the exact Result route for the newest in-flight Work', () => {
  const target = mobileProgressTarget([
    {
      ...runningTask,
      id: 'job-old',
      updatedAt: '2026-07-22T08:59:00.000Z',
      workId: 'work-old',
    },
    runningTask,
  ]);

  assert.deepEqual(target, {
    kind: 'result',
    workId: 'work-in-flight',
  });
});

test('mobile progress uses the real task center when no in-flight Work exists', () => {
  const target = mobileProgressTarget([
    { ...runningTask, status: 'completed' },
    { ...runningTask, id: 'canvas-job', workId: undefined },
  ]);

  assert.deepEqual(target, { kind: 'task-center' });
});

test('mobile navigation consumes the target as a Result deep link or task center route', () => {
  const source = readFileSync(
    new URL('./mobile-nav.tsx', import.meta.url),
    'utf8'
  );

  assert.match(source, /to="\/dashboard\/results_?\/\$workId"/u);
  assert.match(source, /params=\{\{ workId: progress\.workId \}\}/u);
  assert.match(source, /to=\{Routes\.TaskInbox\}/u);
  assert.doesNotMatch(source, /stage:\s*'progress'/u);
});
