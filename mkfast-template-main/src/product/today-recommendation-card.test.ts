import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { TodayRecommendationState } from '@meiye/contracts';

import { todayRecommendationView } from '@/product/today-recommendation-card';

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
