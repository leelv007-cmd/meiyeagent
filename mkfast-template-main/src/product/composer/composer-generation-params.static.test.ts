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
const client = readFileSync(join(here, 'composer-submission-client.ts'), 'utf8');

test('ComposerHome mounts generation params panel and injects on submit', () => {
  assert.match(home, /ComposerGenerationParamsPanel/);
  assert.match(home, /buildSubmissionGenerationParams/);
  assert.match(home, /beautyVoiceRole/);
  assert.match(home, /thinkingLevel/);
  assert.match(home, /creationMode=\{creationMode\}/);
});

test('browser submission contract admits beautyVoiceRole and thinkingLevel', () => {
  assert.match(client, /beautyVoiceRoleSchema/);
  assert.match(client, /thinkingLevelSchema/);
  assert.match(client, /beautyVoiceRole: beautyVoiceRoleSchema\.optional\(\)/);
  assert.match(client, /thinkingLevel: thinkingLevelSchema\.optional\(\)/);
});
