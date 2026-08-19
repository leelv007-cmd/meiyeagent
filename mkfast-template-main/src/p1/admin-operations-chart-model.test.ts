import { strict as assert } from 'node:assert';
import test from 'node:test';

import type { EntitlementStatusView } from '@/p1/admin-entitlement-status-model';
import {
  buildOutcomeSlices,
  buildTaskTimeline,
  buildTenantTimeline,
  buildTrialStatus,
  TRIAL_GRANT_CENSUS,
} from '@/p1/admin-operations-chart-model';

const OUTCOME_LABELS = {
  completed: '完成',
  dead_letter: '死信',
  deferred: '延后',
  retry: '重试',
  threw: '异常',
};

/**
 * 这条断言就是「不画好看的零」那句话的执行版：拿不到执行结果时返回 null，
 * 面板据此写「未知」；返回一个全零的切片集会被读成「近期一件没跑」。
 */
test('unknown outcomes produce nothing to draw, never a zeroed chart', () => {
  assert.equal(
    buildOutcomeSlices(
      { reason: 'runner_window_not_wired', status: 'unknown' },
      OUTCOME_LABELS
    ),
    null
  );
  assert.equal(buildOutcomeSlices(undefined, OUTCOME_LABELS), null);
});

test('an all-zero window is reported as empty, not as unknown', () => {
  const slices = buildOutcomeSlices(
    {
      status: 'known',
      value: {
        completed: 0,
        dead_letter: 0,
        deferred: 0,
        retry: 0,
        threw: 0,
      },
    },
    OUTCOME_LABELS
  );
  assert.deepEqual(slices, []);
});

test('known outcomes become labelled slices in a stable order', () => {
  const slices = buildOutcomeSlices(
    {
      status: 'known',
      value: {
        completed: 12,
        dead_letter: 1,
        deferred: 3,
        retry: 2,
        threw: 0,
      },
    },
    OUTCOME_LABELS
  );
  assert.deepEqual(
    slices?.map((slice) => [slice.id, slice.label, slice.value]),
    [
      ['completed', '完成', 12],
      ['dead_letter', '死信', 1],
      ['deferred', '延后', 3],
      ['retry', '重试', 2],
      ['threw', '异常', 0],
    ]
  );
});

test('task runs become a newest-first timeline with human status words', () => {
  const timeline = buildTaskTimeline(
    [
      {
        id: 'run-old',
        modality: 'image',
        operation: 'image.generate',
        startedAt: '2026-07-26T01:00:00.000Z',
        status: 'succeeded',
        taskId: 'task-1',
      },
      {
        id: 'run-new',
        modality: 'llm',
        operation: 'llm.copy',
        startedAt: '2026-07-27T01:00:00.000Z',
        status: 'running',
        taskId: 'task-2',
      },
    ],
    (status) => (status === 'running' ? '执行中' : '已完成')
  );
  assert.deepEqual(
    timeline?.map((entry) => [entry.id, entry.status]),
    [
      ['run-new', '执行中'],
      ['run-old', '已完成'],
    ]
  );
});

/** 快照没到 ≠ 近期没跑过：前者未知，后者是一个事实。 */
test('a missing snapshot yields no timeline, an empty one yields an empty timeline', () => {
  assert.equal(
    buildTaskTimeline(undefined, (status) => status),
    null
  );
  assert.deepEqual(
    buildTaskTimeline([], (status) => status),
    []
  );
});

/** 目录没到就是「未知」，不折算成「已停发」。 */
test('trial status stays unknown until the plan catalog answers', () => {
  assert.deepEqual(buildTrialStatus({}), { enabled: null });
  assert.deepEqual(buildTrialStatus({ trialEnabled: false }), {
    enabled: false,
  });
  assert.deepEqual(buildTrialStatus({ trialEnabled: true }), { enabled: true });
});

/**
 * 「还在试用期的门店有多少家」平台级没有这本账：快照里的账户分配是管理员开的
 * 例外单，七种 source 里没有一种是试用。想在这里报一个数，得先改这个常量。
 */
test('the trial census is declared unwired, not counted off admin exceptions', () => {
  assert.equal(TRIAL_GRANT_CENSUS.status, 'unknown');
  assert.equal(
    TRIAL_GRANT_CENSUS.reason,
    'trial_grant_census_projection_not_wired'
  );
});

function statusView(
  overrides: Partial<EntitlementStatusView> = {}
): EntitlementStatusView {
  return {
    activeAllocationCount: { status: 'known', value: 1 },
    allocations: [],
    dualTruthNote: '',
    policies: [],
    pools: [],
    publishedPolicyCount: { status: 'known', value: 1 },
    supplyPoolCount: { status: 'known', value: 0 },
    ...overrides,
  };
}

test('the tenant timeline merges both record kinds newest first', () => {
  const timeline = buildTenantTimeline(
    statusView({
      allocations: [
        {
          accountId: 'acct-1',
          endsAt: null,
          id: 'alloc-1',
          kind: 'grant',
          reason: '春季活动加赠额度',
          source: 'campaign',
          startsAt: '2026-07-20T00:00:00.000Z',
          status: 'active',
          targetLabel: '额度 · 文案',
          workspaceId: 'ws-1',
        },
      ],
      policies: [
        {
          allowanceSummary: '文案 20 · 图片 10 · 视频 5',
          concurrencyLimit: 1,
          id: 'policy-1',
          publishedAt: '2026-07-25T00:00:00.000Z',
          queuePriority: 3,
          revision: 4,
          revisionId: 'rev-4',
          stage: 'published',
          supportLabel: 'standard',
          tier: 'trial',
        },
      ],
    }),
    { allocationStatus: () => '生效中', policyStage: () => '已发布' }
  );

  assert.deepEqual(
    timeline.map((entry) => [entry.kind, entry.title]),
    [
      ['policy', 'trial · r4'],
      ['allocation', '额度 · 文案'],
    ]
  );
});

test('records without a timestamp sort last instead of faking one', () => {
  const timeline = buildTenantTimeline(
    statusView({
      policies: [
        {
          allowanceSummary: 'draft',
          concurrencyLimit: 1,
          id: 'policy-draft',
          queuePriority: 1,
          revision: 1,
          revisionId: 'rev-1',
          stage: 'draft',
          supportLabel: 'standard',
          tier: 'pro',
        },
        {
          allowanceSummary: 'published',
          concurrencyLimit: 1,
          id: 'policy-live',
          publishedAt: '2026-07-01T00:00:00.000Z',
          queuePriority: 1,
          revision: 2,
          revisionId: 'rev-2',
          stage: 'published',
          supportLabel: 'standard',
          tier: 'growth',
        },
      ],
    }),
    { allocationStatus: () => '', policyStage: (stage) => stage }
  );

  assert.deepEqual(
    timeline.map((entry) => entry.at),
    ['2026-07-01T00:00:00.000Z', null]
  );
});

test('the timeline is capped so a long history cannot swamp the panel', () => {
  const policies = Array.from({ length: 12 }, (_, index) => ({
    allowanceSummary: `r${index}`,
    concurrencyLimit: 1,
    id: `policy-${index}`,
    publishedAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    queuePriority: 1,
    revision: index,
    revisionId: `rev-${index}`,
    stage: 'published' as const,
    supportLabel: 'standard' as const,
    tier: 'pro',
  }));
  const timeline = buildTenantTimeline(statusView({ policies }), {
    allocationStatus: () => '',
    policyStage: () => '',
  });
  assert.equal(timeline.length, 6);
  assert.equal(timeline[0].at, '2026-07-12T00:00:00.000Z');
});
