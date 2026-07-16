import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_AIGC_VISIBLE_LABEL,
  type ImplicitVideoLabel,
  type TimedSubtitle,
} from './composer.js';
import { runMediaCommand } from './media-tools.js';
import type { VideoProvider } from './provider.js';
import { runVideoProof } from './proof.js';
import { probeVideoFile } from './validation.js';

const OUTPUT_WIDTH = 720;
const OUTPUT_HEIGHT = 1280;
const OUTPUT_FPS = 24;
const PROVIDER = 'meiye-node-renderer';
const MODEL = 'ffmpeg-image-storyboard-v1';

export interface ProductStoryboardShot {
  id: string;
  visualDirection?: string;
  narration: string;
  durationSeconds: number;
}

export interface RenderProductVideoOptions {
  outputId: string;
  correlationId: string;
  storyboard: {
    shots: readonly ProductStoryboardShot[];
  };
  sourceImage: Uint8Array;
  sourceContentType: string;
  aigcLabelEnabled?: boolean;
  provider?: VideoProvider;
  ffmpegPath?: string;
  ffprobePath?: string;
  fontFilePath?: string;
  signal?: AbortSignal;
}

export interface ProductFirstFrameManifest {
  sourceContentType: string;
  fileSizeBytes: number;
  sha256: string;
}

export interface ProductClipManifest {
  shotId: string;
  narration: string;
  requestedDurationSeconds: number;
  durationSeconds: number;
  width: number;
  height: number;
  fileSizeBytes: number;
  sha256: string;
  provider?: string;
  model?: string;
  taskId?: string;
  providerCostCents?: number;
  providerLatencyMs?: number;
}

export interface ProductComposeManifest {
  outputId: string;
  correlationId: string;
  clipCount: number;
  width: number;
  height: number;
  framesPerSecond: number;
  requestedDurationSeconds: number;
  durationSeconds: number;
}

export interface ProductVideoEvidence {
  sha256: string;
  fileSizeBytes: number;
  durationSeconds: number;
  aspectRatio: '9:16';
  visibleLabel?: string;
  implicitMetadata?: ImplicitVideoLabel & { contentType: 'ai_generated' };
  provider: string;
  model: string;
  providerCostCents: number;
  latencyMs: number;
  usableQuality: {
    usable: boolean;
    reason: string;
    assessmentMethod: string;
  };
  firstFrameManifest: ProductFirstFrameManifest;
  clipManifest: ProductClipManifest[];
  composeManifest: ProductComposeManifest;
}

export interface RenderedProductVideo {
  bytes: Uint8Array;
  evidence: ProductVideoEvidence;
}

export interface ProductComposedOutputEvidence {
  rendererRevision: 'product-renderer-validation-v1';
  clipCount: number;
  sourceAssetIds: string[];
  outputSha256: string;
  outputSizeBytes: number;
  durationSeconds: number;
  width: number;
  height: number;
}

/**
 * Shared technical validation used by both the P0 renderer and the durable
 * composed-video workflow. It never owns workflow, routing, billing, or
 * authorization state.
 */
export async function validateProductComposedOutput(input: {
  outputPath: string;
  sourceAssetIds: string[];
  ffprobePath?: string;
}): Promise<ProductComposedOutputEvidence> {
  if (input.sourceAssetIds.length === 0) {
    throw new Error('A composed product video requires source clip assets.');
  }
  const bytes = await readFile(input.outputPath);
  const probe = await probeVideoFile(
    input.outputPath,
    input.ffprobePath ?? process.env.FFPROBE_PATH ?? 'ffprobe'
  );
  const video = probe.streams.find((stream) => stream.codecType === 'video');
  if (
    bytes.byteLength === 0 ||
    !video?.width ||
    !video.height ||
    probe.durationSeconds <= 0
  ) {
    throw new Error('Composed product video failed renderer validation.');
  }
  return {
    rendererRevision: 'product-renderer-validation-v1',
    clipCount: input.sourceAssetIds.length,
    sourceAssetIds: [...input.sourceAssetIds],
    outputSha256: sha256(bytes),
    outputSizeBytes: bytes.byteLength,
    durationSeconds: probe.durationSeconds,
    width: video.width,
    height: video.height,
  };
}

