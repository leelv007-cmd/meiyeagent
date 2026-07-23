import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createCanvasOwnedAssetExportPolicy,
} from '../pro-studio/canvas-asset-facade.js';
import type {
  CanvasAssetContentType,
  CanvasAssetRepository,
  CanvasAudioValidation,
  CanvasOwnedAsset,
  ReceiptAwareCanvasObjectStorage,
} from '../pro-studio/canvas-asset-facade.js';
import type { ReferenceAssetDeliveryPort } from '../p1/model-supply/reference-asset-delivery.js';
import { runMediaCommand } from '../video/media-tools.js';

export const AUDIO_ASSET_LIMITS = {
  maxBitRate: 512_000,
  maxBytes: 25 * 1024 * 1024,
  maxDurationSeconds: 600,
  maxMetadataBytes: 64 * 1024,
  maxSampleRate: 96_000,
} as const;

export interface AudioInspection {
  bitRate: number;
  codec: string;
  container: string;
  durationSeconds: number;
  metadata: Record<string, string>;
  sampleRate: number;
}

export interface AudioInspectorPort {
  inspect(input: {
    bytes: Uint8Array;
    contentType: 'audio/mpeg' | 'audio/wav';
  }): Promise<AudioInspection>;
}

export type AudioProviderFetchPort = ReferenceAssetDeliveryPort;

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
    contentType: 'audio/mpeg' | 'audio/wav';
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
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'AudioAssetPipelineError';
  }
}

interface AudioAssetPipelineOptions {
  clock?: () => Date;
  inspector?: AudioInspectorPort;
  nextAssetId?: () => string;
  nextObjectToken?: () => string;
  providerFetch?: AudioProviderFetchPort;
  repository: CanvasAssetRepository;
  storage: ReceiptAwareCanvasObjectStorage;
}

export class AudioAssetPipeline {
  private readonly clock: () => Date;
  private readonly inspector: AudioInspectorPort;
  private readonly nextAssetId: () => string;
  private readonly nextObjectToken: () => string;

  constructor(private readonly options: AudioAssetPipelineOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.inspector = options.inspector ?? new FfmpegAudioInspector();
    this.nextAssetId = options.nextAssetId ?? (() => `asset-${randomUUID()}`);
    this.nextObjectToken =
      options.nextObjectToken ?? (() => randomBytes(24).toString('hex'));
  }

  async persistProviderAudio(input: {
    fileName: string;
    jobId: string;
    ownerId: string;
    providerUrl: string;
    workspaceId: string;
  }) {
    if (!this.options.providerFetch) {
      throw new AudioAssetPipelineError(
        'AUDIO_PROVIDER_FETCH_UNAVAILABLE',
        'Provider audio safe-fetch is not configured.',
      );
    }
    const fetched = await this.options.providerFetch.get(input.providerUrl, {
      allowedMimeTypes: ['audio/mpeg', 'audio/wav'],
      maxBytes: AUDIO_ASSET_LIMITS.maxBytes,
    });
    if (fetched.mimeType !== 'audio/mpeg' && fetched.mimeType !== 'audio/wav') {
      throw new AudioAssetPipelineError(
        'AUDIO_CONTENT_TYPE_INVALID',
        'Provider audio returned an unsupported MIME type.',
      );
    }
    return this.persistGeneratedAudio({
      bytes: fetched.bytes,
      contentType: fetched.mimeType,
      fileName: input.fileName,
      jobId: input.jobId,
      ownerId: input.ownerId,
      workspaceId: input.workspaceId,
    });
  }

  async persistGeneratedAudio(input: {
    bytes: Uint8Array;
    contentType: 'audio/mpeg' | 'audio/wav';
    fileName: string;
    jobId: string;
    ownerId: string;
    workspaceId: string;
  }) {
    requireObjectKeySegment(input.workspaceId, 'workspaceId');
    requireIdentifier(input.jobId, 'jobId');
    requireIdentifier(input.ownerId, 'ownerId');
    const audioValidation = await validateGeneratedAudio(
      {
        bytes: input.bytes,
        contentType: input.contentType,
      },
      this.inspector,
    );
    const extension = input.contentType === 'audio/mpeg' ? 'mp3' : 'wav';
    const objectToken = this.nextObjectToken();
    if (!/^[a-f0-9]{48,128}$/u.test(objectToken)) {
      throw new AudioAssetPipelineError(
        'AUDIO_OBJECT_KEY_INVALID',
        'Audio object token must be cryptographically random.',
      );
    }
    const id = this.nextAssetId();
    const objectKey = `${input.workspaceId}/canvas/assets/${objectToken}.${extension}`;
    const createdAt = this.clock().toISOString();
    const asset: CanvasOwnedAsset = {
      contentType: input.contentType,
      createdAt,
      exportPolicy: createCanvasOwnedAssetExportPolicy({
        ownerId: input.ownerId,
        updatedAt: createdAt,
        workspaceId: input.workspaceId,
      }),
      fileName: safeFileName(input.fileName, extension),
      id,
      objectKey,
      sha256: createHash('sha256').update(input.bytes).digest('hex'),
      sizeBytes: input.bytes.byteLength,
      source: {
        audioValidation,
        jobId: input.jobId,
        kind: 'generation_job',
      },
      workspaceId: input.workspaceId,
    };
    await this.options.storage.putVerifiedCanvasAsset(
      objectKey,
      Uint8Array.from(input.bytes),
    );
    await this.options.repository.insert(asset);
    return structuredClone(asset);
  }
}

export async function validateGeneratedAudio(
  input: {
    bytes: Uint8Array;
    contentType: 'audio/mpeg' | 'audio/wav';
  },
  inspector: AudioInspectorPort = new FfmpegAudioInspector(),
) {
  validateContainerMagic(input.contentType, input.bytes);
  const inspection = await inspector.inspect({
    bytes: Uint8Array.from(input.bytes),
    contentType: input.contentType,
  });
  return validateInspection(input.contentType, inspection);
}

function validateContainerMagic(
  contentType: CanvasAssetContentType,
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
  contentType: 'audio/mpeg' | 'audio/wav',
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
    throw new Error('Audio probe did not find the expected stream and container.');
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
  contentType: 'audio/mpeg' | 'audio/wav',
  inspection: AudioInspection,
): CanvasAudioValidation {
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
    displayMetadata: Object.entries(inspection.metadata).map(([name, value]) => ({
      name: escapeForDisplay(name),
      value: escapeForDisplay(value),
    })),
    durationSeconds: inspection.durationSeconds,
    metadataBytes,
    sampleRate: inspection.sampleRate,
  };
}

function finiteWithin(value: number, maximum: number) {
  return Number.isFinite(value) && value > 0 && value <= maximum;
}

function safeFileName(value: string, extension: string) {
  const cleaned = value
    .trim()
    .replaceAll(/[\\/\0\r\n]/gu, '_')
    .replace(/\.[A-Za-z0-9]{1,10}$/u, '')
    .slice(0, 175 - extension.length);
  return `${cleaned || 'audio'}.${extension}`;
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

function requireIdentifier(value: string, field: string) {
  if (!value.trim()) {
    throw new AudioAssetPipelineError(
      'AUDIO_INPUT_INVALID',
      `${field} is required.`,
    );
  }
}

function requireObjectKeySegment(value: string, field: string) {
  requireIdentifier(value, field);
  if (!/^[A-Za-z0-9._-]+$/u.test(value) || value === '.' || value === '..') {
    throw new AudioAssetPipelineError(
      'AUDIO_INPUT_INVALID',
      `${field} must be a safe object-key segment.`,
    );
  }
}
