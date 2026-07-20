import assert from 'node:assert/strict';
import test from 'node:test';
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai';
import {
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
} from './index.js';
import {
  FixtureAiStreamingRunner,
  OpenAiCompatibleAiSdkRunner,
} from './ai-sdk-runner.js';

test('formal non-streaming copy generation uses one structured object request', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const generated = {
    candidates: [
      {
        body: 'First grounded body.',
        conversionHook: 'Ask first',
        title: 'First angle',
      },
      {
        body: 'Second materially different body.',
        conversionHook: 'Save this',
        title: 'Second angle',
      },
      {
        body: 'Third distinct local-business body.',
        conversionHook: 'Book later',
        title: 'Third angle',
      },
    ],
  };
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-fixed',
    fetch: (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              index: 0,
              message: {
                content: JSON.stringify(generated),
                role: 'assistant',
              },
            },
          ],
          created: 1,
          id: 'chatcmpl-structured',
          model: 'provider-model',
          object: 'chat.completion',
          usage: {
            completion_tokens: 34,
            prompt_tokens: 12,
            total_tokens: 46,
          },
        }),
        { headers: { 'content-type': 'application/json' } }
      );
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });

  const result = await runner.generateCopy('Write three honest options.');

  assert.equal(requests.length, 1);
  assert.deepEqual(result.candidates, generated.candidates);
  assert.equal(result.providerTaskRef, 'chatcmpl-structured');
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 34 });
  const responseFormat = requests[0]?.response_format as {
    json_schema?: { name?: string; schema?: unknown; strict?: boolean };
    type?: string;
  };
  assert.equal(responseFormat.type, 'json_schema');
  assert.equal(responseFormat.json_schema?.name, 'beauty_copy_candidates');
  assert.equal(responseFormat.json_schema?.strict, true);
  assert.ok(responseFormat.json_schema?.schema);
});

test('formal platform adaptation returns all three distinct variants in one request', async () => {
  let requestCount = 0;
  const platformVariants = {
    xiaohongshu: {
      body: '小红书种草正文',
      conversionHook: '收藏后预约',
      title: '小红书标题',
      topics: ['同城美业'],
    },
    douyin: {
      body: '抖音口播节奏正文',
      conversionHook: '评论预约',
      title: '抖音标题',
      topics: ['同城探店'],
    },
    video_account: {
      body: '视频号熟客分享正文',
      conversionHook: '转发给朋友',
      title: '视频号标题',
      topics: ['熟客推荐'],
    },
  };
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-fixed',
    fetch: (async () => {
      requestCount += 1;
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              index: 0,
              message: {
                content: JSON.stringify(platformVariants),
                role: 'assistant',
              },
            },
          ],
          created: 1,
          id: 'chatcmpl-platform-variants',
          model: 'provider-model',
          object: 'chat.completion',
          usage: {
            completion_tokens: 40,
            prompt_tokens: 15,
            total_tokens: 55,
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });

  const result = await runner.adaptPlatformVariants('改写为三平台版本');

  assert.equal(requestCount, 1);
  assert.deepEqual(result.platformVariants, platformVariants);
  assert.equal(result.providerTaskRef, 'chatcmpl-platform-variants');
});

test('fixture copy generation streams paced JSON before returning the same result', async () => {
  const runner = new FixtureAiStreamingRunner();
  const started = runner.startCopyStream({
    catalogModelId: 'llm-openai',
    prompt: 'Write grounded appointment copy.',
  });

  const chunks = await readChunks(started.response);
  const result = await started.result;
  const streamed = JSON.parse(chunks.join('')) as typeof result;

  assert.ok(chunks.length >= 2);
  assert.equal(
    started.response.headers.get('x-meiye-stream-protocol'),
    'ai-sdk-object-json-v1'
  );
  assert.equal(streamed.candidates.length, 3);
  assert.deepEqual(streamed.candidates, result.candidates);
});

