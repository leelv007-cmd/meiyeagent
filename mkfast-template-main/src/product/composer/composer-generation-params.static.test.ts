/**
 * Consumer-proof wiring: P2-09 panel is mounted on Composer and submission
 * injects generation params (D-150).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const home = readFileSync(join(here, 'composer-home.tsx'), 'utf8');
const client = readFileSync(
  join(here, 'composer-submission-client.ts'),
  'utf8'
);

test('ComposerHome signs generation params before quoting and reuses that payload on submit', () => {
  assert.match(home, /ComposerGenerationParamsPanel/);
  assert.match(home, /buildSubmissionGenerationParams/);
  assert.match(home, /isComposerGenerationParamsSupported/);
  assert.match(home, /generationParamsEnabled \? \(/);
  const generationOffset = home.indexOf('const signedGeneration =');
  const signedSubmissionOffset = home.indexOf('const signedSubmissionParse =');
  assert.notEqual(generationOffset, -1);
  assert.ok(generationOffset < signedSubmissionOffset);
  const signedSubmissionBlock = home.slice(
    signedSubmissionOffset,
    home.indexOf('const quoteInput =', signedSubmissionOffset)
  );
  assert.match(signedSubmissionBlock, /signedGeneration\.beautyVoiceRole/);
  assert.match(signedSubmissionBlock, /signedGeneration\.thinkingLevel/);
  assert.doesNotMatch(home, /const generation = generationParamsEnabled/);
  assert.match(home, /creationMode=\{creationMode\}/);
});

test('browser submission reuses the shared signed contract for generation params', () => {
  assert.match(client, /composerSubmissionSignedFieldsSchema\s*\.extend/);
  assert.doesNotMatch(client, /beautyVoiceRoleSchema|thinkingLevelSchema/);
});
