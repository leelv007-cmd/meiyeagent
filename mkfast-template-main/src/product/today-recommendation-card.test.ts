import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { StoreFact, TodayRecommendationState } from '@meiye/contracts';

import {
  recommendationFactLabels,
  todayRecommendationView,
  workbenchHasWork,
} from '@/product/today-recommendation-card';

test('keeps zero facts in the honest cold state', () => {
  assert.deepEqual(
    todayRecommendationView({
      workspaceId: 'workspace-1',
      currentFactsRevision: 0,
      recommendation: null,
      stale: false,
    }),
    { kind: 'cold' }
  );
});

test('never exposes an old recommendation after the facts revision changes', () => {
  assert.deepEqual(
    todayRecommendationView({
      workspaceId: 'workspace-1',
      currentFactsRevision: 2,
      recommendation: null,
      stale: true,
    }),
    { kind: 'stale' }
  );
});

test('never tells a workspace that already produced work that it has none', () => {
  // W04: the media path can project nothing at all; that degraded state must
  // read as "today's pick did not come out", never as a cold start.
  assert.deepEqual(
    todayRecommendationView(
      {
        workspaceId: 'workspace-1',
        currentFactsRevision: 3,
        recommendation: null,
        stale: false,
      },
      true
    ),
    { kind: 'pending' }
  );
  // A revision change still reads as stale — that reason is more specific.
  assert.deepEqual(
    todayRecommendationView(
      {
        workspaceId: 'workspace-1',
        currentFactsRevision: 3,
        recommendation: null,
        stale: true,
      },
      true
    ),
    { kind: 'stale' }
  );
});

test('reads work in hand from the creative workbench projection', () => {
  const empty = { assets: [], contents: [], events: [], jobs: [], works: [] };
  assert.equal(workbenchHasWork(undefined), false);
  assert.equal(workbenchHasWork(empty), false);
  // 生成过图片的账号：媒体 Asset 单独存在就已经算产出过东西。
  assert.equal(
    workbenchHasWork({ ...empty, assets: [{ kind: 'image' }] } as never),
    true
  );
  assert.equal(
    workbenchHasWork({ ...empty, works: [{ status: 'completed' }] } as never),
    true
  );
  assert.equal(
    workbenchHasWork({
      ...empty,
      jobs: [{ outputAssetIds: ['asset-1'], outputContentIds: [] }],
    } as never),
    true
  );
});

test('an attempt that produced nothing is not work in hand', () => {
  // 首访和全失败：Job/Work 行存在≠成品存在。没有产出就不许说「今天这条没排
  // 出来」——那句话暗示这个账号有历史，冷启动才是诚实的说法。
  const empty = { assets: [], contents: [], events: [], jobs: [], works: [] };
  for (const status of ['submitting', 'failed', 'unknown'] as const) {
    assert.equal(
      workbenchHasWork({
        ...empty,
        jobs: [{ status, outputAssetIds: [], outputContentIds: [] }],
      } as never),
      false
    );
  }
  for (const status of ['draft', 'running', 'failed'] as const) {
    assert.equal(
      workbenchHasWork({ ...empty, works: [{ status }] } as never),
      false
    );
  }
  // 整个工作台只剩一条失败记录 → 冷启动文案，不是 pending。
  assert.deepEqual(
    todayRecommendationView(
      {
        workspaceId: 'workspace-1',
        currentFactsRevision: 1,
        recommendation: null,
        stale: false,
      },
      workbenchHasWork({
        ...empty,
        works: [{ status: 'failed' }],
        jobs: [{ status: 'failed', outputAssetIds: [], outputContentIds: [] }],
      } as never)
    ),
    { kind: 'cold' }
  );
});

test('names the store facts a recommendation used instead of counting them', () => {
  assert.deepEqual(
    recommendationFactLabels(
      ['store_fact:fact-price:2', 'store_fact:fact-service:1'],
      [
        storeFact({ factId: 'fact-price', kind: 'price', value: 199 }),
        storeFact({
          factId: 'fact-service',
          kind: 'service',
          value: { name: '猫眼加固' },
        }),
      ]
    ),
    ['价格', '服务项目·猫眼加固']
  );
});

test('degrades to the count when the fact ledger cannot name a reference', () => {
  // Loading, failed, and "the referenced fact is no longer active" all fall
  // back to the count — an unnamed reference is never invented.
  assert.deepEqual(
    recommendationFactLabels(['store_fact:fact-price:2'], undefined),
    []
  );
  assert.deepEqual(
    recommendationFactLabels(
      ['store_fact:fact-gone:2'],
      [storeFact({ factId: 'fact-price', kind: 'price', value: 199 })]
    ),
    []
  );
});

test('keeps ledger keys and ids out of the named facts', () => {
  assert.deepEqual(
    recommendationFactLabels(
      ['store_fact:fact-a:1', 'store_fact:fact-b:1'],
      [
        storeFact({
          factId: 'fact-a',
          kind: 'discount',
          value: 'store_fact:offer-price',
        }),
        storeFact({
          factId: 'fact-b',
          kind: 'group_buy',
          value: { name: '2f2f7d8a-4a7c-4d0a-9a5f-2f1b7c0d9e11' },
        }),
      ]
    ),
    ['优惠', '团购信息']
  );
});