test('fixture copy generation leaves an observable partial-object interval', async () => {
  const runner = new FixtureAiStreamingRunner();
  const started = runner.startCopyStream({
    catalogModelId: 'llm-openai',
    prompt: 'Show an observable partial object.',
  });
  assert.ok(started.response.body);
  const reader = started.response.body.getReader();
  const decoder = new TextDecoder();

  const first = await reader.read();
  assert.equal(first.done, false);
  assert.match(decoder.decode(first.value), /真实到店记录/u);

  const secondRead = reader.read();
  const earlyState = await Promise.race([
    secondRead.then(() => 'chunk' as const),
    new Promise<'waiting'>((resolve) => {
      setTimeout(() => resolve('waiting'), 40);
    }),
  ]);
  assert.equal(earlyState, 'waiting');

  await secondRead;
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
  await started.result;
});

test('fixture copy generation stops pending chunks and completion when aborted', async () => {
  const runner = new FixtureAiStreamingRunner();
  const abortController = new AbortController();
  const started = runner.startCopyStream(
    {
      catalogModelId: 'llm-openai',
      prompt: 'Stop after the first partial chunk.',
    },
    abortController.signal
  );
  assert.ok(started.response.body);
  const reader = started.response.body.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);

  abortController.abort();
  await assert.rejects(reader.read(), { name: 'AbortError' });
  await assert.rejects(started.result, { name: 'AbortError' });
});

test('fixture assistant emits safe tool and data parts through an AI SDK UI message stream', async () => {
  const runner = new FixtureAiStreamingRunner();
  const response = runner.streamAssistant({
    catalogModelId: 'llm-openai',
    context: {
      workId: 'work-private-id',
      intent: 'Write grounded appointment copy.',
      sourceSummaries: ['asset:private-source-id'],
    },
    messages: [{ role: 'user', content: 'Help refine the angle.' }],
  });

  const chunks = await readChunks(response);
  const payload = chunks.join('');
  const events = parseSseEvents(payload);
  const messages = readUIMessageStream({ stream: chunkStream(events) });
  let completedMessage: UIMessage | undefined;
  for await (const message of messages) completedMessage = message;

  assert.ok(chunks.length >= 2);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(
    response.headers.get('x-meiye-stream-protocol'),
    'ai-sdk-ui-message-v1'
  );
  assert.deepEqual(
    completedMessage?.parts.map((part) => part.type),
    [
      'text',
      'tool-readCurrentContext',
      'data-context',
      'tool-proposeFieldPatch',
      'data-field_patch',
    ]
  );
  const contextToolPart = completedMessage?.parts.find(
    (part) => part.type === 'tool-readCurrentContext'
  );
  assert.ok(contextToolPart && 'state' in contextToolPart);
  assert.equal(contextToolPart.state, 'output-available');
  const patchToolPart = completedMessage?.parts.find(
    (part) => part.type === 'tool-proposeFieldPatch'
  );
  assert.ok(patchToolPart && 'state' in patchToolPart);
  assert.equal(patchToolPart.state, 'output-available');
  assert.match(payload, /"type":"data-field_patch"/u);
  assert.match(payload, /## 建议方向/u);
  assert.match(payload, /核对门店信息/u);
  assert.doesNotMatch(payload, /work-private-id|private-source-id/u);
  assert.match(payload, /data: \[DONE\]/u);
});

test('formal assistant continues after reading current context', async () => {
  const requests: Array<Record<string, unknown>> = [];
  const responses = [
    openAiStreamResponse([
      {
        choices: [
          {
            delta: {
              role: 'assistant',
              tool_calls: [
                {
                  function: {
                    arguments: '{}',
                    name: 'readCurrentContext',
                  },
                  id: 'call-read-context',
                  index: 0,
                },
              ],
            },
            finish_reason: null,
            index: 0,
          },
        ],
        created: 1,
        id: 'chatcmpl-context-tool',
        model: 'provider-model',
        object: 'chat.completion.chunk',
      },
      {
        choices: [
          {
            delta: {},
            finish_reason: 'tool_calls',
            index: 0,
          },
        ],
        created: 1,
        id: 'chatcmpl-context-tool',
        model: 'provider-model',
        object: 'chat.completion.chunk',
        usage: {
          completion_tokens: 4,
          prompt_tokens: 8,
          total_tokens: 12,
        },
      },
    ]),
    openAiStreamResponse([
      {
        choices: [
          {
            delta: {
              content: '按当前真实到店场景，我建议先突出可核验的服务细节。',
              role: 'assistant',
            },
            finish_reason: null,
            index: 0,
          },
        ],
        created: 2,
        id: 'chatcmpl-context-answer',
        model: 'provider-model',
        object: 'chat.completion.chunk',
      },
      {
        choices: [
          {
            delta: {},
            finish_reason: 'stop',
            index: 0,
          },
        ],
        created: 2,
        id: 'chatcmpl-context-answer',
        model: 'provider-model',
        object: 'chat.completion.chunk',
        usage: {
          completion_tokens: 10,
          prompt_tokens: 20,
          total_tokens: 30,
        },
      },
    ]),
  ];
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiKey: 'test-key',
    baseUrl: 'https://provider.example/v1',
    catalogModelId: 'llm-fixed',
    fetch: (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const response = responses.shift();
      assert.ok(response, 'unexpected provider request');
      return response;
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'provider-model',
    outputCostPerMillion: 2,
  });

  const response = runner.streamAssistant({
    catalogModelId: 'llm-fixed',
    context: {
      intent: '突出真实到店服务细节',
      scene: '真实到店',
      sourceSummaries: ['门店环境实拍'],
      workId: 'work-context-loop',
    },
    messages: [{ content: '请结合当前场景给建议。', role: 'user' }],
  });
  const payload = (await readChunks(response)).join('');

  assert.equal(requests.length, 2);
  assert.match(payload, /按当前真实到店场景/u);
  const secondMessages = requests[1]?.messages as Array<{
    content?: string;
    role?: string;
    tool_call_id?: string;
  }>;
  assert.ok(
    secondMessages.some(
      (message) =>
        message.role === 'tool' &&
        message.tool_call_id === 'call-read-context' &&
        message.content?.includes('work-context-loop')
    )
  );
});

