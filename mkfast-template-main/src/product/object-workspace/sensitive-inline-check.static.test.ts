import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const editor = readFileSync(
  new URL('./object-workspace-editor.tsx', import.meta.url),
  'utf8'
);
const panel = readFileSync(
  new URL('./sensitive-inline-check.tsx', import.meta.url),
  'utf8'
);
const worksurface = readFileSync(
  new URL('../results/copy-image-text-worksurface.tsx', import.meta.url),
  'utf8'
);
const composer = readFileSync(
  new URL('../composer/composer-home.tsx', import.meta.url),
  'utf8'
);

test('inline sensitive checking is bounded and mounted only by the note workspace', () => {
  assert.match(panel, /SENSITIVE_INLINE_DEBOUNCE_MS\s*=\s*300/u);
  assert.match(panel, /SENSITIVE_INLINE_TIMEOUT_MS\s*=\s*10_000/u);
  assert.match(panel, /boundedQueryP1<unknown>/u);
  assert.match(panel, /action:\s*['"]scan['"]/u);
  assert.match(panel, /sensitiveScanResultSchema\.parse/u);
  assert.match(worksurface, /isNoteWorkspace[\s\S]*SensitiveInlineCheck/u);
  assert.doesNotMatch(composer, /SensitiveInlineCheck|sensitive-inline-check/u);
});

test('Tiptap owns DecorationSet and one insertText replacement transaction', () => {
  assert.match(editor, /DecorationSet/u);
  assert.match(editor, /Decoration\.inline/u);
  assert.match(editor, /\.tr\.insertText\(/u);
  assert.match(editor, /canReplaceSensitiveHit/u);
});
