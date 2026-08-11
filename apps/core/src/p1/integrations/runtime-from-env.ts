import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import {
  AiSdkFeishuMcpAdapter,
  RecordedFeishuMcpAdapter,
} from './feishu.js';
import {
  LiveByokExecutionAdapter,
  RecordedByokExecutionAdapter,
} from './byok.js';
import {
  AwsSecretsManagerSecretStore,
  EncryptedFileSecretStore,
  FakeKmsSecretStore,
} from './secret-store.js';
import type { FeishuMcpAdapterPort, SecretStorePort } from './contracts.js';
import { assertIntegrationSecretStoreKey } from '@meiye/contracts';

type RuntimeEnv = Readonly<Record<string, string | undefined>>;

export function byokExecutionRuntimeFromEnv(env: RuntimeEnv) {
  const mode = env.BYOK_EXECUTION_MODE ?? 'recorded';
  if (mode === 'recorded') {
    return {
      adapter: new RecordedByokExecutionAdapter(),
      mode: 'recorded' as const,
      permittedModels: [] as string[],
    };
  }
  if (mode !== 'live') {
    throw new Error('BYOK_EXECUTION_MODE must be recorded or live.');
  }
  const modelBindings = parseByokModelBindings(env.BYOK_MODEL_BINDINGS);
  return {
    adapter: new LiveByokExecutionAdapter({ modelBindings }),
    mode: 'live' as const,
    permittedModels: Object.keys(modelBindings),
  };
}

export function integrationSecretStoreFromEnv(
  env: RuntimeEnv
): SecretStorePort {
  const mode = env.INTEGRATION_SECRET_STORE_MODE ?? 'file';
  if (mode === 'recorded') return new FakeKmsSecretStore();
  if (mode === 'file') {
    const key = env.INTEGRATION_SECRET_STORE_KEY;
    assertIntegrationSecretStoreKey(key, env);
    return new EncryptedFileSecretStore({
      filePath:
        env.INTEGRATION_SECRET_STORE_FILE ?? './.data/integration-secrets.json',
      key,
    });
  }
  if (mode !== 'aws') {
    throw new Error(
      'INTEGRATION_SECRET_STORE_MODE must be recorded, file, or aws.',
    );
  }
  const kmsKeyId = env.AWS_SECRETS_KMS_KEY_ID;
  const region = env.AWS_REGION;
  if (!kmsKeyId || !region) {
    throw new Error(
      'AWS secret mode requires AWS_REGION and AWS_SECRETS_KMS_KEY_ID.'
    );
  }
  return new AwsSecretsManagerSecretStore({
    client: new SecretsManagerClient({ region }),
    kmsKeyId,
    prefix: env.AWS_SECRETS_PREFIX ?? 'meiye/integrations',
  });
}

export function feishuMcpAdapterFromEnv(env: RuntimeEnv): FeishuMcpAdapterPort {
  const mode = env.FEISHU_MCP_MODE ?? 'recorded';
  if (mode === 'recorded') {
    return new RecordedFeishuMcpAdapter(
      [
        recordedTool('feishu.doc.search', 'read', {
          query: { type: 'string' },
        }),
        recordedTool('feishu.doc.read', 'read', {
          documentId: { type: 'string' },
        }),
        recordedTool('feishu.doc.create', 'write', {
          title: { type: 'string' },
        }),
        recordedTool('feishu.doc.update', 'write', {
          documentId: { type: 'string' },
        }),
      ],
      { succeedByDefault: true }
    );
  }
  if (mode !== 'remote') {
    throw new Error('FEISHU_MCP_MODE must be recorded or remote.');
  }
  const endpoint = env.FEISHU_MCP_ENDPOINT;
  const catalogAllowedTools = (env.FEISHU_MCP_ALLOWED_TOOLS ?? '')
    .split(',')
    .map((tool) => tool.trim())
    .filter(Boolean);
  if (!endpoint) {
    throw new Error('Remote Feishu MCP mode requires FEISHU_MCP_ENDPOINT.');
  }
  return new AiSdkFeishuMcpAdapter({
    catalogAllowedTools,
    endpoint,
    reconcileToolId: env.FEISHU_MCP_RECONCILE_TOOL_ID,
    riskByTool: Object.fromEntries(
      catalogAllowedTools.map((tool) => [tool, 'open_world' as const])
    ),
  });
}

function recordedTool(
  id: string,
  risk: 'read' | 'write',
  properties: Record<string, unknown>
) {
  return {
    id,
    inputSchema: { properties, type: 'object' },
    remoteRevision: 'recorded-v1',
    risk,
    source: 'recorded://feishu-mcp',
  };
}

function parseByokModelBindings(value: string | undefined) {
  const bindings: Record<string, string> = {};
  for (const entry of value?.split(',') ?? []) {
    const [catalogModelId, providerModel, ...rest] = entry
      .split('=')
      .map((part) => part.trim());
    if (
      !catalogModelId ||
      !providerModel ||
      rest.length > 0 ||
      bindings[catalogModelId]
    ) {
      throw new Error(
        'BYOK_MODEL_BINDINGS must contain unique catalogModelId=providerModel entries.',
      );
    }
    bindings[catalogModelId] = providerModel;
  }
  if (Object.keys(bindings).length === 0) {
    throw new Error(
      'BYOK_MODEL_BINDINGS is required when BYOK_EXECUTION_MODE=live.',
    );
  }
  return bindings;
}
