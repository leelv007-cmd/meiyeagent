import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VolcengineBidirectionalTtsAdapter,
  type VolcengineTtsSocket,
  type VolcengineTtsSocketFactory,
} from './volcengine-tts-adapter.js';
import {
  decodeVolcengineTtsFrame,
  encodeVolcengineTtsFrame,
  VOLCENGINE_TTS_EVENT,
  VOLCENGINE_TTS_MESSAGE_TYPE,
} from './volcengine-tts-protocol.js';

const encoder = new TextEncoder();

function serverFrame(input: {
  event: number;
  messageType?: number;
  payload?: Uint8Array;
  sessionId?: string;
}) {
  return encodeVolcengineTtsFrame({
    event: input.event,
    messageType:
      input.messageType ?? VOLCENGINE_TTS_MESSAGE_TYPE.FullServerResponse,
    payload: input.payload ?? encoder.encode('{}'),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  });
}

class RecordedSocket implements VolcengineTtsSocket {
  readonly actions: string[] = [];
  readonly sent: Uint8Array[] = [];
  closed = false;

  constructor(private readonly incoming: Uint8Array[]) {}

  async send(frame: Uint8Array) {
    this.sent.push(Uint8Array.from(frame));
    this.actions.push(`send:${decodeVolcengineTtsFrame(frame).event}`);
  }

  async receive() {
    const frame = this.incoming.shift();
    if (!frame) throw new Error('No recorded provider frame remains.');
    this.actions.push(`receive:${decodeVolcengineTtsFrame(frame).event}`);
    return frame;
  }

  async close() {
    this.closed = true;
  }
}

