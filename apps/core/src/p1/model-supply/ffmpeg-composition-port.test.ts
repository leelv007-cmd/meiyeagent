import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { ComposeVideoOptions } from '../../video/composer.js';
import {
  FfmpegVideoCompositionPort,
  type CompositionAssetStoragePort,
} from './ffmpeg-composition-port.js';
import type { OwnedAsset } from './index.js';

function clip(id: string): OwnedAsset {
  return {
    id,
    objectKey: `workspace-a/generated/${id}.mp4`,
    sha256: id.padEnd(64, '0'),
    sizeBytes: 10,
    contentType: 'video/mp4',
    technicalValidation: {
      playable: true,
      codec: 'h264',
      durationSeconds: 10,
    },
  };
}

it('delegates technical composition to the existing ffmpeg seam and persists one owned asset', async () => {
  const events: string[] = [];
  const storage: CompositionAssetStoragePort = {
    async materialize({ asset }) {
      events.push(`materialize:${asset.id}`);
      return { path: `/materialized/${asset.id}.mp4` };
    },
    async persistComposedVideo(input) {
      events.push(`persist:${input.compositionKey}:${input.sourceAssetIds.join(',')}`);
      return {
        id: 'composed-asset',
        objectKey: `${input.workspaceId}/composed/${input.workflowId}.mp4`,
        sha256: 'a'.repeat(64),
        sizeBytes: 42,
        contentType: 'video/mp4',
        technicalValidation: {
          playable: true,
          codec: 'h264',
          durationSeconds: 20,
        },
      };
    },
    async releaseMaterialized(paths) {
      events.push(`release:${paths.length}`);
    },
  };
  const port = new FfmpegVideoCompositionPort(storage, {
    async composeFunction(options) {
      events.push(`compose:${options.clipPaths.join(',')}`);
      assert.equal(options.aigcLabelEnabled, true);
      assert.equal(options.brandWatermarkText, '清风美学');
      assert.equal(options.implicitLabel?.contentId, 'workflow-a');
    },
    async validateFunction({ sourceAssetIds }) {
      return {
        rendererRevision: 'product-renderer-validation-v1',
        clipCount: sourceAssetIds.length,
        sourceAssetIds,
        outputSha256: 'a'.repeat(64),
        outputSizeBytes: 42,
        durationSeconds: 20,
        width: 720,
        height: 1280,
      };
    },
  });

  const result = await port.compose({
    workspaceId: 'workspace-a',
    workflowId: 'workflow-a',
    compositionKey: 'composition-key-a',
    clips: [clip('clip-1'), clip('clip-2')],
    aigcLabelEnabled: true,
    brandWatermarkText: '清风美学',
  });
  assert.equal(result.id, 'composed-asset');
  assert.equal(
    result.compositionEvidence?.rendererRevision,
    'product-renderer-validation-v1'
  );
  assert.deepEqual(result.compositionEvidence?.sourceAssetIds, [
    'clip-1',
    'clip-2',
  ]);
  assert.deepEqual(events, [
    'materialize:clip-1',
    'materialize:clip-2',
    'compose:/materialized/clip-1.mp4,/materialized/clip-2.mp4',
    'persist:composition-key-a:clip-1,clip-2',
    'release:2',
  ]);
});

it('keeps AIGC visible and implicit labels off when the workflow switch is off', async () => {
  let composeOptions: ComposeVideoOptions | undefined;
  let persistedKey = '';
  const storage: CompositionAssetStoragePort = {
    async materialize({ asset }) {
      return { path: `/materialized/${asset.id}.mp4` };
    },
    async persistComposedVideo(input) {
      persistedKey = input.compositionKey;
      return {
        ...clip('composed-off'),
        objectKey: `${input.workspaceId}/composed/${input.workflowId}.mp4`,
      };
    },
  };
  const port = new FfmpegVideoCompositionPort(storage, {
    async composeFunction(options) {
      composeOptions = options;
    },
    async validateFunction({ sourceAssetIds }) {
      return {
        rendererRevision: 'product-renderer-validation-v1',
        clipCount: sourceAssetIds.length,
        sourceAssetIds,
        outputSha256: 'composed-off'.padEnd(64, '0'),
        outputSizeBytes: 10,
        durationSeconds: 10,
        width: 720,
        height: 1280,
      };
    },
  });

  await port.compose({
    workspaceId: 'workspace-a',
    workflowId: 'workflow-off',
    compositionKey: 'stable-off-key',
    clips: [clip('clip-off')],
    aigcLabelEnabled: false,
  });

  assert.equal(composeOptions?.aigcLabelEnabled, false);
  assert.equal(composeOptions?.implicitLabel, undefined);
  assert.equal(persistedKey, 'stable-off-key');
});
