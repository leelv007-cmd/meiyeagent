import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAudioSfxContract,
  parseAudioSpeechContract,
} from './audio-contracts.js';

test('audio.speech accepts only its bounded provider-neutral contract', () => {
  assert.deepEqual(
    parseAudioSpeechContract({
      format: 'mp3',
      language: 'zh-CN',
      maxDurationSeconds: 30,
      speed: 1,
      tone: 'warm',
      voice: 'warm-female',
    }),
    {
      format: 'mp3',
      language: 'zh-CN',
      maxDurationSeconds: 30,
      speed: 1,
      tone: 'warm',
      voice: 'warm-female',
    },
  );
  assert.throws(
    () =>
      parseAudioSpeechContract({
        description: 'door bell',
        durationSeconds: 2,
        format: 'mp3',
        language: 'zh-CN',
        maxDurationSeconds: 30,
        speed: 1,
        tone: 'warm',
        voice: 'warm-female',
      }),
    /audio\.speech parameters are invalid/u,
  );
});

test('audio.sfx keeps description semantics separate from speech parameters', () => {
  assert.deepEqual(
    parseAudioSfxContract({
      description: 'A short glass door bell with a soft tail',
      durationSeconds: 4,
      format: 'wav',
    }),
    {
      description: 'A short glass door bell with a soft tail',
      durationSeconds: 4,
      format: 'wav',
    },
  );
  for (const input of [
    { description: 'bell', durationSeconds: 121, format: 'wav' },
    {
      description: 'bell',
      durationSeconds: 4,
      format: 'wav',
      voice: 'warm-female',
    },
    { description: 'bell', durationSeconds: 4, format: 'mp4' },
  ]) {
    assert.throws(
      () => parseAudioSfxContract(input),
      /audio\.sfx parameters are invalid/u,
    );
  }
});
