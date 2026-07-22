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

test('rejects private IPv4-mapped IPv6 representations before transport', async () => {
  const mappedAddresses = [
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:7f00:1',
    '0:0:0:0::ffff:7f00:1',
    '0:0:0::ffff:7f00:1',
    '0:0::ffff:7f00:1',
    '0::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:0a00:1',
    '0:0:0:0:0:ffff:a00:1',
    '::ffff:172.16.0.1',
    '::ffff:ac10:1',
    '::ffff:192.168.0.1',
    '::ffff:c0a8:1',
    '::ffff:192.0.0.1',
    '::ffff:c000:1',
    '::ffff:192.0.2.1',
    '::ffff:c000:201',
    '::ffff:192.88.99.1',
    '::ffff:c058:6301',
    '::ffff:192.175.48.1',
    '::ffff:c0af:3001',
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    '0:0:0:0:0:ffff:a9fe:a9fe',
    '::ffff:198.18.0.1',
    '::ffff:c612:1',
    '::ffff:203.0.113.1',
    '::ffff:cb00:7101',
    '::ffff:224.0.0.1',
    '::ffff:e000:1',
  ];

  for (const address of mappedAddresses) {
    let requested = false;
    const safeFetch = new ProviderSafeFetch({
      allowedHosts: ['cdn.provider.test'],
      resolver: { resolve: async () => [address] },
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
      address,
    );
    assert.equal(requested, false, address);
  }
});

test('allows public IPv4-mapped IPv6 representations through pinned transport', async () => {
  const mappedAddresses: Array<[string, string]> = [
    ['::ffff:93.184.216.34', '93.184.216.34'],
    ['::ffff:5db8:d822', '93.184.216.34'],
    ['0:0:0:0:0:ffff:5db8:d822', '93.184.216.34'],
    ['0::ffff:5db8:d822', '93.184.216.34'],
    ['::ffff:192.0.1.1', '192.0.1.1'],
    ['::ffff:198.51.1.1', '198.51.1.1'],
    ['::ffff:203.0.1.1', '203.0.1.1'],
  ];

  for (const [address, expectedAddress] of mappedAddresses) {
    let requestedAddresses: string[] = [];
    const safeFetch = new ProviderSafeFetch({
      allowedHosts: ['cdn.provider.test'],
      resolver: { resolve: async () => [address] },
      transport: transport(async (input) => {
        requestedAddresses = input.allowedAddresses;
        return {
          status: 200,
          headers: { 'content-type': 'image/png' },
          body: body([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          cancel: () => undefined,
        };
      }),
    });

    await safeFetch.get('https://cdn.provider.test/result.png', {
      allowedMimeTypes: ['image/png'],
      maxBytes: 1024,
    });

    assert.deepEqual(requestedAddresses, [expectedAddress], address);
  }
});

test('pins transport to validated DNS answers and accepts a verified PNG', async () => {
  const requests: Array<{ addresses: string[]; headers: Record<string, string> }> = [];
  let cancelled = 0;
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
        cancel: () => {
          cancelled += 1;
        },
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
  assert.equal(cancelled, 0);
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
        cancel: () => undefined,
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

test('rejects a mapped private DNS answer before a redirect can reach transport', async () => {
  let requests = 0;
  let resolutions = 0;
  const safeFetch = new ProviderSafeFetch({
    allowedHosts: ['cdn.provider.test'],
    resolver: {
      resolve: async () => {
        resolutions += 1;
        return resolutions === 1
          ? ['93.184.216.34']
          : ['::ffff:169.254.169.254'];
      },
    },
    transport: transport(async () => {
      requests += 1;
      return {
        status: 302,
        headers: { location: 'https://cdn.provider.test/redirected.png' },
        body: body([]),
        cancel: () => undefined,
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
      error.code === 'SAFE_FETCH_PRIVATE_ADDRESS',
  );
  assert.equal(resolutions, 2);
  assert.equal(requests, 1);
});

test('cancels a redirect response body before following the next hop', async () => {
  let cancelled = 0;
  const safeFetch = new ProviderSafeFetch({
    allowedHosts: ['api.provider.test', 'cdn.provider.test'],
    resolver: { resolve: async () => ['93.184.216.34'] },
    transport: transport(async (input) => {
      if (input.url.hostname === 'api.provider.test') {
        return {
          status: 302,
          headers: {
            location: 'https://cdn.provider.test/result.png',
          } as Record<string, string>,
          body: body([1, 2, 3]),
          cancel: () => {
            cancelled += 1;
          },
        };
      }
      return {
        status: 200,
        headers: {
          'content-type': 'image/png',
        } as Record<string, string>,
        body: body([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        cancel: () => undefined,
      };
    }),
  });

  await safeFetch.get('https://api.provider.test/result.png', {
    allowedMimeTypes: ['image/png'],
    maxBytes: 1024,
  });

  assert.equal(cancelled, 1);
});

test('cancels response bodies rejected before streaming', async () => {
  const cases: Array<{
    name: string;
    status: number;
    headers: Record<string, string>;
    maxRedirects?: number;
    errorCode: string;
  }> = [
    {
      name: 'redirect limit',
      status: 302,
      headers: { location: 'https://cdn.provider.test/again.png' },
      maxRedirects: 0,
      errorCode: 'SAFE_FETCH_REDIRECT_LIMIT',
    },
    {
      name: 'redirect without location',
      status: 302,
      headers: {},
      errorCode: 'SAFE_FETCH_REDIRECT_INVALID',
    },
    {
      name: 'upstream failure',
      status: 503,
      headers: {},
      errorCode: 'SAFE_FETCH_UPSTREAM_STATUS',
    },
    {
      name: 'declared body too large',
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-length': '5000',
      },
      errorCode: 'SAFE_FETCH_TOO_LARGE',
    },
    {
      name: 'forbidden MIME type',
      status: 200,
      headers: { 'content-type': 'text/html' },
      errorCode: 'SAFE_FETCH_MIME_FORBIDDEN',
    },
  ];

  for (const scenario of cases) {
    let cancelled = 0;
    const safeFetch = new ProviderSafeFetch({
      allowedHosts: ['cdn.provider.test'],
      resolver: { resolve: async () => ['93.184.216.34'] },
      ...(scenario.maxRedirects === undefined
        ? {}
        : { maxRedirects: scenario.maxRedirects }),
      transport: transport(async () => ({
        status: scenario.status,
        headers: scenario.headers,
        body: body([1, 2, 3]),
        cancel: () => {
          cancelled += 1;
        },
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
        error.code === scenario.errorCode,
      scenario.name,
    );
    assert.equal(cancelled, 1, scenario.name);
  }
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
          cancel: () => undefined,
        };
      }
      return {
        status: 200,
        headers: { 'content-type': 'image/png' } as Record<string, string>,
        body: body([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        cancel: () => undefined,
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

test('rejects an authenticated fetch over HTTP before transport', async () => {
  let requested = false;
  const safeFetch = new ProviderSafeFetch({
    allowedHosts: ['api.provider.test'],
    resolver: { resolve: async () => ['93.184.216.34'] },
    transport: transport(async () => {
      requested = true;
      throw new Error('must not request');
    }),
  });

  await assert.rejects(
    safeFetch.get('http://api.provider.test/result.png', {
      allowedMimeTypes: ['image/png'],
      authorization: {
        host: 'api.provider.test',
        value: 'Bearer provider-secret',
      },
      maxBytes: 1024,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'SAFE_FETCH_AUTH_PROTOCOL_FORBIDDEN',
  );
  assert.equal(requested, false);
});

test('rejects an authenticated downgrade redirect before the second transport', async () => {
  let calls = 0;
  let cancelled = 0;
  const safeFetch = new ProviderSafeFetch({
    allowedHosts: ['api.provider.test', 'cdn.provider.test'],
    resolver: { resolve: async () => ['93.184.216.34'] },
    transport: transport(async () => {
      calls += 1;
      return {
        status: 302,
        headers: { location: 'http://cdn.provider.test/result.png' },
        body: body([1, 2, 3]),
        cancel: () => {
          cancelled += 1;
        },
      };
    }),
  });

  await assert.rejects(
    safeFetch.get('https://api.provider.test/result.png', {
      allowedMimeTypes: ['image/png'],
      authorization: {
        host: 'api.provider.test',
        value: 'Bearer provider-secret',
      },
      maxBytes: 1024,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'SAFE_FETCH_AUTH_PROTOCOL_FORBIDDEN',
  );
  assert.equal(calls, 1);
  assert.equal(cancelled, 1);
});

test('enforces declared and streamed size limits', async () => {
  const declared = new ProviderSafeFetch({
    allowedHosts: ['cdn.provider.test'],
    resolver: { resolve: async () => ['93.184.216.34'] },
    transport: transport(async () => ({
      status: 200,
      headers: { 'content-type': 'image/png', 'content-length': '5000' },
      body: body([]),
      cancel: () => undefined,
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
      cancel: () => undefined,
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

test('cancels a response when its streamed body exceeds the byte limit', async () => {
  let cancelled = 0;
  const safeFetch = new ProviderSafeFetch({
    allowedHosts: ['cdn.provider.test'],
    resolver: { resolve: async () => ['93.184.216.34'] },
    transport: transport(async () => ({
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: body([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0]),
      cancel: () => {
        cancelled += 1;
      },
    })),
  });

  await assert.rejects(
    safeFetch.get('https://cdn.provider.test/result.png', {
      allowedMimeTypes: ['image/png'],
      maxBytes: 8,
    }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'SAFE_FETCH_TOO_LARGE',
  );
  assert.equal(cancelled, 1);
});

test('rejects MIME confusion even when the response claims an allowed type', async () => {
  const safeFetch = new ProviderSafeFetch({
    allowedHosts: ['cdn.provider.test'],
    resolver: { resolve: async () => ['93.184.216.34'] },
    transport: transport(async () => ({
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: body([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]),
      cancel: () => undefined,
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
        cancel: () => undefined,
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
