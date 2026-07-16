import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ProviderSafeFetch,
  type SafeFetchTransportPort,
} from './provider-safe-fetch.js';

function body(bytes: number[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield new Uint8Array(bytes);
    },
  };
}

function transport(
  handler: SafeFetchTransportPort['request'],
): SafeFetchTransportPort {
  return { request: handler };
}

test('rejects when any DNS answer is private or metadata scoped', async () => {
  let requested = false;
  const safeFetch = new ProviderSafeFetch({
    allowedHosts: ['cdn.provider.test'],
    resolver: {
      resolve: async () => ['93.184.216.34', '169.254.169.254'],
    },
    transport: transport(async () => {
      requested = true;
      throw new Error('must not request');
    }),
  });

  await assert.rejects(
    safeFetch.get('https://cdn.provider.test/result.png', {
      allowedMimeTypes: ['image/png'],
      maxBytes: 1024,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'SAFE_FETCH_PRIVATE_ADDRESS',
  );
  assert.equal(requested, false);
});

test('pins transport to validated DNS answers and accepts a verified PNG', async () => {
  const requests: Array<{ addresses: string[]; headers: Record<string, string> }> = [];
  const safeFetch = new ProviderSafeFetch({
    allowedHosts: ['cdn.provider.test'],
    resolver: { resolve: async () => ['93.184.216.34'] },
    transport: transport(async (input) => {
      requests.push({
        addresses: input.allowedAddresses,
        headers: input.headers,
      });
      return {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': '8',
        },
        body: body([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      };
    }),
  });

  const result = await safeFetch.get('https://cdn.provider.test/result.png', {
    allowedMimeTypes: ['image/png'],
    maxBytes: 1024,
  });
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.bytes.byteLength, 8);
  assert.deepEqual(requests, [
    { addresses: ['93.184.216.34'], headers: { accept: 'image/png' } },
  ]);
});

test('revalidates every redirect and rejects a disallowed target', async () => {
  let calls = 0;
  const safeFetch = new ProviderSafeFetch({
    allowedHosts: ['cdn.provider.test'],
    resolver: { resolve: async () => ['93.184.216.34'] },
    transport: transport(async () => {
      calls += 1;
      return {
        status: 302,
        headers: { location: 'https://attacker.test/steal' },
        body: body([]),
      };
    }),
  });

  await assert.rejects(
    safeFetch.get('https://cdn.provider.test/result.png', {
      allowedMimeTypes: ['image/png'],
      maxBytes: 1024,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'SAFE_FETCH_HOST_FORBIDDEN',
  );
  assert.equal(calls, 1);
});

test('keeps provider authorization on its exact host and drops it across redirects', async () => {
  const requests: Array<{ host: string; headers: Record<string, string> }> = [];
  const safeFetch = new ProviderSafeFetch({
    allowedHosts: ['api.provider.test', 'cdn.provider.test'],
    resolver: { resolve: async () => ['93.184.216.34'] },
    transport: transport(async (input) => {
      requests.push({ host: input.url.hostname, headers: input.headers });
      if (input.url.hostname === 'api.provider.test') {
        return {
          status: 302,
          headers: {
            location: 'https://cdn.provider.test/result.png',
          } as Record<string, string>,
          body: body([]),
        };
      }
      return {
        status: 200,
        headers: { 'content-type': 'image/png' } as Record<string, string>,
        body: body([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      };
    }),
  });

  await safeFetch.get('https://api.provider.test/result.png', {
    allowedMimeTypes: ['image/png'],
    authorization: {
      host: 'api.provider.test',
      value: 'Bearer provider-secret',
    },
    maxBytes: 1024,
  });

  assert.deepEqual(requests, [
    {
      host: 'api.provider.test',
      headers: {
        accept: 'image/png',
        authorization: 'Bearer provider-secret',
      },
    },
    { host: 'cdn.provider.test', headers: { accept: 'image/png' } },
  ]);
});

test('enforces declared and streamed size limits', async () => {
  const declared = new ProviderSafeFetch({
    allowedHosts: ['cdn.provider.test'],
    resolver: { resolve: async () => ['93.184.216.34'] },
    transport: transport(async () => ({
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': '5000' },
      body: body([]),
    })),
  });
  await assert.rejects(
    declared.get('https://cdn.provider.test/result.png', {
      allowedMimeTypes: ['image/png'],
      maxBytes: 1024,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'SAFE_FETCH_TOO_LARGE',
  );

  const streamed = new ProviderSafeFetch({
    allowedHosts: ['cdn.provider.test'],
    resolver: { resolve: async () => ['93.184.216.34'] },
    transport: transport(async () => ({
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: body([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0]),
    })),
  });
  await assert.rejects(
    streamed.get('https://cdn.provider.test/result.png', {
      allowedMimeTypes: ['image/png'],
      maxBytes: 8,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'SAFE_FETCH_TOO_LARGE',
  );
});

test('rejects MIME confusion even when the response claims an allowed type', async () => {
  const safeFetch = new ProviderSafeFetch({
    allowedHosts: ['cdn.provider.test'],
    resolver: { resolve: async () => ['93.184.216.34'] },
    transport: transport(async () => ({
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: body([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]),
    })),
  });

  await assert.rejects(
    safeFetch.get('https://cdn.provider.test/result.png', {
      allowedMimeTypes: ['image/png'],
      maxBytes: 1024,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'SAFE_FETCH_MAGIC_MISMATCH',
  );
});

test('fails closed when the configured concurrency limit is exhausted', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const safeFetch = new ProviderSafeFetch({
    allowedHosts: ['cdn.provider.test'],
    maxConcurrency: 1,
    resolver: { resolve: async () => ['93.184.216.34'] },
    transport: transport(async () => {
      await pending;
      return {
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: body([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      };
    }),
  });
  const first = safeFetch.get('https://cdn.provider.test/first.png', {
    allowedMimeTypes: ['image/png'],
    maxBytes: 1024,
  });
  await assert.rejects(
    safeFetch.get('https://cdn.provider.test/second.png', {
      allowedMimeTypes: ['image/png'],
      maxBytes: 1024,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'SAFE_FETCH_CONCURRENCY_LIMIT',
  );
  release();
  await first;
});
