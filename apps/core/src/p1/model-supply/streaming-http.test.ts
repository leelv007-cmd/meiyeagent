import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createCoreServer } from '../../server.js';
import type { OperationsApplicationService } from '../operations/application-service.js';
import { FixtureAiStreamingRunner } from './ai-sdk-runner.js';

test('assistant HTTP stream enforces identity and forwards paced fixture chunks', async (t) => {
  const runner = new FixtureAiStreamingRunner();
  type Workbench = Awaited<
    ReturnType<OperationsApplicationService['getCreativeWorkbench']>
  >;
  const operationsService: Pick<
    OperationsApplicationService,
    'getCreativeWorkbench'
  > = {
    async getCreativeWorkbench() {
      return {
        assets: [],
        contents: [],
        events: [],
        jobs: [],
        works: [
          {
            id: 'work-a',
            workspaceId: 'workspace-a',
            sessionId: 'session-a',
            intent: '写一条真实项目介绍',
            mode: 'agent',
            sourceReferences: [],
            status: 'draft',
            createdAt: '2026-07-13T00:00:00.000Z',
            updatedAt: '2026-07-13T00:00:00.000Z',
          },
        ],
      } as Workbench;
    },
  };
  const server = createCoreServer({
    aiStreamingRunner: runner,
    operationsService,
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}/v1/workspaces/workspace-a`;
  const headers = {
    'content-type': 'application/json',
    'x-correlation-id': 'corr-stream-http',
    'x-service-token': 'test-service-token',
    'x-user-id': 'owner-a',
    'x-workspace-id': 'workspace-a',
    'x-workspace-role': 'owner',
  };

  const assistant = await fetch(`${base}/p1/assistant/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      catalogModelId: 'llm-openai',
      context: {
        workId: 'work-a',
        intent: '写一条真实项目介绍',
        sourceSummaries: [],
      },
      messages: [{ role: 'user', content: '帮我整理角度' }],
    }),
  });
  const assistantChunks = await readChunks(assistant);
  assert.equal(assistant.status, 200);
  assert.ok(assistantChunks.length >= 2);
  assert.equal(
    assistant.headers.get('x-meiye-stream-protocol'),
    'ai-sdk-ui-message-v1'
  );

  const reviewer = await fetch(`${base}/p1/assistant/stream`, {
    method: 'POST',
    headers: {
      ...headers,
      'x-user-id': 'reviewer-a',
      'x-workspace-role': 'reviewer',
    },
    body: JSON.stringify({
      catalogModelId: 'llm-openai',
      context: {
        workId: 'work-a',
        intent: '写一条真实项目介绍',
        sourceSummaries: [],
      },
      messages: [{ role: 'user', content: '越权创作' }],
    }),
  });
  assert.equal(reviewer.status, 403);

  const spoofed = await fetch(`${base}/p1/assistant/stream`, {
    method: 'POST',
    headers: { ...headers, 'x-workspace-id': 'workspace-b' },
    body: '{}',
  });
  assert.equal(spoofed.status, 404);

  const foreignWork = await fetch(`${base}/p1/assistant/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      catalogModelId: 'llm-openai',
      context: {
        workId: 'work-b',
        intent: '伪造的其他创作记录',
        sourceSummaries: [],
      },
      messages: [{ role: 'user', content: '帮我处理' }],
    }),
  });
  assert.equal(foreignWork.status, 404);
});

test('assistant stream is rejected while the execution mode gate is disabled', async (t) => {
  const runner = new FixtureAiStreamingRunner();
  let disabled = true;
  let assistantWorkbenchReads = 0;
  const operationsService: Pick<
    OperationsApplicationService,
    'getCreativeWorkbench'
  > = {
    async getCreativeWorkbench() {
      assistantWorkbenchReads += 1;
      throw new Error('gate must reject before the workbench read');
    },
  };
  const server = createCoreServer({
    aiStreamingRunner: runner,
    executionModeGate: {
      async blocksNewSubmission() {
        return disabled;
      },
    },
    operationsService,
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const streamAssistant = () =>
    fetch(
      `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1/assistant/stream`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-service-token': 'test-service-token',
          'x-user-id': 'owner-a',
          'x-workspace-id': 'workspace-a',
          'x-workspace-role': 'owner',
        },
        body: JSON.stringify({
          catalogModelId: 'llm-openai',
          context: {
            workId: 'work-a',
            intent: '写一条真实项目介绍',
            sourceSummaries: [],
          },
          messages: [{ role: 'user', content: '帮我整理角度' }],
        }),
      }
    );

  const blocked = await streamAssistant();
  const payload = (await blocked.json()) as {
    error: { code: string; message: string };
  };
  assert.equal(blocked.status, 503);
  assert.equal(payload.error.code, 'MODEL_EXECUTION_DISABLED');
  assert.match(payload.error.message, /模型执行已停用/);
  assert.equal(assistantWorkbenchReads, 0);

  disabled = false;
  const allowed = await streamAssistant();
  assert.equal(allowed.status, 502);
  assert.equal(assistantWorkbenchReads, 1);
});

test('assistant HTTP stream stays unavailable when no verified runner is installed', async (t) => {
  const server = createCoreServer({
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const response = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1/assistant/stream`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-service-token': 'test-service-token',
        'x-user-id': 'owner-a',
        'x-workspace-id': 'workspace-a',
        'x-workspace-role': 'owner',
      },
      body: '{}',
    }
  );
  assert.equal(response.status, 503);
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
