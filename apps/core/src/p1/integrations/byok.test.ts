import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveByokExecutionAdapter } from './byok.js';

test('live BYOK execution uses only the workspace credential and bound provider model', async () => {
  const requests: Array<{
    authorization: string | null;
    body: Record<string, unknown>;
    url: string;
  }> = [];
  const adapter = new LiveByokExecutionAdapter({
    fetch: (async (input, init) => {
      const request = new Request(input, init);
      requests.push({
        authorization: request.headers.get('authorization'),
        body: JSON.parse(await request.text()) as Record<string, unknown>,
        url: request.url,
      });
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              index: 0,
              message: {
                content: '真实生成的中文门店文案',
                role: 'assistant',
              },
            },
          ],
          created: 1,
          id: 'chatcmpl-byok',
          model: 'deepseek-chat',
          object: 'chat.completion',
          usage: {
            completion_tokens: 12,
            prompt_tokens: 8,
            total_tokens: 20,
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch,
    modelBindings: { 'llm-domestic': 'deepseek-chat' },
  });

  const result = await adapter.execute({
    endpoint: 'https://provider.example/v1',
    catalogModelId: 'llm-domestic',
    credential: 'workspace-secret',
    prompt: '为美甲店写一段预约文案',
  });

  assert.deepEqual(result, {
    status: 'completed',
    output: '真实生成的中文门店文案',
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, 'https://provider.example/v1/chat/completions');
  assert.equal(requests[0]?.authorization, 'Bearer workspace-secret');
  assert.equal(requests[0]?.body.model, 'deepseek-chat');
});

test('live BYOK execution classifies provider authorization rejection without leaking the credential', async () => {
  const adapter = new LiveByokExecutionAdapter({
    fetch: (async () =>
      new Response(
        JSON.stringify({
          error: { message: 'invalid_api_key', type: 'authentication_error' },
        }),
        {
          headers: { 'content-type': 'application/json' },
          status: 401,
        },
      )) as typeof fetch,
    modelBindings: { 'llm-domestic': 'deepseek-chat' },
  });

  const result = await adapter.execute({
    endpoint: 'https://provider.example/v1',
    catalogModelId: 'llm-domestic',
    credential: 'must-not-leak',
    prompt: '为美甲店写一段预约文案',
  });

  assert.deepEqual(result, { status: 'unauthorized' });
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
});

test('live BYOK execution treats forbidden credentials as unauthorized', async () => {
  const adapter = new LiveByokExecutionAdapter({
    fetch: (async () =>
      new Response(JSON.stringify({ error: { message: 'forbidden' } }), {
        headers: { 'content-type': 'application/json' },
        status: 403,
      })) as typeof fetch,
    modelBindings: { 'llm-domestic': 'deepseek-chat' },
  });

  assert.deepEqual(
    await adapter.execute({
      endpoint: 'https://provider.example/v1',
      catalogModelId: 'llm-domestic',
      credential: 'workspace-secret',
      prompt: '为美甲店写一段预约文案',
    }),
    { status: 'unauthorized' },
  );
});

test('live BYOK execution keeps provider and transport uncertainty failed', async () => {
  const request = {
    endpoint: 'https://provider.example/v1',
    catalogModelId: 'llm-domestic',
    credential: 'workspace-secret',
    prompt: '为美甲店写一段预约文案',
  };
  const unavailable = new LiveByokExecutionAdapter({
    fetch: (async () =>
      new Response(JSON.stringify({ error: { message: 'unavailable' } }), {
        headers: { 'content-type': 'application/json' },
        status: 500,
      })) as typeof fetch,
    modelBindings: { 'llm-domestic': 'deepseek-chat' },
  });
  const disconnected = new LiveByokExecutionAdapter({
    fetch: (async () => {
      throw new Error('network unavailable');
    }) as typeof fetch,
    modelBindings: { 'llm-domestic': 'deepseek-chat' },
  });

  assert.deepEqual(await unavailable.execute(request), { status: 'failed' });
  assert.deepEqual(await disconnected.execute(request), { status: 'failed' });
});

test('live BYOK execution treats timeout as failed without retrying', async () => {
  let requests = 0;
  const adapter = new LiveByokExecutionAdapter({
    fetch: (async (input, init) => {
      requests += 1;
      const signal = new Request(input, init).signal;
      await new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), {
          once: true,
        });
      });
      return new Response(null, { status: 204 });
    }) as typeof fetch,
    modelBindings: { 'llm-domestic': 'deepseek-chat' },
    timeoutMs: 5,
  });

  assert.deepEqual(
    await adapter.execute({
      endpoint: 'https://provider.example/v1',
      catalogModelId: 'llm-domestic',
      credential: 'workspace-secret',
      prompt: '为美甲店写一段预约文案',
    }),
    { status: 'failed' },
  );
  assert.equal(requests, 1);
});
