import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  composeVideo,
  DEFAULT_AIGC_VISIBLE_LABEL,
  type ComposeVideoOptions,
  type ImplicitVideoLabel,
  type TimedSubtitle,
} from '../../video/composer.js';
import { runMediaCommand } from '../../video/media-tools.js';
import { validateProductComposedOutput } from '../../video/product-renderer.js';
import { validateVideoLabels } from '../../video/validation.js';
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
    compositionEvidence: NonNullable<OwnedAsset['compositionEvidence']>;
  }): Promise<OwnedAsset>;
  persistRecordedComposedVideo?(input: {
    bytes: Uint8Array;
    compositionEvidence: NonNullable<OwnedAsset['compositionEvidence']>;
    compositionKey: string;
    technicalValidation: NonNullable<OwnedAsset['technicalValidation']>;
    workflowId: string;
    workspaceId: string;
  }): Promise<OwnedAsset>;
  persistVideoCover?(input: {
    bytes: Uint8Array;
    compositionKey: string;
    workflowId: string;
    workspaceId: string;
  }): Promise<{ id: string; objectKey: string; sha256: string; sizeBytes: number; contentType: 'image/jpeg' }>;
  releaseMaterialized?(paths: string[]): Promise<void>;
}

type ComposeFunction = (options: ComposeVideoOptions) => Promise<void>;
type ExtractCoverFunction = (input: {
  coverPath: string;
  ffmpegPath: string;
  outputPath: string;
}) => Promise<Uint8Array>;
type ValidateFunction = typeof validateProductComposedOutput;
type ValidateLabelsFunction = typeof validateVideoLabels;

/** Thin adapter: durable business state stays in the workflow store. */
export class FfmpegVideoCompositionPort implements VideoCompositionPort {
  private readonly composeFunction: ComposeFunction;
  private readonly extractCoverFunction: ExtractCoverFunction;
  private readonly ffmpegPath?: string;
  private readonly fontFilePath?: string;
  private readonly ffprobePath?: string;
  private readonly validateFunction: ValidateFunction;
  private readonly validateLabelsFunction: ValidateLabelsFunction;

  constructor(
    private readonly assets: CompositionAssetStoragePort,
    options: {
      composeFunction?: ComposeFunction;
      extractCoverFunction?: ExtractCoverFunction;
      ffmpegPath?: string;
      ffprobePath?: string;
      fontFilePath?: string;
      validateFunction?: ValidateFunction;
      validateLabelsFunction?: ValidateLabelsFunction;
    } = {},
  ) {
    this.composeFunction = options.composeFunction ?? composeVideo;
    this.extractCoverFunction = options.extractCoverFunction ?? extractVideoCover;
    this.ffmpegPath = options.ffmpegPath;
    this.ffprobePath = options.ffprobePath;
    this.fontFilePath = options.fontFilePath;
    this.validateFunction =
      options.validateFunction ?? validateProductComposedOutput;
    this.validateLabelsFunction =
      options.validateLabelsFunction ?? validateVideoLabels;
  }

