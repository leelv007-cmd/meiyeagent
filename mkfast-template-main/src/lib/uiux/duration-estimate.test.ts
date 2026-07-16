import assert from 'node:assert/strict';
import test from 'node:test';

import { durationEstimateView } from './duration-estimate';

test('does not invent a duration when fewer than five live samples exist', () => {
  assert.deepEqual(
    durationEstimateView({
      status: 'insufficient_data',
      sampleSize: 3,
      minimumSampleSize: 5,
      windowDays: 30,
      asOf: '2026-07-13T12:00:00.000Z',
    }),
    {
      label: '暂无足够真实样本',
      description:
        '最近 30 天只有 3/5 次可核对的生产完成记录，不展示猜测耗时；实际耗时受所选模型与队列影响。',
    }
  );
});

test('formats observed P50 and P90 without fake precision', () => {
  assert.deepEqual(
    durationEstimateView({
      status: 'observed',
      p50Seconds: 50,
      p90Seconds: 125,
      sampleSize: 9,
      windowDays: 30,
      asOf: '2026-07-13T12:00:00.000Z',
    }),
    {
      label: '通常约 50 秒–2 分 5 秒',
      description:
        '基于最近 30 天 9 次可核对的生产完成记录；实际耗时受所选模型与队列影响。',
    }
  );
});
