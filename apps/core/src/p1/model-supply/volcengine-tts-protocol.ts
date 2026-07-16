/**
 * Binary contract source:
 * docs/_private/volcengine-tts/protocols/protocols_.py
 */
export const VOLCENGINE_TTS_MESSAGE_TYPE = {
  FullClientRequest: 0b0001,
  AudioOnlyClient: 0b0010,
  FullServerResponse: 0b1001,
  AudioOnlyServer: 0b1011,
  FrontEndResultServer: 0b1100,
  Error: 0b1111,
} as const;

export const VOLCENGINE_TTS_EVENT = {
  StartConnection: 1,
  FinishConnection: 2,
  ConnectionStarted: 50,
  ConnectionFailed: 51,
  ConnectionFinished: 52,
  StartSession: 100,
  CancelSession: 101,
  FinishSession: 102,
  SessionStarted: 150,
  SessionCanceled: 151,
  SessionFinished: 152,
  SessionFailed: 153,
  UsageResponse: 154,
  TaskRequest: 200,
  TTSSentenceStart: 350,
  TTSSentenceEnd: 351,
  TTSResponse: 352,
  TTSEnded: 359,
  TTSSubtitle: 364,
} as const;

const WITH_EVENT = 0b0100;
const JSON_SERIALIZATION = 0b0001;
const NO_COMPRESSION = 0;
const CONNECTION_EVENTS_WITHOUT_SESSION = new Set<number>([
  VOLCENGINE_TTS_EVENT.StartConnection,
  VOLCENGINE_TTS_EVENT.FinishConnection,
  VOLCENGINE_TTS_EVENT.ConnectionStarted,
  VOLCENGINE_TTS_EVENT.ConnectionFailed,
  VOLCENGINE_TTS_EVENT.ConnectionFinished,
]);
const CONNECTION_RESPONSE_EVENTS = new Set<number>([
  VOLCENGINE_TTS_EVENT.ConnectionStarted,
  VOLCENGINE_TTS_EVENT.ConnectionFailed,
  VOLCENGINE_TTS_EVENT.ConnectionFinished,
]);

export interface VolcengineTtsFrame {
  compression: number;
  connectId?: string;
  errorCode?: number;
  event?: number;
  flags: number;
  headerSize: number;
  messageType: number;
  payload: Uint8Array;
  sequence?: number;
  serialization: number;
  sessionId?: string;
  version: number;
}

export function encodeVolcengineTtsFrame(input: {
  connectId?: string;
  event: number;
  messageType: number;
  payload: Uint8Array;
  sessionId?: string;
}) {
  const fields: Uint8Array[] = [
    Uint8Array.from([
      0x11,
      (input.messageType << 4) | WITH_EVENT,
      (JSON_SERIALIZATION << 4) | NO_COMPRESSION,
      0,
    ]),
    signedInt32(input.event),
  ];
  if (!CONNECTION_EVENTS_WITHOUT_SESSION.has(input.event)) {
    fields.push(lengthPrefixed(new TextEncoder().encode(input.sessionId ?? '')));
  }
  if (CONNECTION_RESPONSE_EVENTS.has(input.event)) {
    fields.push(lengthPrefixed(new TextEncoder().encode(input.connectId ?? '')));
  }
  fields.push(lengthPrefixed(input.payload));
  return concatenate(fields);
}

export function decodeVolcengineTtsFrame(data: Uint8Array): VolcengineTtsFrame {
  if (data.byteLength < 4) {
    throw new Error('Volcengine TTS frame must contain at least 4 bytes.');
  }
  const version = data[0]! >> 4;
  const headerSize = (data[0]! & 0x0f) * 4;
  if (headerSize < 4 || headerSize > data.byteLength) {
    throw new Error('Volcengine TTS frame header size is invalid.');
  }
  const messageType = data[1]! >> 4;
  const flags = data[1]! & 0x0f;
  const serialization = data[2]! >> 4;
  const compression = data[2]! & 0x0f;
  if (compression !== NO_COMPRESSION) {
    throw new Error('Compressed Volcengine TTS frames are unsupported.');
  }
  let offset = headerSize;
  let sequence: number | undefined;
  let errorCode: number | undefined;
  if (flags === 0b0001 || flags === 0b0011) {
    [sequence, offset] = readSignedInt32(data, offset, 'sequence');
  }
  if (messageType === VOLCENGINE_TTS_MESSAGE_TYPE.Error) {
    [errorCode, offset] = readUnsignedInt32(data, offset, 'error code');
  }
  let event: number | undefined;
  let sessionId: string | undefined;
  let connectId: string | undefined;
  if (flags === WITH_EVENT) {
    [event, offset] = readSignedInt32(data, offset, 'event');
    if (!CONNECTION_EVENTS_WITHOUT_SESSION.has(event)) {
      [sessionId, offset] = readString(data, offset, 'session id');
    }
    if (CONNECTION_RESPONSE_EVENTS.has(event)) {
      [connectId, offset] = readString(data, offset, 'connect id');
    }
  }
  const [payloadLength, payloadOffset] = readUnsignedInt32(
    data,
    offset,
    'payload length',
  );
  const payloadEnd = payloadOffset + payloadLength;
  if (payloadEnd !== data.byteLength) {
    throw new Error('Volcengine TTS frame payload length does not match bytes.');
  }
  return {
    compression,
    ...(connectId ? { connectId } : {}),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(event === undefined ? {} : { event }),
    flags,
    headerSize,
    messageType,
    payload: Uint8Array.from(data.subarray(payloadOffset, payloadEnd)),
    ...(sequence === undefined ? {} : { sequence }),
    serialization,
    ...(sessionId ? { sessionId } : {}),
    version,
  };
}

function signedInt32(value: number) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, false);
  return bytes;
}

function unsignedInt32(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error('Volcengine TTS frame field exceeds uint32.');
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function lengthPrefixed(value: Uint8Array) {
  return concatenate([unsignedInt32(value.byteLength), value]);
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

function readSignedInt32(
  data: Uint8Array,
  offset: number,
  field: string,
): [number, number] {
  requireBytes(data, offset, 4, field);
  return [new DataView(data.buffer, data.byteOffset + offset, 4).getInt32(0), offset + 4];
}

function readUnsignedInt32(
  data: Uint8Array,
  offset: number,
  field: string,
): [number, number] {
  requireBytes(data, offset, 4, field);
  return [
    new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0),
    offset + 4,
  ];
}

function readString(
  data: Uint8Array,
  offset: number,
  field: string,
): [string, number] {
  const [length, valueOffset] = readUnsignedInt32(data, offset, `${field} length`);
  requireBytes(data, valueOffset, length, field);
  return [
    new TextDecoder('utf-8', { fatal: true }).decode(
      data.slice(valueOffset, valueOffset + length),
    ),
    valueOffset + length,
  ];
}

function requireBytes(
  data: Uint8Array,
  offset: number,
  length: number,
  field: string,
) {
  if (length < 0 || offset < 0 || offset + length > data.byteLength) {
    throw new Error(`Volcengine TTS frame ${field} is truncated.`);
  }
}
