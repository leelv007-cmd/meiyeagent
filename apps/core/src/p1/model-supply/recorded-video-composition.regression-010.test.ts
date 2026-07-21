import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryModelAssetStorage,
  RecordedVideoCompositionPort,
} from './index.js';

// Regression: ISSUE-010 — recorded composed videos were text bytes labelled as MP4.
// Found by /qa on 2026-07-22.
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-22.md
test('persists a playable MP4 fixture for recorded composition', async () => {
  const storage = new MemoryModelAssetStorage();
  const asset = await new RecordedVideoCompositionPort(storage).compose({
    workspaceId: 'workspace-a',
    workflowId: 'workflow-a',
    compositionKey: 'composition-a',
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
    subtitles: [{ text: '测试成片', startSeconds: 0, endSeconds: 2 }],
  });

  const bytes = storage.read(asset.objectKey);
  assert.ok(bytes);
  assert.equal(Buffer.from(bytes).subarray(4, 8).toString('ascii'), 'ftyp');
  assert.equal(asset.technicalValidation?.durationSeconds, 2);
  assert.equal(asset.technicalValidation?.playable, true);
});
