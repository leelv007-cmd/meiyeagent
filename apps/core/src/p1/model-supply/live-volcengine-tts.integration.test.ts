import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { VolcengineBidirectionalTtsAdapter } from './volcengine-tts-adapter.js';
import { NodeVolcengineTtsSocketFactory } from './volcengine-tts-node-socket.js';

const live = process.env.RUN_LIVE_VOLCENGINE_TTS_TEST === '1';

test(
  'live Volcengine bidirectional TTS returns non-empty audio and usage evidence',
  { skip: !live, timeout: 180_000 },
  async () => {
    const appId = required('VOLCENGINE_TTS_APP_ID');
    const accessToken = required('VOLCENGINE_TTS_ACCESS_TOKEN');
    const resourceId = required('VOLCENGINE_TTS_RESOURCE_ID');
    const defaultSpeaker = required('VOLCENGINE_TTS_SPEAKER');
    assert.ok(resourceId === 'seed-tts-2.0' || resourceId === 'seed-icl-2.0');
    const adapter = new VolcengineBidirectionalTtsAdapter({
      auth: { accessToken, appId, kind: 'legacy' },
      defaultSpeaker,
      ...(process.env.VOLCENGINE_TTS_ENDPOINT
        ? { endpoint: process.env.VOLCENGINE_TTS_ENDPOINT }
        : {}),
      ...(process.env.VOLCENGINE_TTS_MODEL
        ? { model: process.env.VOLCENGINE_TTS_MODEL }
        : {}),
      resourceId,
      socketFactory: new NodeVolcengineTtsSocketFactory(),
    });

    const result = await adapter.synthesize({
      format: 'mp3',
      language: 'zh-CN',
      sampleRate: 24_000,
      speed: 1,
      text: '欢迎体验本次门店服务。',
    });

    assert.ok(result.bytes.byteLength > 0);
    assert.equal(result.contentType, 'audio/mpeg');
    assert.ok((result.billedTextWords ?? 0) > 0);
    console.info(
      JSON.stringify({
        billedTextWords: result.billedTextWords,
        contentType: result.contentType,
        outputBytes: result.bytes.byteLength,
        outputSha256: createHash('sha256').update(result.bytes).digest('hex'),
        status: 'completed',
      }),
    );
  },
);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live TTS test.`);
  return value;
}