  async compose(input: {
    workspaceId: string;
    workflowId: string;
    compositionKey: string;
    clips: OwnedAsset[];
    aigcLabelEnabled: boolean;
    brandWatermarkText?: string;
    storyboardRevision?: string;
    subtitles?: TimedSubtitle[];
  }) {
    if (input.clips.length === 0) {
      throw new Error('At least one selected clip is required for composition.');
    }
    if (!this.assets.persistVideoCover || !input.storyboardRevision || !input.subtitles?.length) {
      throw new Error('Canonical cover and subtitle evidence is required.');
    }
    const materialized = await Promise.all(
      input.clips.map((asset) =>
        this.assets.materialize({ workspaceId: input.workspaceId, asset }),
      ),
    );
    const clipPaths = materialized.map(({ path }) => path);
    const workDirectory = await mkdtemp(join(tmpdir(), 'meiye-composed-video-'));
    const outputPath = join(workDirectory, 'output.mp4');
    const implicitLabel: ImplicitVideoLabel = {
      serviceProvider: 'meiye-content-workflow',
      serviceCode: 'ffmpeg-compose-v1',
      contentId: input.workflowId,
    };
    try {
      await this.composeFunction({
        clipPaths,
        outputPath,
        subtitles: input.subtitles ?? [],
        aigcLabelEnabled: input.aigcLabelEnabled,
        ...(input.brandWatermarkText
          ? { brandWatermarkText: input.brandWatermarkText }
          : {}),
        ...(input.aigcLabelEnabled
          ? {
              implicitLabel: {
                ...implicitLabel,
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
      const labels = input.aigcLabelEnabled
        ? await this.validateLabelsFunction({
            filePath: outputPath,
            expectedVisibleLabel: DEFAULT_AIGC_VISIBLE_LABEL,
            expectedImplicitLabel: implicitLabel,
            ...(this.ffprobePath ? { ffprobePath: this.ffprobePath } : {}),
          })
        : undefined;
      const coverPath = join(workDirectory, 'cover.jpg');
      const cover = await this.assets.persistVideoCover({
        bytes: await this.extractCoverFunction({
          coverPath,
          ffmpegPath: this.ffmpegPath ?? 'ffmpeg',
          outputPath,
        }),
        compositionKey: input.compositionKey,
        workflowId: input.workflowId,
        workspaceId: input.workspaceId,
      });
      const compositionEvidence: NonNullable<
        OwnedAsset['compositionEvidence']
      > = {
        ...rendererEvidence,
        aigc: input.aigcLabelEnabled
          ? {
              requested: true,
              visibleLabel: {
                actual: true,
                value: labels!.visibleLabel,
                validated: true,
              },
              implicitMetadata: {
                actual: true,
                ...labels!.implicitLabel,
                validated: true,
              },
              validationMethod: 'ffprobe_metadata',
            }
          : {
              requested: false,
              visibleLabel: { actual: false, validated: true },
              implicitMetadata: { actual: false, validated: true },
              validationMethod: 'composition_manifest',
            },
        brandWatermark: {
          actual: Boolean(input.brandWatermarkText),
          requested: Boolean(input.brandWatermarkText),
          validated: true,
          validationMethod: 'composition_manifest',
          ...(input.brandWatermarkText
            ? { text: input.brandWatermarkText }
            : {}),
        },
        delivery: {
          compositionRevision: input.compositionKey,
          storyboardRevision: input.storyboardRevision,
          workflowId: input.workflowId,
          outputVideoSha256: rendererEvidence.outputSha256,
          cover: { ...cover, validationMethod: 'ffmpeg_frame_extract' },
          subtitles: {
            durationSeconds: input.subtitles.at(-1)?.endSeconds ?? 0,
            format: 'srt',
            text: serializeSrt(input.subtitles),
            validationMethod: 'composition_manifest',
          },
        },
      };
      const owned = await this.assets.persistComposedVideo({
        workspaceId: input.workspaceId,
        workflowId: input.workflowId,
        compositionKey: input.compositionKey,
        path: outputPath,
        sourceAssetIds: input.clips.map((asset) => asset.id),
        compositionEvidence,
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
        compositionEvidence,
      };
    } finally {
      await this.assets.releaseMaterialized?.(clipPaths);
      await rm(workDirectory, { recursive: true, force: true });
    }
  }
}

async function extractVideoCover(input: {
  coverPath: string;
  ffmpegPath: string;
  outputPath: string;
}) {
  await runMediaCommand(input.ffmpegPath, [
    '-y', '-i', input.outputPath, '-frames:v', '1', '-q:v', '2', input.coverPath,
  ]);
  return readFile(input.coverPath);
}

function serializeSrt(subtitles: TimedSubtitle[]) {
  const time = (seconds: number) => {
    const ms = Math.round(seconds * 1000);
    const date = new Date(ms).toISOString().slice(11, 23).replace('.', ',');
    return date;
  };
  return subtitles.map((item, index) =>
    `${index + 1}\n${time(item.startSeconds)} --> ${time(item.endSeconds)}\n${item.text}\n`,
  ).join('\n');
}
