import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { DiagnosticRun } from '@meiye/contracts';
import type { DiagnosticRepository } from '../../diagnostics/repository.js';
import { P1DomainError } from '../foundation/domain.js';
import { createCoreServer } from '../../server.js';
import {
  OperationsError,
  type OperationsApplicationService,
} from '../operations/application-service.js';
import { FixtureAiStreamingRunner } from './ai-sdk-runner.js';

const diagnostics: DiagnosticRepository = {
  async create(run: DiagnosticRun) {
    return run;
  },
  async get() {
    return null;
  },
  async save(run: DiagnosticRun) {
    return run;
  },
};

const contract = {
  aigcLabelEnabled: true,
  catalogModelId: 'llm-openai',
  catalogRevision: 'catalog-live-v1',
  currency: 'CNY',
  dataClass: [],
  estimatedAmount: 1,
  operation: 'copy.generate' as const,
  outputCount: 1,
  outputLabel: '1 条主推荐',
  quoteAcceptedAt: '2026-07-13T00:00:00.000Z',
  quoteRevision: 'quote-live-v1',
  watermarkEnabled: false,
};

test('AI HTTP streams enforce identity and forward paced fixture chunks', async (t) => {
  const runner = new FixtureAiStreamingRunner();
  const copyCalls: Array<{ workId: string; submissionKey: string }> = [];
  type CopyStart = Awaited<
    ReturnType<OperationsApplicationService['startCreativeCopyStream']>
  >;
  let settleCopy: ((value: Awaited<CopyStart['completion']>) => void) | undefined;
  type Workbench = Awaited<
    ReturnType<OperationsApplicationService['getCreativeWorkbench']>
  >;
  const operationsService: Pick<
    OperationsApplicationService,
    'getCreativeWorkbench' | 'startCreativeCopyStream'
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
    async startCreativeCopyStream(
      _context,
      workId,
      receivedContract,
      submissionKey
    ) {
      copyCalls.push({ workId, submissionKey });
      const started = runner.startCopyStream({
        catalogModelId: receivedContract.catalogModelId,
        prompt: 'formal Work intent',
      });
      return {
        response: started.response,
        completion: new Promise<Awaited<CopyStart['completion']>>((resolve) => {
          settleCopy = resolve;
        }),
      };
    },
  };
  const server = createCoreServer({
    aiStreamingRunner: runner,
    diagnosticRepository: diagnostics,
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

  const copy = await fetch(`${base}/p1/copy/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      catalogModelId: 'llm-openai',
      contract,
      submissionKey: 'stable-copy-stream-key',
      workId: 'work-a',
    }),
  });
  assert.equal(copy.status, 200);
  assert.ok(copy.body);
  const copyReader = copy.body.getReader();
  const decoder = new TextDecoder();
  const copyChunks: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const chunk = await copyReader.read();
    assert.equal(chunk.done, false);
    copyChunks.push(decoder.decode(chunk.value, { stream: true }));
  }
  const finalRead = copyReader.read();
  const beforeSettlement = await Promise.race([
    finalRead.then(() => 'closed' as const),
    new Promise<'waiting'>((resolve) => {
      setTimeout(() => resolve('waiting'), 40);
    }),
  ]);
  assert.equal(beforeSettlement, 'waiting');
  assert.ok(settleCopy);
  settleCopy({} as Awaited<CopyStart['completion']>);
  assert.equal((await finalRead).done, true);
  assert.ok(copyChunks.length >= 2);
  assert.equal(JSON.parse(copyChunks.join('')).candidates.length, 1);
  assert.deepEqual(copyCalls, [
    { workId: 'work-a', submissionKey: 'stable-copy-stream-key' },
  ]);

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
    'getCreativeWorkbench' | 'startCreativeCopyStream'
  > = {
    async getCreativeWorkbench() {
      assistantWorkbenchReads += 1;
      throw new Error('gate must reject before the workbench read');
    },
    async startCreativeCopyStream() {
      throw new Error('not used');
    },
  };
  const server = createCoreServer({
    aiStreamingRunner: runner,
    diagnosticRepository: diagnostics,
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

test('copy stream hides unexpected internal error details', async (t) => {
  const runner = new FixtureAiStreamingRunner();
  const operationsService: Pick<
    OperationsApplicationService,
    'getCreativeWorkbench' | 'startCreativeCopyStream'
  > = {
    async getCreativeWorkbench() {
      throw new Error('not used');
    },
    async startCreativeCopyStream() {
      throw new Error('postgres://user:secret@db.internal/provider-key');
    },
  };
  const server = createCoreServer({
    aiStreamingRunner: runner,
    diagnosticRepository: diagnostics,
    operationsService,
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const response = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1/copy/stream`,
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
        contract,
        submissionKey: 'copy-stream-secret-error',
        workId: 'work-a',
      }),
    }
  );
  const payload = (await response.json()) as {
    error: { code: string; message: string };
  };

  assert.equal(response.status, 502);
  assert.deepEqual(payload.error, {
    code: 'COPY_STREAM_FAILED',
    message: 'The copy stream could not be started.',
  });
  assert.doesNotMatch(JSON.stringify(payload), /secret|db\.internal|provider-key/);
});

test('copy stream preserves an Operations domain error', async (t) => {
  const runner = new FixtureAiStreamingRunner();
  const operationsService: Pick<
    OperationsApplicationService,
    'getCreativeWorkbench' | 'startCreativeCopyStream'
  > = {
    async getCreativeWorkbench() {
      throw new Error('not used');
    },
    async startCreativeCopyStream() {
      throw new OperationsError(
        'COPY_STREAM_ALREADY_STARTED',
        'This submission already started. Read the existing Work instead of resubmitting.',
        409
      );
    },
  };
  const server = createCoreServer({
    aiStreamingRunner: runner,
    diagnosticRepository: diagnostics,
    operationsService,
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const response = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1/copy/stream`,
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
        contract,
        submissionKey: 'copy-stream-domain-error',
        workId: 'work-a',
      }),
    }
  );
  const payload = (await response.json()) as {
    error: { code: string; message: string };
  };

  assert.equal(response.status, 409);
  assert.deepEqual(payload.error, {
    code: 'COPY_STREAM_ALREADY_STARTED',
    message:
      'This submission already started. Read the existing Work instead of resubmitting.',
  });
});

test('copy stream preserves typed insufficient entitlement as 409', async (t) => {
  const runner = new FixtureAiStreamingRunner();
  const operationsService: Pick<
    OperationsApplicationService,
    'getCreativeWorkbench' | 'startCreativeCopyStream'
  > = {
    async getCreativeWorkbench() {
      throw new Error('not used');
    },
    async startCreativeCopyStream() {
      throw new P1DomainError(
        'INSUFFICIENT_ENTITLEMENT',
        'Copy allowance is insufficient.'
      );
    },
  };
  const server = createCoreServer({
    aiStreamingRunner: runner,
    diagnosticRepository: diagnostics,
    operationsService,
    serviceToken: 'test-service-token',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;

  const response = await fetch(
    `http://127.0.0.1:${port}/v1/workspaces/workspace-a/p1/copy/stream`,
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
        contract,
        submissionKey: 'copy-stream-quota',
        workId: 'work-a',
      }),
    }
  );

  assert.equal(response.status, 409);
  assert.deepEqual((await response.json()).error, {
    code: 'INSUFFICIENT_ENTITLEMENT',
    message: 'Copy allowance is insufficient.',
  });
});

test('AI HTTP streams stay unavailable when no verified runner is installed', async (t) => {
  const server = createCoreServer({
    diagnosticRepository: diagnostics,
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
