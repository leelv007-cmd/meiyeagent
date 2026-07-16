import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CanvasAssetFacade,
  MemoryCanvasAssetRepository,
  MemoryCanvasObjectStorage,
} from '../pro-studio/canvas-asset-facade.js';
import {
  AudioAssetPipeline,
  AudioAssetPipelineError,
  FfmpegAudioInspector,
  type AudioInspectorPort,
  type AudioProviderFetchPort,
} from './audio-asset-pipeline.js';
import {
  detectMediaTools,
  runMediaCommand,
} from '../video/media-tools.js';

const mp3 = Uint8Array.from([
  0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xff, 0xfb, 0x90, 0x64,
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

function fixture(
  inspection: Awaited<ReturnType<AudioInspectorPort['inspect']>>,
  providerFetch?: AudioProviderFetchPort,
) {
  const repository = new MemoryCanvasAssetRepository();
  const storage = new MemoryCanvasObjectStorage();
  const pipeline = new AudioAssetPipeline({
    clock: () => new Date('2026-07-16T12:00:00.000Z'),
    inspector: { inspect: async () => inspection },
    nextAssetId: () => 'asset-audio-1',
    nextObjectToken: () => 'a'.repeat(48),
    ...(providerFetch ? { providerFetch } : {}),
    repository,
    storage,
  });
  return { pipeline, repository, storage };
}

test('validated audio is persisted under a random private key and delivered through CanvasAssetFacade', async () => {
  const { pipeline, repository, storage } = fixture({
    bitRate: 128_000,
    codec: 'mp3',
    container: 'mp3',
    durationSeconds: 2.5,
    metadata: { artist: '<script>alert(1)</script>' },
    sampleRate: 44_100,
  });

  const asset = await pipeline.persistGeneratedAudio({
    bytes: mp3,
    contentType: 'audio/mpeg',
    fileName: '门店“欢迎”\r\nX-Evil: yes.html',
    jobId: 'job-audio-1',
    workspaceId: 'workspace-1',
  });

  assert.equal(
    asset.objectKey,
    `workspace-1/canvas/private/audio/${'a'.repeat(48)}.mp3`,
  );
  assert.match(asset.fileName, /\.mp3$/u);
  assert.doesNotMatch(asset.fileName, /\.html|[\r\n]/u);
  assert.deepEqual(asset.source, {
    audioValidation: {
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
    },
    jobId: 'job-audio-1',
    kind: 'generation_job',
  });
  assert.deepEqual(await storage.read(asset.objectKey), mp3);

  const facade = new CanvasAssetFacade({ repository, storage });
  const delivery = await facade.getAssetDelivery(
    { userId: 'user-1', workspaceId: 'workspace-1' },
    { assetId: asset.id, download: true, range: 'bytes=0-9' },
  );
  assert.equal(delivery.status, 206);
  assert.equal(delivery.headers['content-type'], 'audio/mpeg');
  assert.equal(delivery.headers['x-content-type-options'], 'nosniff');
  assert.equal(delivery.headers['cache-control'], 'private, no-store');
  assert.equal(delivery.headers['content-range'], `bytes 0-9/${mp3.length}`);
  assert.match(
    delivery.headers['content-disposition'] ?? '',
    /^attachment; filename="[A-Za-z0-9._-]+"$/u,
  );
});

test('container and magic mismatch is rejected before decode or persistence', async () => {
  let inspected = false;
  const repository = new MemoryCanvasAssetRepository();
  const storage = new MemoryCanvasObjectStorage();
  const pipeline = new AudioAssetPipeline({
    inspector: {
      async inspect() {
        inspected = true;
        throw new Error('must not inspect forged bytes');
      },
    },
    repository,
    storage,
  });

  await assert.rejects(
    pipeline.persistGeneratedAudio({
      bytes: Uint8Array.from([0x52, 0x49, 0x46, 0x46]),
      contentType: 'audio/mpeg',
      fileName: 'forged.mp3',
      jobId: 'job-forged',
      workspaceId: 'workspace-1',
    }),
    (error: unknown) =>
      error instanceof AudioAssetPipelineError &&
      error.code === 'AUDIO_CONTAINER_INVALID',
  );
  assert.equal(inspected, false);
  assert.equal(repository.inspect().length, 0);
});

test('private object custody rejects a workspace path instead of treating it as a key segment', async () => {
  const { pipeline, repository } = fixture({
    bitRate: 64_000,
    codec: 'mp3',
    container: 'mp3',
    durationSeconds: 1,
    metadata: {},
    sampleRate: 24_000,
  });
  await assert.rejects(
    pipeline.persistGeneratedAudio({
      bytes: mp3,
      contentType: 'audio/mpeg',
      fileName: 'speech.mp3',
      jobId: 'job-audio',
      workspaceId: '../public',
    }),
    (error: unknown) =>
      error instanceof AudioAssetPipelineError &&
      error.code === 'AUDIO_INPUT_INVALID',
  );
  assert.equal(repository.inspect().length, 0);
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
    const { pipeline, repository } = fixture(inspection);
    await assert.rejects(
      pipeline.persistGeneratedAudio({
        bytes: mp3,
        contentType: 'audio/mpeg',
        fileName: 'invalid.mp3',
        jobId: 'job-invalid',
        workspaceId: 'workspace-1',
      }),
      (error: unknown) =>
        error instanceof AudioAssetPipelineError &&
        error.code === 'AUDIO_TECHNICAL_VALIDATION_FAILED',
    );
    assert.equal(repository.inspect().length, 0);
  }
});

test('provider audio enters custody only through the shared safe-fetch seam', async () => {
  let safeFetchInput:
    | { target: string; allowedMimeTypes: string[]; maxBytes: number }
    | undefined;
  const providerFetch: AudioProviderFetchPort = {
    async get(target, constraints) {
      safeFetchInput = {
        target,
        allowedMimeTypes: [...constraints.allowedMimeTypes],
        maxBytes: constraints.maxBytes,
      };
      return {
        bytes: mp3,
        finalUrl: target,
        mimeType: 'audio/mpeg',
      };
    },
  };
  const { pipeline } = fixture(
    {
      bitRate: 64_000,
      codec: 'mp3',
      container: 'mp3',
      durationSeconds: 1,
      metadata: {},
      sampleRate: 24_000,
    },
    providerFetch,
  );

  const asset = await pipeline.persistProviderAudio({
    fileName: 'speech.mp3',
    jobId: 'job-provider-audio',
    providerUrl: 'https://audio.provider.example/result/owned.mp3',
    workspaceId: 'workspace-1',
  });

  assert.equal(asset.contentType, 'audio/mpeg');
  assert.deepEqual(safeFetchInput, {
    target: 'https://audio.provider.example/result/owned.mp3',
    allowedMimeTypes: ['audio/mpeg', 'audio/wav'],
    maxBytes: 25 * 1024 * 1024,
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
