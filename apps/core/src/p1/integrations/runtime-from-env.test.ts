import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  byokExecutionRuntimeFromEnv,
  feishuMcpAdapterFromEnv,
  integrationSecretStoreFromEnv,
} from './runtime-from-env.js';

test('recorded Feishu runtime exposes a usable deterministic product path', async () => {
  const adapter = feishuMcpAdapterFromEnv({ FEISHU_MCP_MODE: 'recorded' });
  const tools = await adapter.discover({ uat: 'recorded-uat' });
  assert.equal(tools.length, 4);

  const result = await adapter.call({
    allowedTools: ['feishu.doc.read'],
    arguments: { documentId: 'doc-a' },
    toolId: 'feishu.doc.read',
    uat: 'recorded-uat',
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.objectId, 'recorded-feishu-doc-read');
  assert.deepEqual(result.output, {
    adapter: 'recorded',
    arguments: { documentId: 'doc-a' },
    toolId: 'feishu.doc.read',
  });
});

test('remote Feishu discovery only requires the official endpoint', () => {
  assert.doesNotThrow(() =>
    feishuMcpAdapterFromEnv({
      FEISHU_MCP_ENDPOINT: 'https://mcp.feishu.cn/mcp',
      FEISHU_MCP_MODE: 'remote',
    })
  );
});

test('BYOK runtime defaults to recorded and live mode requires explicit model bindings', () => {
  const recorded = byokExecutionRuntimeFromEnv({});
  assert.equal(recorded.mode, 'recorded');
  assert.deepEqual(recorded.permittedModels, []);

  assert.throws(
    () => byokExecutionRuntimeFromEnv({ BYOK_EXECUTION_MODE: 'live' }),
    /BYOK_MODEL_BINDINGS/,
  );

  const live = byokExecutionRuntimeFromEnv({
    BYOK_EXECUTION_MODE: 'live',
    BYOK_MODEL_BINDINGS:
      'llm-domestic=deepseek-chat,llm-openai=gpt-4o-mini',
  });
  assert.equal(live.mode, 'live');
  assert.deepEqual(live.permittedModels, ['llm-domestic', 'llm-openai']);
});

test('file secret runtime survives a new process store instance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-secrets-'));
  const env = {
    INTEGRATION_SECRET_STORE_FILE: join(directory, 'secrets.json'),
    INTEGRATION_SECRET_STORE_KEY: 'a'.repeat(64),
    INTEGRATION_SECRET_STORE_MODE: 'file',
  };
  const context = {
    credentialId: 'credential-a',
    provider: 'model' as const,
    version: 1,
    workspaceId: 'workspace-a',
  };
  try {
    const first = integrationSecretStoreFromEnv(env);
    const secretRef = await first.put(context, 'persistent-secret');
    const restarted = integrationSecretStoreFromEnv(env);
    assert.equal(
      await restarted.use(secretRef, context),
      'persistent-secret',
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('default secret runtime is durable and survives a new process store instance', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'meiye-default-secrets-'));
  const env = {
    INTEGRATION_SECRET_STORE_FILE: join(directory, 'secrets.json'),
    INTEGRATION_SECRET_STORE_KEY: 'b'.repeat(64),
  };
  const context = {
    credentialId: 'credential-default',
    provider: 'model' as const,
    version: 1,
    workspaceId: 'workspace-default',
  };
  try {
    const first = integrationSecretStoreFromEnv(env);
    const secretRef = await first.put(context, 'persistent-by-default');
    const restarted = integrationSecretStoreFromEnv(env);
    assert.equal(
      await restarted.use(secretRef, context),
      'persistent-by-default',
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('default secret runtime fails closed when its durable key is missing', () => {
  assert.throws(
    () => integrationSecretStoreFromEnv({}),
    /INTEGRATION_SECRET_STORE_KEY/,
  );
});

test('file secret runtime refuses the all-zero fixture key outside development/e2e/test', () => {
  assert.throws(
    () =>
      integrationSecretStoreFromEnv({
        APP_ENV: 'production',
        INTEGRATION_SECRET_STORE_KEY:
          '0000000000000000000000000000000000000000000000000000000000000000',
        INTEGRATION_SECRET_STORE_MODE: 'file',
      }),
    /all-zero fixture key/,
  );
});
