import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import type { ProductCommand } from '@meiye/contracts';
import { insertNewAccountWriteOwnership } from '../p1/foundation/write-ownership.js';
import { PostgresProductRepository } from './postgres-repository.js';
import { ProductService } from './product-service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

const SHARED_HASH = 'c'.repeat(64);

function addAssetCommand(
  workspaceId: string,
  overrides: Partial<Extract<ProductCommand, { type: 'add_asset' }>['asset']>
): Extract<ProductCommand, { type: 'add_asset' }> {
  return {
    type: 'add_asset',
    asset: {
      category: 'other',
      consentScope: 'internal_only',
      containsPerson: false,
      containsSensitiveData: false,
      id: 'asset-page',
      mediaType: 'image',
      minorStatus: 'none',
      objectKey: `${workspaceId}/assets/user-a/${SHARED_HASH}.png`,
      rightsOwner: '盘点美发',
      sourceType: 'real',
      tags: [],
      ...overrides,
    },
  };
}

describe(
  'V31-87 same-content reupload persistence',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' },
  () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const workspaceId = `workspace-lane87-${randomUUID()}`;
    const userId = `user-lane87-${randomUUID()}`;
    const repository = new PostgresProductRepository(pool);
    const context = {
      actor: 'user' as const,
      correlationId: 'corr-lane87-reupload',
      userId,
      workspaceId,
    };

    before(async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "user" (
          id text PRIMARY KEY,
          name text NOT NULL,
          email text NOT NULL UNIQUE,
          email_verified boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS workspaces (
          id text PRIMARY KEY,
          name text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS workspace_memberships (
          workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          user_id text NOT NULL,
          role text NOT NULL DEFAULT 'owner',
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (workspace_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS content_package_write_ownership (
          workspace_id text PRIMARY KEY,
          owner text NOT NULL CHECK (owner IN ('legacy', 'frozen', 'contentpackage')),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      await repository.migrate();
      await pool.query(
        `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, false, now(), now())`,
        [userId, 'Lane87 reupload user', `${userId}@example.test`]
      );
      await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [
        workspaceId,
        'Lane87 reupload',
      ]);
      await pool.query(
        'INSERT INTO workspace_memberships (workspace_id, user_id) VALUES ($1, $2)',
        [workspaceId, userId]
      );
      await insertNewAccountWriteOwnership(pool, workspaceId);
    });

    after(async () => {
      await pool.query(
        'DELETE FROM product_command_results WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query('DELETE FROM product_states WHERE workspace_id = $1', [
        workspaceId,
      ]);
      await pool.query(
        'DELETE FROM p1_write_ownership WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query(
        'DELETE FROM content_package_write_ownership WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query(
        'DELETE FROM workspace_memberships WHERE workspace_id = $1',
        [workspaceId]
      );
      await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceId]);
      await pool.query('DELETE FROM "user" WHERE id = $1', [userId]);
      await pool.end();
    });

    it('keeps one asset after a cross-surface reupload and keeps the latest facts', async () => {
      const service = new ProductService({
        acceptedWriteOwner: 'p1',
        repository,
      });
      const objectKey = `${workspaceId}/assets/user-a/${SHARED_HASH}.png`;

      await service.execute(
        context,
        addAssetCommand(workspaceId, {
          category: 'other',
          id: 'asset-from-library',
          rightsOwner: '盘点美发',
        }),
        'asset-register:library-page'
      );
      await service.execute(
        context,
        {
          type: 'authorize_asset',
          assetId: 'asset-from-library',
          consentScope: 'public_marketing',
          rightsEvidence: 'owner-consent-library',
          rightsNoFixedExpiry: true,
          rightsPlatforms: ['xiaohongshu'],
        },
        'asset-authorize:library-page'
      );

      const reused = await service.execute(
        context,
        addAssetCommand(workspaceId, {
          category: 'customer_case',
          id: 'asset-from-composer',
          rightsOwner: '顾客本人',
          tags: ['v31-87-case.png'],
        }),
        'asset-register:composer-inline'
      );
      const authorized = await service.execute(
        context,
        {
          type: 'authorize_asset',
          assetId: 'asset-from-library',
          consentScope: 'public_marketing',
          rightsEvidence: 'owner-consent-composer',
          rightsNoFixedExpiry: false,
          rightsPlatforms: ['douyin'],
          rightsValidUntil: '2027-08-13T00:00:00.000Z',
        },
        'asset-authorize:composer-inline'
      );

      const matching = authorized.state.assets.filter(
        (asset) => asset.objectKey === objectKey
      );
      assert.equal(matching.length, 1);
      assert.equal(matching[0]?.id, 'asset-from-library');
      assert.equal(matching[0]?.category, 'customer_case');
      assert.equal(matching[0]?.rightsOwner, '顾客本人');
      assert.deepEqual(matching[0]?.tags, ['v31-87-case.png']);
      assert.deepEqual(matching[0]?.rightsPlatforms, ['douyin']);
      assert.equal(matching[0]?.rightsValidUntil, '2027-08-13T00:00:00.000Z');
      assert.equal(matching[0]?.authorizationStatus, 'authorized');
      assert.equal(reused.state.assets.length, 1);
    });
  }
);
