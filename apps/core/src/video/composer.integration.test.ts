import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { composeVideo, DEFAULT_AIGC_VISIBLE_LABEL } from './composer.js';
import { detectMediaTools } from './media-tools.js';
import {
  probeVideoFile,
  validateVideoLabels,
  VideoLabelValidationError,
} from './validation.js';

async function run(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${stderr}`));
    });
  });
}

const tools = await detectMediaTools();
const mediaSkip = tools.available ? false : tools.reason;

test('ffmpeg concatenates clips, burns subtitle/AIGC text, adds BGM, and writes labels', {
  skip: mediaSkip,
}, async (t) => {
  assert.ok(tools.available);
  const directory = await mkdtemp(join(tmpdir(), 'video-compose-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const first = join(directory, 'first.mp4');
  const second = join(directory, 'second.mp4');
  const bgm = join(directory, 'bgm.wav');
  const output = join(directory, 'composed.mp4');
  await run(tools.ffmpegPath, [
    '-y', '-f', 'lavfi', '-i', 'color=c=0xD1495B:s=320x240:d=0.7',
    '-r', '24', '-pix_fmt', 'yuv420p', '-c:v', 'mpeg4', first,
  ]);
  await run(tools.ffmpegPath, [
    '-y', '-f', 'lavfi', '-i', 'color=c=0x2A9D8F:s=640x360:d=0.8',
    '-r', '24', '-pix_fmt', 'yuv420p', '-c:v', 'mpeg4', second,
  ]);
  await run(tools.ffmpegPath, [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.25',
    '-c:a', 'pcm_s16le', bgm,
  ]);

  await composeVideo({
    clipPaths: [first, second],
    outputPath: output,
    aigcLabelEnabled: true,
    bgmPath: bgm,
    bgmVolume: 0.15,
    subtitles: [
      { text: '示例美甲内容', startSeconds: 0, endSeconds: 1.5 },
    ],
    implicitLabel: {
      serviceProvider: 'Meiye Content Copilot',
      serviceCode: 'meiye-core',
      contentId: 'content-integration-1',
    },
    ffmpegPath: tools.ffmpegPath,
    ffprobePath: tools.ffprobePath,
  });

  const validation = await validateVideoLabels({
    filePath: output,
    expectedVisibleLabel: DEFAULT_AIGC_VISIBLE_LABEL,
    expectedImplicitLabel: {
      serviceProvider: 'Meiye Content Copilot',
      serviceCode: 'meiye-core',
      contentId: 'content-integration-1',
    },
    ffprobePath: tools.ffprobePath,
  });
  const probe = await probeVideoFile(output, tools.ffprobePath);

  assert.ok(probe.durationSeconds >= 1.3, `duration was ${probe.durationSeconds}`);
  assert.ok(probe.streams.some((stream) => stream.codecType === 'video'));
  assert.ok(probe.streams.some((stream) => stream.codecType === 'audio'));
  assert.equal(validation.visibleLabel, DEFAULT_AIGC_VISIBLE_LABEL);
  assert.equal(validation.implicitLabel.contentId, 'content-integration-1');
});

test('ffmpeg leaves visible and implicit AIGC labels absent when the switch is off', {
  skip: mediaSkip,
}, async (t) => {
  assert.ok(tools.available);
  const directory = await mkdtemp(join(tmpdir(), 'video-compose-unlabeled-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const clip = join(directory, 'clip.mp4');
  const output = join(directory, 'unlabeled.mp4');
  await run(tools.ffmpegPath, [
    '-y', '-f', 'lavfi', '-i', 'color=c=0x2A9D8F:s=320x240:d=0.4',
    '-r', '24', '-pix_fmt', 'yuv420p', '-c:v', 'mpeg4', clip,
  ]);

  await composeVideo({
    clipPaths: [clip],
    outputPath: output,
    subtitles: [],
    fontFilePath: '/font-is-not-required-when-labels-are-off.ttf',
    ffmpegPath: tools.ffmpegPath,
  });

  const probe = await probeVideoFile(output, tools.ffprobePath);
  assert.equal(probe.tags.aigc_visible_label, undefined);
  assert.equal(probe.tags.aigc_content_type, undefined);
  assert.equal(probe.tags.aigc_service_provider, undefined);
  assert.equal(probe.tags.aigc_service_code, undefined);
  assert.equal(probe.tags.aigc_content_id, undefined);
});

test('ffprobe validation rejects missing visible and implicit labeling evidence', {
  skip: mediaSkip,
}, async (t) => {
  assert.ok(tools.available);
  const directory = await mkdtemp(join(tmpdir(), 'video-label-validation-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const implicitOnly = join(directory, 'implicit-only.mp4');
  const visibleOnly = join(directory, 'visible-only.mp4');
  const baseArgs = [
    '-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x120:d=0.25',
    '-r', '24', '-pix_fmt', 'yuv420p', '-c:v', 'mpeg4',
    '-movflags', 'use_metadata_tags',
  ];
  await run(tools.ffmpegPath, [
    ...baseArgs,
    '-metadata', 'aigc_content_type=ai_generated',
    '-metadata', 'aigc_service_provider=Meiye Content Copilot',
    '-metadata', 'aigc_service_code=meiye-core',
    '-metadata', 'aigc_content_id=implicit-only',
    implicitOnly,
  ]);
  await run(tools.ffmpegPath, [
    ...baseArgs,
    '-metadata', `aigc_visible_label=${DEFAULT_AIGC_VISIBLE_LABEL}`,
    visibleOnly,
  ]);

  await assert.rejects(
    validateVideoLabels({
      filePath: implicitOnly,
      expectedVisibleLabel: DEFAULT_AIGC_VISIBLE_LABEL,
      ffprobePath: tools.ffprobePath,
    }),
    (error) => {
      assert.ok(error instanceof VideoLabelValidationError);
      assert.equal(error.code, 'visible_label_missing');
      return true;
    }
  );
  await assert.rejects(
    validateVideoLabels({
      filePath: visibleOnly,
      expectedVisibleLabel: DEFAULT_AIGC_VISIBLE_LABEL,
      ffprobePath: tools.ffprobePath,
    }),
    (error) => {
      assert.ok(error instanceof VideoLabelValidationError);
      assert.equal(error.code, 'implicit_label_missing');
      return true;
    }
  );
});