const localProvider: VideoProvider = {
  name: PROVIDER,
  model: MODEL,
  zeroCost: { amount: 0, currency: 'CNY', estimated: false },
  async generateClip() {
    throw new Error('The product renderer supplies local FFmpeg clips directly.');
  },
};

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sourceExtension(contentType: string) {
  switch (contentType.toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      throw new Error(`Unsupported source image content type: ${contentType}`);
  }
}

function validateOptions(options: RenderProductVideoOptions) {
  if (!options.outputId.trim()) throw new Error('outputId is required.');
  if (!options.correlationId.trim()) throw new Error('correlationId is required.');
  if (options.sourceImage.byteLength === 0) throw new Error('sourceImage is required.');
  if (options.storyboard.shots.length === 0) {
    throw new Error('At least one storyboard shot is required.');
  }
  for (const shot of options.storyboard.shots) {
    if (!shot.id.trim()) throw new Error('Every storyboard shot requires an id.');
    if (!Number.isFinite(shot.durationSeconds) || shot.durationSeconds <= 0) {
      throw new Error(`Storyboard shot ${shot.id} requires a positive durationSeconds.`);
    }
  }
}

async function renderShotClip(options: {
  sourcePath: string;
  outputPath: string;
  durationSeconds: number;
  ffmpegPath: string;
  signal?: AbortSignal;
}) {
  await runMediaCommand(options.ffmpegPath, [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-loop',
    '1',
    '-i',
    options.sourcePath,
    '-t',
    String(options.durationSeconds),
    '-vf',
    `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,` +
      `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},setsar=1,fps=${OUTPUT_FPS},format=yuv420p`,
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '21',
    '-movflags',
    '+faststart',
    options.outputPath,
  ], options.signal);
}