test('formal model supply stream performs one provider effect and persists only the final object', async () => {
  class CountingRunner extends FixtureAiStreamingRunner {
    calls = 0;
    failure?: { afterChunk: boolean; statusCode: number };

    override startCopyStream(request: {
      catalogModelId: string;
      prompt: string;
    }) {
      this.calls += 1;
      if (this.failure) {
        const failure = this.failure;
        return {
          response: new Response(failure.afterChunk ? 'partial' : null),
          result: new Promise<never>((_resolve, reject) => {
            setTimeout(() => {
              reject(
                Object.assign(new Error('provider stream failed'), {
                  statusCode: failure.statusCode,
                })
              );
            }, 20);
          }),
        };
      }
      return super.startCopyStream(request);
    }
  }
  const runner = new CountingRunner();
  const saved: unknown[] = [];
  const service = new ModelSupplyApplicationService({
    models: [
      {
        id: 'llm-openai',
        modality: 'llm',
        operations: ['copy.generate'],
        displayName: 'OpenAI copy',
        qualityRank: 100,
      },
    ],
    deployments: [
      {
        id: 'openai-live',
        catalogModelId: 'llm-openai',
        apiFamily: 'openai',
        channel: 'direct',
        region: 'overseas',
        status: 'active',
        activationEvidence: { status: 'live_verified' },
      },
    ],
    execution: new RecordedProviderExecutionPort(),
    resultSink: {
      async saveResult(_workspaceId, result) {
        saved.push(structuredClone(result));
      },
    },
  });
  const submission = (idempotencyKey: string) => ({
    workspaceId: 'workspace-a',
    actorId: 'owner-a',
    correlationId: 'corr-copy-stream',
    idempotencyKey,
    operation: 'copy.generate' as const,
    selection: {
      mode: 'fixed' as const,
      catalogModelId: 'llm-openai',
    },
    dataClass: [],
    prompt: 'Write grounded appointment copy.',
  });

  const started = await service.startCopyStream(
    submission('formal-copy-stream-key'),
    runner
  );
  const chunks = await readChunks(started.response);
  const completed = await started.completion;

  assert.ok(chunks.length >= 2);
  assert.equal(runner.calls, 1);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.copyCandidates?.length, 3);
  assert.equal(saved.length, 1);

  runner.failure = { afterChunk: false, statusCode: 429 };
  const rejected = await service.startCopyStream(
    submission('formal-copy-stream-rejected'),
    runner
  );
  assert.equal(await rejected.response.text(), '');
  const rejectedResult = await rejected.completion;
  assert.equal(rejectedResult.status, 'failed');
  assert.equal(rejectedResult.attempt.acceptance, 'rejected_before_accept');

  runner.failure = { afterChunk: true, statusCode: 429 };
  const interrupted = await service.startCopyStream(
    submission('formal-copy-stream-interrupted'),
    runner
  );
  assert.equal(await interrupted.response.text(), 'partial');
  const interruptedResult = await interrupted.completion;
  assert.equal(interruptedResult.status, 'unknown');
  assert.equal(interruptedResult.attempt.acceptance, 'acceptance_unknown');
  // Td-2: copy stream partial interrupt refunds the product usage reservation.
  assert.equal(interruptedResult.usage.status, 'refunded');
  assert.equal(runner.calls, 3);
});

