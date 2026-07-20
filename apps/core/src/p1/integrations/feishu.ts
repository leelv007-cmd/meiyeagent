import type {
  FeishuMcpAdapterPort,
  FeishuRemoteTool,
  FeishuReconciliationResult,
  FeishuToolCallResult,
} from './contracts.js';
import {
  createMCPClient,
  type CallToolResult,
  type ListToolsResult,
  type MCPClientConfig,
} from '@ai-sdk/mcp';

export class RecordedFeishuMcpAdapter implements FeishuMcpAdapterPort {
  private readonly callQueue: FeishuToolCallResult[] = [];
  private readonly reconcileQueue: FeishuReconciliationResult[] = [];
  private readonly recordedCalls: Array<{
    toolId: string;
    allowedTools: string[];
    arguments: Record<string, unknown>;
  }> = [];
  private readonly recordedReconciliations: Array<
    Omit<Parameters<NonNullable<FeishuMcpAdapterPort['reconcile']>>[0], 'uat'>
  > = [];

  constructor(
    private tools: FeishuRemoteTool[],
    private readonly options: { succeedByDefault?: boolean } = {}
  ) {}

  setTools(tools: FeishuRemoteTool[]) {
    this.tools = structuredClone(tools);
  }

  queueCallResult(result: FeishuToolCallResult) {
    this.callQueue.push(structuredClone(result));
  }

  queueReconciliationResult(result: FeishuReconciliationResult) {
    this.reconcileQueue.push(structuredClone(result));
  }

  calls() {
    return structuredClone(this.recordedCalls);
  }

  reconciliations() {
    return structuredClone(this.recordedReconciliations);
  }

  async discover(_request: { uat: string }) {
    return structuredClone(this.tools);
  }

  async call(request: {
    uat: string;
    toolId: string;
    allowedTools: string[];
    arguments: Record<string, unknown>;
  }) {
    this.recordedCalls.push({
      toolId: request.toolId,
      allowedTools: [...request.allowedTools],
      arguments: structuredClone(request.arguments),
    });
    const fallback: FeishuToolCallResult = this.options.succeedByDefault
      ? {
          content: `Recorded result for ${request.toolId}`,
          objectId: `recorded-${request.toolId.replace(/[^a-z0-9]+/gi, '-')}`,
          output: {
            adapter: 'recorded',
            arguments: structuredClone(request.arguments),
            toolId: request.toolId,
          },
          status: 'ok',
        }
      : {
          status: 'failed',
          errorCode: 'recorded_not_configured',
        };
    return structuredClone(this.callQueue.shift() ?? fallback);
  }

  async reconcile(
    request: Parameters<NonNullable<FeishuMcpAdapterPort['reconcile']>>[0]
  ): Promise<FeishuReconciliationResult> {
    const { uat: _uat, ...envelope } = request;
    this.recordedReconciliations.push(structuredClone(envelope));
    const result: FeishuReconciliationResult =
      this.reconcileQueue.shift() ?? {
        errorCode: 'recorded_reconciliation_not_configured',
        status: 'unknown' as const,
      };
    return structuredClone(result);
  }
}

interface McpClientPort {
  serverInfo: { name: string; version: string };
  initializeResult: { protocolVersion: string };
  listTools(): Promise<ListToolsResult>;
  callTool(input: {
    name: string;
    arguments?: Record<string, unknown>;
  }): Promise<CallToolResult>;
  close(): Promise<void>;
}

type McpClientFactory = (config: MCPClientConfig) => Promise<McpClientPort>;

export class AiSdkFeishuMcpAdapter implements FeishuMcpAdapterPort {
  private readonly clientFactory: McpClientFactory;

  constructor(
    private readonly options: {
      endpoint: string;
      catalogAllowedTools?: string[];
      reconcileToolId?: string;
      riskByTool: Record<string, FeishuRemoteTool['risk']>;
      clientFactory?: McpClientFactory;
    }
  ) {
    this.clientFactory =
      options.clientFactory ?? (createMCPClient as unknown as McpClientFactory);
  }

  async discover(request: { uat: string }) {
    const client = await this.createClient(request.uat);
    try {
      const result = await client.listTools();
      const remoteRevision = `${client.serverInfo.name}@${client.serverInfo.version}:${client.initializeResult.protocolVersion}`;
      return result.tools.map((tool) => ({
        id: tool.name,
        remoteRevision,
        source: this.options.endpoint,
        risk: this.options.riskByTool[tool.name] ?? ('open_world' as const),
        inputSchema: structuredClone(tool.inputSchema) as Record<string, unknown>,
      }));
    } finally {
      await this.closeQuietly(client);
    }
  }

