import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import test from 'node:test';

import {
  assertLangfuseLongPromptLiveConfig,
  runLangfuseLongPromptAcceptance,
} from './langfuse-prompt-live-acceptance.js';

test('long Chinese prompt acceptance creates and reads the exact returned version without truncation', async (t) => {
  const prompt = '请完整保存这段中文提示词，不得截断、改写或丢失任何字符。'.repeat(
    60,
  );
  let created:
    | {
        name: string;
        prompt: string;
        type: string;
        labels: string[];
      }
    | undefined;
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (
      request.method === 'POST' &&
      request.url === '/api/public/v2/prompts'
    ) {
      created = await readJson(request);
      sendJson(response, 200, { version: 37 });
      return;
    }
    if (
      request.method === 'GET' &&
      request.url ===
        '/api/public/v2/prompts/harness%2Facceptance%2Flong-cn-test?version=37'
    ) {
      sendJson(response, 200, {
        name: created?.name,
        prompt: created?.prompt,
        type: 'text',
        version: 37,
      });
      return;
    }
    sendJson(response, 404, {});
  });

  const result = await runLangfuseLongPromptAcceptance({
    baseUrl: await listen(t, server),
    publicKey: 'pk-live-test',
    secretKey: 'sk-live-test',
    name: 'harness/acceptance/long-cn-test',
    prompt,
  });

  assert.deepEqual(requests, [
    'POST /api/public/v2/prompts',
    'GET /api/public/v2/prompts/harness%2Facceptance%2Flong-cn-test?version=37',
  ]);
  assert.deepEqual(created, {
    name: 'harness/acceptance/long-cn-test',
    prompt,
    type: 'text',
    labels: ['acceptance'],
  });
  assert.equal(result.name, 'harness/acceptance/long-cn-test');
  assert.equal(result.version, 37);
  assert.ok(result.characters > 1024);
  assert.equal(result.utf8Bytes, Buffer.byteLength(prompt));
  assert.match(result.contentHash, /^[a-f0-9]{64}$/u);
  assert.equal(result.matched, true);
  assert.equal(JSON.stringify(result).includes(prompt), false);
});

test('long prompt acceptance rejects content that does not cross the 1024 character boundary', async () => {
  await assert.rejects(
    runLangfuseLongPromptAcceptance({
      baseUrl: 'https://langfuse.example',
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      name: 'harness/acceptance/too-short',
      prompt: '中'.repeat(1024),
    }),
    /more than 1024 characters/u,
  );
});

test('long prompt acceptance fails when the exact version returns truncated content', async (t) => {
  const prompt = '长中文提示词必须逐字一致。'.repeat(100);
  const server = createServer((request, response) => {
    if (request.method === 'POST') {
      sendJson(response, 200, { version: 8 });
      return;
    }
    sendJson(response, 200, {
      name: 'harness/acceptance/truncated',
      prompt: prompt.slice(0, 1024),
      type: 'text',
      version: 8,
    });
  });

  await assert.rejects(
    runLangfuseLongPromptAcceptance({
      baseUrl: await listen(t, server),
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      name: 'harness/acceptance/truncated',
      prompt,
    }),
    /truncated or changed content/u,
  );
});

test('live acceptance configuration fails closed without explicit opt-in and credentials', () => {
  assert.throws(
    () => assertLangfuseLongPromptLiveConfig({}),
    /RUN_LIVE_LANGFUSE_PROMPT_ACCEPTANCE=1/u,
  );
  assert.throws(
    () =>
      assertLangfuseLongPromptLiveConfig({
        RUN_LIVE_LANGFUSE_PROMPT_ACCEPTANCE: '1',
      }),
    /LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, and LANGFUSE_SECRET_KEY/u,
  );
  assert.deepEqual(
    assertLangfuseLongPromptLiveConfig({
      RUN_LIVE_LANGFUSE_PROMPT_ACCEPTANCE: '1',
      LANGFUSE_BASE_URL: ' https://langfuse.example/ ',
      LANGFUSE_PUBLIC_KEY: ' pk-live ',
      LANGFUSE_SECRET_KEY: ' sk-live ',
    }),
    {
      baseUrl: 'https://langfuse.example/',
      publicKey: 'pk-live',
      secretKey: 'sk-live',
    },
  );
});

async function listen(t: test.TestContext, server: Server) {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected fixture server to expose a TCP address.');
  }
  return `http://127.0.0.1:${address.port}`;
}

async function readJson(request: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(
  response: import('node:http').ServerResponse,
  status: number,
  body: unknown,
) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
