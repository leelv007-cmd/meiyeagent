import assert from 'node:assert/strict';
import test from 'node:test';

import type { SensitiveScanResult, SensitiveWordHit } from '@meiye/contracts';

import {
  canApplySensitiveScan,
  canReplaceSensitiveHit,
} from './sensitive-inline-check-model.js';

const requestText = '前缀😀根治后缀';
const hit: SensitiveWordHit = {
  wordId: 'sw-root',
  word: '根治',
  category: 'extreme',
  replacements: ['明显改善'],
  index: requestText.indexOf('根治'),
  length: '根治'.length,
};
const scan: SensitiveScanResult = {
  schemaVersion: 'sensitive-scan/v1',
  complete: true,
  textLength: requestText.length,
  hitCount: 1,
  hits: [hit],
};

for (const multilineText of [
  '首段😀护理。\n第二行根治色斑。',
  '首段😀护理。\n\n第二段根治色斑。',
]) {
  test(`UTF-16 snapshot validation survives multiline text: ${JSON.stringify(multilineText)}`, () => {
    const index = multilineText.indexOf('根治');
    assert.equal(
      canApplySensitiveScan({
        currentText: multilineText,
        requestText: multilineText,
        scan: {
          ...scan,
          textLength: multilineText.length,
          hits: [{ ...hit, index }],
        },
      }),
      true
    );
  });
}

test('a complete scan applies only to its exact UTF-16 source snapshot', () => {
  assert.equal(
    canApplySensitiveScan({ currentText: requestText, requestText, scan }),
    true
  );
  assert.equal(
    canApplySensitiveScan({
      currentText: '前缀😀治疗后缀',
      requestText,
      scan,
    }),
    false,
    'same-length replacement text is stale'
  );
  assert.equal(
    canApplySensitiveScan({
      currentText: requestText,
      requestText,
      scan: { ...scan, textLength: scan.textLength + 1 },
    }),
    false
  );
  assert.equal(
    canApplySensitiveScan({
      currentText: requestText,
      requestText,
      scan: {
        ...scan,
        hits: [{ ...hit, word: '治疗' }],
      },
    }),
    false
  );
});

test('replacement rechecks snapshot, range, word, and replacement', () => {
  assert.equal(
    canReplaceSensitiveHit({
      currentText: requestText,
      requestText,
      hit,
      replacement: '明显改善',
    }),
    true
  );
  for (const invalid of [
    { currentText: '前缀😀治疗后缀' },
    { hit: { ...hit, index: hit.index - 1 } },
    { hit: { ...hit, length: hit.length + 1 } },
    { hit: { ...hit, word: '治疗' } },
    { replacement: '' },
  ]) {
    assert.equal(
      canReplaceSensitiveHit({
        currentText: requestText,
        requestText,
        hit,
        replacement: '明显改善',
        ...invalid,
      }),
      false
    );
  }
});
