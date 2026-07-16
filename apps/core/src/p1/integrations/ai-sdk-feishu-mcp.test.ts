import assert from 'node:assert/strict';
import test from 'node:test';
import type { MCPClientConfig } from '@ai-sdk/mcp';
import { AiSdkFeishuMcpAdapter } from './index.js';

test('AI SDK MCP discovery is not cropped by the execution allowlist', async () => {
  const configs: MCPClientConfig[] = [];
  const calls: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
  const clients = [
    {
      serverInfo: { name: 'lark-mcp', version: 'official-2026-07' },
      initializeResult: { protocolVersion: '2024-11-05' },
      async listTools() {
        return {
          tools: [
            {
              name: 'docx.v1.document.rawContent',
              description: 'Read a document',
              inputSchema: {
                type: 'object' as const,
                properties: { document_id: { type: 'string' } },
              },
            },
            {
              name: 'calendar.v4.calendarEvent.create',
              description: 'A newly published official tool',
              inputSchema: {
                type: 'object' as const,
                properties: { summary: { type: 'string' } },
              },
            },
          ],
        };
      },
      async callTool() {
        throw new Error('not used');
      },
      async close() {},
    },
    {
      serverInfo: { name: 'lark-mcp', version: 'official-2026-07' },
      initializeResult: { protocolVersion: '2024-11-05' },
      async listTools() {
        throw new Error('not used');
      },
      async callTool(input: { name: string; arguments?: Record<string, unknown> }) {
        calls.push(input);
        return {
          content: [{ type: 'text' as const, text: 'document body' }],
          structuredContent: {
            document_id: 'doc-a',
            url: 'https://example.feishu.cn/docx/doc-a',
          },
          isError: false,
        };
      },
      async close() {},
    },
  ];
  const adapter = new AiSdkFeishuMcpAdapter({
    endpoint: 'https://mcp.feishu.cn/mcp',
    catalogAllowedTools: [
      'docx.v1.document.rawContent',
      'docx.v1.document.create',
      'docx.v1.document.update',
    ],
    riskByTool: { 'docx.v1.document.rawContent': 'read' },
    clientFactory: async (config) => {
      configs.push(config);
      return clients.shift()!;
    },
  });

  const discovered = await adapter.discover({ uat: 'uat-secret' });
  assert.deepEqual(
    discovered.map((tool) => tool.id),
    [
      'docx.v1.document.rawContent',
      'calendar.v4.calendarEvent.create',
    ]
  );
  assert.equal(discovered[0]?.remoteRevision, 'lark-mcp@official-2026-07:2024-11-05');
  assert.equal(discovered[0]?.risk, 'read');
  assert.deepEqual(configs[0], {
    transport: {
      type: 'http',
      url: 'https://mcp.feishu.cn/mcp',
      redirect: 'error',
      headers: {
        'X-Lark-MCP-UAT': 'uat-secret',
      },
    },
    maxRetries: 0,
  });

  const called = await adapter.call({
    uat: 'uat-secret',
    toolId: 'docx.v1.document.rawContent',
    allowedTools: ['docx.v1.document.rawContent'],
    arguments: { document_id: 'doc-a' },
  });
  assert.deepEqual(calls, [
    { name: 'docx.v1.document.rawContent', arguments: { document_id: 'doc-a' } },
  ]);
  assert.deepEqual(called, {
    status: 'ok',
    objectId: 'doc-a',
    externalUrl: 'https://example.feishu.cn/docx/doc-a',
    content: 'document body',
    output: {
      document_id: 'doc-a',
      url: 'https://example.feishu.cn/docx/doc-a',
    },
  });
  const secondTransport = configs[1]!.transport;
  assert.equal('headers' in secondTransport && secondTransport.headers?.['X-Lark-MCP-Allowed-Tools'], 'docx.v1.document.rawContent');
});

test('AI SDK MCP adapter classifies auth, permission, rate and unknown failures', async () => {
  const errors = [
    { statusCode: 401 },
    { statusCode: 403 },
    { statusCode: 429 },
    new Error('connection reset after request'),
  ];
  const adapter = new AiSdkFeishuMcpAdapter({
    endpoint: 'https://mcp.feishu.cn/mcp',
    catalogAllowedTools: ['docx.v1.document.rawContent'],
    riskByTool: { 'docx.v1.document.rawContent': 'read' },
    clientFactory: async () => {
      throw errors.shift();
    },
  });
  const request = {
    uat: 'uat-secret',
    toolId: 'docx.v1.document.rawContent',
    allowedTools: ['docx.v1.document.rawContent'],
    arguments: { document_id: 'doc-a' },
  };

  assert.deepEqual(await adapter.call(request), { status: 'unauthorized' });
  assert.deepEqual(await adapter.call(request), { status: 'forbidden' });
  assert.deepEqual(await adapter.call(request), { status: 'rate_limited' });
  assert.deepEqual(await adapter.call(request), { status: 'unknown' });
});

test('AI SDK MCP reconciliation uses only the configured inspect tool and immutable envelope', async () => {
  const configs: MCPClientConfig[] = [];
  const calls: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
  const adapter = new AiSdkFeishuMcpAdapter({
    endpoint: 'https://mcp.feishu.cn/mcp',
    reconcileToolId: 'meiye.intent.inspect',
    riskByTool: {},
    clientFactory: async (config) => {
      configs.push(config);
      return {
        serverInfo: { name: 'lark-mcp', version: 'official-2026-07' },
        initializeResult: { protocolVersion: '2024-11-05' },
        async listTools() {
          throw new Error('not used');
        },
        async callTool(input) {
          calls.push(input);
          return {
            content: [],
            isError: false,
            structuredContent: {
              document_id: 'doc-reconciled',
              provider_log_id: 'log-safe',
              status: 'completed',
              url: 'https://example.feishu.cn/docx/doc-reconciled',
            },
          };
        },
        async close() {},
      };
    },
  });

  assert.deepEqual(
    await adapter.reconcile({
      argumentHash: 'a'.repeat(64),
      fields: ['title'],
      intentId: 'intent-a',
      schemaHash: 'b'.repeat(64),
      sideEffect: 'create',
      targetObjectId: 'folder-a',
      toolId: 'docx.v1.document.create',
      toolRevision: 'official-r1:hash',
      uat: 'uat-secret',
    }),
    {
      externalUrl: 'https://example.feishu.cn/docx/doc-reconciled',
      objectId: 'doc-reconciled',
      providerLogId: 'log-safe',
      status: 'completed',
    }
  );
  assert.deepEqual(calls, [
    {
      arguments: {
        argument_hash: 'a'.repeat(64),
        fields: ['title'],
        intent_id: 'intent-a',
        schema_hash: 'b'.repeat(64),
        side_effect: 'create',
        target_object_id: 'folder-a',
        tool_id: 'docx.v1.document.create',
        tool_revision: 'official-r1:hash',
      },
      name: 'meiye.intent.inspect',
    },
  ]);
  const transport = configs[0]!.transport;
  assert.equal(
    'headers' in transport &&
      transport.headers?.['X-Lark-MCP-Allowed-Tools'],
    'meiye.intent.inspect'
  );
});