  async call(request: {
    uat: string;
    toolId: string;
    allowedTools: string[];
    arguments: Record<string, unknown>;
  }): Promise<FeishuToolCallResult> {
    if (
      request.allowedTools.length === 0 ||
      !request.allowedTools.includes(request.toolId) ||
      ((this.options.catalogAllowedTools?.length ?? 0) > 0 &&
        request.allowedTools.some(
          (toolId) => !this.options.catalogAllowedTools?.includes(toolId)
        ))
    ) {
      return { status: 'forbidden', errorCode: 'allowed_tools_mismatch' };
    }
    let client: McpClientPort | undefined;
    try {
      client = await this.createClient(request.uat, request.allowedTools);
      const result = await client.callTool({
        name: request.toolId,
        arguments: structuredClone(request.arguments),
      });
      return this.normalize(result);
    } catch (error) {
      return this.classify(error);
    } finally {
      await this.closeQuietly(client);
    }
  }

  async reconcile(
    request: Parameters<NonNullable<FeishuMcpAdapterPort['reconcile']>>[0]
  ): Promise<FeishuReconciliationResult> {
    const reconcileToolId = this.options.reconcileToolId?.trim();
    if (!reconcileToolId) {
      return { status: 'unknown', errorCode: 'reconcile_tool_unavailable' };
    }
    let client: McpClientPort | undefined;
    try {
      client = await this.createClient(request.uat, [reconcileToolId]);
      const called = this.normalize(
        await client.callTool({
          name: reconcileToolId,
          arguments: {
            argument_hash: request.argumentHash,
            fields: [...request.fields],
            intent_id: request.intentId,
            schema_hash: request.schemaHash,
            side_effect: request.sideEffect,
            ...(request.targetObjectId
              ? { target_object_id: request.targetObjectId }
              : {}),
            tool_id: request.toolId,
            tool_revision: request.toolRevision,
          },
        })
      );
      if (called.status !== 'ok') {
        return {
          status: 'unknown',
          errorCode:
            'errorCode' in called && called.errorCode
              ? called.errorCode
              : `reconcile_${called.status}`,
        };
      }
      const status = called.output?.status;
      const providerLogId = this.stringField(called.output, [
        'provider_log_id',
        'request_id',
      ]);
      if (status === 'completed') {
        return {
          status,
          ...(called.objectId ? { objectId: called.objectId } : {}),
          ...(called.externalUrl ? { externalUrl: called.externalUrl } : {}),
          ...(providerLogId ? { providerLogId } : {}),
        };
      }
      if (status === 'not_found') {
        return {
          status,
          ...(providerLogId ? { providerLogId } : {}),
        };
      }
      return {
        status: status === 'failed' ? 'failed' : 'unknown',
        errorCode:
          this.stringField(called.output, ['error_code']) ??
          'reconcile_outcome_unknown',
        ...(providerLogId ? { providerLogId } : {}),
      };
    } catch {
      return { status: 'unknown', errorCode: 'reconcile_transport_unknown' };
    } finally {
      await this.closeQuietly(client);
    }
  }

  private createClient(uat: string, allowedTools?: string[]) {
    return this.clientFactory({
      transport: {
        type: 'http',
        url: this.options.endpoint,
        redirect: 'error',
        headers: {
          'X-Lark-MCP-UAT': uat,
          ...(allowedTools?.length
            ? { 'X-Lark-MCP-Allowed-Tools': allowedTools.join(',') }
            : {}),
        },
      },
      maxRetries: 0,
    });
  }

  private normalize(result: CallToolResult): FeishuToolCallResult {
    if ('toolResult' in result) {
      const output = this.asRecord(result.toolResult);
      return {
        status: 'ok',
        output: output ?? { result: result.toolResult },
      };
    }
    if (result.isError) return { status: 'failed', errorCode: 'remote_tool_error' };
    const content = result.content
      .filter((item): item is Extract<(typeof result.content)[number], { type: 'text' }> =>
        item.type === 'text'
      )
      .map((item) => item.text)
      .join('\n');
    const output = this.asRecord(result.structuredContent) ?? this.parseRecord(content);
    return {
      status: 'ok',
      objectId: this.stringField(output, [
        'object_id',
        'document_id',
        'doc_token',
        'task_id',
      ]),
      externalUrl: this.stringField(output, ['external_url', 'url', 'link']),
      content: content || undefined,
      output: output ?? undefined,
    };
  }

  private classify(error: unknown): FeishuToolCallResult {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    const code = (error as { code?: number })?.code;
    if (statusCode === 401) return { status: 'unauthorized' };
    if (statusCode === 403) return { status: 'forbidden' };
    if (statusCode === 429 || code === -32030) return { status: 'rate_limited' };
    return { status: 'unknown' };
  }

  private asRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (structuredClone(value) as Record<string, unknown>)
      : undefined;
  }

  private parseRecord(value: string) {
    if (!value) return undefined;
    try {
      return this.asRecord(JSON.parse(value));
    } catch {
      return undefined;
    }
  }

  private stringField(
    record: Record<string, unknown> | undefined,
    fields: string[]
  ) {
    for (const field of fields) {
      if (typeof record?.[field] === 'string') return record[field] as string;
    }
    return undefined;
  }

  private async closeQuietly(client: McpClientPort | undefined) {
    try {
      await client?.close();
    } catch {
      // Session cleanup must not replace the already classified tool outcome.
    }
  }
}
