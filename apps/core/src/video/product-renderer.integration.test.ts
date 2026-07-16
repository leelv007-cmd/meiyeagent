import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULT_AIGC_VISIBLE_LABEL } from './composer.js';
import { detectMediaTools, runMediaCommand } from './media-tools.js';
import { renderProductVideo } from './product-renderer.js';
import { DeterministicFakeVideoProvider } from './provider.js';
import { probeVideoFile, validateVideoLabels } from './validation.js';

const tools = await detectMediaTools();
const mediaSkip = tools.available ? false : tools.reason;

test('renders storyboard shots from a real image into a validated product video', {
  skip: mediaSkip,
}, async (t) => {
  assert.ok(tools.available);
  const directory = await mkdtemp(join(tmpdir(), 'product-video-renderer-test-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const sourcePath = join(directory, 'source.png');
  const outputPath = join(directory, 'output.mp4');
  await runMediaCommand(tools.ffmpegPath, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=0xD1495B:s=480x640',
    '-frames:v',
    '1',
    sourcePath,
  ]);
  const sourceImage = await readFile(sourcePath);

  const result = await renderProductVideo({
    outputId: 'output-product-1',
    correlationId: 'corr-product-1',
    storyboard: {
      shots: [
        { id: 'shot-1', narration: '门店环境干净明亮', durationSeconds: 0.6 },
        { id: 'shot-2', narration: '到店体验自然舒适', durationSeconds: 0.7 },
      ],
    },
    sourceImage,
    sourceContentType: 'image/png',
    aigcLabelEnabled: true,
    ffmpegPath: tools.ffmpegPath,
    ffprobePath: tools.ffprobePath,
  });

  await writeFile(outputPath, result.bytes);
  const probe = await probeVideoFile(outputPath, tools.ffprobePath);
  const labels = await validateVideoLabels({
    filePath: outputPath,
    expectedVisibleLabel: DEFAULT_AIGC_VISIBLE_LABEL,
    expectedImplicitLabel: {
      serviceProvider: result.evidence.provider,
      serviceCode: result.evidence.model,
      contentId: 'output-product-1',
    },
    ffprobePath: tools.ffprobePath,
  });
  const videoStream = probe.streams.find((stream) => stream.codecType === 'video');

  assert.ok(result.bytes.byteLength > 1_000);
  assert.equal(
    result.evidence.sha256,
    createHash('sha256').update(result.bytes).digest('hex')
  );
  assert.equal(result.evidence.fileSizeBytes, result.bytes.byteLength);
  assert.ok(result.evidence.durationSeconds >= 1.2, `${result.evidence.durationSeconds}`);
  assert.equal(result.evidence.aspectRatio, '9:16');
  assert.equal(videoStream?.width, 720);
  assert.equal(videoStream?.height, 1280);
  assert.equal(labels.visibleLabel, DEFAULT_AIGC_VISIBLE_LABEL);
  assert.equal(labels.implicitLabel.contentId, 'output-product-1');
  assert.equal(result.evidence.visibleLabel, DEFAULT_AIGC_VISIBLE_LABEL);
  assert.equal(result.evidence.implicitMetadata?.contentType, 'ai_generated');
  assert.equal(result.evidence.provider, 'meiye-node-renderer');
  assert.equal(result.evidence.model, 'ffmpeg-image-storyboard-v1');
  assert.equal(result.evidence.providerCostCents, 0);
  assert.ok(result.evidence.latencyMs >= 0);
  assert.deepEqual(result.evidence.usableQuality, {
    usable: true,
    reason: 'playable_720x1280_with_requested_labels',
    assessmentMethod: 'technical-playability-v1',
  });
  assert.equal(result.evidence.firstFrameManifest.sourceContentType, 'image/png');
  assert.equal(result.evidence.firstFrameManifest.fileSizeBytes, sourceImage.byteLength);
  assert.equal(result.evidence.clipManifest.length, 2);
  assert.deepEqual(
    result.evidence.clipManifest.map((clip) => clip.shotId),
    ['shot-1', 'shot-2']
  );
  assert.ok(result.evidence.clipManifest.every((clip) => clip.fileSizeBytes > 0));
  assert.equal(result.evidence.composeManifest.width, 720);
  assert.equal(result.evidence.composeManifest.height, 1280);
  assert.equal(result.evidence.composeManifest.clipCount, 2);
  assert.equal(result.evidence.composeManifest.correlationId, 'corr-product-1');
});

test('uses the configured video provider in the product render path', {
  skip: mediaSkip,
}, async (t) => {
  assert.ok(tools.available);
  const directory = await mkdtemp(join(tmpdir(), 'product-video-provider-test-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const sourcePath = join(directory, 'source.png');
  const providerClipPath = join(directory, 'provider.mp4');
  await runMediaCommand(tools.ffmpegPath, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x347A5B:s=720x1280:d=1',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x347A5B:s=480x640',
    '-map',
    '0:v',
    '-t',
    '1',
    '-pix_fmt',
    'yuv420p',
    providerClipPath,
    '-map',
    '1:v',
    '-frames:v',
    '1',
    sourcePath,
  ]);
  const sourceImage = await readFile(sourcePath);
  const provider = new DeterministicFakeVideoProvider({
    sourceClipPath: providerClipPath,
    provider: 'configured-video-provider',
    model: 'configured-model-v1',
    cost: { amount: 1.25, currency: 'CNY', estimated: true },
  });

  const result = await renderProductVideo({
    outputId: 'provider-output-1',
    correlationId: 'provider-correlation-1',
    storyboard: {
      shots: [
        {
          id: 'provider-shot-1',
          visualDirection: '自然光门店环境',
          narration: '真实项目展示',
          durationSeconds: 1,
        },
      ],
    },
    sourceImage,
    sourceContentType: 'image/png',
    provider,
    ffmpegPath: tools.ffmpegPath,
    ffprobePath: tools.ffprobePath,
  });

  assert.equal(result.evidence.provider, 'configured-video-provider');
  assert.equal(result.evidence.model, 'configured-model-v1');
  assert.equal(result.evidence.providerCostCents, 125);
  assert.equal(
    result.evidence.clipManifest[0]?.provider,
    'configured-video-provider'
  );
  assert.match(result.evidence.clipManifest[0]?.taskId ?? '', /^fake-/);
});
