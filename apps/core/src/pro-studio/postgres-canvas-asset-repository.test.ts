import assert from 'node:assert/strict';
import test from 'node:test';
import type { Pool } from 'pg';
import { PostgresCanvasAssetRepository } from './postgres-canvas-asset-repository.js';

test('compare-and-swap rejects a stale PostgreSQL export-policy write after revocation', async () => {
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  let version = 1;
  const pool = {
    async query(sql: string, values: unknown[] = []) {
      queries.push({ sql, values });
      if (!sql.includes('UPDATE pro_studio_owned_assets')) return { rows: [] };
      if (values[3] !== String(version)) return { rows: [] };
      const exportPolicy = JSON.parse(String(values[2]));
      version = exportPolicy.version;
      return {
        rows: [
          {
            contentType: 'image/png',
            createdAt: '2026-07-23T00:00:00.000Z',
            exportPolicy,
            fileName: 'source.png',
            id: 'asset-1',
            legacyStorageKey: null,
            objectKey: 'workspace-1/canvas/assets/asset-1.png',
            sha256: 'a'.repeat(64),
            sizeBytes: 9,
            source: { kind: 'local_import' },
            workspaceId: 'workspace-1',
          },
        ],
      };
    },
  } as unknown as Pool;
  const repository = new PostgresCanvasAssetRepository(pool);
  const revokedPolicy = {
    exportAllowed: true,
    expiresAt: null,
    ownerId: 'user-1',
    privateRetrievalAllowed: true,
    revokedAt: '2026-07-23T01:00:00.000Z',
    updatedAt: '2026-07-23T01:00:00.000Z',
    version: 2,
    workspaceId: 'workspace-1',
  };

  const revoked = await repository.updateExportPolicy({
    assetId: 'asset-1',
    expectedVersion: 1,
    exportPolicy: revokedPolicy,
    workspaceId: 'workspace-1',
  });
  const staleClear = await repository.updateExportPolicy({
    assetId: 'asset-1',
    expectedVersion: 1,
    exportPolicy: { ...revokedPolicy, revokedAt: null },
    workspaceId: 'workspace-1',
  });

  assert.equal(revoked?.exportPolicy?.revokedAt, revokedPolicy.revokedAt);
  assert.equal(staleClear, null);
  assert.match(
    queries[0]?.sql ?? '',
    /export_policy->>'version' = \$4/u,
  );
  assert.equal(queries[0]?.values[3], '1');
  assert.equal(queries[1]?.values[3], '1');
});
