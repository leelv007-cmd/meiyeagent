import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { recordedRequest } from './adapters.js';
import { TuziMediaExecutionPort } from './tuzi-media-adapter.js';

const enabled = process.env.RUN_LIVE_TUZI_MEDIA_TEST === '1';
const requiredNames = [
  'TUZI_MEDIA_API_KEY',
  'TUZI_MEDIA_BASE_URL',
  'TUZI_GPT_IMAGE_2_MODEL',
  'TUZI_SEEDANCE_MODEL',
] as const;
const missing = requiredNames.filter((name) => !process.env[name]?.trim());

function required(name: (typeof requiredNames)[number]) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live Tuzi test.`);
  return value;
}

test(
  'live Tuzi adapter generates and downloads a real image and video',
  {
    skip: !enabled
      ? 'Set RUN_LIVE_TUZI_MEDIA_TEST=1 to opt in.'
      : missing.length > 0
        ? `Missing live Tuzi variables: ${missing.join(', ')}`
        : false,
    timeout: 15 * 60_000,
  },
  async () => {
    const adapter = new TuziMediaExecutionPort({
      apiKey: required('TUZI_MEDIA_API_KEY'),
      baseUrl: required('TUZI_MEDIA_BASE_URL'),
      credentialVersion: 'live-tuzi-key',
      endpointRevision: 'tuzi-openai-media-v1',
      image: {
        catalogModelId: 'gpt-image-2',
        costPerImage: 0,
        model: required('TUZI_GPT_IMAGE_2_MODEL'),
      },
      sourceUrlTtlSeconds: 3600,
      video: {
        catalogModelId: 'seedance-2',
        costPerMillionTokens: 0,
        estimatedTokensPerSecond: 0,
        model: required('TUZI_SEEDANCE_MODEL'),
      },
    });
    const imageRequest = {
      ...recordedRequest('gpt-image-2', 'image.generate'),
      effectIdempotencyKey: `live-tuzi-image-${Date.now()}`,
    };
    imageRequest.submission.prompt =
      'A clean editorial still life of a white skincare bottle on warm beige stone, soft daylight, no text, no logo.';
    const imageReceipt = await adapter.submit(imageRequest);
    assert.equal(imageReceipt.acceptance, 'accepted');
    assert.ok(imageReceipt.taskRef);
    const image = await adapter.download({
      ...imageRequest,
      taskRef: imageReceipt.taskRef,
    });
    assert.equal(image.contentType, 'image/png');
    assert.ok(image.bytes.byteLength > 0);

    const videoRequest = {
      ...recordedRequest('seedance-2', 'video.generate', {
        durationSeconds: 5,
      }),
      effectIdempotencyKey: `live-tuzi-video-${Date.now()}`,
    };
    videoRequest.submission.prompt =
      'A cinematic product shot of a white skincare bottle on beige stone, slow camera push in, soft daylight, no text.';
    const videoReceipt = await adapter.submit(videoRequest);
    assert.equal(videoReceipt.acceptance, 'accepted');
    assert.ok(videoReceipt.taskRef);
    let videoStatus = await adapter.poll({
      ...videoRequest,
      taskRef: videoReceipt.taskRef,
    });
    for (
      let attempt = 0;
      attempt < 90 && videoStatus.status !== 'completed';
      attempt += 1
    ) {
      assert.notEqual(videoStatus.status, 'failed');
      await delay(10_000);
      videoStatus = await adapter.poll({
        ...videoRequest,
        taskRef: videoReceipt.taskRef,
      });
    }
    assert.equal(videoStatus.status, 'completed');
    const video = await adapter.download({
      ...videoRequest,
      taskRef: videoReceipt.taskRef,
    });
    assert.equal(video.contentType, 'video/mp4');
    assert.ok(video.bytes.byteLength > 0);

    const evidenceDir = process.env.TUZI_LIVE_EVIDENCE_DIR?.trim();
    if (evidenceDir) {
      await mkdir(evidenceDir, { recursive: true });
      await Promise.all([
        writeFile(join(evidenceDir, 'tuzi-image.png'), image.bytes),
        writeFile(join(evidenceDir, 'tuzi-video.mp4'), video.bytes),
      ]);
    }
    console.log(
      JSON.stringify({
        imageBytes: image.bytes.byteLength,
        imageSha256: createHash('sha256').update(image.bytes).digest('hex'),
        videoBytes: video.bytes.byteLength,
        videoSha256: createHash('sha256').update(video.bytes).digest('hex'),
      })
    );
  }
);
