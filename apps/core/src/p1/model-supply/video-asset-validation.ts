import { runMediaCommand } from './media-tools.js';

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
  ffprobePath = 'ffprobe',
): Promise<VideoProbe> {
  let raw: RawProbe;
  try {
    const result = await runMediaCommand(ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'format=duration:format_tags:stream=index,codec_type,codec_name,width,height,duration',
      '-of',
      'json',
      filePath,
    ]);
    raw = JSON.parse(result.stdout) as RawProbe;
  } catch (error) {
    throw new VideoProbeError(`ffprobe could not inspect ${filePath}.`, {
      cause: error,
    });
  }
  const streams = (raw.streams ?? []).map(
    (stream): ProbedVideoStream => ({
      index: finiteNumber(stream.index) ?? -1,
      codecType:
        typeof stream.codec_type === 'string' ? stream.codec_type : 'unknown',
      ...(typeof stream.codec_name === 'string'
        ? { codecName: stream.codec_name }
        : {}),
      ...(finiteNumber(stream.width) === undefined
        ? {}
        : { width: finiteNumber(stream.width) }),
      ...(finiteNumber(stream.height) === undefined
        ? {}
        : { height: finiteNumber(stream.height) }),
      ...(finiteNumber(stream.duration) === undefined
        ? {}
        : { durationSeconds: finiteNumber(stream.duration) }),
    }),
  );
  const formatDuration = finiteNumber(raw.format?.duration);
  const streamDuration = Math.max(
    0,
    ...streams.map((stream) => stream.durationSeconds ?? 0),
  );
  const durationSeconds = formatDuration ?? streamDuration;
  if (
    !streams.some((stream) => stream.codecType === 'video') ||
    durationSeconds <= 0
  ) {
    throw new VideoProbeError(
      `ffprobe did not find a playable video stream in ${filePath}.`,
    );
  }
  const tags = Object.fromEntries(
    Object.entries(raw.format?.tags ?? {})
      .filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      )
      .map(([key, value]) => [key.toLowerCase(), value]),
  );
  return { filePath, durationSeconds, streams, tags };
}
