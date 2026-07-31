import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMediaCommand } from './media-tools.js';

export const AUDIO_ASSET_LIMITS = {
  maxBitRate: 512_000,
  maxBytes: 25 * 1024 * 1024,
  maxDurationSeconds: 600,
  maxMetadataBytes: 64 * 1024,
  maxSampleRate: 96_000,
} as const;

export type AudioContentType = 'audio/mpeg' | 'audio/wav';

export interface AudioInspection {
  bitRate: number;
  codec: string;
  container: string;
  durationSeconds: number;
  metadata: Record<string, string>;
  sampleRate: number;
}

export interface AudioValidation {
  bitRate: number;
  codec: 'mp3' | 'pcm_s16le';
  container: 'mp3' | 'wav';
  displayMetadata: Array<{ name: string; value: string }>;
  durationSeconds: number;
  metadataBytes: number;
  sampleRate: number;
}

export interface AudioInspectorPort {
  inspect(input: {
    bytes: Uint8Array;
    contentType: AudioContentType;
  }): Promise<AudioInspection>;
}

export class FfmpegAudioInspector implements AudioInspectorPort {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;

  constructor(
    options: { ffmpegPath?: string; ffprobePath?: string } = {},
  ) {
    this.ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
    this.ffprobePath =
      options.ffprobePath ?? process.env.FFPROBE_PATH ?? 'ffprobe';
  }

  async inspect(input: {
    bytes: Uint8Array;
    contentType: AudioContentType;
  }): Promise<AudioInspection> {
    const directory = await mkdtemp(join(tmpdir(), 'meiye-audio-inspect-'));
    const filePath = join(
      directory,
      input.contentType === 'audio/mpeg' ? 'input.mp3' : 'input.wav',
    );
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 15_000);
    try {
      await writeFile(filePath, input.bytes, { flag: 'wx', mode: 0o600 });
      const probe = await runMediaCommand(
        this.ffprobePath,
        [
          '-v',
          'error',
          '-show_entries',
          'format=format_name,duration,bit_rate:format_tags:stream=codec_type,codec_name,sample_rate,bit_rate',
          '-of',
          'json',
          filePath,
        ],
        abort.signal,
      );
      await runMediaCommand(
        this.ffmpegPath,
        [
          '-v',
          'error',
          '-nostdin',
          '-i',
          filePath,
          '-map',
          '0:a:0',
          '-f',
          'null',
          '-',
        ],
        abort.signal,
      );
      return parseProbe(probe.stdout, input.contentType);
    } catch {
      throw new AudioAssetPipelineError(
        'AUDIO_DECODE_FAILED',
        'Audio could not be decoded by the isolated media inspector.',
      );
    } finally {
      clearTimeout(timeout);
      await rm(directory, { force: true, recursive: true });
    }
  }
}

export class AudioAssetPipelineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AudioAssetPipelineError';
  }
}

export async function validateGeneratedAudio(
  input: {
    bytes: Uint8Array;
    contentType: AudioContentType;
  },
  inspector: AudioInspectorPort = new FfmpegAudioInspector(),
): Promise<AudioValidation> {
  validateContainerMagic(input.contentType, input.bytes);
  const inspection = await inspector.inspect({
    bytes: Uint8Array.from(input.bytes),
    contentType: input.contentType,
  });
  return validateInspection(input.contentType, inspection);
}

function validateContainerMagic(
  contentType: AudioContentType,
  bytes: Uint8Array,
) {
  if (bytes.byteLength === 0 || bytes.byteLength > AUDIO_ASSET_LIMITS.maxBytes) {
    throw new AudioAssetPipelineError(
      'AUDIO_SIZE_INVALID',
      'Audio bytes exceed the accepted size range.',
    );
  }
  const mp3 =
    contentType === 'audio/mpeg' &&
    (ascii(bytes, 0, 3) === 'ID3' ||
      (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0));
  const wav =
    contentType === 'audio/wav' &&
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 4) === 'WAVE';
  if (!mp3 && !wav) {
    throw new AudioAssetPipelineError(
      'AUDIO_CONTAINER_INVALID',
      'Audio container and magic bytes do not match.',
    );
  }
}

function parseProbe(
  json: string,
  contentType: AudioContentType,
): AudioInspection {
  const value = JSON.parse(json) as {
    format?: {
      bit_rate?: unknown;
      duration?: unknown;
      format_name?: unknown;
      tags?: Record<string, unknown>;
    };
    streams?: Array<{
      bit_rate?: unknown;
      codec_name?: unknown;
      codec_type?: unknown;
      sample_rate?: unknown;
    }>;
  };
  const stream = value.streams?.find(
    (candidate) => candidate.codec_type === 'audio',
  );
  const expectedContainer = contentType === 'audio/mpeg' ? 'mp3' : 'wav';
  const formatNames =
    typeof value.format?.format_name === 'string'
      ? value.format.format_name.split(',')
      : [];
  if (!stream || !formatNames.includes(expectedContainer)) {
    throw new Error(
      'Audio probe did not find the expected stream and container.',
    );
  }
  const metadata = Object.fromEntries(
    Object.entries(value.format?.tags ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
  return {
    bitRate: numeric(stream.bit_rate ?? value.format?.bit_rate),
    codec: typeof stream.codec_name === 'string' ? stream.codec_name : '',
    container: expectedContainer,
    durationSeconds: numeric(value.format?.duration),
    metadata,
    sampleRate: numeric(stream.sample_rate),
  };
}

function numeric(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function validateInspection(
  contentType: AudioContentType,
  inspection: AudioInspection,
): AudioValidation {
  const expected =
    contentType === 'audio/mpeg'
      ? ({ codec: 'mp3', container: 'mp3' } as const)
      : ({ codec: 'pcm_s16le', container: 'wav' } as const);
  const metadataBytes = Object.entries(inspection.metadata).reduce(
    (total, [name, value]) =>
      total + Buffer.byteLength(name, 'utf8') + Buffer.byteLength(value, 'utf8'),
    0,
  );
  if (
    inspection.codec !== expected.codec ||
    inspection.container !== expected.container ||
    !finiteWithin(
      inspection.durationSeconds,
      AUDIO_ASSET_LIMITS.maxDurationSeconds,
    ) ||
    !finiteWithin(inspection.bitRate, AUDIO_ASSET_LIMITS.maxBitRate) ||
    !finiteWithin(inspection.sampleRate, AUDIO_ASSET_LIMITS.maxSampleRate) ||
    metadataBytes > AUDIO_ASSET_LIMITS.maxMetadataBytes
  ) {
    throw new AudioAssetPipelineError(
      'AUDIO_TECHNICAL_VALIDATION_FAILED',
      'Decoded audio exceeds the accepted technical limits.',
    );
  }
  return {
    bitRate: inspection.bitRate,
    codec: expected.codec,
    container: expected.container,
    displayMetadata: Object.entries(inspection.metadata).map(
      ([name, value]) => ({
        name: escapeForDisplay(name),
        value: escapeForDisplay(value),
      }),
    ),
    durationSeconds: inspection.durationSeconds,
    metadataBytes,
    sampleRate: inspection.sampleRate,
  };
}

function finiteWithin(value: number, maximum: number) {
  return Number.isFinite(value) && value > 0 && value <= maximum;
}

function escapeForDisplay(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function ascii(bytes: Uint8Array, start: number, length: number) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}
