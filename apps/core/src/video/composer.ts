import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runMediaCommand } from './media-tools.js';

export const DEFAULT_AIGC_VISIBLE_LABEL = '内容由 AI 生成';

export interface TimedSubtitle {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export interface ImplicitVideoLabel {
  serviceProvider: string;
  serviceCode: string;
  contentId: string;
}

export interface ComposeVideoOptions {
  clipPaths: string[];
  outputPath: string;
  subtitles: TimedSubtitle[];
  /** Creation-time option. Publication platforms apply their own gates later. */
  aigcLabelEnabled?: boolean;
  brandWatermarkText?: string;
  implicitLabel?: ImplicitVideoLabel;
  bgmPath?: string;
  bgmVolume?: number;
  width?: number;
  height?: number;
  framesPerSecond?: number;
  fontFilePath?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  signal?: AbortSignal;
}

export class VideoCompositionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'VideoCompositionError';
  }
}

const FONT_CANDIDATES = [
  '/System/Library/Fonts/PingFang.ttc',
  '/System/Library/Fonts/STHeiti Medium.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
];

function filterValue(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'");
}

function resolveFontFile(explicit?: string) {
  if (explicit) {
    if (!existsSync(explicit)) throw new VideoCompositionError(`Font file not found: ${explicit}`);
    return explicit;
  }
  const detected = FONT_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!detected) {
    throw new VideoCompositionError(
      'No CJK font was found. Configure fontFilePath so the AIGC label is readable.'
    );
  }
  return detected;
}

function requirePositiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new VideoCompositionError(`${name} must be a positive integer.`);
  }
}

async function probeClipDuration(
  clipPath: string,
  ffprobePath: string,
  signal?: AbortSignal
) {
  const result = await runMediaCommand(
    ffprobePath,
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      clipPath,
    ],
    signal
  );
  const duration = Number(result.stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new VideoCompositionError(
      `Unable to determine clip duration: ${clipPath}`
    );
  }
  return duration;
}

