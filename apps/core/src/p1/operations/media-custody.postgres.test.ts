import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { RecordedCanvasExportAdapter, RecordedImageGenerationAdapter } from './adapters.js';
import { OperationsApplicationService } from './application-service.js';
import { transitionContentPackage } from './content-package.js';
import { PostgresOperationsRepository } from './postgres-repository.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'rolls back Postgres custody references when an at-least-once object copy fails',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    const admin = new Pool({ connectionString });
    const schema = `media_custody_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const pool = new Pool({
      connectionString,
      options: `-c search_path=${schema},public`,
    });
    t.after(async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    });
    await pool.query(`
      CREATE TABLE "user" (
        id text PRIMARY KEY,
        name text NOT NULL,
        email text NOT NULL UNIQUE
      );
      CREATE TABLE workspaces (
        id text PRIMARY KEY,
        name text NOT NULL
      );
      CREATE TABLE workspace_memberships (
        workspace_id text NOT NULL,
        user_id text NOT NULL,
        role text NOT NULL DEFAULT 'owner',
        PRIMARY KEY (workspace_id, user_id)
      );
    `);
    const repository = new PostgresOperationsRepository(pool);
    await repository.migrate();
    const context = {
      actor: 'admin' as const,
      correlationId: 'custody-pg-rollback',
      userId: 'custody-admin',
      workspaceId: 'workspace-a',
    };
    await pool.query(
      `INSERT INTO "user" (id, name, email) VALUES ($1, 'Custody admin', $2)`,
      [context.userId, 'custody-admin@example.test']
    );
    await pool.query(
      `INSERT INTO workspaces (id, name) VALUES ($1, 'Custody workspace')`,
      [context.workspaceId]
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id) VALUES ($1, $2)`,
      [context.workspaceId, context.userId]
    );
    const copiedSourceIds: string[] = [];
    const operations = new OperationsApplicationService(repository, {
      canvasExporter: new RecordedCanvasExportAdapter(),
      imageGenerator: new RecordedImageGenerationAdapter(),
      mediaCustodyStorage: {
        async inspectOwned(input) {
          return input.assets.map((asset) => asset.id);
        },
        async copyToOwned(input) {
          copiedSourceIds.push(input.sourceAssetId);
          if (input.sourceAssetId === 'source-b') {
            throw new Error('simulated object copy failure');
          }
          return {
            contentType: 'image/jpeg',
            id: 'owned-source-a',
            objectKey: `${input.workspaceId}/owned/${'a'.repeat(64)}.jpg`,
            sha256: 'a'.repeat(64),
            sizeBytes: 3,
          };
        },
        async inspectSources(input) {
          return input.sourceAssetIds.map((sourceAssetId) => ({
            id: sourceAssetId,
            objectKey: `${input.workspaceId}/assets/${sourceAssetId}.jpg`,
          }));
        },
      },
      notifier: { async send() {} },
    });
    const created = await operations.createContentPackage(context, {
      kind: 'image_text',
      source: { assetIds: ['source-a', 'source-b'] },
    });
    const seeded = await repository.loadWorkspace(context.workspaceId);
    assert.ok(seeded);
    const packageIndex = seeded.contentPackages.findIndex(
      (contentPackage) => contentPackage.id === created.id
    );
    seeded.contentPackages[packageIndex] = transitionContentPackage(
      { ...created, status: 'review_ready' },
      {
        type: 'adopted',
        version: {
          body: 'Custody repair',
          createdAt: '2026-07-16T10:00:00.000Z',
          createdBy: context.userId,
          id: 'version-a',
          orderedAssetIds: ['source-a', 'source-b'],
          title: 'Custody repair',
          topics: [],
        },
      },
      '2026-07-16T10:00:00.000Z'
    );
    await repository.saveWorkspace(seeded);

    await assert.rejects(
      operations.repairMediaCustody(context, {
        packageId: created.id,
        versionId: 'version-a',
      }),
      /simulated object copy failure/u
    );

    assert.deepEqual(copiedSourceIds, ['source-a', 'source-b']);
    const rolledBack = await repository.loadWorkspace(context.workspaceId);
    const rolledBackPackage = rolledBack?.contentPackages.find(
      (contentPackage) => contentPackage.id === created.id
    );
    assert.deepEqual(rolledBackPackage?.versions[0]?.orderedAssetIds, [
      'source-a',
      'source-b',
    ]);
    assert.deepEqual(rolledBackPackage?.generated.assetIds, []);
    assert.deepEqual(rolledBackPackage?.generated.ownedAssets ?? [], []);
  }
);
