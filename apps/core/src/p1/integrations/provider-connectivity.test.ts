import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HttpProviderConnectivityProbe,
  providerConnectivityProbeFromEnv,
} from './provider-connectivity.js';

test('provider connectivity probe uses side-effect-free model listing endpoints', async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const probe = new HttpProviderConnectivityProbe(
    {
      'ark.media': 'https://ark.example.test/api/v3',
      'model.direct': 'https://api.tu-zi.com/v1',
    },
    async (input, init) => {
      requests.push({ input: String(input), init });
      return new Response('{}', { status: 200 });
    },
  );

  assert.deepEqual(
    await probe.probe({ credential: 'direct-secret', slot: 'model.direct' }),
    { status: 'passed' },
  );
  assert.deepEqual(
    await probe.probe({ credential: 'ark-secret', slot: 'ark.media' }),
    { status: 'passed' },
  );
  assert.deepEqual(
    requests.map(({ input, init }) => ({
      authorization: new Headers(init?.headers).get('authorization'),
      input,
      method: init?.method,
    })),
    [
      {
        authorization: 'Bearer direct-secret',
        input: 'https://api.tu-zi.com/v1/models',
        method: 'GET',
      },
      {
        authorization: 'Bearer ark-secret',
        input: 'https://ark.example.test/api/v3/models',
        method: 'GET',
      },
    ],
  );
});

test('provider connectivity probe returns safe five-way classifications', async () => {
  const responseForStatus = (status: number) =>
    new HttpProviderConnectivityProbe(
      { 'model.direct': 'https://provider.example.test/v1' },
      async () => new Response('provider-secret-in-body', { status }),
    );

  assert.deepEqual(
    await responseForStatus(401).probe({
      credential: 'secret',
      slot: 'model.direct',
    }),
    { errorCode: 'http_401', status: 'unauthorized' },
  );
  assert.deepEqual(
    await responseForStatus(503).probe({
      credential: 'secret',
      slot: 'model.direct',
    }),
    { errorCode: 'http_503', status: 'unknown' },
  );
  assert.deepEqual(
    await new HttpProviderConnectivityProbe(
      { 'model.direct': 'https://provider.example.test/v1' },
      async () => {
        throw new TypeError('secret leaked by network stack');
      },
    ).probe({ credential: 'secret', slot: 'model.direct' }),
    { errorCode: 'network_error', status: 'network_failed' },
  );
});

test('provider connectivity runtime uses configured direct and Ark endpoints', async () => {
  const requested: string[] = [];
  const probe = providerConnectivityProbeFromEnv(
    {
      ARK_MEDIA_BASE_URL: 'https://ark.example.test/api/v3',
      MODEL_DIRECT_BASE_URL: 'https://direct.example.test/v1/',
    },
    async (input) => {
      requested.push(String(input));
      return new Response('{}', { status: 200 });
    },
  );

  await probe.probe({ credential: 'secret', slot: 'model.direct' });
  await probe.probe({ credential: 'secret', slot: 'ark.media' });

  assert.deepEqual(requested, [
    'https://direct.example.test/v1/models',
    'https://ark.example.test/api/v3/models',
  ]);
});
