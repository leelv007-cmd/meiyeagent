import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { VolcengineBidirectionalTtsAdapter } from './volcengine-tts-adapter.js';
import { NodeVolcengineTtsSocketFactory } from './volcengine-tts-node-socket.js';
import { volcengineTtsConfigurationRevisionFromEnv } from './runtime-config.js';

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
    const endpoint =
      process.env.VOLCENGINE_TTS_ENDPOINT?.trim() ||
      'wss://openspeech.bytedance.com/api/v3/tts/bidirection';
    const model =
      process.env.VOLCENGINE_TTS_MODEL?.trim() || 'seed-tts-2.0-standard';
    const adapter = new VolcengineBidirectionalTtsAdapter({
      auth: { accessToken, appId, kind: 'legacy' },
      defaultSpeaker,
      endpoint,
      model,
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
    const outputSha256 = createHash('sha256')
      .update(result.bytes)
      .digest('hex');
    const nonSecretFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          authKind: 'legacy',
          endpoint,
          model,
          resourceId,
          speaker: defaultSpeaker,
        }),
      )
      .digest('hex');
    const evidence = {
      authKind: 'legacy',
      billedTextWords: result.billedTextWords,
      contentType: result.contentType,
      deploymentId: 'seed-tts-2-volcengine-direct',
      endpoint,
      model,
      nonSecretConfigFingerprint: nonSecretFingerprint,
      outputBytes: result.bytes.byteLength,
      outputSha256,
      resourceId,
      speaker: defaultSpeaker,
      status: 'completed',
    };
    console.info(JSON.stringify(evidence));

    // Full production configuration revision requires approved price env vars.
    // Without them the catalog must stay inactive even after a live probe pass.
    const pricingPresent =
      Boolean(process.env.VOLCENGINE_TTS_APPROVED_PRICE_PER_TEXT_WORD_CNY?.trim()) &&
      Boolean(process.env.VOLCENGINE_TTS_PRICE_REVISION?.trim()) &&
      Boolean(process.env.VOLCENGINE_TTS_CREDENTIAL_VERSION?.trim()) &&
      Boolean(process.env.VOLCENGINE_TTS_ENDPOINT_REVISION?.trim());
    if (pricingPresent) {
      console.info(
        `VOLCENGINE_TTS_CONFIGURATION_REVISION=${volcengineTtsConfigurationRevisionFromEnv(process.env)}`,
      );
    } else {
      console.info(
        JSON.stringify({
          activationBlocked: true,
          reason:
            'approved_price_or_price_revision_or_credential_metadata_missing',
          status: 'live_probe_passed_catalog_inactive',
        }),
      );
    }
  },
);

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live TTS test.`);
  return value;
}
