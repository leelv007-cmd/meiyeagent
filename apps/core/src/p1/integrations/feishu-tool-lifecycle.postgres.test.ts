import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import {
  FakeKmsSecretStore,
  IntegrationApplicationService,
  PostgresIntegrationRepository,
  RecordedFeishuMcpAdapter,
} from './index.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Postgres Feishu catalog lifecycle survives service restart without duplicate revisions or shortcut drift',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const workspaceId = `feishu-lifecycle-${suffix}`;
    const connectionId = `feishu-${suffix}`;
    const readToolId = `docx.v1.document.read.${suffix}`;
    const createToolId = `docx.v1.document.create.${suffix}`;
    const repository = new PostgresIntegrationRepository(pool);
    const secrets = new FakeKmsSecretStore();
    const feishu = new RecordedFeishuMcpAdapter([
      tool(readToolId, 'official-r1', 'read', false),
    ]);
    await repository.migrate();
    t.after(async () => {
      await repository.deleteWorkspaceFacts(workspaceId);
      await pool.query(
        'DELETE FROM integration_tool_revisions WHERE tool_id = ANY($1::text[])',
        [[readToolId, createToolId]]
      );
      await pool.end();
    });
    const owner = {
      correlationId: `verify-${suffix}`,
      role: 'owner' as const,
      userId: `owner-${suffix}`,
      workspaceId,
    };
    const service = new IntegrationApplicationService({
      feishu,
      repository,
      secrets,
    });
    await service.createConnection(
      owner,
      {
        credential: {
          scope: ['docx:document'],
          value: `recorded-uat-${suffix}`,
        },
        grantedCapabilities: ['mcp.tools'],
        id: connectionId,
        identityMode: 'oauth_user',
        provider: 'feishu',
        requestedCapabilities: ['mcp.tools'],
      },
      `create-${suffix}`
    );
    await service.verifyFeishuConnection(owner, connectionId);
    await service.setFeishuShortcuts(owner, connectionId, [
      { hidden: false, order: 3, toolId: readToolId },
    ]);

    feishu.setTools([
      tool(readToolId, 'official-r2', 'read', true),
      tool(createToolId, 'official-r1', 'write', false),
    ]);
    const restarted = new IntegrationApplicationService({
      feishu,
      repository: new PostgresIntegrationRepository(pool),
      secrets,
    });
    const first = await restarted.runFeishuToolLifecycle({
      correlationId: `lifecycle-${suffix}`,
      role: 'worker',
      userId: 'feishu-tool-lifecycle-worker',
      workspaceId: '__system__',
    });
    const replayedAfterRestart =
      await new IntegrationApplicationService({
        feishu,
        repository: new PostgresIntegrationRepository(pool),
        secrets,
      }).runFeishuToolLifecycle({
        correlationId: `lifecycle-replay-${suffix}`,
        role: 'worker',
        userId: 'feishu-tool-lifecycle-worker',
        workspaceId: '__system__',
      });

    assert.equal(first.publishedRevisionCount, 2);
    assert.equal(replayedAfterRestart.publishedRevisionCount, 0);
    assert.deepEqual(
      await restarted.listFeishuShortcuts(owner, connectionId),
      [{ hidden: false, order: 3, toolId: readToolId }]
    );
    const catalog = await restarted.listFeishuToolRevisionCatalog({
      ...owner,
      role: 'admin',
    });
    assert.equal(
      catalog.filter(
        (revision) =>
          revision.id === readToolId && revision.status === 'published'
      ).length,
      1
    );
    assert.equal(
      catalog.filter(
        (revision) =>
          revision.id === createToolId && revision.status === 'published'
      ).length,
      1
    );
  }
);

function tool(
  id: string,
  remoteRevision: string,
  risk: 'read' | 'write',
  strict: boolean
) {
  return {
    id,
    inputSchema: {
      ...(strict ? { additionalProperties: false } : {}),
      properties: { document_id: { type: 'string' } },
      type: 'object',
    },
    remoteRevision,
    risk,
    source: 'recorded://feishu',
  };
}
