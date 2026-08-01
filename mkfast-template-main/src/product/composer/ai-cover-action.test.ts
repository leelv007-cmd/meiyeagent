import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AI_COVER_ASPECT_RATIOS,
  AI_COVER_BEAUTY_PRESETS,
  AI_COVER_IDLE_PRIMARY_ENTRY,
  AI_COVER_SIZE_MAP,
  aiCoverAllowedOnSurface,
  buildAiCoverActionSeed,
  listAiCoverRatioOptions,
  projectAiCoverWorkspaceTool,
} from './ai-cover-action';
import { COMPOSER_TOOL_ENTRY_SEEDS } from './tool-entry-seeds';

test('three ratios are selectable and each maps to a size', () => {
  assert.deepEqual([...AI_COVER_ASPECT_RATIOS], ['3:4', '1:1', '9:16']);
  const options = listAiCoverRatioOptions({ style: 'beauty_soft' });
  assert.equal(options.length, 3);
  for (const option of options) {
    assert.equal(option.id, 'ai_cover');
    assert.equal(option.size, AI_COVER_SIZE_MAP[option.aspectRatio]);
    assert.match(option.intent, /AI 封面/);
    assert.match(option.label, /生成 AI 封面/);
  }
  assert.equal(AI_COVER_SIZE_MAP['3:4'], '1536x2048');
  assert.equal(AI_COVER_SIZE_MAP['1:1'], '2048x2048');
  assert.equal(AI_COVER_SIZE_MAP['9:16'], '1440x2560');
});

test('beauty presets are the five beauty replacements (not generic)', () => {
  assert.deepEqual([...AI_COVER_BEAUTY_PRESETS], [
    'beauty_soft',
    'beauty_editorial',
    'before_after',
    'spa_minimal',
    'salon_photo',
  ]);
  const seed = buildAiCoverActionSeed({
    style: 'spa_minimal',
    aspectRatio: '1:1',
  });
  assert.match(seed.intent, /SPA 极简/);
  assert.match(seed.intent, /1:1/);
});

test('Delivered secondary + object workspace tool hang; Idle primary does not', () => {
  assert.equal(AI_COVER_IDLE_PRIMARY_ENTRY, false);
  assert.equal(
    aiCoverAllowedOnSurface({ surface: 'idle_primary', lensId: 'image_text' }),
    false
  );
  assert.equal(
    aiCoverAllowedOnSurface({
      surface: 'delivered_secondary',
      lensId: 'image_text',
    }),
    true
  );
  assert.equal(
    aiCoverAllowedOnSurface({
      surface: 'object_workspace_tool',
      lensId: 'image_text',
    }),
    true
  );
  assert.equal(
    aiCoverAllowedOnSurface({
      surface: 'delivered_secondary',
      lensId: 'copy',
    }),
    false
  );

  const tool = projectAiCoverWorkspaceTool({ lensId: 'image_text' });
  assert.ok(tool);
  assert.equal(tool.id, 'ai_cover');
  assert.equal(tool.enabled, true);
  assert.equal(projectAiCoverWorkspaceTool({ lensId: 'copy' }), null);
});

test('Idle ordinary tools do not include AI cover as a primary entry', () => {
  assert.equal(
    COMPOSER_TOOL_ENTRY_SEEDS.some(
      (tool) =>
        tool.id.includes('cover') ||
        tool.label.includes('封面') ||
        tool.label.includes('AI 封面')
    ),
    false
  );
});
