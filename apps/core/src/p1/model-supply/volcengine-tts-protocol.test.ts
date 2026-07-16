import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeVolcengineTtsFrame,
  encodeVolcengineTtsFrame,
  VOLCENGINE_TTS_EVENT,
  VOLCENGINE_TTS_MESSAGE_TYPE,
} from './volcengine-tts-protocol.js';

test('encodes the documented StartConnection binary frame', () => {
  const frame = encodeVolcengineTtsFrame({
    event: VOLCENGINE_TTS_EVENT.StartConnection,
    messageType: VOLCENGINE_TTS_MESSAGE_TYPE.FullClientRequest,
    payload: new TextEncoder().encode('{}'),
  });

  assert.equal(
    Buffer.from(frame).toString('hex'),
    '1114100000000001000000027b7d',
  );
});

test('encodes session ids only for session-scoped client events', () => {
  const frame = encodeVolcengineTtsFrame({
    event: VOLCENGINE_TTS_EVENT.StartSession,
    messageType: VOLCENGINE_TTS_MESSAGE_TYPE.FullClientRequest,
    payload: new TextEncoder().encode('{}'),
    sessionId: 's1',
  });

  assert.equal(
    Buffer.from(frame).toString('hex'),
    '1114100000000064000000027331000000027b7d',
  );
});

test('decodes documented connection and audio server frames', () => {
  const connection = decodeVolcengineTtsFrame(
    Buffer.from('1194100000000032000000026331000000027b7d', 'hex'),
  );
  assert.deepEqual(connection, {
    compression: 0,
    connectId: 'c1',
    event: VOLCENGINE_TTS_EVENT.ConnectionStarted,
    flags: 4,
    headerSize: 4,
    messageType: VOLCENGINE_TTS_MESSAGE_TYPE.FullServerResponse,
    payload: Uint8Array.from([0x7b, 0x7d]),
    serialization: 1,
    version: 1,
  });

  const audio = encodeVolcengineTtsFrame({
    event: VOLCENGINE_TTS_EVENT.TTSResponse,
    messageType: VOLCENGINE_TTS_MESSAGE_TYPE.AudioOnlyServer,
    payload: Uint8Array.from([1, 2, 3]),
    sessionId: 's1',
  });
  assert.deepEqual(decodeVolcengineTtsFrame(audio), {
    compression: 0,
    event: VOLCENGINE_TTS_EVENT.TTSResponse,
    flags: 4,
    headerSize: 4,
    messageType: VOLCENGINE_TTS_MESSAGE_TYPE.AudioOnlyServer,
    payload: Uint8Array.from([1, 2, 3]),
    serialization: 1,
    sessionId: 's1',
    version: 1,
  });
});

test('rejects truncated and length-mismatched frames', () => {
  assert.throws(
    () => decodeVolcengineTtsFrame(Uint8Array.from([0x11, 0x94, 0x10])),
    /at least 4 bytes/u,
  );
  assert.throws(
    () =>
      decodeVolcengineTtsFrame(
        Buffer.from('1114100000000001000000037b7d', 'hex'),
      ),
    /payload length/u,
  );
});
