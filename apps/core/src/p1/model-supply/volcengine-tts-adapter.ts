import { randomUUID } from 'node:crypto';
import { AUDIO_ASSET_LIMITS } from '../../pro-studio-runtime/audio-asset-pipeline.js';
import {
  decodeVolcengineTtsFrame,
  encodeVolcengineTtsFrame,
  VOLCENGINE_TTS_EVENT,
  VOLCENGINE_TTS_MESSAGE_TYPE,
  type VolcengineTtsFrame,
} from './volcengine-tts-protocol.js';

/**
 * API contract sources:
 * docs/_private/volcengine-tts/bidirectional-tts-api.md
 * docs/_private/volcengine-tts/legacy-auth-reference.md
 */

const DEFAULT_ENDPOINT =
  'wss://openspeech.bytedance.com/api/v3/tts/bidirection';
const DEFAULT_MODEL = 'seed-tts-2.0-standard';
const DOCUMENTED_SAMPLE_RATES = new Set([
  8_000, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000,
]);
const DOCUMENTED_LANGUAGES = new Set([
  'zh-cn',
  'en',
  'ja',
  'es-mx',
  'id',
  'pt-br',
  'pt',
  'ko',
  'it',
  'de',
  'fr',
  'th',
  'vi',
  'ru',
  'fil',
  'ms',
  'ar',
  'pl',
  'tr',
  'sv',
]);

export type VolcengineTtsAuth =
  | { apiKey: string; kind: 'api_key' }
  | { accessToken: string; appId: string; kind: 'legacy' };

