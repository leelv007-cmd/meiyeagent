import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RECENT_DESKTOP_LIMIT,
  RECENT_MOBILE_LIMIT,
  type RecentActivitySource,
} from '@meiye/contracts';

import {
  nextActionLabelForPhase,
  nextActionLabelForRecent,
  projectRecent,
  recentLimitForViewport,
} from './recent-projection.js';

function activity(
  overrides: Partial<RecentActivitySource> &
    Pick<RecentActivitySource, 'workId' | 'effectiveActivityAt' | 'phase'>,
): RecentActivitySource {
  return {
    workspaceId: 'ws-1',
    title: `title-${overrides.workId}`,
    medium: 'image_text',
    ...overrides,
  };
}

test('desktop caps at 6 and mobile caps at 4', () => {
  assert.equal(RECENT_DESKTOP_LIMIT, 6);
  assert.equal(RECENT_MOBILE_LIMIT, 4);
  assert.equal(recentLimitForViewport('desktop'), 6);
  assert.equal(recentLimitForViewport('mobile'), 4);

  const sources = Array.from({ length: 10 }, (_, index) =>
    activity({
      workId: `work-${String(index).padStart(2, '0')}`,
      phase: 'ready',
      effectiveActivityAt: new Date(
        Date.parse('2026-07-20T00:00:00.000Z') + index * 60_000,
      ).toISOString(),
    }),
  );

  const desktop = projectRecent(sources, 'desktop');
  const mobile = projectRecent(sources, 'mobile');

  assert.equal(desktop.length, 6);
  assert.equal(mobile.length, 4);

  // Newest first.
  assert.deepEqual(
    desktop.map((item) => item.workId),
    ['work-09', 'work-08', 'work-07', 'work-06', 'work-05', 'work-04'],
  );
  assert.deepEqual(
    mobile.map((item) => item.workId),
    ['work-09', 'work-08', 'work-07', 'work-06'],
  );
});

test('sorts by recent effective activity and keeps precise workId targets', () => {
  const sources: RecentActivitySource[] = [
    activity({
      workId: 'work-old',
      phase: 'delivered',
      effectiveActivityAt: '2026-07-19T00:00:00.000Z',
      contentId: 'pkg-old',
    }),
    activity({
      workId: 'work-new',
      phase: 'running',
      effectiveActivityAt: '2026-07-20T12:00:00.000Z',
      contentId: 'pkg-new',
      panel: 'run',
    }),
    activity({
      workId: 'work-mid',
      phase: 'needs_input',
      effectiveActivityAt: '2026-07-20T06:00:00.000Z',
    }),
  ];

  const projected = projectRecent(sources, 'desktop');
  assert.deepEqual(
    projected.map((item) => item.workId),
    ['work-new', 'work-mid', 'work-old'],
  );
  assert.equal(projected[0]?.target.workId, 'work-new');
  assert.equal(projected[0]?.target.contentId, 'pkg-new');
  assert.equal(projected[0]?.target.panel, 'run');
  // Never invents a different workId.
  assert.ok(projected.every((item) => item.target.workId === item.workId));
});

test('status-driven next-action copy covers phase matrix', () => {
  assert.equal(nextActionLabelForPhase('running'), '查看进度');
  assert.equal(nextActionLabelForPhase('needs_input'), '处理当前问题');
  assert.equal(nextActionLabelForPhase('ready'), '继续调整');
  assert.equal(nextActionLabelForPhase('failed'), '处理当前问题');
  assert.equal(nextActionLabelForPhase('delivered'), '查看结果');

  assert.equal(
    nextActionLabelForRecent(
      activity({
        workId: 'w1',
        phase: 'ready',
        panel: 'delivery',
        effectiveActivityAt: '2026-07-20T00:00:00.000Z',
      }),
    ),
    '继续交付',
  );
  assert.equal(
    nextActionLabelForRecent(
      activity({
        workId: 'w2',
        phase: 'ready',
        panel: 'result',
        effectiveActivityAt: '2026-07-20T00:00:00.000Z',
      }),
    ),
    '查看结果',
  );

  const projected = projectRecent(
    [
      activity({
        workId: 'w-run',
        phase: 'running',
        effectiveActivityAt: '2026-07-20T05:00:00.000Z',
      }),
      activity({
        workId: 'w-input',
        phase: 'needs_input',
        effectiveActivityAt: '2026-07-20T04:00:00.000Z',
      }),
      activity({
        workId: 'w-ready',
        phase: 'ready',
        effectiveActivityAt: '2026-07-20T03:00:00.000Z',
      }),
      activity({
        workId: 'w-fail',
        phase: 'failed',
        effectiveActivityAt: '2026-07-20T02:00:00.000Z',
      }),
      activity({
        workId: 'w-del',
        phase: 'delivered',
        effectiveActivityAt: '2026-07-20T01:00:00.000Z',
      }),
      activity({
        workId: 'w-deliver-panel',
        phase: 'ready',
        panel: 'delivery',
        effectiveActivityAt: '2026-07-20T00:30:00.000Z',
      }),
    ],
    'desktop',
  );

  assert.deepEqual(
    projected.map((item) => [item.workId, item.nextActionLabel]),
    [
      ['w-run', '查看进度'],
      ['w-input', '处理当前问题'],
      ['w-ready', '继续调整'],
      ['w-fail', '处理当前问题'],
      ['w-del', '查看结果'],
      ['w-deliver-panel', '继续交付'],
    ],
  );

  // Vague copy is forbidden.
  for (const item of projected) {
    assert.notEqual(item.nextActionLabel, '查看详情');
  }
});

test('projection is pure and deterministic', () => {
  const sources = [
    activity({
      workId: 'a',
      phase: 'ready',
      effectiveActivityAt: '2026-07-20T01:00:00.000Z',
    }),
    activity({
      workId: 'b',
      phase: 'running',
      effectiveActivityAt: '2026-07-20T02:00:00.000Z',
    }),
  ];
  assert.deepEqual(
    projectRecent(sources, 'mobile'),
    projectRecent(sources, 'mobile'),
  );
});
