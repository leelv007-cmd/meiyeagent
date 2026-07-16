import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeVideo, type ComposeVideoOptions } from '../../video/composer.js';
import { validateProductComposedOutput } from '../../video/product-renderer.js';
import type {
  OwnedAsset,
  VideoCompositionPort,
} from './index.js';

export interface CompositionAssetStoragePort {
  materialize(input: {
    workspaceId: string;
    asset: OwnedAsset;
  }): Promise<{ path: string }>;
  persistComposedVideo(input: {
    workspaceId: string;
    workflowId: string;
    compositionKey: string;
    path: string;
    sourceAssetIds: string[];
  }): Promise<OwnedAsset>;
  releaseMaterialized?(paths: string[]): Promise<void>;
}

type ComposeFunction = (options: ComposeVideoOptions) => Promise<void>;
type ValidateFunction = typeof validateProductComposedOutput;

/** Thin adapter: durable business state stays in the workflow store. */
export class FfmpegVideoCompositionPort implements VideoCompositionPort {
  private readonly composeFunction: ComposeFunction;
  private readonly ffmpegPath?: string;
  private readonly fontFilePath?: string;
  private readonly ffprobePath?: string;
  private readonly validateFunction: ValidateFunction;

  constructor(
    private readonly assets: CompositionAssetStoragePort,
    options: {
      composeFunction?: ComposeFunction;
      ffmpegPath?: string;
      ffprobePath?: string;
      fontFilePath?: string;
      validateFunction?: ValidateFunction;
    } = {},
  ) {
    this.composeFunction = options.composeFunction ?? composeVideo;
    this.ffmpegPath = options.ffmpegPath;
    this.ffprobePath = options.ffprobePath;
    this.fontFilePath = options.fontFilePath;
    this.validateFunction =
      options.validateFunction ?? validateProductComposedOutput;
  }

  async compose(input: {
    workspaceId: string;
    workflowId: string;
    compositionKey: string;
    clips: OwnedAsset[];
    aigcLabelEnabled: boolean;
    brandWatermarkText?: string;
  }) {
    if (input.clips.length === 0) {
      throw new Error('At least one selected clip is required for composition.');
    }
    const materialized = await Promise.all(
      input.clips.map((asset) =>
        this.assets.materialize({ workspaceId: input.workspaceId, asset }),
      ),
    );
    const clipPaths = materialized.map(({ path }) => path);
    const workDirectory = await mkdtemp(join(tmpdir(), 'meiye-composed-video-'));
    const outputPath = join(workDirectory, 'output.mp4');
    try {
      await this.composeFunction({
        clipPaths,
        outputPath,
        subtitles: [],
        aigcLabelEnabled: input.aigcLabelEnabled,
        ...(input.brandWatermarkText
          ? { brandWatermarkText: input.brandWatermarkText }
          : {}),
        ...(input.aigcLabelEnabled
          ? {
              implicitLabel: {
                serviceProvider: 'meiye-content-workflow',
                serviceCode: 'ffmpeg-compose-v1',
                contentId: input.workflowId,
              },
            }
          : {}),
        ...(this.ffmpegPath ? { ffmpegPath: this.ffmpegPath } : {}),
        ...(this.fontFilePath ? { fontFilePath: this.fontFilePath } : {}),
      });
      const rendererEvidence = await this.validateFunction({
        outputPath,
        sourceAssetIds: input.clips.map((asset) => asset.id),
        ...(this.ffprobePath ? { ffprobePath: this.ffprobePath } : {}),
      });
      const owned = await this.assets.persistComposedVideo({
        workspaceId: input.workspaceId,
        workflowId: input.workflowId,
        compositionKey: input.compositionKey,
        path: outputPath,
        sourceAssetIds: input.clips.map((asset) => asset.id),
      });
      if (
        owned.contentType !== 'video/mp4' ||
        owned.technicalValidation?.playable !== true
      ) {
        throw new Error('Composed video must be persisted as a technically validated owned MP4 asset.');
      }
      if (
        owned.sha256 !== rendererEvidence.outputSha256 ||
        owned.sizeBytes !== rendererEvidence.outputSizeBytes
      ) {
        throw new Error(
          'Persisted composition does not match product-renderer evidence.'
        );
      }
      return {
        ...owned,
        compositionEvidence: rendererEvidence,
      };
    } finally {
      await this.assets.releaseMaterialized?.(clipPaths);
      await rm(workDirectory, { recursive: true, force: true });
    }
  }
}