test('formal model supply stream rejects before the runner when the mode gate disables execution', async () => {
  class CountingRunner extends FixtureAiStreamingRunner {
    calls = 0;

    override startCopyStream(request: {
      catalogModelId: string;
      prompt: string;
    }) {
      this.calls += 1;
      return super.startCopyStream(request);
    }
  }
  const runner = new CountingRunner();
  let disabled = true;
  const service = new ModelSupplyApplicationService({
    models: [
      {
        id: 'llm-openai',
        modality: 'llm',
        operations: ['copy.generate'],
        displayName: 'OpenAI copy',
        qualityRank: 100,
      },
    ],
    deployments: [
      {
        id: 'openai-live',
        catalogModelId: 'llm-openai',
        apiFamily: 'openai',
        channel: 'direct',
        region: 'overseas',
        status: 'active',
        activationEvidence: { status: 'live_verified' },
      },
    ],
    execution: new RecordedProviderExecutionPort(),
    submissionGate: {
      async blocksNewSubmission() {
        return disabled;
      },
    },
  });
  const submission = (idempotencyKey: string) => ({
    workspaceId: 'workspace-a',
    actorId: 'owner-a',
    correlationId: 'corr-copy-stream-gate',
    idempotencyKey,
    operation: 'copy.generate' as const,
    selection: {
      mode: 'fixed' as const,
      catalogModelId: 'llm-openai',
    },
    dataClass: [],
    prompt: 'Write grounded appointment copy.',
  });

  const blocked = await service.startCopyStream(
    submission('gated-copy-stream-key'),
    runner
  );
  const blockedResult = await blocked.completion;
  assert.equal(runner.calls, 0);
  assert.equal(blockedResult.status, 'failed');
  assert.equal(blockedResult.attempt.acceptance, 'rejected_before_accept');
  assert.equal(blockedResult.providerCost.amount, 0);

  disabled = false;
  const allowed = await service.startCopyStream(
    submission('ungated-copy-stream-key'),
    runner
  );
  const allowedResult = await allowed.completion;
  assert.equal(runner.calls, 1);
  assert.equal(allowedResult.status, 'completed');
});

async function readChunks(response: Response) {
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }
  return chunks;
}

function parseSseEvents(payload: string) {
  return payload
    .split('\n\n')
    .map((record) => record.trim())
    .filter(
      (record) => record.startsWith('data: ') && record !== 'data: [DONE]'
    )
    .map((record) => JSON.parse(record.slice(6)) as UIMessageChunk);
}

function chunkStream(events: UIMessageChunk[]) {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const event of events) controller.enqueue(event);
      controller.close();
    },
  });
}

