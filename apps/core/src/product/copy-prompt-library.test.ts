import assert from 'node:assert/strict';
import test from 'node:test';
import { BEAUTY_COPY_PROMPT } from './copy-prompt-library.js';

test('beauty copy prompt library keeps prompt and few-shot revisions explicit', () => {
  assert.equal(BEAUTY_COPY_PROMPT.promptRevision, 'beauty-copy-prompt-v1');
  assert.equal(BEAUTY_COPY_PROMPT.templateRevision, 'beauty-copy-template-v1');
  assert.equal(BEAUTY_COPY_PROMPT.exampleSetRevision, 'beauty-copy-examples-v1');
  assert.ok(BEAUTY_COPY_PROMPT.fewShots.length >= 3);
  assert.equal(BEAUTY_COPY_PROMPT.instructions.candidateCount, 3);
  assert.equal(BEAUTY_COPY_PROMPT.instructions.preserveFacts, true);
  assert.equal(BEAUTY_COPY_PROMPT.instructions.prohibitInventedPrices, true);
});
