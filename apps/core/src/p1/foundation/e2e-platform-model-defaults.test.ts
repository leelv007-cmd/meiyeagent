import assert from 'node:assert/strict';
import test from 'node:test';
import { e2ePlatformModelDefaultsFromEnv } from './e2e-platform-model-defaults.js';

const configuredEnv = {
  APP_ENV: 'e2e',
  E2E_PLATFORM_DEFAULT_MODEL_AUDIO: 'audio-speech-fixture',
  E2E_PLATFORM_DEFAULT_MODEL_COPY: 'llm-openai',
  E2E_PLATFORM_DEFAULT_MODEL_IMAGE: 'gpt-image-2',
  E2E_PLATFORM_DEFAULT_MODEL_VIDEO: 'seedance-2',
};

test('E2E model defaults require an explicit complete platform configuration', () => {
  assert.deepEqual(e2ePlatformModelDefaultsFromEnv(configuredEnv), {
    audio: 'audio-speech-fixture',
    copy: 'llm-openai',
    image: 'gpt-image-2',
    video: 'seedance-2',
  });
  assert.throws(
    () =>
      e2ePlatformModelDefaultsFromEnv({
        APP_ENV: 'e2e',
        E2E_PLATFORM_DEFAULT_MODEL_COPY: 'llm-openai',
      }),
    /must configure copy, image, video, and audio together/u
  );
});

test('E2E model defaults never become production fallbacks', () => {
  assert.deepEqual(
    e2ePlatformModelDefaultsFromEnv({
      ...configuredEnv,
      APP_ENV: 'production',
    }),
    {}
  );
});
