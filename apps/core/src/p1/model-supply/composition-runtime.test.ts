import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FileSystemAssetStorage } from './filesystem-asset-storage.js';
import {
  FfmpegVideoCompositionPort,
  RecordedVideoCompositionPort,
  videoCompositionRuntimeFromEnv,
  type CompositionAssetStoragePort,
} from './index.js';

const storage = {} as CompositionAssetStoragePort;

test('production composition defaults to ffmpeg and recorded mode is explicit', () => {
  assert.equal(
    videoCompositionRuntimeFromEnv({}, storage) instanceof
      FfmpegVideoCompositionPort,
    true,
  );
  assert.equal(
    videoCompositionRuntimeFromEnv(
      { APP_ENV: 'e2e', P1_VIDEO_COMPOSITION_MODE: 'recorded' },
      storage,
    ) instanceof RecordedVideoCompositionPort,
    true,
  );
  assert.throws(
    () =>
      videoCompositionRuntimeFromEnv(
        { P1_VIDEO_COMPOSITION_MODE: 'recorded' },
        storage,
      ),
    /restricted to APP_ENV=e2e/,
  );
  assert.throws(
    () =>
      videoCompositionRuntimeFromEnv(
        { P1_VIDEO_COMPOSITION_MODE: 'other' },
        storage,
      ),
    /ffmpeg or recorded/,
  );
});

test('recorded composition labels synthetic technical evidence', async () => {
  const result = await new RecordedVideoCompositionPort().compose({
    workspaceId: 'workspace-a',
    workflowId: 'recorded-composition',
    compositionKey: 'recorded-composition-key',
    clips: [
      {
        id: 'clip-a',
        objectKey: 'workspace-a/generated/clip-a.mp4',
        sha256: 'a'.repeat(64),
        sizeBytes: 10,
        contentType: 'video/mp4',
      },
    ],
    aigcLabelEnabled: false,
  });

  assert.equal(
    result.technicalValidation?.evidenceKind,
    'recorded_synthetic',
  );
});

test('recorded runtime persists a receipt-addressed composed video', async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), 'meiye-recorded-video-'));
  try {
    const storage = new FileSystemAssetStorage({
      rootDirectory,
      videoProbe: async () => {
        throw new Error('Recorded composition must not invoke ffprobe.');
      },
    });
    const runtime = videoCompositionRuntimeFromEnv(
      { APP_ENV: 'e2e', P1_VIDEO_COMPOSITION_MODE: 'recorded' },
      storage,
    );
    const result = await runtime.compose({
      workspaceId: 'workspace-a',
      workflowId: 'video-workflow-recorded',
      compositionKey: 'recorded-composition-key',
      clips: [
        {
          id: 'clip-a',
          objectKey: 'workspace-a/generated/clip-a.mp4',
          sha256: 'a'.repeat(64),
          sizeBytes: 10,
          contentType: 'video/mp4',
        },
      ],
      aigcLabelEnabled: true,
      brandWatermarkText: '美业内容',
    });

    assert.match(
      result.objectKey,
      /^workspace-a\/composed\/[a-f0-9]{64}\.mp4$/,
    );
    assert.equal(result.technicalValidation?.evidenceKind, 'recorded_synthetic');
    assert.equal(
      result.compositionEvidence?.aigc.validationMethod,
      'recorded_synthetic',
    );
    const restored = await storage.read(result.objectKey);
    assert.equal(restored.contentType, 'video/mp4');
    assert.equal(restored.bytes.byteLength, result.sizeBytes);

    const second = await runtime.compose({
      workspaceId: 'workspace-a',
      workflowId: 'video-workflow-recorded-2',
      compositionKey: 'recorded-composition-key-2',
      clips: [
        {
          id: 'clip-a',
          objectKey: 'workspace-a/generated/clip-a.mp4',
          sha256: 'a'.repeat(64),
          sizeBytes: 10,
          contentType: 'video/mp4',
        },
      ],
      aigcLabelEnabled: true,
      brandWatermarkText: '美业内容',
    });
    assert.equal(second.sha256, result.sha256);
    assert.notEqual(second.objectKey, result.objectKey);
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});
