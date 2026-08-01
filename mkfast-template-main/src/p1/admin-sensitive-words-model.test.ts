import assert from 'node:assert/strict';
import test from 'node:test';

import {
  categoryLabel,
  emptySensitiveWordDraft,
  parseReplacementsText,
  validateSensitiveWordDraft,
} from './admin-sensitive-words-model';

test('parseReplacementsText splits Chinese and ASCII separators', () => {
  assert.deepEqual(parseReplacementsText('明显改善，持续护理\n因人而异'), [
    '明显改善',
    '持续护理',
    '因人而异',
  ]);
});

test('validateSensitiveWordDraft rejects empty word', () => {
  const draft = emptySensitiveWordDraft();
  assert.equal(validateSensitiveWordDraft(draft), '违禁词不能为空');
  draft.word = '根治';
  assert.equal(validateSensitiveWordDraft(draft), null);
});

test('category labels cover all seven buckets', () => {
  assert.equal(categoryLabel('medical'), '医疗用语');
  assert.equal(categoryLabel('extreme'), '极限用语');
});
