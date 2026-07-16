import assert from 'node:assert/strict';
import { test } from 'node:test';
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
      { P1_VIDEO_COMPOSITION_MODE: 'recorded' },
      storage,
    ) instanceof RecordedVideoCompositionPort,
    true,
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
