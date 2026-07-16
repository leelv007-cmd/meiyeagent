import WebSocket, { type RawData } from 'ws';
import type {
  VolcengineTtsSocket,
  VolcengineTtsSocketFactory,
} from './volcengine-tts-adapter.js';

const DEFAULT_OPEN_TIMEOUT_MS = 15_000;
const DEFAULT_RECEIVE_TIMEOUT_MS = 120_000;
const MAX_FRAME_BYTES = 26 * 1024 * 1024;

export class NodeVolcengineTtsSocketFactory
  implements VolcengineTtsSocketFactory
{
  private readonly openTimeoutMs: number;
  private readonly receiveTimeoutMs: number;

  constructor(
    options: { openTimeoutMs?: number; receiveTimeoutMs?: number } = {},
  ) {
    this.openTimeoutMs = positiveTimeout(
      options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS,
      'WebSocket open timeout',
    );
    this.receiveTimeoutMs = positiveTimeout(
      options.receiveTimeoutMs ?? DEFAULT_RECEIVE_TIMEOUT_MS,
      'WebSocket receive timeout',
    );
  }

  async connect(input: {
    headers: Readonly<Record<string, string>>;
    url: string;
  }): Promise<VolcengineTtsSocket> {
    const socket = new WebSocket(input.url, {
      headers: { ...input.headers },
      maxPayload: MAX_FRAME_BYTES,
      perMessageDeflate: false,
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        socket.terminate();
        reject(new Error('Volcengine TTS WebSocket open timed out.'));
      }, this.openTimeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        socket.off('open', opened);
        socket.off('error', failed);
      };
      const opened = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error('Volcengine TTS WebSocket could not be opened.'));
      };
      socket.once('open', opened);
      socket.once('error', failed);
    });
    return new NodeVolcengineTtsSocket(socket, this.receiveTimeoutMs);
  }
}

class NodeVolcengineTtsSocket implements VolcengineTtsSocket {
  private readonly queue: Uint8Array[] = [];
  private readonly waiters: Array<{
    reject(error: Error): void;
    resolve(value: Uint8Array): void;
    timeout: NodeJS.Timeout;
  }> = [];
  private closed = false;
  private failure: Error | undefined;

  constructor(
    private readonly socket: WebSocket,
    private readonly receiveTimeoutMs: number,
  ) {
    socket.on('message', (data, isBinary) => {
      if (!isBinary) {
        this.fail(new Error('Volcengine TTS returned a text WebSocket frame.'));
        return;
      }
      this.push(rawDataBytes(data));
    });
    socket.on('error', () => {
      this.fail(new Error('Volcengine TTS WebSocket transport failed.'));
    });
    socket.on('close', () => {
      this.closed = true;
      if (this.waiters.length > 0) {
        this.fail(new Error('Volcengine TTS WebSocket closed before a response.'));
      }
    });
  }

  async send(frame: Uint8Array) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Volcengine TTS WebSocket is not open.');
    }
    await new Promise<void>((resolve, reject) => {
      this.socket.send(frame, { binary: true }, (error) => {
        if (error) {
          reject(new Error('Volcengine TTS WebSocket send failed.'));
        } else {
          resolve();
        }
      });
    });
  }

  async receive() {
    const queued = this.queue.shift();
    if (queued) return queued;
    if (this.failure) throw this.failure;
    if (this.closed) {
      throw new Error('Volcengine TTS WebSocket is closed.');
    }
    return new Promise<Uint8Array>((resolve, reject) => {
      const waiter = {
        reject,
        resolve,
        timeout: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error('Volcengine TTS WebSocket receive timed out.'));
        }, this.receiveTimeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.socket.terminate();
        resolve();
      }, 1_000);
      this.socket.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.socket.close();
    });
  }

  private push(value: Uint8Array) {
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timeout);
      waiter.resolve(value);
    } else {
      this.queue.push(value);
    }
  }

  private fail(error: Error) {
    this.failure ??= error;
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timeout);
      waiter.reject(this.failure);
    }
  }
}

function rawDataBytes(data: RawData) {
  if (Array.isArray(data)) {
    return Uint8Array.from(Buffer.concat(data));
  }
  return data instanceof ArrayBuffer
    ? Uint8Array.from(new Uint8Array(data))
    : Uint8Array.from(data);
}

function positiveTimeout(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