function openAiStreamResponse(chunks: Array<Record<string, unknown>>) {
  return new Response(
    `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } }
  );
}

test('native anthropic family routes requests to the /v1/messages endpoint', async () => {
  let calledUrl = '';
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiFamily: 'anthropic',
    apiKey: 'test-key',
    baseUrl: 'https://anthropic.example/v1',
    catalogModelId: 'llm-anthropic',
    fetch: (async (input) => {
      calledUrl = typeof input === 'string' ? input : (input as Request).url;
      throw new Error('probe: request captured');
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'claude-x',
    outputCostPerMillion: 2,
  });

  await assert.rejects(runner.generateCopy('probe'));
  assert.match(calledUrl, /anthropic\.example\/v1\/messages$/);
});

test('native gemini family routes requests to the generateContent endpoint', async () => {
  let calledUrl = '';
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiFamily: 'gemini',
    apiKey: 'test-key',
    baseUrl: 'https://gemini.example/v1beta',
    catalogModelId: 'llm-gemini',
    fetch: (async (input) => {
      calledUrl = typeof input === 'string' ? input : (input as Request).url;
      throw new Error('probe: request captured');
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'gemini-x',
    outputCostPerMillion: 2,
  });

  await assert.rejects(runner.generateCopy('probe'));
  assert.match(calledUrl, /gemini\.example\/v1beta\/models\/gemini-x/);
  assert.match(calledUrl, /generateContent/);
});

test('custom openai chat protocol routes requests to the configured chat completions endpoint', async () => {
  let calledUrl = '';
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiFamily: 'custom',
    apiKey: 'test-key',
    baseUrl: 'https://custom.example/v1',
    catalogModelId: 'llm-custom',
    customProtocol: 'openai_chat',
    fetch: (async (input) => {
      calledUrl = typeof input === 'string' ? input : (input as Request).url;
      throw new Error('probe: request captured');
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'custom-model',
    outputCostPerMillion: 2,
  });

  await assert.rejects(runner.generateCopy('probe'));
  assert.match(calledUrl, /custom\.example\/v1\/chat\/completions$/);
});

test('custom anthropic messages protocol routes requests to the configured messages endpoint', async () => {
  let calledUrl = '';
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiFamily: 'custom',
    apiKey: 'test-key',
    baseUrl: 'https://custom.example/v1',
    catalogModelId: 'llm-custom',
    customProtocol: 'anthropic_messages',
    fetch: (async (input) => {
      calledUrl = typeof input === 'string' ? input : (input as Request).url;
      throw new Error('probe: request captured');
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'custom-model',
    outputCostPerMillion: 2,
  });

  await assert.rejects(runner.generateCopy('probe'));
  assert.match(calledUrl, /custom\.example\/v1\/messages$/);
});

test('custom gemini protocol routes requests to the configured generateContent endpoint', async () => {
  let calledUrl = '';
  const runner = new OpenAiCompatibleAiSdkRunner({
    apiFamily: 'custom',
    apiKey: 'test-key',
    baseUrl: 'https://custom.example/v1beta',
    catalogModelId: 'llm-custom',
    customProtocol: 'gemini_generate_content',
    fetch: (async (input) => {
      calledUrl = typeof input === 'string' ? input : (input as Request).url;
      throw new Error('probe: request captured');
    }) as typeof fetch,
    inputCostPerMillion: 1,
    model: 'custom-model',
    outputCostPerMillion: 2,
  });

  await assert.rejects(runner.generateCopy('probe'));
  assert.match(calledUrl, /custom\.example\/v1beta\/models\/custom-model/);
  assert.match(calledUrl, /generateContent/);
});

test('custom API family requires an explicit request protocol', () => {
  assert.throws(
    () =>
      new OpenAiCompatibleAiSdkRunner({
        apiFamily: 'custom',
        apiKey: 'test-key',
        baseUrl: 'https://custom.example/v1',
        catalogModelId: 'llm-custom',
        inputCostPerMillion: 1,
        model: 'custom-model',
        outputCostPerMillion: 2,
      }),
    /customProtocol is required/,
  );
});

test('native API families reject a custom request protocol', () => {
  assert.throws(
    () =>
      new OpenAiCompatibleAiSdkRunner({
        apiFamily: 'openai',
        apiKey: 'test-key',
        baseUrl: 'https://openai.example/v1',
        catalogModelId: 'llm-openai',
        customProtocol: 'openai_chat',
        inputCostPerMillion: 1,
        model: 'native-model',
        outputCostPerMillion: 2,
      }),
    /customProtocol is only supported/,
  );
});
