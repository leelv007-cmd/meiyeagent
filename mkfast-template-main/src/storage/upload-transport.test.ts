import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PayloadTooLargeError,
  readBoundedRequestBody,
} from './upload-transport';

test('declared oversized upload bodies are rejected before reading the stream', async () => {
  let readerRequested = false;
  const request = {
    body: {
      getReader() {
        readerRequested = true;
        throw new Error('body should not be read');
      },
    },
    headers: new Headers({ 'content-length': '11' }),
  } as unknown as Request;

  await assert.rejects(
    readBoundedRequestBody(request, 10),
    PayloadTooLargeError
  );
  assert.equal(readerRequested, false);
});

test('streamed upload bodies are rejected before form parsing when they cross the limit', async () => {
  const request = new Request('https://example.test/api/storage/upload', {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    }),
    duplex: 'half',
    headers: { 'content-type': 'multipart/form-data; boundary=test' },
    method: 'POST',
  } as RequestInit & { duplex: 'half' });

  await assert.rejects(
    readBoundedRequestBody(request, 10),
    PayloadTooLargeError
  );
});
