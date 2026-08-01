/**
 * Idle light capsules — D2 / C3 (#318).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IDLE_FIRST_SCREEN_RECIPE_CHIPS,
  todaySuggestionChipLabel,
} from './idle-suggestion-chips';
import type { RecommendationHandoff } from './recommendation-handoff';

test('first-screen recipe chips include 小红书图文 and 爆款复刻', () => {
  const labels = IDLE_FIRST_SCREEN_RECIPE_CHIPS.map((c) => c.label);
  assert.ok(labels.includes('小红书图文'));
  assert.ok(labels.includes('爆款复刻'));
  assert.equal(IDLE_FIRST_SCREEN_RECIPE_CHIPS.length, 2);
});

test('C3: recipe handoff shape is intent + outputHint + recipeChipId only', () => {
  for (const chip of IDLE_FIRST_SCREEN_RECIPE_CHIPS) {
    const handoff: RecommendationHandoff = chip.handoff;
    assert.ok(handoff.intent.length > 0);
    assert.equal(handoff.outputHint, 'image_text');
    assert.equal(handoff.recipeChipId, chip.id);
    // Exact key set — no autoSubmit / charge / submit flags can sneak in.
    assert.deepEqual(Object.keys(handoff).sort(), [
      'intent',
      'outputHint',
      'recipeChipId',
    ]);
  }
});

test('爆款复刻 handoff stays paste-track honest (no scrape language)', () => {
  const viral = IDLE_FIRST_SCREEN_RECIPE_CHIPS.find(
    (c) => c.id === 'viral_adapt'
  );
  assert.ok(viral);
  assert.match(viral.handoff.intent, /粘贴|复刻/u);
  assert.doesNotMatch(viral.handoff.intent, /抓取|爬虫|匿名/u);
});

test('今日建议 chip label truncates long titles', () => {
  assert.equal(todaySuggestionChipLabel('换季护理'), '今日建议：换季护理');
  const long = todaySuggestionChipLabel(
    '这是一个非常非常非常非常长的推荐标题用于截断'
  );
  assert.match(long, /^今日建议：/u);
  assert.ok(long.endsWith('…'));
  assert.ok(long.length < 40);
});
