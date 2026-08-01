/**
 * Selection AI six-action model (P2-10 / #322).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SELECTION_AI_ACTIONS,
  SELECTION_AI_LABELS,
  applySelectionAiPreview,
  buildSelectionAiPrompt,
  selectionAiNeedsInstruction,
  selectionAiToolbarItems,
} from './selection-ai-model';
import { objectWorkspaceCarrierFromFacts } from './object-workspace-shell';

test('selection AI freezes the six product actions', () => {
  assert.deepEqual([...SELECTION_AI_ACTIONS], [
    'continue',
    'rewrite',
    'expand',
    'shorten',
    'tone',
    'custom',
  ]);
  assert.equal(SELECTION_AI_LABELS.continue, '续写');
  assert.equal(SELECTION_AI_LABELS.rewrite, '改写');
  assert.equal(SELECTION_AI_LABELS.expand, '扩写');
  assert.equal(SELECTION_AI_LABELS.shorten, '精简');
  assert.equal(SELECTION_AI_LABELS.tone, '语气');
  assert.equal(SELECTION_AI_LABELS.custom, '自定义');
  assert.equal(selectionAiToolbarItems().length, 6);
});

test('tone and custom require an instruction; others do not', () => {
  assert.equal(selectionAiNeedsInstruction('tone'), true);
  assert.equal(selectionAiNeedsInstruction('custom'), true);
  assert.equal(selectionAiNeedsInstruction('continue'), false);
  assert.equal(selectionAiNeedsInstruction('rewrite'), false);
  assert.equal(selectionAiNeedsInstruction('expand'), false);
  assert.equal(selectionAiNeedsInstruction('shorten'), false);
});

test('local templates are beauty-context and include the selection', () => {
  const prompt = buildSelectionAiPrompt({
    action: 'rewrite',
    selection: '限时美甲套餐',
  });
  assert.match(prompt, /美业/);
  assert.match(prompt, /限时美甲套餐/);
  assert.doesNotMatch(prompt, /\{selection\}/);
});

test('deterministic previews cover at least three selection AI actions', () => {
  const source = '限时优惠美甲套餐欢迎抢购';
  const continued = applySelectionAiPreview(source, 'continue');
  assert.ok(continued.startsWith(source));
  assert.ok(continued.length > source.length);

  const shortened = applySelectionAiPreview(source, 'shorten');
  assert.ok(shortened.length < source.length);

  const expanded = applySelectionAiPreview(source, 'expand');
  assert.ok(expanded.length > source.length);
  assert.match(expanded, /到店/);
});

test('object workspace carrier maps copy / note / media', () => {
  assert.equal(
    objectWorkspaceCarrierFromFacts({ orderedAssetCount: 0 }),
    'copy'
  );
  assert.equal(
    objectWorkspaceCarrierFromFacts({ orderedAssetCount: 3 }),
    'note'
  );
  assert.equal(
    objectWorkspaceCarrierFromFacts({ workspaceKind: 'video' }),
    'media'
  );
});
