import assert from 'node:assert/strict';
import test from 'node:test';

import { coreProxyResponse, coreProxyResponseHeaders } from './core-stream';

test('preserves AI stream protocol and correlation headers', () => {
  const headers = coreProxyResponseHeaders(
    new Headers({
      'cache-control': 'public, max-age=60',
      'content-type': 'text/event-stream; charset=utf-8',
      'x-correlation-id': 'corr-123',
      'x-meiye-catalog-model-id': 'llm-openai',
      'x-meiye-e2e-agent-fault-applied': 'artifact-gap-close',
      'x-meiye-stream-protocol': 'ai-sdk-ui-message-v1',
      'x-vercel-ai-ui-message-stream': 'v1',
      'x-private-upstream': 'secret',
    })
  );

  assert.equal(headers.get('cache-control'), 'no-store');
  assert.equal(headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.equal(headers.get('x-correlation-id'), 'corr-123');
  assert.equal(headers.get('x-meiye-catalog-model-id'), 'llm-openai');
  assert.equal(
    headers.get('x-meiye-e2e-agent-fault-applied'),
    'artifact-gap-close'
  );
  assert.equal(headers.get('x-meiye-stream-protocol'), 'ai-sdk-ui-message-v1');
  assert.equal(headers.get('x-vercel-ai-ui-message-stream'), 'v1');
  assert.equal(headers.get('content-encoding'), 'identity');
  assert.equal(headers.get('x-accel-buffering'), 'no');
  assert.equal(headers.has('x-private-upstream'), false);
});

test('defaults ordinary Core responses to JSON without adding stream markers', () => {
  const headers = coreProxyResponseHeaders(new Headers());
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.has('content-encoding'), false);
  assert.equal(headers.has('x-vercel-ai-ui-message-stream'), false);
});

test('SSE content type disables buffering even without an auxiliary protocol header', () => {
  const headers = coreProxyResponseHeaders(
    new Headers({ 'content-type': 'text/event-stream; charset=utf-8' })
  );

  assert.equal(headers.get('content-encoding'), 'identity');
  assert.equal(headers.get('x-accel-buffering'), 'no');
});

test('exposes the first upstream chunk before the stream closes', async () => {
  const encoder = new TextEncoder();
  let sendSecondChunk: (() => void) | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('第一段'));
      sendSecondChunk = () => {
        controller.enqueue(encoder.encode('第二段'));
        controller.close();
      };
    },
  });
  const response = coreProxyResponse(
    new Response(body, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  );
  const reader = response.body?.getReader();
  assert.ok(reader);

  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), '第一段');
  assert.equal(first.done, false);

  assert.ok(sendSecondChunk);
  sendSecondChunk();
  const second = await reader.read();
  assert.equal(new TextDecoder().decode(second.value), '第二段');
});

test('cancels the upstream reader when the downstream client disconnects', async () => {
  let resolveDisconnected: (reason: unknown) => void = () => {};
  const disconnected = new Promise<unknown>((resolve) => {
    resolveDisconnected = resolve;
  });
  const upstream = new Response(
    new ReadableStream<Uint8Array>({
      cancel(reason) {
        resolveDisconnected(reason);
      },
    })
  );
  const response = coreProxyResponse(upstream);
  const reason = new Error('client disconnected');

  await response.body?.cancel(reason);

  assert.equal(await disconnected, reason);
});
