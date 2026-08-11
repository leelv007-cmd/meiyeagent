import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import type { ComposerDestinationMapping } from '@meiye/contracts';

import { createCoreServer } from '../../server.js';
import type {
  ComposerDestinationMappingPort,
} from './composer-destination-mapper.js';

test('Core exposes authorized pre-quote destination mapping without changing the submission contract', async (t) => {
  const mapper = new RecordingMapper({
    contentPackagePlatform: 'xiaohongshu',
    distributionTarget: 'manual_copy',
    status: 'mapped',
  });
  const server = createCoreServer({
    composerDestinationMapper: mapper,
    serviceToken: 'destination-test-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/v1/workspaces/workspace-1/p1/composer/destination-map`;
  const headers = {
    'content-type': 'application/json',
    'x-service-token': 'destination-test-token',
    'x-user-id': 'owner-1',
    'x-workspace-id': 'workspace-1',
    'x-workspace-role': 'owner',
  };

  const unauthenticated = await fetch(url, {
    body: JSON.stringify({ destination: '发到小红书' }),
    method: 'POST',
  });
  assert.equal(unauthenticated.status, 401);

  const forbidden = await fetch(url, {
    body: JSON.stringify({ destination: '发到小红书' }),
    headers: { ...headers, 'x-workspace-role': 'reviewer' },
    method: 'POST',
  });
  assert.equal(forbidden.status, 403);

  const invalid = await fetch(url, {
    body: JSON.stringify({
      creationMode: 'free',
      destination: '发到小红书',
      intent: '客户端不应把签名字段交给预解析器',
    }),
    headers,
    method: 'POST',
  });
  assert.equal(invalid.status, 400);

  const response = await fetch(url, {
    body: JSON.stringify({
      destination: '发到小红书，生成后我自己复制',
    }),
    headers,
    method: 'POST',
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.data, {
    contentPackagePlatform: 'xiaohongshu',
    distributionTarget: 'manual_copy',
    status: 'mapped',
  });
  assert.deepEqual(mapper.destinations, ['发到小红书，生成后我自己复制']);
});

class RecordingMapper implements ComposerDestinationMappingPort {
  readonly destinations: string[] = [];

  constructor(private readonly result: ComposerDestinationMapping) {}

  async map(input: { destination: string }) {
    this.destinations.push(input.destination);
    return this.result;
  }
}
