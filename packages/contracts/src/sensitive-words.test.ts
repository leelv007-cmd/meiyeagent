import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSensitiveWordCommandSchema,
  SENSITIVE_SCAN_LIMITS,
  SENSITIVE_WORD_CATEGORIES,
  scanSensitiveTextQuerySchema,
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
    complete: true,
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

test('scan schema rejects mismatched, overlapping, or out-of-bounds ranges', () => {
  const hit = {
    wordId: 'sw-1',
    word: '根治',
    category: 'extreme' as const,
    replacements: ['明显改善'],
    index: 0,
    length: 2,
  };
  const result = (overrides: Record<string, unknown>) => ({
    schemaVersion: 'sensitive-scan/v1',
    complete: true,
    textLength: 4,
    hitCount: 1,
    hits: [hit],
    ...overrides,
  });

  assert.equal(
    sensitiveScanResultSchema.safeParse(result({ hitCount: 0 })).success,
    false
  );
  assert.equal(
    sensitiveScanResultSchema.safeParse(
      result({
        hitCount: 2,
        hits: [hit, { ...hit, wordId: 'sw-2', index: 1 }],
      })
    ).success,
    false
  );
  assert.equal(
    sensitiveScanResultSchema.safeParse(
      result({ hits: [{ ...hit, index: 3 }] })
    ).success,
    false
  );
});

test('public scan limits and completeness fail closed at the contract boundary', () => {
  assert.deepEqual(SENSITIVE_SCAN_LIMITS, {
    maxTextLength: 50_000,
    maxEnabledWords: 500,
    maxWorkUnits: 25_000_000,
    maxRawHits: 1_000,
  });
  assert.equal(
    scanSensitiveTextQuerySchema.safeParse({
      text: 'a'.repeat(SENSITIVE_SCAN_LIMITS.maxTextLength),
    }).success,
    true
  );
  assert.equal(
    scanSensitiveTextQuerySchema.safeParse({
      text: 'a'.repeat(SENSITIVE_SCAN_LIMITS.maxTextLength + 1),
    }).success,
    false
  );

  const completeResult = {
    schemaVersion: 'sensitive-scan/v1',
    complete: true,
    textLength: 0,
    hitCount: 0,
    hits: [],
  };
  assert.equal(sensitiveScanResultSchema.safeParse(completeResult).success, true);
  assert.equal(
    sensitiveScanResultSchema.safeParse({
      ...completeResult,
      complete: false,
    }).success,
    false
  );
  const { complete: _missing, ...missingCompleteness } = completeResult;
  assert.equal(
    sensitiveScanResultSchema.safeParse(missingCompleteness).success,
    false
  );
});
