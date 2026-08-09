import type { IncomingMessage, ServerResponse } from 'node:http';
import { type HttpErrorFallback, withErrorEnvelope } from './http-errors.js';

interface SseSource {
  ready(): Promise<void>;
  signal: AbortSignal;
  write(frame: string): Promise<void>;
}

export async function streamSse(input: {
  additionalResponseHeaders?: Readonly<Record<string, string>>;
  disconnectMessage: string;
  encodeStreamError?: (error: unknown) => string;
  errorFallback: HttpErrorFallback;
  heartbeatMs: number;
  observeRequestClose?: boolean;
  protocol: string;
  request: IncomingMessage;
  requestCorrelationId: string;
  response: ServerResponse;
  source(stream: SseSource): Promise<void>;
}) {
  const abortController = new AbortController();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let heartbeatInFlight = false;
  let writer: SseWriter | undefined;
  const disconnect = () => {
    if (!abortController.signal.aborted) {
      abortController.abort(new Error(input.disconnectMessage));
    }
  };
  input.request.once('aborted', disconnect);
  if (input.observeRequestClose) input.request.once('close', disconnect);
  input.response.once('close', disconnect);

  try {
    await withErrorEnvelope(
      async () => {
        const ready = async () => {
          if (writer) return;
          if (abortController.signal.aborted) {
            throw new Error(`${input.disconnectMessage} before start.`);
          }
          input.response.writeHead(200, {
            ...input.additionalResponseHeaders,
            'cache-control': 'no-cache, no-transform',
            connection: 'keep-alive',
            'content-type': 'text/event-stream; charset=utf-8',
            'x-accel-buffering': 'no',
            'x-correlation-id': input.requestCorrelationId,
            'x-meiye-stream-protocol': input.protocol,
          });
          writer = new SseWriter(input.response, abortController.signal);
          await write(': heartbeat\n\n');
          heartbeat = setInterval(() => {
            if (
              heartbeatInFlight ||
              abortController.signal.aborted ||
              !writer
            ) {
              return;
            }
            heartbeatInFlight = true;
            void writer
              .write(': heartbeat\n\n')
              .then((written) => {
                if (!written && !abortController.signal.aborted) disconnect();
              })
              .finally(() => {
                heartbeatInFlight = false;
              });
          }, input.heartbeatMs);
        };
        const write = async (frame: string) => {
          if (!writer || !(await writer.write(frame))) {
            disconnect();
            throw new Error('SSE response is no longer writable.');
          }
        };
        await input.source({
          ready,
          signal: abortController.signal,
          write,
        });
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
        await writer?.flush();
        if (!input.response.writableEnded) input.response.end();
      },
      {
        fallback: input.errorFallback,
        onHeadersSent: async (error) => {
          if (abortController.signal.aborted) return;
          if (!input.encodeStreamError || !writer) {
            input.response.destroy();
            return;
          }
          await writer.write(input.encodeStreamError(error));
          if (!input.response.writableEnded) input.response.end();
        },
        requestCorrelationId: input.requestCorrelationId,
        response: input.response,
      }
    );
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    input.request.off('aborted', disconnect);
    if (input.observeRequestClose) input.request.off('close', disconnect);
    input.response.off('close', disconnect);
    if (!abortController.signal.aborted) abortController.abort();
  }
}

class SseWriter {
  private pending: Promise<boolean> = Promise.resolve(true);

  constructor(
    private readonly response: ServerResponse,
    private readonly signal: AbortSignal
  ) {}

  write(chunk: string) {
    this.pending = this.pending.then((previousWriteSucceeded) => {
      if (!previousWriteSucceeded || this.signal.aborted) return false;
      return writeSseChunk(this.response, chunk, this.signal);
    });
    return this.pending;
  }

  flush() {
    return this.pending;
  }
}

async function writeSseChunk(
  response: ServerResponse,
  chunk: string,
  signal: AbortSignal
) {
  if (signal.aborted || response.destroyed || response.writableEnded) {
    return false;
  }
  try {
    if (response.write(chunk)) return true;
  } catch {
    return false;
  }
  return waitForSseDrain(response, signal);
}

function waitForSseDrain(response: ServerResponse, signal: AbortSignal) {
  if (signal.aborted || response.destroyed || response.writableEnded) {
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve) => {
    const cleanup = () => {
      response.off('close', onClose);
      response.off('drain', onDrain);
      response.off('error', onClose);
      signal.removeEventListener('abort', onClose);
    };
    const settle = (written: boolean) => {
      cleanup();
      resolve(written);
    };
    const onClose = () => settle(false);
    const onDrain = () => settle(true);
    response.once('close', onClose);
    response.once('drain', onDrain);
    response.once('error', onClose);
    signal.addEventListener('abort', onClose, { once: true });
  });
}