export async function composeVideo(options: ComposeVideoOptions): Promise<void> {
  if (options.clipPaths.length === 0) {
    throw new VideoCompositionError('At least one clip is required.');
  }
  const width = options.width ?? 720;
  const height = options.height ?? 1280;
  const framesPerSecond = options.framesPerSecond ?? 24;
  const bgmVolume = options.bgmVolume ?? 0.18;
  requirePositiveInteger(width, 'width');
  requirePositiveInteger(height, 'height');
  requirePositiveInteger(framesPerSecond, 'framesPerSecond');
  if (bgmVolume < 0 || bgmVolume > 1) {
    throw new VideoCompositionError('bgmVolume must be between 0 and 1.');
  }
  for (const subtitle of options.subtitles) {
    if (subtitle.startSeconds < 0 || subtitle.endSeconds <= subtitle.startSeconds) {
      throw new VideoCompositionError('Subtitle times must be ordered and non-negative.');
    }
  }
  const aigcLabelEnabled = options.aigcLabelEnabled === true;
  const brandWatermarkText = options.brandWatermarkText?.trim();
  if (aigcLabelEnabled && !options.implicitLabel) {
    throw new VideoCompositionError(
      'implicitLabel is required when the AIGC label is enabled.'
    );
  }
  const needsTextRendering =
    aigcLabelEnabled || Boolean(brandWatermarkText) || options.subtitles.length > 0;
  const fontFilePath = needsTextRendering
    ? resolveFontFile(options.fontFilePath)
    : undefined;
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'meiye-video-compose-'));
  const partialOutputPath = `${options.outputPath}.${process.pid}.tmp.mp4`;
  await mkdir(dirname(options.outputPath), { recursive: true });

  try {
    const videoDuration = options.bgmPath
      ? (
          await Promise.all(
            options.clipPaths.map((clipPath) =>
              probeClipDuration(
                clipPath,
                options.ffprobePath ?? process.env.FFPROBE_PATH ?? 'ffprobe',
                options.signal
              )
            )
          )
        ).reduce((total, duration) => total + duration, 0)
      : undefined;
    const labelTextPath = join(temporaryDirectory, 'aigc-label.txt');
    if (aigcLabelEnabled) {
      await writeFile(labelTextPath, DEFAULT_AIGC_VISIBLE_LABEL, 'utf8');
    }
    const watermarkTextPath = join(temporaryDirectory, 'brand-watermark.txt');
    if (brandWatermarkText) {
      await writeFile(watermarkTextPath, brandWatermarkText, 'utf8');
    }
    const subtitlePaths: string[] = [];
    for (const [index, subtitle] of options.subtitles.entries()) {
      const path = join(temporaryDirectory, `subtitle-${index}.txt`);
      await writeFile(path, subtitle.text, 'utf8');
      subtitlePaths.push(path);
    }

    const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error'];
    for (const clipPath of options.clipPaths) args.push('-i', clipPath);
    if (options.bgmPath) args.push('-stream_loop', '-1', '-i', options.bgmPath);

    const filters: string[] = options.clipPaths.map((_, index) =>
      `[${index}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,` +
      `setsar=1,fps=${framesPerSecond},format=yuv420p,setpts=PTS-STARTPTS[v${index}]`
    );
    if (options.clipPaths.length === 1) {
      filters.push('[v0]null[joined]');
    } else {
      const inputs = options.clipPaths.map((_, index) => `[v${index}]`).join('');
      filters.push(`${inputs}concat=n=${options.clipPaths.length}:v=1:a=0[joined]`);
    }

    let currentVideo = 'joined';
    const commonText = fontFilePath
      ? `fontfile='${filterValue(fontFilePath)}':fontcolor=white:box=1:` +
        'boxcolor=black@0.68:boxborderw=10'
      : undefined;
    if (aigcLabelEnabled && commonText) {
      filters.push(
        `[${currentVideo}]drawtext=textfile='${filterValue(labelTextPath)}':${commonText}:` +
        'fontsize=28:x=w-tw-24:y=24[aigc_labeled]'
      );
      currentVideo = 'aigc_labeled';
    }
    if (brandWatermarkText && commonText) {
      filters.push(
        `[${currentVideo}]drawtext=textfile='${filterValue(watermarkTextPath)}':${commonText}:` +
        'fontsize=28:x=w-tw-24:y=h-th-24[brand_watermarked]'
      );
      currentVideo = 'brand_watermarked';
    }
    for (const [index, subtitle] of options.subtitles.entries()) {
      const output = `subtitle_${index}`;
      filters.push(
        `[${currentVideo}]drawtext=textfile='${filterValue(subtitlePaths[index] ?? '')}':` +
        `${commonText ?? ''}:fontsize=34:x=(w-tw)/2:y=h-th-54:` +
        `enable='between(t,${subtitle.startSeconds},${subtitle.endSeconds})'[${output}]`
      );
      currentVideo = output;
    }
    if (options.bgmPath) {
      filters.push(
        `[${options.clipPaths.length}:a:0]aformat=sample_rates=48000:` +
        `channel_layouts=stereo,volume=${bgmVolume},` +
        `atrim=duration=${videoDuration},asetpts=N/SR/TB[bgm]`
      );
    }

    args.push('-filter_complex', filters.join(';'), '-map', `[${currentVideo}]`);
    if (options.bgmPath) args.push('-map', '[bgm]');
    args.push(
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '21',
      '-pix_fmt', 'yuv420p',
      ...(options.bgmPath
        ? [
            '-c:a',
            'aac',
            '-b:a',
            '160k',
            '-t',
            String(videoDuration),
          ]
        : ['-an']),
      '-movflags', '+faststart+use_metadata_tags'
    );
    if (aigcLabelEnabled && options.implicitLabel) {
      args.push(
        '-metadata', 'aigc_content_type=ai_generated',
        '-metadata', `aigc_service_provider=${options.implicitLabel.serviceProvider}`,
        '-metadata', `aigc_service_code=${options.implicitLabel.serviceCode}`,
        '-metadata', `aigc_content_id=${options.implicitLabel.contentId}`,
        '-metadata', `aigc_visible_label=${DEFAULT_AIGC_VISIBLE_LABEL}`
      );
    }
    if (brandWatermarkText) {
      args.push('-metadata', `brand_watermark_text=${brandWatermarkText}`);
    }
    args.push(partialOutputPath);
    await runMediaCommand(options.ffmpegPath ?? 'ffmpeg', args, options.signal);
    await rename(partialOutputPath, options.outputPath);
  } catch (error) {
    await rm(partialOutputPath, { force: true });
    if (error instanceof VideoCompositionError) throw error;
    throw new VideoCompositionError('ffmpeg video composition failed.', { cause: error });
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}
