import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CARD_LANGUAGE_ISSUE_LABELS,
  cardLanguageIssues,
} from './card-language';

test('the gate catches what D-116 forbids in visible card copy', () => {
  // 工程术语 — the labels match core's own list so a failure reads the same
  // on both sides of the seam.
  assert.deepEqual(cardLanguageIssues('workflow 已进入下一步'), ['workflow']);
  assert.deepEqual(cardLanguageIssues('revision 3 已生成'), ['revision']);
  assert.deepEqual(cardLanguageIssues('provider 返回 HTTP 500'), [
    'provider',
    'HTTP code',
  ]);
  // 成本价 — D-123 keeps the internal baseline off the front end entirely.
  assert.deepEqual(cardLanguageIssues('本次成本价 0.8'), ['internal cost']);
  assert.deepEqual(cardLanguageIssues('本次消耗 ¥1.20'), ['money amount']);
  // 内部 ID.
  assert.deepEqual(
    cardLanguageIssues('question 3f2a1b4c-1111-2222-9999-abcdefabcdef'),
    ['uuid']
  );
  assert.deepEqual(cardLanguageIssues('task-9:s1:industry_category'), [
    'harness id',
  ]);
  assert.deepEqual(cardLanguageIssues('引用 store_fact:abc'), ['ledger key']);
});

test("a run's own identifiers count as leaks even when the shape looks ordinary", () => {
  const taskId = 'task-abc';
  assert.deepEqual(cardLanguageIssues('已经准备好了', [taskId]), []);
  assert.deepEqual(cardLanguageIssues(`已经准备好了 ${taskId}`, [taskId]), [
    `internal id ${taskId}`,
  ]);
  // An empty id must not match every string.
  assert.deepEqual(cardLanguageIssues('已经准备好了', ['']), []);
});

test('the merchant sentences the card family actually ships are clean', () => {
  const shipped = [
    '成品已就绪 · 第 3 版',
    '点开看完整成品',
    '采用这一版',
    '继续调整',
    '导出使用',
    '第 3 版已经准备好。策略依据：周末到店高峰。版本定位：这是本次适合小红书的主推荐。使用建议：建议先核对内容和预约引导，确认后再发布。',
    '已听懂这次想表达的重点',
    '这次先按通用模式生成；以后补充门店、项目或风格资料，内容会更像你的店。',
  ];
  for (const sentence of shipped) {
    assert.deepEqual(cardLanguageIssues(sentence), [], sentence);
  }
});

test('the label list is the gate — an empty result must mean it looked', () => {
  // Guards against the gate quietly shrinking to nothing and every card
  // "passing" because there is nothing left to check.
  assert.ok(CARD_LANGUAGE_ISSUE_LABELS.length >= 17);
  assert.ok(CARD_LANGUAGE_ISSUE_LABELS.includes('internal cost'));
  assert.ok(CARD_LANGUAGE_ISSUE_LABELS.includes('uuid'));
});
