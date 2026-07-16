import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EMPTY_TASK_FILTERS,
  currentWeekRange,
  nextActionTask,
  taskQuery,
  weeklyReviewView,
} from './operations-route-model';
import type { RawTask } from './operations-view-model';

function task(overrides: Partial<RawTask>): RawTask {
  return {
    createdAt: '2026-07-12T00:00:00.000Z',
    dueAt: '2026-07-15T09:00:00.000Z',
    executable: true,
    id: 'task-default',
    risk: 'normal',
    source: 'manual',
    status: 'todo',
    title: '默认任务',
    ...overrides,
  };
}

describe('operations route model', () => {
  it('keeps the week stable and never sends raw all filter values', () => {
    const now = new Date('2026-07-15T12:00:00.000Z');
    assert.deepEqual(currentWeekRange(now), {
      from: '2026-07-13T00:00:00.000Z',
      to: '2026-07-19T23:59:59.999Z',
    });
    assert.deepEqual(taskQuery(EMPTY_TASK_FILTERS, now), {});
    assert.deepEqual(
      taskQuery(
        {
          ...EMPTY_TASK_FILTERS,
          date: 'week',
          relatedKind: 'asset',
          risk: 'attention',
          source: 'asset_gap',
          status: 'needs_asset',
        },
        now
      ),
      {
        from: '2026-07-13T00:00:00.000Z',
        relatedKinds: ['asset'],
        risks: ['attention'],
        sources: ['asset_gap'],
        statuses: ['needs_asset'],
        to: '2026-07-19T23:59:59.999Z',
      }
    );
  });

  it('selects one next action by recovery, deadline, and stable id order', () => {
    const selected = nextActionTask([
      task({ id: 'task-late', dueAt: '2026-07-18T09:00:00.000Z' }),
      task({
        id: 'task-review',
        dueAt: '2026-07-14T09:00:00.000Z',
        status: 'needs_review',
      }),
      task({
        id: 'task-recovery-b',
        dueAt: '2026-07-16T09:00:00.000Z',
        status: 'blocked',
      }),
      task({
        id: 'task-recovery-a',
        dueAt: '2026-07-16T09:00:00.000Z',
        status: 'blocked',
      }),
    ]);
    assert.equal(selected?.id, 'task-recovery-a');
  });

  it('renders a missing weekly review as an honest empty projection', () => {
    assert.deepEqual(weeklyReviewView(null), { candidates: [], facts: [] });
  });
});
