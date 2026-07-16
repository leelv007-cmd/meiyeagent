import { runMediaCommand } from './media-tools.js';
import type { ImplicitVideoLabel } from './composer.js';

export interface ProbedVideoStream {
  index: number;
  codecType: string;
  codecName?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export interface VideoProbe {
  filePath: string;
  durationSeconds: number;
  streams: ProbedVideoStream[];
  tags: Record<string, string>;
}

export class VideoProbeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'VideoProbeError';
  }
}

export type VideoLabelValidationErrorCode =
  | 'non_playable_video'
  | 'visible_label_missing'
  | 'implicit_label_missing'
  | 'label_mismatch';

export class VideoLabelValidationError extends Error {
  constructor(
    readonly code: VideoLabelValidationErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'VideoLabelValidationError';
  }
}

interface RawProbe {
  streams?: Array<Record<string, unknown>>;
  format?: {
    duration?: string;
    tags?: Record<string, unknown>;
  };
}

function finiteNumber(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export async function probeVideoFile(
  filePath: string,
  ffprobePath = 'ffprobe'
): Promise<VideoProbe> {
  let raw: RawProbe;
  try {
    const result = await runMediaCommand(ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration:format_tags:stream=index,codec_type,codec_name,width,height,duration',
      '-of', 'json',
      filePath,
    ]);
    raw = JSON.parse(result.stdout) as RawProbe;
  } catch (error) {
    throw new VideoProbeError(`ffprobe could not inspect ${filePath}.`, { cause: error });
  }
  const streams = (raw.streams ?? []).map((stream): ProbedVideoStream => ({
    index: finiteNumber(stream.index) ?? -1,
    codecType: typeof stream.codec_type === 'string' ? stream.codec_type : 'unknown',
    ...(typeof stream.codec_name === 'string' ? { codecName: stream.codec_name } : {}),
    ...(finiteNumber(stream.width) === undefined ? {} : { width: finiteNumber(stream.width) }),
    ...(finiteNumber(stream.height) === undefined ? {} : { height: finiteNumber(stream.height) }),
    ...(finiteNumber(stream.duration) === undefined
      ? {}
      : { durationSeconds: finiteNumber(stream.duration) }),
  }));
  const formatDuration = finiteNumber(raw.format?.duration);
  const streamDuration = Math.max(0, ...streams.map((stream) => stream.durationSeconds ?? 0));
  const durationSeconds = formatDuration ?? streamDuration;
  if (!streams.some((stream) => stream.codecType === 'video') || durationSeconds <= 0) {
    throw new VideoProbeError(`ffprobe did not find a playable video stream in ${filePath}.`);
  }
  const tags = Object.fromEntries(
    Object.entries(raw.format?.tags ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, value]) => [key.toLowerCase(), value])
  );
  return { filePath, durationSeconds, streams, tags };
}

export interface ValidatedVideoLabels {
  filePath: string;
  visibleLabel: string;
  implicitLabel: ImplicitVideoLabel & { contentType: 'ai_generated' };
}

export async function validateVideoLabels(options: {
  filePath: string;
  expectedVisibleLabel: string;
  expectedImplicitLabel?: ImplicitVideoLabel;
  ffprobePath?: string;
}): Promise<ValidatedVideoLabels> {
  let probe: VideoProbe;
  try {
    probe = await probeVideoFile(options.filePath, options.ffprobePath);
  } catch (error) {
    throw new VideoLabelValidationError(
      'non_playable_video',
      `Video output is not playable: ${options.filePath}`,
      { cause: error }
    );
  }
  const visibleLabel = probe.tags.aigc_visible_label;
  if (!visibleLabel) {
    throw new VideoLabelValidationError(
      'visible_label_missing',
      'ffprobe found no evidence that the visible AIGC label was burned.'
    );
  }
  if (visibleLabel !== options.expectedVisibleLabel) {
    throw new VideoLabelValidationError(
      'label_mismatch',
      `Visible AIGC label evidence was ${JSON.stringify(visibleLabel)}.`
    );
  }
  const contentType = probe.tags.aigc_content_type;
  const serviceProvider = probe.tags.aigc_service_provider;
  const serviceCode = probe.tags.aigc_service_code;
  const contentId = probe.tags.aigc_content_id;
  if (contentType !== 'ai_generated' || !serviceProvider || !serviceCode || !contentId) {
    throw new VideoLabelValidationError(
      'implicit_label_missing',
      'ffprobe found incomplete implicit AIGC metadata.'
    );
  }
  const expected = options.expectedImplicitLabel;
  if (expected && (
    expected.serviceProvider !== serviceProvider ||
    expected.serviceCode !== serviceCode ||
    expected.contentId !== contentId
  )) {
    throw new VideoLabelValidationError(
      'label_mismatch',
      'Implicit AIGC metadata did not match the requested output evidence.'
    );
  }
  return {
    filePath: options.filePath,
    visibleLabel,
    implicitLabel: {
      contentType: 'ai_generated',
      serviceProvider,
      serviceCode,
      contentId,
    },
  };
}
