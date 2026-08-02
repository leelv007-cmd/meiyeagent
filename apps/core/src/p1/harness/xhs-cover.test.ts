import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HARNESS_BUILTIN_PROMPTS,
  XHS_VERTICAL_PROMPT_KEYS,
} from './langfuse-prompts.js';
import { triggersPaidMediaExecution } from './workflow-core.js';
import {
  AI_COVER_IDLE_PRIMARY_ENTRY,
  XHS_COVER_ASPECT_RATIOS,
  XHS_COVER_BEAUTY_PRESET_PROMPTS,
  XHS_COVER_BEAUTY_PRESETS,
  XHS_COVER_SIZE_MAP,
  aiCoverTriggersPaidMediaConfirm,
  buildAiCoverUsageReservation,
  compileAiCoverImageParameters,
  isXhsCoverAspectRatio,
  isXhsCoverBeautyPreset,
  mapXhsCoverSize,
  materializeXhsCoverPrompt,
} from './xhs-cover.js';

test('AI cover exposes three product ratios and five beauty presets', () => {
  assert.deepEqual([...XHS_COVER_ASPECT_RATIOS], ['3:4', '1:1', '9:16']);
  assert.deepEqual(
    [...XHS_COVER_BEAUTY_PRESETS],
    [
      'beauty_soft',
      'beauty_editorial',
      'before_after',
      'spa_minimal',
      'salon_photo',
    ],
  );
  for (const ratio of XHS_COVER_ASPECT_RATIOS) {
    assert.equal(isXhsCoverAspectRatio(ratio), true);
    const size = mapXhsCoverSize(ratio);
    assert.equal(size.size, XHS_COVER_SIZE_MAP[ratio].size);
    assert.match(size.size, /^\d+x\d+$/u);
  }
  for (const preset of XHS_COVER_BEAUTY_PRESETS) {
    assert.equal(isXhsCoverBeautyPreset(preset), true);
    assert.match(
      HARNESS_BUILTIN_PROMPTS.xhsCoverPrompt,
      new RegExp(preset, 'u'),
    );
  }
  assert.equal(isXhsCoverAspectRatio('16:9'), false);
  assert.equal(isXhsCoverBeautyPreset('xiaohongshu'), false);
});

test('size mapping (实施时定) is closed and ratio-selectable for all three', () => {
  assert.equal(mapXhsCoverSize('3:4').size, '1536x2048');
  assert.equal(mapXhsCoverSize('1:1').size, '2048x2048');
  assert.equal(mapXhsCoverSize('9:16').size, '1152x2048');
  for (const ratio of XHS_COVER_ASPECT_RATIOS) {
    const params = compileAiCoverImageParameters({
      aspectRatio: ratio,
      style: 'beauty_soft',
    });
    assert.equal(params.ratio, ratio);
    assert.equal(params.resolution, XHS_COVER_SIZE_MAP[ratio].size);
    assert.equal(params.purpose, 'xiaohongshu_cover');
    assert.ok(XHS_COVER_SIZE_MAP[ratio].width <= 2048);
    assert.ok(XHS_COVER_SIZE_MAP[ratio].height <= 2048);
  }
});

test('materializeXhsCoverPrompt fills Chinese beauty-preset description + mapped size', () => {
  const out = materializeXhsCoverPrompt({
    userPrompt: '夏日控油三步护理封面',
    style: 'spa_minimal',
    aspectRatio: '9:16',
  });
  assert.match(out.prompt, /夏日控油三步护理封面/);
  // Chinese descriptive phrase fills the style slot (not bare English enum).
  assert.match(
    out.prompt,
    new RegExp(
      `风格预设：${XHS_COVER_BEAUTY_PRESET_PROMPTS.spa_minimal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`,
    ),
  );
  assert.match(out.prompt, /1152x2048/);
  assert.equal(out.size, '1152x2048');
  assert.equal(out.aspectRatio, '9:16');
  assert.equal(out.style, 'spa_minimal');
  // No leftover unfilled placeholders for the three slots we own.
  assert.equal(out.prompt.includes('{userPrompt}'), false);
  assert.equal(out.prompt.includes('{style}'), false);
  assert.equal(out.prompt.includes('{size}'), false);
});

test('each beauty preset injects its own Chinese style description into the prompt', () => {
  for (const preset of XHS_COVER_BEAUTY_PRESETS) {
    const description = XHS_COVER_BEAUTY_PRESET_PROMPTS[preset];
    assert.match(description, /[\u4e00-\u9fff]/u, preset);
    const out = materializeXhsCoverPrompt({
      userPrompt: '门店护理封面',
      style: preset,
      aspectRatio: '3:4',
    });
    assert.match(
      out.prompt,
      new RegExp(
        `风格预设：${description.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`,
      ),
      `prompt style slot must be Chinese description for ${preset}`,
    );
    // Bare enum id must not appear as the style slot value.
    assert.equal(out.prompt.includes(`风格预设：${preset}`), false, preset);
  }
});

test('compileAiCoverImageParameters does not forward style to provider params', () => {
  const params = compileAiCoverImageParameters({
    aspectRatio: '3:4',
    style: 'beauty_soft',
  });
  assert.equal(params.ratio, '3:4');
  assert.equal(params.resolution, '1536x2048');
  assert.equal(params.purpose, 'xiaohongshu_cover');
  assert.equal(
    'style' in params,
    false,
    'style is prompt-only; adapters have no style field',
  );
});

test('empty user prompt fails closed', () => {
  assert.throws(
    () =>
      materializeXhsCoverPrompt({
        userPrompt: '   ',
        style: 'beauty_soft',
        aspectRatio: '3:4',
      }),
    /non-empty user prompt/u,
  );
});

test('AI cover reservation is image units and trips paid-media confirm gate', () => {
  assert.equal(aiCoverTriggersPaidMediaConfirm(), true);
  const reservation = buildAiCoverUsageReservation({ quantity: 1 });
  assert.deepEqual(reservation.units, [{ resource: 'image', quantity: 1 }]);

  // Minimal snapshot-backed request shape for the gate predicate.
  const request = {
    executionSnapshot: {
      id: 'snap-ai-cover',
      quote: { id: 'quote-ai-cover' },
    },
    usageReservation: reservation,
  } as Parameters<typeof triggersPaidMediaExecution>[0];

  assert.equal(triggersPaidMediaExecution(request), true);
});

test('pure copy units do not trip the gate (negative control for cover path)', () => {
  const request = {
    executionSnapshot: {
      id: 'snap-copy',
      quote: { id: 'quote-copy' },
    },
    usageReservation: {
      id: 'usage-copy',
      units: [{ resource: 'copy' as const, quantity: 1 }],
    },
  } as Parameters<typeof triggersPaidMediaExecution>[0];
  assert.equal(triggersPaidMediaExecution(request), false);
});

test('Idle must not expose AI cover as a first-class primary entry', () => {
  assert.equal(AI_COVER_IDLE_PRIMARY_ENTRY, false);
});

test('xhsCoverPrompt remains a registered XHS vertical site consumer', () => {
  assert.ok(XHS_VERTICAL_PROMPT_KEYS.includes('xhsCoverPrompt'));
});