test('admits only values that look like merchant language', () => {
  // Fail-closed 白名单：证明不了是人话的值一律退回计数（只留 kind 标签）。
  const rejected = [
    'fact-price',
    'asset-abc',
    'factprice',
    'assetabc',
    '01J8XK2M3N4P5Q6R',
    'SKU_1234',
    'a3f9c2e1b4d6',
    'deadbeef',
    'ABCDEF',
    'v2/store/name',
    '猫眼加固 01J8XK2M3N4P',
    '猫眼 J8XK2M3',
    // 对抗边界：恰好 4 位、中文标点包裹、纯数字邻接字母 token。
    '猫眼 SKU1',
    '猫眼（AB12）加固',
    '猫眼 199，ABCD',
  ];
  for (const value of rejected) {
    assert.deepEqual(
      recommendationFactLabels(
        ['store_fact:fact-a:1'],
        [storeFact({ factId: 'fact-a', kind: 'price', value })]
      ),
      ['价格'],
      `${value} must not reach the card`
    );
  }

  // S4 裁决：单 token 纯 Latin 一律退计数；误杀自然词可接受。
  assert.deepEqual(
    recommendationFactLabels(
      ['store_fact:fact-a:1'],
      [storeFact({ factId: 'fact-a', kind: 'price', value: 'Balayage' })]
    ),
    ['价格']
  );

  const admitted: [string, string][] = [
    ['猫眼加固', '价格·猫眼加固'],
    ['199 元洗剪吹', '价格·199 元洗剪吹'],
    ['French Nails', '价格·French Nails'],
  ];
  for (const [value, label] of admitted) {
    assert.deepEqual(
      recommendationFactLabels(
        ['store_fact:fact-a:1'],
        [storeFact({ factId: 'fact-a', kind: 'price', value })]
      ),
      [label]
    );
  }
});

test('drops a fact whose kind this build has no merchant word for', () => {
  // 未知 kind fail-closed：整项退回计数，不渲染 `undefined·名称`。
  assert.deepEqual(
    recommendationFactLabels(
      ['store_fact:fact-a:1', 'store_fact:fact-b:1'],
      [
        storeFact({
          factId: 'fact-a',
          kind: 'loyalty_tier' as never,
          value: { name: '金卡专享' },
        }),
        storeFact({ factId: 'fact-b', kind: 'price', value: '猫眼加固' }),
      ]
    ),
    ['价格·猫眼加固']
  );
});

test('renders only the server-persisted current recommendation', () => {
  const recommendation = state().recommendation!;
  assert.deepEqual(todayRecommendationView(state()), {
    kind: 'current',
    recommendation,
  });
});

test('does not import static opening suggestions as personalization', () => {
  const source = readFileSync(
    new URL('./today-recommendation-card.tsx', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(source, /openingSuggestions/u);
});

test('places the server-projected opportunity in the current recommendation hero', () => {
  const source = readFileSync(
    new URL('./today-recommendation-card.tsx', import.meta.url),
    'utf8'
  );

  assert.match(source, /HotTopicOpportunityCardView/u);
  assert.match(source, /recommendation\.opportunity/u);
  assert.match(source, /presentation="compact"/u);
});

test('stays in the base document layer instead of floating over controls', () => {
  const source = readFileSync(
    new URL('./today-recommendation-card.tsx', import.meta.url),
    'utf8'
  );

  assert.match(source, /data-layer="base"/u);
  assert.doesNotMatch(
    source,
    /className="[^"]*\b(?:fixed|absolute|sticky|z-(?:\[|\d))/u
  );
});

function storeFact(
  overrides: Pick<StoreFact, 'factId' | 'kind' | 'value'>
): StoreFact {
  return {
    workspaceId: 'workspace-1',
    key: 'offer.price',
    scope: { storeId: 'workspace-1' },
    source: {
      kind: 'user_confirmation',
      referenceId: 'confirmation-1',
      capturedAt: '2026-07-18T08:00:00.000Z',
    },
    effectiveFrom: '2026-07-18T08:00:00.000Z',
    expiresAt: null,
    revision: 1,
    recordedAt: '2026-07-18T08:00:00.000Z',
    recordedBy: 'user-1',
    ...overrides,
  };
}

function state(): TodayRecommendationState {
  return {
    workspaceId: 'workspace-1',
    currentFactsRevision: 1,
    stale: false,
    recommendation: {
      workspaceId: 'workspace-1',
      taskId: 'task-1',
      factsRevision: 1,
      packageId: 'package-1',
      versionId: 'version-1',
      title: '本周猫眼项目推荐',
      body: '本店已确认项目的完整成品内容。',
      whyNow: '适合当前换季场景',
      factReferences: ['store_fact:offer-price:1'],
      customerAction: '私信预约',
      sourceLabel: '把新团购做一套能发的',
      createdAt: '2026-07-18T08:00:00.000Z',
    },
  };
}
