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
// Free-creation surface was extracted from composer-home; the panel mounts there.
const freePanel = readFileSync(join(here, 'free-creation-panel.tsx'), 'utf8');
const client = readFileSync(
  join(here, 'composer-submission-client.ts'),
  'utf8'
);

test('ComposerHome signs generation params before quoting and reuses that payload on submit', () => {
  // Panel mount lives on the free-creation surface (extracted in 7fe159cd).
  // It has to stay behind the route gate: an ungated mount ships a control the
  // submission side then drops, which is the #343 regression.
  assert.equal(freePanel.match(/<ComposerGenerationParamsPanel/gu)?.length, 1);
  assert.match(
    freePanel,
    /\{generationParamsEnabled \? \(\s*\n\s*<ComposerGenerationParamsPanel/u
  );
  // Home owns the probe and hands the panel the same boolean it signs with.
  assert.match(home, /generationParamsEnabled=\{generationParamsEnabled\}/);
  // Signing still happens on home before quoteInput is built.
  assert.match(home, /buildSubmissionGenerationParams/);
  assert.match(home, /isComposerGenerationParamsSupported/);
  // Multi-line gate: only sign when the capability probe is on.
  assert.match(
    home,
    /const signedGeneration = generationParamsEnabled\s*\n\s*\?\s*buildSubmissionGenerationParams\(\{/u
  );
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
  assert.match(freePanel, /creationMode="free"/);
});

test('browser submission reuses the shared signed contract for generation params', () => {
  assert.match(client, /composerSubmissionSignedFieldsSchema\s*\.extend/);
  assert.doesNotMatch(client, /beautyVoiceRoleSchema|thinkingLevelSchema/);
});
