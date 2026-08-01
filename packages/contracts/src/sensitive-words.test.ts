import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SENSITIVE_WORD_CATEGORIES,
  createSensitiveWordCommandSchema,
  sensitiveCheckBarSchema,
  sensitiveScanResultSchema,
  sensitiveWordRecordSchema,
} from './sensitive-words.js';

test('sensitive word categories are the seven product buckets', () => {
  assert.deepEqual([...SENSITIVE_WORD_CATEGORIES], [
    'extreme',
    'medical',
    'cosmetic',
    'finance',
    'legal',
    'vulgar',
    'other',
  ]);
});

test('create command defaults category/status/replacements', () => {
  const parsed = createSensitiveWordCommandSchema.parse({ word: '根治' });
  assert.equal(parsed.category, 'other');
  assert.equal(parsed.status, 'enabled');
  assert.deepEqual(parsed.replacements, []);
});

test('scan + check-bar schemas accept fixture-shaped payloads', () => {
  const scan = sensitiveScanResultSchema.parse({
    schemaVersion: 'sensitive-scan/v1',
    textLength: 10,
    hitCount: 1,
    hits: [
      {
        wordId: 'sw-1',
        word: '根治',
        category: 'extreme',
        replacements: ['明显改善'],
        index: 0,
        length: 2,
      },
    ],
  });
  assert.equal(scan.hitCount, 1);

  const bar = sensitiveCheckBarSchema.parse({
    schemaVersion: 'sensitive-check-bar/v1',
    status: 'hits',
    summary: '检出 1 处违禁词，请按建议替换后再交付。',
    items: [
      {
        wordId: 'sw-1',
        word: '根治',
        category: 'extreme',
        snippet: '…根治…',
        replacements: ['明显改善'],
      },
    ],
  });
  assert.equal(bar.status, 'hits');

  const record = sensitiveWordRecordSchema.parse({
    id: 'sw-1',
    word: '根治',
    category: 'extreme',
    replacements: ['明显改善'],
    status: 'enabled',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  });
  assert.equal(record.word, '根治');
});
