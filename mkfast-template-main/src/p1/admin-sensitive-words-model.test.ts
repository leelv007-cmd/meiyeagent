import assert from 'node:assert/strict';
import test from 'node:test';

import {
  admin_sensitive_word_category_extreme,
  admin_sensitive_word_category_medical,
  admin_sensitive_word_error_empty,
} from '@/locale/paraglide/messages';

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
  assert.equal(
    validateSensitiveWordDraft(draft),
    admin_sensitive_word_error_empty()
  );
  draft.word = '根治';
  assert.equal(validateSensitiveWordDraft(draft), null);
});

test('category labels cover all seven buckets', () => {
  assert.equal(
    categoryLabel('medical'),
    admin_sensitive_word_category_medical()
  );
  assert.equal(
    categoryLabel('extreme'),
    admin_sensitive_word_category_extreme()
  );
});
