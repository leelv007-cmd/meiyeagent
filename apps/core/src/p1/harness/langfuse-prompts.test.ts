import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import {
  HARNESS_LANGFUSE_PROMPT_NAMES,
  LangfuseHarnessPromptResolver,
} from './langfuse-prompts.js';

test('task admission prompt resolver freezes production versions and content hashes', async (t) => {
  const requests: Array<{ url?: string; authorization?: string }> = [];
  const server = createServer((request, response) => {
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
    });
    const name = decodeURIComponent(
      request.url?.split('/api/public/v2/prompts/')[1]?.split('?')[0] ?? '',
    );
    if (name === HARNESS_LANGFUSE_PROMPT_NAMES.intentNaming) {
      sendJson(response, 200, {
        name,
        version: 7,
        type: 'text',
        prompt: 'Intent prompt v7 with exact production instructions.',
      });
      return;
    }
    sendJson(response, 200, {
      name,
      version: 12,
      type: 'text',
      prompt: 'Brief prompt v12 with exact production instructions.',
    });
  });
  const resolver = new LangfuseHarnessPromptResolver({
    baseUrl: await listen(t, server),
    publicKey: 'pk-prompt',
    secretKey: 'sk-prompt',
  });

  const frozen = await resolver.resolve();

  assert.deepEqual(frozen.intentNaming, {
    name: 'harness/intent-naming',
    version: '7',
    content: 'Intent prompt v7 with exact production instructions.',
    contentHash: '87e6d5912c32be17fc537293f6267b956b247dae38f1b63e2b8f7bc50e49ca7a',
    label: 'production',
    source: 'langfuse',
    isFallback: false,
  });
  assert.equal(frozen.briefCompilation.version, '12');
  assert.equal(
    frozen.briefCompilation.contentHash,
    'b59c9b4683cb2d152f857740cb518dacb2e2de5aa108114e4c5adf59f955431a',
  );
  assert.deepEqual(
    requests.map(({ url }) => url).sort(),
    Object.values(HARNESS_LANGFUSE_PROMPT_NAMES)
      .map((name) =>
        `/api/public/v2/prompts/${encodeURIComponent(name)}?label=production`,
      )
      .sort(),
  );
  assert.ok(
    requests.every(
      ({ authorization }) =>
        authorization ===
        `Basic ${Buffer.from('pk-prompt:sk-prompt').toString('base64')}`,
    ),
  );
});

test('configured prompt versions are fetched by version and surfaced as immutable references', async (t) => {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    sendJson(response, 200, {
      version: 9,
      type: 'text',
      prompt: 'Pinned prompt content with enough detail for the fixture.',
    });
  });
  const resolver = new LangfuseHarnessPromptResolver({
    baseUrl: await listen(t, server),
    publicKey: 'pk-prompt',
    secretKey: 'sk-prompt',
    versions: { intentNaming: 9 },
  });

  const frozen = await resolver.resolve();

  assert.ok(
    requests.includes(
      '/api/public/v2/prompts/harness%2Fintent-naming?version=9',
    ),
  );
  assert.equal(frozen.intentNaming.version, '9');
  assert.equal(frozen.intentNaming.isFallback, false);
});

test('missing Langfuse keeps fixture resolution green but emits one downgrade warning per registered prompt', async () => {
  const warnings: Array<{ name: string; reason: string }> = [];
  const resolver = new LangfuseHarnessPromptResolver({
    warn: (warning) => warnings.push(warning),
  });

  const frozen = await resolver.resolve();

  assert.equal(warnings.length, Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).length);
  assert.ok(warnings.every(({ reason }) => reason === 'unconfigured'));
  assert.ok(Object.values(frozen).every((prompt) => prompt.isFallback));
});

test('Langfuse prompt failure freezes built-in content and an explicit fallback fact', async (t) => {
  const server = createServer((_request, response) => {
    sendJson(response, 503, { error: 'unavailable' });
  });
  const resolver = new LangfuseHarnessPromptResolver({
    baseUrl: await listen(t, server),
    publicKey: 'pk-prompt',
    secretKey: 'sk-prompt',
  });

  const frozen = await resolver.resolve();

  for (const prompt of [frozen.intentNaming, frozen.briefCompilation]) {
    assert.equal(prompt.version, 'builtin-v1');
    assert.equal(prompt.source, 'builtin');
    assert.equal(prompt.isFallback, true);
    assert.equal(prompt.fallbackReason, 'http_503');
    assert.ok(prompt.content.length > 80);
    assert.match(prompt.contentHash, /^[a-f0-9]{64}$/u);
  }
});

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function listen(t: test.TestContext, server: ReturnType<typeof createServer>) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}