export async function renderProductVideo(
  options: RenderProductVideoOptions
): Promise<RenderedProductVideo> {
  validateOptions(options);
  const startedAt = performance.now();
  const ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const ffprobePath = options.ffprobePath ?? process.env.FFPROBE_PATH ?? 'ffprobe';
  const extension = sourceExtension(options.sourceContentType);
  const workDirectory = await mkdtemp(join(tmpdir(), 'meiye-product-video-'));
  const sourcePath = join(workDirectory, `source.${extension}`);
  const outputPath = join(workDirectory, 'output.mp4');
  const implicitLabel: ImplicitVideoLabel = {
    serviceProvider: options.provider?.name ?? PROVIDER,
    serviceCode: options.provider?.model ?? MODEL,
    contentId: options.outputId,
  };

  try {
    await writeFile(sourcePath, options.sourceImage);
    const clipPaths: string[] = [];
    const clipManifest: ProductClipManifest[] = [];
    const subtitles: TimedSubtitle[] = [];
    let subtitleStartSeconds = 0;
    let providerCostCents = 0;

    for (const [index, shot] of options.storyboard.shots.entries()) {
      const clipPath = join(workDirectory, `shot-${index + 1}.mp4`);
      const generated = options.provider
        ? await options.provider.generateClip({
            prompt: [shot.visualDirection, shot.narration]
              .filter(Boolean)
              .join('。'),
            durationSeconds: shot.durationSeconds,
            aspectRatio: '9:16',
            correlationId: options.correlationId,
            outputPath: clipPath,
          }, options.signal)
        : undefined;
      if (!generated) {
        await renderShotClip({
          sourcePath,
          outputPath: clipPath,
          durationSeconds: shot.durationSeconds,
          ffmpegPath,
          signal: options.signal,
        });
      }
      if (generated) {
        if (generated.cost.currency !== 'CNY') {
          throw new Error('Product video provider cost must be reported in CNY.');
        }
        providerCostCents += Math.round(generated.cost.amount * 100);
      }
      const clipBytes = await readFile(clipPath);
      const clipProbe = await probeVideoFile(clipPath, ffprobePath);
      const clipVideoStream = clipProbe.streams.find(
        (stream) => stream.codecType === 'video'
      );
      clipPaths.push(clipPath);
      clipManifest.push({
        shotId: shot.id,
        narration: shot.narration,
        requestedDurationSeconds: shot.durationSeconds,
        durationSeconds: clipProbe.durationSeconds,
        width: clipVideoStream?.width ?? OUTPUT_WIDTH,
        height: clipVideoStream?.height ?? OUTPUT_HEIGHT,
        fileSizeBytes: clipBytes.byteLength,
        sha256: sha256(clipBytes),
        ...(generated
          ? {
              provider: generated.provider,
              model: generated.model,
              taskId: generated.taskId,
              providerCostCents: Math.round(generated.cost.amount * 100),
              providerLatencyMs: generated.latencyMs,
            }
          : {}),
      });
      if (shot.narration.trim()) {
        subtitles.push({
          text: shot.narration,
          startSeconds: subtitleStartSeconds,
          endSeconds: subtitleStartSeconds + shot.durationSeconds,
        });
      }
      subtitleStartSeconds += shot.durationSeconds;
    }

    const proof = await runVideoProof({
      outputId: options.outputId,
      outputPath,
      provider: options.provider ?? localProvider,
      clips: clipPaths.map((path) => ({ kind: 'provided' as const, path })),
      subtitles,
      aigcLabelEnabled: options.aigcLabelEnabled === true,
      ...(options.aigcLabelEnabled === true ? { implicitLabel } : {}),
      ffmpegPath,
      ffprobePath,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.fontFilePath ? { fontFilePath: options.fontFilePath } : {}),
      evaluateUsableQuality: async (path) => {
        const probe = await probeVideoFile(path, ffprobePath);
        const videoStream = probe.streams.find((stream) => stream.codecType === 'video');
        const usable =
          videoStream?.width === OUTPUT_WIDTH && videoStream.height === OUTPUT_HEIGHT;
        return {
          usable,
          reason: usable
            ? options.aigcLabelEnabled === true
              ? 'playable_720x1280_with_requested_labels'
              : 'playable_720x1280'
            : 'unexpected_output_dimensions',
        };
      },
      recordMetrics: async () => {},
    });
    const outputBytes = await readFile(outputPath);
    const outputProbe = await probeVideoFile(outputPath, ffprobePath);
    const usableQuality = proof.metrics.usableQuality.status === 'assessed'
      ? {
          usable: proof.metrics.usableQuality.usable,
          reason: proof.metrics.usableQuality.reason,
          assessmentMethod: 'technical-playability-v1',
        }
      : {
          usable: false,
          reason: 'technical_failure',
          assessmentMethod: 'technical-playability-v1',
        };

    return {
      bytes: new Uint8Array(outputBytes),
      evidence: {
        sha256: sha256(outputBytes),
        fileSizeBytes: outputBytes.byteLength,
        durationSeconds: outputProbe.durationSeconds,
        aspectRatio: '9:16',
        ...(proof.labels
          ? {
              visibleLabel: proof.labels.visibleLabel,
              implicitMetadata: proof.labels.implicitLabel,
            }
          : {}),
        provider: options.provider?.name ?? localProvider.name,
        model: options.provider?.model ?? localProvider.model,
        providerCostCents,
        latencyMs: Math.max(0, performance.now() - startedAt),
        usableQuality,
        firstFrameManifest: {
          sourceContentType: options.sourceContentType,
          fileSizeBytes: options.sourceImage.byteLength,
          sha256: sha256(options.sourceImage),
        },
        clipManifest,
        composeManifest: {
          outputId: options.outputId,
          correlationId: options.correlationId,
          clipCount: clipManifest.length,
          width: OUTPUT_WIDTH,
          height: OUTPUT_HEIGHT,
          framesPerSecond: OUTPUT_FPS,
          requestedDurationSeconds: options.storyboard.shots.reduce(
            (total, shot) => total + shot.durationSeconds,
            0
          ),
          durationSeconds: outputProbe.durationSeconds,
        },
      },
    };
  } finally {
    await rm(workDirectory, { force: true, recursive: true });
  }
}
