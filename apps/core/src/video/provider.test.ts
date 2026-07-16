import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { ArkDirectVideoProvider } from './ark-provider.js';
import {
  DeterministicFakeVideoProvider,
  VideoProviderError,
} from './provider.js';

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

test('deterministic fake provider writes stable clip bytes and evidence', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'video-provider-fake-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const clipBytes = Buffer.from('deterministic-video-clip');
  const provider = new DeterministicFakeVideoProvider({
    provider: 'fake-seedance',
    model: 'fake-video-v1',
    clipBytes,
    cost: { amount: 1.25, currency: 'CNY', estimated: false },
  });
  const request = {
    prompt: 'A clean beauty studio reveal',
    durationSeconds: 5,
    aspectRatio: '9:16' as const,
    correlationId: 'corr-fake-1',
  };

  const first = await provider.generateClip({
    ...request,
    outputPath: join(directory, 'first.mp4'),
  });
  const second = await provider.generateClip({
    ...request,
    outputPath: join(directory, 'second.mp4'),
  });

  assert.deepEqual(await readFile(first.path), clipBytes);
  assert.deepEqual(await readFile(second.path), clipBytes);
  assert.equal(first.taskId, second.taskId);
  assert.deepEqual(first.cost, { amount: 1.25, currency: 'CNY', estimated: false });
  assert.equal(first.provider, 'fake-seedance');
  assert.equal(first.model, 'fake-video-v1');
});

test('Ark direct provider submits, polls, downloads, and records estimated cost', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'video-provider-http-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const requests: Array<{
    method?: string;
    url?: string;
    authorization?: string;
    correlationId?: string;
    body?: unknown;
  }> = [];
  let pollCount = 0;
  let baseUrl = '';
  const server = createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/api/v3/contents/generations/tasks') {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        correlationId: request.headers['x-client-request-id'] as string | undefined,
        body: await readJson(request),
      });
      sendJson(response, 200, { id: 'task-http-1' });
      return;
    }
    if (request.method === 'GET' && request.url === '/api/v3/contents/generations/tasks/task-http-1') {
      pollCount += 1;
      sendJson(response, 200, pollCount === 1
        ? { id: 'task-http-1', status: 'queued' }
        : {
            id: 'task-http-1',
            status: 'succeeded',
            content: { video_url: `${baseUrl}/clip.mp4` },
            usage: { total_tokens: 2400 },
          });
      return;
    }
    if (request.method === 'GET' && request.url === '/clip.mp4') {
      response.writeHead(200, { 'content-type': 'video/mp4' });
      response.end(Buffer.from('playable-provider-fixture'));
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  const provider = new ArkDirectVideoProvider({
    apiKey: 'test-ark-key',
    baseUrl: `${baseUrl}/api/v3`,
    model: 'doubao-seedance-test',
    pollIntervalMs: 1,
    timeoutMs: 2_000,
    estimateCost: (_request, task) => ({
      amount: Number(task.usage?.total_tokens ?? 0) / 1_000,
      currency: 'CNY',
      estimated: true,
    }),
  });
  const outputPath = join(directory, 'provider.mp4');
  const result = await provider.generateClip({
    prompt: 'A polished nail-art close-up',
    durationSeconds: 5,
    aspectRatio: '9:16',
    firstFrameUrl: 'https://assets.example/first.png',
    correlationId: 'corr-http-1',
    outputPath,
  });

  assert.equal(result.path, outputPath);
  assert.equal(result.taskId, 'task-http-1');
  assert.deepEqual(result.cost, { amount: 2.4, currency: 'CNY', estimated: true });
  assert.deepEqual(await readFile(outputPath), Buffer.from('playable-provider-fixture'));
  assert.equal(requests[0]?.authorization, 'Bearer test-ark-key');
  assert.equal(requests[0]?.correlationId, 'corr-http-1');
  assert.deepEqual(requests[0]?.body, {
    model: 'doubao-seedance-test',
    content: [
      {
        type: 'text',
        text: 'A polished nail-art close-up --ratio 9:16',
      },
      {
        type: 'image_url',
        image_url: { url: 'https://assets.example/first.png' },
        role: 'first_frame',
      },
    ],
    duration: 5,
  });
  assert.equal(pollCount, 2);
});

test('Ark direct provider classifies retry and refund behavior', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'video-provider-errors-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const server = createServer(async (request, response) => {
    const body = request.method === 'POST' ? await readJson(request) : {};
    const serialized = JSON.stringify(body);
    if (serialized.includes('blocked prompt')) {
      sendJson(response, 400, {
        error: { code: 'InputTextSensitiveContentDetected', message: 'content rejected' },
      });
      return;
    }
    sendJson(response, 429, {
      error: { code: 'RateLimitExceeded', message: 'try later' },
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const { port } = server.address() as AddressInfo;
  const provider = new ArkDirectVideoProvider({
    apiKey: 'test-key',
    baseUrl: `http://127.0.0.1:${port}`,
    model: 'test-model',
    pollIntervalMs: 1,
    timeoutMs: 1_000,
    estimateCost: () => ({ amount: 1, currency: 'CNY', estimated: true }),
  });

  await assert.rejects(
    provider.generateClip({
      prompt: 'normal prompt',
      durationSeconds: 5,
      aspectRatio: '9:16',
      correlationId: 'corr-rate-limit',
      outputPath: join(directory, 'rate-limit.mp4'),
    }),
    (error) => {
      assert.ok(error instanceof VideoProviderError);
      assert.equal(error.code, 'rate_limit');
      assert.equal(error.retryable, true);
      assert.equal(error.refund, 'required');
      return true;
    }
  );

  await assert.rejects(
    provider.generateClip({
      prompt: 'blocked prompt',
      durationSeconds: 5,
      aspectRatio: '9:16',
      correlationId: 'corr-policy',
      outputPath: join(directory, 'policy.mp4'),
    }),
    (error) => {
      assert.ok(error instanceof VideoProviderError);
      assert.equal(error.code, 'content_policy');
      assert.equal(error.retryable, false);
      assert.equal(error.refund, 'required');
      return true;
    }
  );
});