test('streams text through the documented lifecycle and concatenates audio', async () => {
  const socket = new RecordedSocket([
    serverFrame({ event: VOLCENGINE_TTS_EVENT.ConnectionStarted }),
    serverFrame({
      event: VOLCENGINE_TTS_EVENT.SessionStarted,
      sessionId: 'session-id',
    }),
    serverFrame({
      event: VOLCENGINE_TTS_EVENT.TTSSentenceStart,
      sessionId: 'session-id',
    }),
    serverFrame({
      event: VOLCENGINE_TTS_EVENT.TTSResponse,
      messageType: VOLCENGINE_TTS_MESSAGE_TYPE.AudioOnlyServer,
      payload: Uint8Array.from([1, 2]),
      sessionId: 'session-id',
    }),
    serverFrame({
      event: VOLCENGINE_TTS_EVENT.TTSResponse,
      messageType: VOLCENGINE_TTS_MESSAGE_TYPE.AudioOnlyServer,
      payload: Uint8Array.from([3, 4]),
      sessionId: 'session-id',
    }),
    serverFrame({
      event: VOLCENGINE_TTS_EVENT.TTSSentenceEnd,
      sessionId: 'session-id',
    }),
    serverFrame({
      event: VOLCENGINE_TTS_EVENT.UsageResponse,
      payload: encoder.encode(JSON.stringify({ usage: { text_words: 6 } })),
      sessionId: 'session-id',
    }),
    serverFrame({
      event: VOLCENGINE_TTS_EVENT.TTSEnded,
      sessionId: 'session-id',
    }),
    serverFrame({
      event: VOLCENGINE_TTS_EVENT.SessionFinished,
      sessionId: 'session-id',
    }),
    serverFrame({ event: VOLCENGINE_TTS_EVENT.ConnectionFinished }),
  ]);
  let connection:
    | { headers: Readonly<Record<string, string>>; url: string }
    | undefined;
  const socketFactory: VolcengineTtsSocketFactory = {
    async connect(input) {
      connection = input;
      return socket;
    },
  };
  const ids = ['connect-id', 'session-id'];
  const adapter = new VolcengineBidirectionalTtsAdapter({
    auth: { apiKey: 'fixture-key', kind: 'api_key' },
    defaultSpeaker: 'fixture-speaker',
    nextId: () => ids.shift() ?? 'unexpected-id',
    resourceId: 'seed-tts-2.0',
    socketFactory,
  });

  const result = await adapter.synthesize({
    format: 'mp3',
    language: 'zh-CN',
    sampleRate: 24_000,
    speed: 1.25,
    text: '欢迎体验。',
  });

  assert.deepEqual(connection, {
    headers: {
      'X-Api-Connect-Id': 'connect-id',
      'X-Api-Key': 'fixture-key',
      'X-Api-Resource-Id': 'seed-tts-2.0',
      'X-Control-Require-Usage-Tokens-Return': '*',
    },
    url: 'wss://openspeech.bytedance.com/api/v3/tts/bidirection',
  });
  assert.deepEqual(result, {
    billedTextWords: 6,
    bytes: Uint8Array.from([1, 2, 3, 4]),
    contentType: 'audio/mpeg',
  });
  assert.equal(socket.closed, true);
  assert.deepEqual(socket.actions, [
    `send:${VOLCENGINE_TTS_EVENT.StartConnection}`,
    `receive:${VOLCENGINE_TTS_EVENT.ConnectionStarted}`,
    `send:${VOLCENGINE_TTS_EVENT.StartSession}`,
    `receive:${VOLCENGINE_TTS_EVENT.SessionStarted}`,
    `send:${VOLCENGINE_TTS_EVENT.TaskRequest}`,
    `receive:${VOLCENGINE_TTS_EVENT.TTSSentenceStart}`,
    `send:${VOLCENGINE_TTS_EVENT.FinishSession}`,
    `receive:${VOLCENGINE_TTS_EVENT.TTSResponse}`,
    `receive:${VOLCENGINE_TTS_EVENT.TTSResponse}`,
    `receive:${VOLCENGINE_TTS_EVENT.TTSSentenceEnd}`,
    `receive:${VOLCENGINE_TTS_EVENT.UsageResponse}`,
    `receive:${VOLCENGINE_TTS_EVENT.TTSEnded}`,
    `receive:${VOLCENGINE_TTS_EVENT.SessionFinished}`,
    `send:${VOLCENGINE_TTS_EVENT.FinishConnection}`,
    `receive:${VOLCENGINE_TTS_EVENT.ConnectionFinished}`,
  ]);

  const sent = socket.sent.map(decodeVolcengineTtsFrame);
  assert.deepEqual(
    sent.map(({ event }) => event),
    [
      VOLCENGINE_TTS_EVENT.StartConnection,
      VOLCENGINE_TTS_EVENT.StartSession,
      VOLCENGINE_TTS_EVENT.TaskRequest,
      VOLCENGINE_TTS_EVENT.FinishSession,
      VOLCENGINE_TTS_EVENT.FinishConnection,
    ],
  );
  assert.deepEqual(JSON.parse(Buffer.from(sent[1]!.payload).toString('utf8')), {
    req_params: {
      audio_params: {
        format: 'mp3',
        sample_rate: 24_000,
        speech_rate: 25,
      },
      explicit_language: 'zh-cn',
      model: 'seed-tts-2.0-standard',
      speaker: 'fixture-speaker',
    },
  });
  assert.deepEqual(JSON.parse(Buffer.from(sent[2]!.payload).toString('utf8')), {
    req_params: { text: '欢迎体验。' },
  });
});

test('rejects provider audio that exceeds the owned-audio size contract', async () => {
  const socket = new RecordedSocket([
    serverFrame({ event: VOLCENGINE_TTS_EVENT.ConnectionStarted }),
    serverFrame({
      event: VOLCENGINE_TTS_EVENT.SessionStarted,
      sessionId: 'session-id',
    }),
    serverFrame({
      event: VOLCENGINE_TTS_EVENT.TTSResponse,
      messageType: VOLCENGINE_TTS_MESSAGE_TYPE.AudioOnlyServer,
      payload: new Uint8Array(25 * 1024 * 1024 + 1),
      sessionId: 'session-id',
    }),
  ]);
  const adapter = new VolcengineBidirectionalTtsAdapter({
    auth: { apiKey: 'fixture-key', kind: 'api_key' },
    defaultSpeaker: 'fixture-speaker',
    nextId: (() => {
      const ids = ['connect-id', 'session-id'];
      return () => ids.shift() ?? 'unexpected-id';
    })(),
    resourceId: 'seed-tts-2.0',
    socketFactory: { connect: async () => socket },
  });

  await assert.rejects(
    adapter.synthesize({ format: 'mp3', text: '测试' }),
    /size limit/u,
  );
  assert.equal(socket.closed, true);
});

