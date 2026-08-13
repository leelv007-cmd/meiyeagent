import assert from 'node:assert/strict';
import test from 'node:test';

import { finalizeStoreIntakeCommandSchema } from './asset-intake.js';
import {
  EMPTY_STORE_SENTENCE_MODEL_OUTPUT,
  extractStoreSentenceCommandSchema,
  extractStoreSentenceResultSchema,
  STORE_SENTENCE_FACT_IDS,
  storeSentenceModelOutputSchema,
} from './store-sentence-extract.js';

test('extract_store_sentence accepts a spoken sentence and no extra keys', () => {
  const command = extractStoreSentenceCommandSchema.parse({
    sentence: '盘点美发工作室开在杭州，染发套餐价格三百八十八',
  });
  assert.equal(command.sentence.startsWith('盘点美发工作室'), true);
  assert.equal(
    extractStoreSentenceCommandSchema.safeParse({
      sentence: '店名叫青禾',
      extra: true,
    }).success,
    false,
  );
  assert.equal(
    extractStoreSentenceCommandSchema.safeParse({ sentence: '   ' }).success,
    false,
  );
});

test('suggestions are limited to existing profile field ids', () => {
  const result = extractStoreSentenceResultSchema.parse({
    status: 'suggested',
    suggestions: [
      {
        id: 'name',
        value: '盘点美发工作室',
        confidence: 0.9,
        provenance: 'ai_suggestion',
        source: 'spoken_sentence',
      },
    ],
    errorCode: null,
  });
  assert.deepEqual(
    result.suggestions.map((item) => item.id),
    ['name'],
  );
  assert.ok(STORE_SENTENCE_FACT_IDS.includes('name'));
  assert.equal(
    extractStoreSentenceResultSchema.safeParse({
      status: 'suggested',
      suggestions: [
        {
          id: 'brandVoice',
          value: '克制',
          confidence: 0.5,
          provenance: 'ai_suggestion',
          source: 'spoken_sentence',
        },
      ],
      errorCode: null,
    }).success,
    false,
  );
});

test('empty and unavailable extracts stay honest about error codes', () => {
  assert.deepEqual(
    extractStoreSentenceResultSchema.parse({
      status: 'empty',
      suggestions: [],
      errorCode: null,
    }).status,
    'empty',
  );
  assert.equal(
    extractStoreSentenceResultSchema.safeParse({
      status: 'empty',
      suggestions: [
        {
          id: 'city',
          value: '杭州',
          confidence: 0.4,
          provenance: 'ai_suggestion',
          source: 'spoken_sentence',
        },
      ],
      errorCode: null,
    }).success,
    false,
  );
  assert.equal(
    extractStoreSentenceResultSchema.parse({
      status: 'unavailable',
      suggestions: [],
      errorCode: 'model_execution_failed',
    }).errorCode,
    'model_execution_failed',
  );
  assert.equal(
    extractStoreSentenceResultSchema.safeParse({
      status: 'suggested',
      suggestions: [],
      errorCode: null,
    }).success,
    false,
  );
});

test('model output requires an explicit null for every profile field', () => {
  assert.deepEqual(
    storeSentenceModelOutputSchema.parse(EMPTY_STORE_SENTENCE_MODEL_OUTPUT),
    EMPTY_STORE_SENTENCE_MODEL_OUTPUT,
  );
  assert.equal(
    storeSentenceModelOutputSchema.safeParse({
      name: { value: '青禾', confidence: 0.8 },
    }).success,
    false,
  );
});

test('finalize_store_intake still requires confirmations — extract is not a write', () => {
  const parsed = finalizeStoreIntakeCommandSchema.parse({
    batch: { batchId: 'server-batch-a' },
    confirmations: [
      {
        candidateId: 'candidate-name',
        factId: 'store-profile:name:other',
        expectedFactRevision: 0,
      },
    ],
    profilePatch: { expectedRevision: 0, name: '盘点美发工作室' },
  });
  assert.deepEqual(parsed.batch, { batchId: 'server-batch-a' });
  assert.equal(
    finalizeStoreIntakeCommandSchema.safeParse({
      batch: { batchId: 'server-batch-a' },
      confirmations: [],
      profilePatch: { expectedRevision: 0 },
    }).success,
    false,
  );
});
