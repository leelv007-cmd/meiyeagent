import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeAdminFeishuToolRevisions } from './admin-feishu-view-model';

describe('admin Feishu tool view model', () => {
  it('keeps revision and compatibility evidence without exposing MCP schema internals', () => {
    const revisions = normalizeAdminFeishuToolRevisions([
      {
        compatibility: {
          reason: 'schema_root_must_be_object',
          status: 'incompatible',
        },
        discoveredAt: '2026-07-11T00:00:00.000Z',
        id: 'docx.v1.document.broken',
        inputSchema: { description: 'untrusted remote instruction' },
        remoteRevision: 'official-r2',
        revision: 'official-r2:abc',
        risk: 'read',
        schemaHash: 'a'.repeat(64),
        secret: 'must-not-leak',
        source: 'https://mcp.example.invalid/private',
        status: 'draft',
      },
    ]);

    assert.deepEqual(revisions, [
      {
        compatibility: {
          reason: 'schema_root_must_be_object',
          status: 'incompatible',
        },
        discoveredAt: '2026-07-11T00:00:00.000Z',
        id: 'docx.v1.document.broken',
        remoteRevision: 'official-r2',
        revision: 'official-r2:abc',
        risk: 'read',
        schemaHash: 'a'.repeat(64),
        status: 'draft',
      },
    ]);
    assert.equal(JSON.stringify(revisions).includes('untrusted'), false);
    assert.equal(JSON.stringify(revisions).includes('must-not-leak'), false);
  });
});