test('fails closed on a provider session failure and always closes the socket', async () => {
  const socket = new RecordedSocket([
    serverFrame({ event: VOLCENGINE_TTS_EVENT.ConnectionStarted }),
    serverFrame({
      event: VOLCENGINE_TTS_EVENT.SessionFailed,
      payload: encoder.encode(JSON.stringify({ error: 'fixture failure' })),
      sessionId: 'session-id',
    }),
  ]);
  const adapter = new VolcengineBidirectionalTtsAdapter({
    auth: { apiKey: 'fixture-key', kind: 'api_key' },
    defaultSpeaker: 'fixture-speaker',
    nextId: (() => {
      const ids = ['connect-id', 'session-id'];
      return () => ids.shift() ?? 'unexpected-id';
    })(),
    resourceId: 'seed-tts-2.0',
    socketFactory: { connect: async () => socket },
  });

  await assert.rejects(
    adapter.synthesize({ format: 'mp3', text: '测试' }),
    /SessionFailed/u,
  );
  assert.equal(socket.closed, true);
});

test('preserves the numeric provider error code without exposing its payload', async () => {
  const frame = Uint8Array.from([
    0x11, 0xf0, 0x10, 0x00,
    0x00, 0x00, 0x11, 0x5c,
    0x00, 0x00, 0x00, 0x12,
    ...encoder.encode('sensitive response'),
  ]);
  const socket = new RecordedSocket([
    serverFrame({ event: VOLCENGINE_TTS_EVENT.ConnectionStarted }),
    serverFrame({
      event: VOLCENGINE_TTS_EVENT.SessionStarted,
      sessionId: 'session-id',
    }),
    frame,
  ]);
  const adapter = new VolcengineBidirectionalTtsAdapter({
    auth: { apiKey: 'fixture-key', kind: 'api_key' },
    defaultSpeaker: 'fixture-speaker',
    nextId: (() => {
      const ids = ['connect-id', 'session-id'];
      return () => ids.shift() ?? 'unexpected-id';
    })(),
    resourceId: 'seed-tts-2.0',
    socketFactory: { connect: async () => socket },
  });

  await assert.rejects(
    adapter.synthesize({ format: 'mp3', text: '测试' }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(
        (error as { providerErrorCode?: number }).providerErrorCode,
        4_444,
      );
      assert.doesNotMatch(error.message, /sensitive response/u);
      return true;
    },
  );
});

test('rejects undocumented language and sample rate values before connecting', async () => {
  let connected = false;
  const adapter = new VolcengineBidirectionalTtsAdapter({
    auth: { apiKey: 'fixture-key', kind: 'api_key' },
    defaultSpeaker: 'fixture-speaker',
    resourceId: 'seed-tts-2.0',
    socketFactory: {
      async connect() {
        connected = true;
        throw new Error('must not connect');
      },
    },
  });

  await assert.rejects(
    adapter.synthesize({
      format: 'mp3',
      language: 'xx-XX',
      text: '测试',
    }),
    /language/u,
  );
  await assert.rejects(
    adapter.synthesize({
      format: 'mp3',
      sampleRate: 12_345 as 24_000,
      text: '测试',
    }),
    /sample rate/u,
  );
  assert.equal(connected, false);
});

test('uses the documented legacy TTS headers without sending a secret key', async () => {
  let headers: Readonly<Record<string, string>> | undefined;
  const adapter = new VolcengineBidirectionalTtsAdapter({
    auth: {
      accessToken: 'fixture-access-token',
      appId: 'fixture-app-id',
      kind: 'legacy',
    },
    defaultSpeaker: 'fixture-speaker',
    nextId: () => 'request-id',
    resourceId: 'seed-tts-2.0',
    socketFactory: {
      async connect(input) {
        headers = input.headers;
        throw new Error('recorded stop');
      },
    },
  });

  await assert.rejects(
    adapter.synthesize({ format: 'mp3', text: '测试' }),
    /recorded stop/u,
  );
  assert.deepEqual(headers, {
    'X-Api-Access-Key': 'fixture-access-token',
    'X-Api-App-Id': 'fixture-app-id',
    'X-Api-Connect-Id': 'request-id',
    'X-Api-Request-Id': 'request-id',
    'X-Api-Resource-Id': 'seed-tts-2.0',
    'X-Control-Require-Usage-Tokens-Return': '*',
  });
});
