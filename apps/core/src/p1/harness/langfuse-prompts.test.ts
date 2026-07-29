import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import {
  HARNESS_PROMPT_SITES,
  HARNESS_LANGFUSE_PROMPT_NAMES,
  LangfuseHarnessPromptResolver,
  assertLangfusePromptRuntimePolicy,
  harnessPromptCapabilityRequirement,
} from './langfuse-prompts.js';

test('the single 14-site registry owns prompt names and capability requirements', () => {
  assert.deepEqual(
    Object.keys(HARNESS_PROMPT_SITES).sort(),
    Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).sort(),
  );
  assert.equal(Object.keys(HARNESS_PROMPT_SITES).length, 14);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(HARNESS_PROMPT_SITES).map(([key, site]) => [
        key,
        site.name,
      ]),
    ),
    HARNESS_LANGFUSE_PROMPT_NAMES,
  );

  assert.deepEqual(
    harnessPromptCapabilityRequirement('briefImage'),
    {
      axisId: 'briefImage',
      vocabularyVersion: 'model-capability-v1',
      requiredProtocolCapabilities: ['structured-output'],
      requiredModalities: ['text/plain'],
      requiredBusinessTags: [],
      requiredModalityCapabilities: [],
      unknownPolicy: 'conservative_always_available',
    },
  );
  assert.deepEqual(
    harnessPromptCapabilityRequirement('textResponse'),
    {
      axisId: 'textResponse',
      vocabularyVersion: 'model-capability-v1',
      requiredProtocolCapabilities: [],
      requiredModalities: ['text/plain'],
      requiredBusinessTags: [],
      requiredModalityCapabilities: [],
      unknownPolicy: 'conservative_always_available',
    },
  );
  assert.deepEqual(
    harnessPromptCapabilityRequirement('textResponse', {
      referenceImage: true,
    }).requiredModalities,
    ['text/plain', 'image/*'],
  );
});

test('strict prompt policy is the default and rejects missing runtime configuration', () => {
  assert.throws(
    () => assertLangfusePromptRuntimePolicy({}),
    /LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_PROMPT_VERSIONS/u,
  );
  assert.throws(
    () =>
      assertLangfusePromptRuntimePolicy({
        LANGFUSE_BASE_URL: 'https://langfuse.example',
        LANGFUSE_PUBLIC_KEY: 'pk-prompt',
        LANGFUSE_SECRET_KEY: 'sk-prompt',
        LANGFUSE_PROMPT_VERSIONS: JSON.stringify({ intentNaming: 7 }),
      }),
    /briefCompilation/u,
  );
  assert.throws(
    () =>
      assertLangfusePromptRuntimePolicy({
        LANGFUSE_PROMPT_POLICY: 'development',
      }),
    /LANGFUSE_PROMPT_POLICY/u,
  );
});

test('strict prompt resolver fetches every prompt by an explicit version', async (t) => {
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
    policy: 'strict',
    versions: promptVersions((key) => (key === 'intentNaming' ? 7 : 12)),
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
      .map((name, index) =>
        `/api/public/v2/prompts/${encodeURIComponent(name)}?version=${index === 0 ? 7 : 12}`,
      )
      .sort(),
  );
  assert.ok(requests.every(({ url }) => !url?.includes('label=')));
  assert.ok(
    requests.every(
      ({ authorization }) =>
        authorization ===
        `Basic ${Buffer.from('pk-prompt:sk-prompt').toString('base64')}`,
    ),
  );
});

test('strict prompt resolver checks the complete pin set before any remote request', async () => {
  let requests = 0;
  const resolver = new LangfuseHarnessPromptResolver({
    baseUrl: 'https://langfuse.example',
    fetch: async () => {
      requests += 1;
      return new Response();
    },
    publicKey: 'pk-prompt',
    secretKey: 'sk-prompt',
    policy: 'strict',
    versions: { intentNaming: 7 },
  });

  await assert.rejects(resolver.resolve(), /briefCompilation/u);
  assert.equal(requests, 0);
});

test('configured prompt versions are fetched by version and surfaced as immutable references', async (t) => {
  const requests: string[] = [];
  const warnings: Array<{ name: string; reason: string }> = [];
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
    policy: 'pilot',
    versions: { intentNaming: 9 },
    warn: (warning) => warnings.push(warning),
  });

  const frozen = await resolver.resolve();

  assert.ok(
    requests.includes(
      '/api/public/v2/prompts/harness%2Fintent-naming?version=9',
    ),
  );
  assert.equal(frozen.intentNaming.version, '9');
  assert.equal(frozen.intentNaming.isFallback, false);
  assert.equal(frozen.briefCompilation.isFallback, true);
  assert.equal(frozen.briefCompilation.fallbackReason, 'unpinned');
  assert.equal(requests.length, 1);
  assert.equal(warnings.length, Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).length - 1);
  assert.ok(warnings.every(({ reason }) => reason === 'unpinned'));
});

test('only explicit pilot policy permits missing configuration to fall back', async () => {
  const warnings: Array<{ name: string; reason: string }> = [];
  const resolver = new LangfuseHarnessPromptResolver({
    policy: 'pilot',
    warn: (warning) => warnings.push(warning),
  });

  const frozen = await resolver.resolve();

  assert.equal(warnings.length, Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).length);
  assert.ok(warnings.every(({ reason }) => reason === 'unconfigured'));
  assert.ok(Object.values(frozen).every((prompt) => prompt.isFallback));
});

test('pilot fallback emits a warning even when no warning callback is injected', async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    await new LangfuseHarnessPromptResolver({ policy: 'pilot' }).resolve();
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).length);
  assert.ok(warnings.every((warning) => warning.includes('(unconfigured)')));
});

test('Langfuse prompt failure freezes built-in content and an explicit fallback fact', async (t) => {
  const server = createServer((_request, response) => {
    sendJson(response, 503, { error: 'unavailable' });
  });
  const warnings: Array<{ name: string; reason: string }> = [];
  const resolver = new LangfuseHarnessPromptResolver({
    baseUrl: await listen(t, server),
    publicKey: 'pk-prompt',
    secretKey: 'sk-prompt',
    policy: 'pilot',
    versions: promptVersions(() => 9),
    warn: (warning) => warnings.push(warning),
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
  assert.equal(warnings.length, Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).length);
  assert.ok(warnings.every(({ reason }) => reason === 'http_503'));
});

test('strict prompt resolution fails closed instead of using a builtin on remote failure', async (t) => {
  const server = createServer((_request, response) => {
    sendJson(response, 503, { error: 'unavailable' });
  });
  const resolver = new LangfuseHarnessPromptResolver({
    baseUrl: await listen(t, server),
    publicKey: 'pk-prompt',
    secretKey: 'sk-prompt',
    policy: 'strict',
    versions: promptVersions(() => 9),
  });

  await assert.rejects(resolver.resolve(), /http_503/u);
});

function promptVersions(
  versionFor: (key: keyof typeof HARNESS_LANGFUSE_PROMPT_NAMES) => number,
) {
  return Object.fromEntries(
    Object.keys(HARNESS_LANGFUSE_PROMPT_NAMES).map((key) => [
      key,
      versionFor(key as keyof typeof HARNESS_LANGFUSE_PROMPT_NAMES),
    ]),
  ) as Record<keyof typeof HARNESS_LANGFUSE_PROMPT_NAMES, number>;
}

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