export interface VolcengineTtsSocket {
  send(frame: Uint8Array): Promise<void>;
  receive(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface VolcengineTtsSocketFactory {
  connect(input: {
    headers: Readonly<Record<string, string>>;
    url: string;
  }): Promise<VolcengineTtsSocket>;
}

export interface VolcengineBidirectionalTtsOptions {
  auth: VolcengineTtsAuth;
  defaultSpeaker: string;
  endpoint?: string;
  model?: string;
  nextId?: () => string;
  resourceId: 'seed-tts-2.0' | 'seed-icl-2.0';
  socketFactory: VolcengineTtsSocketFactory;
}

export interface VolcengineTtsSynthesisRequest {
  format: 'mp3' | 'wav';
  language?: string;
  sampleRate?: 8000 | 16000 | 22050 | 24000 | 32000 | 44100 | 48000;
  speaker?: string;
  speed?: number;
  text: string;
}

export interface VolcengineTtsSynthesisResult {
  billedTextWords?: number;
  bytes: Uint8Array;
  contentType: 'audio/mpeg' | 'audio/wav';
}

export class VolcengineTtsAdapterError extends Error {
  constructor(
    readonly event: number | 'invalid_response',
    message: string,
    readonly providerErrorCode?: number,
  ) {
    super(message);
    this.name = 'VolcengineTtsAdapterError';
  }
}

export class VolcengineBidirectionalTtsAdapter {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly nextId: () => string;

  constructor(private readonly options: VolcengineBidirectionalTtsOptions) {
    requireText(options.defaultSpeaker, 'Volcengine TTS default speaker');
    if (options.auth.kind === 'api_key') {
      requireText(options.auth.apiKey, 'Volcengine TTS API key');
    } else {
      requireText(options.auth.appId, 'Volcengine TTS APP ID');
      requireText(options.auth.accessToken, 'Volcengine TTS access token');
    }
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    if (!this.endpoint.startsWith('wss://')) {
      throw new Error('Volcengine TTS endpoint must use wss.');
    }
    this.model = options.model ?? DEFAULT_MODEL;
    requireText(this.model, 'Volcengine TTS model');
    this.nextId = options.nextId ?? randomUUID;
  }

  async synthesize(
    request: VolcengineTtsSynthesisRequest,
  ): Promise<VolcengineTtsSynthesisResult> {
    const normalized = normalizeRequest(request, this.options.defaultSpeaker);
    const connectId = requireText(this.nextId(), 'Volcengine TTS connect id');
    const sessionId = requireText(this.nextId(), 'Volcengine TTS session id');
    const socket = await this.options.socketFactory.connect({
      headers: this.headers(connectId),
      url: this.endpoint,
    });
    try {
      await sendJson(
        socket,
        VOLCENGINE_TTS_EVENT.StartConnection,
        {},
      );
      await receiveExpected(socket, VOLCENGINE_TTS_EVENT.ConnectionStarted);

      await sendJson(
        socket,
        VOLCENGINE_TTS_EVENT.StartSession,
        {
          req_params: {
            audio_params: {
              format: normalized.format,
              sample_rate: normalized.sampleRate,
              speech_rate: normalized.speechRate,
            },
            ...(normalized.language
              ? { explicit_language: normalized.language }
              : {}),
            model: this.model,
            speaker: normalized.speaker,
          },
        },
        sessionId,
      );
      await receiveExpected(socket, VOLCENGINE_TTS_EVENT.SessionStarted);

      await sendJson(
        socket,
        VOLCENGINE_TTS_EVENT.TaskRequest,
        { req_params: { text: normalized.text } },
        sessionId,
      );
      await sendJson(
        socket,
        VOLCENGINE_TTS_EVENT.FinishSession,
        {},
        sessionId,
      );

      const audioChunks: Uint8Array[] = [];
      let audioBytes = 0;
      let billedTextWords: number | undefined;
      while (true) {
        const frame = decodeVolcengineTtsFrame(await socket.receive());
        failOnProviderError(frame);
        billedTextWords = usageFrom(frame) ?? billedTextWords;
        if (frame.event === VOLCENGINE_TTS_EVENT.TTSResponse) {
          if (
            frame.messageType !== VOLCENGINE_TTS_MESSAGE_TYPE.AudioOnlyServer
          ) {
            throw new VolcengineTtsAdapterError(
              'invalid_response',
              'Volcengine TTS audio event used an invalid message type.',
            );
          }
          if (frame.payload.byteLength > 0) {
            audioBytes += frame.payload.byteLength;
            if (audioBytes > AUDIO_ASSET_LIMITS.maxBytes) {
              throw new VolcengineTtsAdapterError(
                'invalid_response',
                'Volcengine TTS audio exceeded the owned-audio size limit.',
              );
            }
            audioChunks.push(frame.payload);
          }
          continue;
        }
        if (frame.event === VOLCENGINE_TTS_EVENT.SessionFinished) break;
        if (
          frame.event === VOLCENGINE_TTS_EVENT.UsageResponse ||
          frame.event === VOLCENGINE_TTS_EVENT.TTSSentenceStart ||
          frame.event === VOLCENGINE_TTS_EVENT.TTSSentenceEnd ||
          frame.event === VOLCENGINE_TTS_EVENT.TTSEnded ||
          frame.event === VOLCENGINE_TTS_EVENT.TTSSubtitle
        ) {
          continue;
        }
        throw new VolcengineTtsAdapterError(
          'invalid_response',
          `Volcengine TTS returned unexpected event ${String(frame.event)}.`,
        );
      }
      const bytes = concatenate(audioChunks);
      if (bytes.byteLength === 0) {
        throw new VolcengineTtsAdapterError(
          'invalid_response',
          'Volcengine TTS completed without audio bytes.',
        );
      }

      await sendJson(socket, VOLCENGINE_TTS_EVENT.FinishConnection, {});
      await receiveExpected(socket, VOLCENGINE_TTS_EVENT.ConnectionFinished);
      return {
        ...(billedTextWords === undefined ? {} : { billedTextWords }),
        bytes,
        contentType:
          normalized.format === 'mp3' ? 'audio/mpeg' : 'audio/wav',
      };
    } finally {
      await socket.close();
    }
  }

  private headers(requestId: string): Readonly<Record<string, string>> {
    const common = {
      'X-Api-Connect-Id': requestId,
      'X-Api-Resource-Id': this.options.resourceId,
      'X-Control-Require-Usage-Tokens-Return': '*',
    };
    return this.options.auth.kind === 'api_key'
      ? { ...common, 'X-Api-Key': this.options.auth.apiKey }
      : {
          ...common,
          'X-Api-Access-Key': this.options.auth.accessToken,
          'X-Api-App-Id': this.options.auth.appId,
          'X-Api-Request-Id': requestId,
        };
  }
}

async function sendJson(
  socket: VolcengineTtsSocket,
  event: number,
  value: unknown,
  sessionId?: string,
) {
  await socket.send(
    encodeVolcengineTtsFrame({
      event,
      messageType: VOLCENGINE_TTS_MESSAGE_TYPE.FullClientRequest,
      payload: new TextEncoder().encode(JSON.stringify(value)),
      ...(sessionId ? { sessionId } : {}),
    }),
  );
}

async function receiveExpected(
  socket: VolcengineTtsSocket,
  event: number,
) {
  const frame = decodeVolcengineTtsFrame(await socket.receive());
  failOnProviderError(frame);
  if (
    frame.messageType !== VOLCENGINE_TTS_MESSAGE_TYPE.FullServerResponse ||
    frame.event !== event
  ) {
    throw new VolcengineTtsAdapterError(
      'invalid_response',
      `Volcengine TTS expected event ${event} but received ${String(frame.event)}.`,
    );
  }
  return frame;
}

function failOnProviderError(frame: VolcengineTtsFrame) {
  const failedEvents = new Set<number>([
    VOLCENGINE_TTS_EVENT.ConnectionFailed,
    VOLCENGINE_TTS_EVENT.SessionFailed,
    VOLCENGINE_TTS_EVENT.SessionCanceled,
  ]);
  if (
    frame.messageType === VOLCENGINE_TTS_MESSAGE_TYPE.Error ||
    (frame.event !== undefined && failedEvents.has(frame.event))
  ) {
    throw new VolcengineTtsAdapterError(
      frame.event ?? 'invalid_response',
      `Volcengine TTS provider failure event ${eventName(frame.event)}${
        frame.errorCode === undefined ? '' : ` (code ${frame.errorCode})`
      }.`,
      frame.errorCode,
    );
  }
}

function eventName(event: number | undefined) {
  for (const [name, value] of Object.entries(VOLCENGINE_TTS_EVENT)) {
    if (value === event) return name;
  }
  return String(event ?? 'unknown');
}

function usageFrom(frame: VolcengineTtsFrame) {
  if (
    frame.messageType !== VOLCENGINE_TTS_MESSAGE_TYPE.FullServerResponse ||
    frame.payload.byteLength === 0
  ) {
    return undefined;
  }
  try {
    const decoded = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(frame.payload),
    ) as unknown;
    if (!isRecord(decoded) || !isRecord(decoded.usage)) return undefined;
    const value = decoded.usage.text_words;
    return Number.isSafeInteger(value) && (value as number) >= 0
      ? (value as number)
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeRequest(
  request: VolcengineTtsSynthesisRequest,
  defaultSpeaker: string,
) {
  const text = requireText(request.text, 'Volcengine TTS text');
  const speaker = requireText(
    request.speaker ?? defaultSpeaker,
    'Volcengine TTS speaker',
  );
  const sampleRate = request.sampleRate ?? 24_000;
  if (!DOCUMENTED_SAMPLE_RATES.has(sampleRate)) {
    throw new Error('Volcengine TTS sample rate is not documented.');
  }
  const language = request.language?.trim().toLowerCase();
  if (language && !DOCUMENTED_LANGUAGES.has(language)) {
    throw new Error('Volcengine TTS language is not documented.');
  }
  const speed = request.speed ?? 1;
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
    throw new Error('Volcengine TTS speed must be between 0.5 and 2.');
  }
  return {
    format: request.format,
    ...(language ? { language } : {}),
    sampleRate,
    speaker,
    speechRate: Math.round((speed - 1) * 100),
    text,
  };
}

function requireText(value: string, name: string) {
  if (!value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function concatenate(values: readonly Uint8Array[]) {
  const output = new Uint8Array(
    values.reduce((length, value) => length + value.byteLength, 0),
  );
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
