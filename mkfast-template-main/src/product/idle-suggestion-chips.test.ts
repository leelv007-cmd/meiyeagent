/**
 * Idle light capsules — D2 / C3 (#318).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IDLE_FIRST_SCREEN_RECIPE_CHIPS,
  todaySuggestionChipLabel,
} from './idle-suggestion-chips';

test('first-screen recipe chips include 小红书图文 and 爆款复刻', () => {
  const labels = IDLE_FIRST_SCREEN_RECIPE_CHIPS.map((c) => c.label);
  assert.ok(labels.includes('小红书图文'));
  assert.ok(labels.includes('爆款复刻'));
  assert.equal(IDLE_FIRST_SCREEN_RECIPE_CHIPS.length, 2);
});

test('C3: every recipe chip only carries a prefill handoff (no submit flag)', () => {
  for (const chip of IDLE_FIRST_SCREEN_RECIPE_CHIPS) {
    assert.ok(chip.handoff.intent.length > 0);
    // Typed lens when the recipe knows one — never hard-coded charge/submit.
    assert.equal(chip.handoff.outputHint, 'image_text');
    assert.equal(
      'autoSubmit' in chip.handoff,
      false,
      'handoff must not auto-submit'
    );
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
