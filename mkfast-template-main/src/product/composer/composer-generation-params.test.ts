import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSubmissionGenerationParams,
  DEFAULT_BEAUTY_VOICE_ROLE,
  DEFAULT_THINKING_LEVEL,
  initialGenerationParamsState,
  isComposerGenerationParamsSupported,
  shouldShowBeautyVoiceRole,
  shouldShowThinkingLevel,
} from './composer-generation-params';

test('generation params are supported only for the XHS image-text note route', () => {
  assert.equal(
    isComposerGenerationParamsSupported({
      deliverableKind: 'note',
      lensId: 'image_text',
      platform: 'xiaohongshu',
    }),
    true
  );
  assert.equal(
    isComposerGenerationParamsSupported({
      deliverableKind: 'note',
      lensId: 'copy',
      platform: 'xiaohongshu',
    }),
    false
  );
  assert.equal(
    isComposerGenerationParamsSupported({
      deliverableKind: 'note',
      lensId: 'image_text',
      platform: 'douyin',
    }),
    false
  );
  assert.equal(
    isComposerGenerationParamsSupported({
      deliverableKind: 'image_set',
      lensId: 'image_text',
      platform: 'xiaohongshu',
    }),
    false
  );
});

test('free mode exposes both selectors; customized hides thinking and injects defaults', () => {
  assert.equal(shouldShowBeautyVoiceRole('free'), true);
  assert.equal(shouldShowThinkingLevel('free'), true);
  assert.equal(shouldShowBeautyVoiceRole('customized'), false);
  assert.equal(shouldShowThinkingLevel('customized'), false);
});

test('customized submission injects owner + standard without free UI state', () => {
  assert.deepEqual(
    buildSubmissionGenerationParams({
      creationMode: 'customized',
      state: initialGenerationParamsState(),
    }),
    {
      beautyVoiceRole: DEFAULT_BEAUTY_VOICE_ROLE,
      thinkingLevel: DEFAULT_THINKING_LEVEL,
    }
  );
});

test('free submission injects explicit role and thinking level', () => {
  assert.deepEqual(
    buildSubmissionGenerationParams({
      creationMode: 'free',
      state: {
        beautyVoiceRole: 'beautician',
        thinkingLevel: 'deep',
      },
    }),
    {
      beautyVoiceRole: 'beautician',
      thinkingLevel: 'deep',
    }
  );
  assert.deepEqual(
    buildSubmissionGenerationParams({
      creationMode: 'free',
      state: initialGenerationParamsState(),
    }),
    { thinkingLevel: DEFAULT_THINKING_LEVEL }
  );
});
