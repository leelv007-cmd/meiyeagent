import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  AudioAssetPipelineError,
  FfmpegAudioInspector,
  type AudioInspectorPort,
  validateGeneratedAudio,
} from './audio-asset-pipeline.js';
import { detectMediaTools, runMediaCommand } from './media-tools.js';

const mp3 = Uint8Array.from([
  0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xfb, 0x90,
  0x64,
]);

function pcmWav() {
  const sampleRate = 8_000;
  const sampleCount = 800;
  const dataSize = sampleCount * 2;
  const bytes = Buffer.alloc(44 + dataSize);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(dataSize, 40);
  return new Uint8Array(bytes);
}

test('container and magic mismatch is rejected before decode', async () => {
  let inspected = false;
  const inspector: AudioInspectorPort = {
    async inspect() {
      inspected = true;
      throw new Error('must not inspect forged bytes');
    },
  };

  await assert.rejects(
    validateGeneratedAudio(
      {
        bytes: Uint8Array.from([0x52, 0x49, 0x46, 0x46]),
        contentType: 'audio/mpeg',
      },
      inspector,
    ),
    (error: unknown) =>
      error instanceof AudioAssetPipelineError &&
      error.code === 'AUDIO_CONTAINER_INVALID',
  );
  assert.equal(inspected, false);
});

test('decoded duration, bitrate, sample rate, codec, and metadata limits fail closed', async () => {
  const valid = {
    bitRate: 128_000,
    codec: 'mp3',
    container: 'mp3',
    durationSeconds: 2,
    metadata: {},
    sampleRate: 44_100,
  };
  const invalidInspections = [
    { ...valid, codec: 'aac' },
    { ...valid, durationSeconds: 601 },
    { ...valid, bitRate: 512_001 },
    { ...valid, sampleRate: 96_001 },
    { ...valid, metadata: { comment: 'x'.repeat(64 * 1024) } },
  ];

  for (const inspection of invalidInspections) {
    await assert.rejects(
      validateGeneratedAudio(
        { bytes: mp3, contentType: 'audio/mpeg' },
        { inspect: async () => inspection },
      ),
      (error: unknown) =>
        error instanceof AudioAssetPipelineError &&
        error.code === 'AUDIO_TECHNICAL_VALIDATION_FAILED',
    );
  }
});

test('validated audio returns escaped display metadata and technical facts', async () => {
  const validation = await validateGeneratedAudio(
    { bytes: mp3, contentType: 'audio/mpeg' },
    {
      async inspect() {
        return {
          bitRate: 128_000,
          codec: 'mp3',
          container: 'mp3',
          durationSeconds: 2.5,
          metadata: { artist: '<script>alert(1)</script>' },
          sampleRate: 44_100,
        };
      },
    },
  );

  assert.deepEqual(validation, {
    bitRate: 128_000,
    codec: 'mp3',
    container: 'mp3',
    displayMetadata: [
      {
        name: 'artist',
        value: '&lt;script&gt;alert(1)&lt;/script&gt;',
      },
    ],
    durationSeconds: 2.5,
    metadataBytes: 31,
    sampleRate: 44_100,
  });
});

test('default inspector decodes a real PCM WAV before accepting its technical facts', async (t) => {
  const tools = await detectMediaTools();
  if (!tools.available) {
    t.skip(tools.reason);
    return;
  }
  const inspection = await new FfmpegAudioInspector({
    ffmpegPath: tools.ffmpegPath,
    ffprobePath: tools.ffprobePath,
  }).inspect({ bytes: pcmWav(), contentType: 'audio/wav' });

  assert.equal(inspection.codec, 'pcm_s16le');
  assert.equal(inspection.container, 'wav');
  assert.equal(inspection.sampleRate, 8_000);
  assert.equal(inspection.bitRate, 128_000);
  assert.ok(Math.abs(inspection.durationSeconds - 0.1) < 0.001);
});

test('default inspector decodes a real MP3 stream rather than trusting its header', async (t) => {
  const tools = await detectMediaTools();
  if (!tools.available) {
    t.skip(tools.reason);
    return;
  }
  const directory = await mkdtemp(join(tmpdir(), 'meiye-audio-test-'));
  const outputPath = join(directory, 'tone.mp3');
  try {
    try {
      await runMediaCommand(tools.ffmpegPath, [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=24000:duration=0.25',
        '-codec:a',
        'mp3',
        '-b:a',
        '64k',
        outputPath,
      ]);
    } catch (error) {
      t.skip(`MP3 encoder unavailable: ${String(error)}`);
      return;
    }
    const inspection = await new FfmpegAudioInspector({
      ffmpegPath: tools.ffmpegPath,
      ffprobePath: tools.ffprobePath,
    }).inspect({
      bytes: new Uint8Array(await readFile(outputPath)),
      contentType: 'audio/mpeg',
    });

    assert.equal(inspection.codec, 'mp3');
    assert.equal(inspection.container, 'mp3');
    assert.equal(inspection.sampleRate, 24_000);
    assert.ok(inspection.durationSeconds > 0.2);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
