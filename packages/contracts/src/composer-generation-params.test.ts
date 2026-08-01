import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BEAUTY_VOICE_ROLE_DEFINITIONS,
  DEFAULT_BEAUTY_VOICE_ROLE,
  DEFAULT_THINKING_LEVEL,
  beautyVoiceRoleSchema,
  composerGenerationParamsSchema,
  generationParamsVisibility,
  mapThinkingLevelToModelOptions,
  resolveBeautyVoiceInjection,
  resolveComposerGenerationParams,
  thinkingLevelSchema,
} from './composer-generation-params.js';

test('beauty voice roles are the three beauty-context personas', () => {
  assert.deepEqual(
    Object.keys(BEAUTY_VOICE_ROLE_DEFINITIONS).sort(),
    ['beautician', 'customer', 'owner'],
  );
  assert.equal(beautyVoiceRoleSchema.safeParse('beautician').success, true);
  assert.equal(beautyVoiceRoleSchema.safeParse('blogger').success, false);
  assert.equal(DEFAULT_BEAUTY_VOICE_ROLE, 'owner');
});

test('beauty voice injection supplies xhsNoteGen tone and roleBlock', () => {
  const owner = resolveBeautyVoiceInjection('owner');
  assert.equal(owner.tone, '温暖治愈');
  assert.match(owner.roleBlock, /店主/);
  assert.equal(owner.label, '店主口吻');

  const customer = resolveBeautyVoiceInjection('customer');
  assert.equal(customer.tone, '闺蜜聊天');
  assert.match(customer.roleBlock, /顾客/);
});

test('thinking level maps onto existing model tiers without a billing switch', () => {
  assert.deepEqual(mapThinkingLevelToModelOptions('standard'), {
    routeProfile: 'balanced',
    thinking: { type: 'disabled' },
  });
  assert.deepEqual(mapThinkingLevelToModelOptions('deep'), {
    routeProfile: 'quality',
    thinking: { type: 'enabled' },
    reasoningEffort: 'high',
  });
  assert.equal(thinkingLevelSchema.safeParse('max').success, false);
});

test('C5 visibility: free shows both controls; customized injects defaults only', () => {
  assert.deepEqual(generationParamsVisibility('free'), {
    beautyVoiceRole: 'explicit',
    thinkingLevel: 'visible',
  });
  assert.deepEqual(generationParamsVisibility('customized'), {
    beautyVoiceRole: 'default_inject',
    thinkingLevel: 'hidden',
  });
});

test('customized always injects owner + standard; free keeps unselected voice optional', () => {
  assert.deepEqual(
    resolveComposerGenerationParams({ creationMode: 'customized' }),
    {
      beautyVoiceRole: DEFAULT_BEAUTY_VOICE_ROLE,
      thinkingLevel: DEFAULT_THINKING_LEVEL,
    },
  );
  assert.deepEqual(
    resolveComposerGenerationParams({
      creationMode: 'customized',
      beautyVoiceRole: 'customer',
      thinkingLevel: 'deep',
    }),
    {
      beautyVoiceRole: DEFAULT_BEAUTY_VOICE_ROLE,
      thinkingLevel: DEFAULT_THINKING_LEVEL,
    },
  );
  assert.deepEqual(
    resolveComposerGenerationParams({
      creationMode: 'free',
      thinkingLevel: 'deep',
    }),
    { thinkingLevel: 'deep' },
  );
  assert.deepEqual(
    resolveComposerGenerationParams({
      creationMode: 'free',
      beautyVoiceRole: 'beautician',
      thinkingLevel: 'deep',
    }),
    { beautyVoiceRole: 'beautician', thinkingLevel: 'deep' },
  );
});

test('generation params schema rejects unknown keys and values', () => {
  assert.equal(
    composerGenerationParamsSchema.safeParse({ thinkingLevel: 'deep' })
      .success,
    true,
  );
  assert.equal(
    composerGenerationParamsSchema.safeParse({
      thinkingLevel: 'deep',
      extra: true,
    }).success,
    false,
  );
  assert.equal(
    composerGenerationParamsSchema.safeParse({ beautyVoiceRole: 'chef' })
      .success,
    false,
  );
});
