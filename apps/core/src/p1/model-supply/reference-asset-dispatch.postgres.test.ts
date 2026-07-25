import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import type { ProductState } from '@meiye/contracts';
import { Pool } from 'pg';
import { PostgresProductRepository } from '../../product/postgres-repository.js';
import { createCanvasOwnedAssetExportPolicy } from '../../pro-studio/canvas-asset-facade.js';
import { PostgresCanvasAssetRepository } from '../../pro-studio/postgres-canvas-asset-repository.js';
import { PostgresProStudioMigration } from '../../pro-studio/postgres-pro-studio-migration.js';
import { ModelSupplyComposerRouteResolver } from '../execution-spine/composer-route-resolver.js';
import { withServerDerivedReferenceDataClass } from './reference-asset-dispatch-guard.js';
import {
  OwnedAssetReferenceResolver,
  ProductReferenceAssetPolicyResolver,
} from './reference-asset-resolver.js';
import type { ModelSupplySubmission } from './route-contracts.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  'Postgres dispatch rechecks revocation and rejects expired, cross-workspace, and sensitive routes',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const workspaceId = `t15-${randomUUID()}`;
    const otherWorkspaceId = `t15-other-${randomUUID()}`;
    const assets = new PostgresCanvasAssetRepository(pool);
    const products = new PostgresProductRepository(pool);
    const bytes = Uint8Array.from(Buffer.from('t15-owned-reference'));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const basePolicy = createCanvasOwnedAssetExportPolicy({
      ownerId: 'user-t15',
      updatedAt: '2026-07-26T00:00:00.000Z',
      workspaceId,
    });
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id text PRIMARY KEY,
          name text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await pool.query(
        `INSERT INTO workspaces (id, name) VALUES ($1, 'T15'), ($2, 'T15 other')`,
        [workspaceId, otherWorkspaceId],
      );
      const client = await pool.connect();
      try {
        await new PostgresProStudioMigration().migrate(client);
      } finally {
        client.release();
      }
      await products.migrate();
      await products.save({
        workspaceId,
        assets: [
          {
            aigcStatus: 'not_ai',
            authorizationStatus: 'authorized',
            consentScope: 'public_marketing',
            containsPerson: true,
            containsSensitiveData: true,
            createdAt: '2026-07-26T00:00:00.000Z',
            id: 'product-sensitive',
            mediaType: 'image',
            minorStatus: 'none',
            objectKey: `${workspaceId}/assets/${sha256}.png`,
            replacementRequired: false,
            rightsEvidence: 'owner-consent',
            rightsNoFixedExpiry: true,
            rightsOwner: 'merchant',
            rightsPlatforms: ['xiaohongshu'],
            sourceType: 'real',
            tags: [],
          },
        ],
        store: { regulated: true },
      } as unknown as ProductState);
      await assets.insert({
        contentType: 'image/png',
        createdAt: '2026-07-26T00:00:00.000Z',
        exportPolicy: basePolicy,
        fileName: 'sensitive.png',
        id: 'owned-sensitive',
        objectKey: `${workspaceId}/canvas/assets/sensitive.png`,
        sha256,
        sizeBytes: bytes.byteLength,
        source: {
          kind: 'product_asset',
          sourceAssetId: 'product-sensitive',
        },
        workspaceId,
      });
      await assets.insert({
        contentType: 'image/png',
        createdAt: '2026-07-26T00:00:00.000Z',
        exportPolicy: {
          ...basePolicy,
          expiresAt: '2026-07-25T23:59:59.000Z',
        },
        fileName: 'expired.png',
        id: 'owned-expired',
        objectKey: `${workspaceId}/canvas/assets/expired.png`,
        sha256,
        sizeBytes: bytes.byteLength,
        source: { kind: 'local_import' },
        workspaceId,
      });

      let revokeDuringRead = false;
      const resolver = new OwnedAssetReferenceResolver(
        assets,
        {
          async read() {
            if (revokeDuringRead) {
              await assets.updateExportPolicy({
                assetId: 'owned-sensitive',
                expectedVersion: 1,
                exportPolicy: {
                  ...basePolicy,
                  revokedAt: '2026-07-26T01:00:00.000Z',
                  updatedAt: '2026-07-26T01:00:00.000Z',
                  version: 2,
                },
                workspaceId,
              });
            }
            return bytes;
          },
        },
        {
          clock: () => new Date('2026-07-26T02:00:00.000Z'),
          productPolicyResolver: new ProductReferenceAssetPolicyResolver(
            products,
            () => new Date('2026-07-26T02:00:00.000Z'),
          ),
        },
      );

      assert.deepEqual(await resolver.inspect(workspaceId, ['owned-expired']), [
        {
          assetId: 'owned-expired',
          kind: 'failure',
          reason: 'rights_incomplete',
        },
      ]);
      assert.deepEqual(
        await resolver.inspect(otherWorkspaceId, ['owned-sensitive']),
        [
          {
            assetId: 'owned-sensitive',
            kind: 'failure',
            reason: 'not_found',
          },
        ],
      );

      const guarded = await withServerDerivedReferenceDataClass(
        submission(workspaceId),
        resolver,
      );
      assert.deepEqual(guarded.dataClass, [
        'contains_face',
        'medical',
        'pii',
      ]);
      const routeResolver = new ModelSupplyComposerRouteResolver(
        {
          async freezeFixedRouteForExecution(input) {
            assert.deepEqual(input.dataClass, [
              'contains_face',
              'medical',
              'pii',
            ]);
            throw new Error('No compliant sensitive route.');
          },
        },
        {
          async getRouteSnapshot() {
            return null;
          },
          async insertRouteSnapshot() {
            assert.fail('an invalid sensitive route must not be stored');
          },
        },
      );
      await assert.rejects(
        routeResolver.resolve({
          catalogModel: { id: 'model-image', revision: 'catalog-r1' },
          dataClass: guarded.dataClass,
          operation: 'image.generate',
          workspaceId,
        }),
        /No compliant sensitive route/u,
      );

      revokeDuringRead = true;
      let externalSends = 0;
      const [resolution] = await resolver.resolve(workspaceId, [
        'owned-sensitive',
      ]);
      if (resolution?.kind === 'resolved') externalSends += 1;
      assert.deepEqual(resolution, {
        assetId: 'owned-sensitive',
        kind: 'failure',
        reason: 'authorization_withdrawn',
      });
      assert.equal(externalSends, 0);
    } finally {
      await pool.query('DELETE FROM product_states WHERE workspace_id = $1', [
        workspaceId,
      ]);
      await pool.query('DELETE FROM workspaces WHERE id = ANY($1::text[])', [
        [workspaceId, otherWorkspaceId],
      ]);
      await pool.end();
    }
  },
);

function submission(workspaceId: string): ModelSupplySubmission {
  return {
    actorId: 'user-t15',
    dataClass: [],
    idempotencyKey: 't15-sensitive-route',
    input: {
      inputAssets: [
        { assetId: 'owned-sensitive', role: 'reference_image' },
      ],
    },
    operation: 'image.edit',
    prompt: 'Use the selected source.',
    selection: { catalogModelId: 'model-image', mode: 'fixed' },
    workspaceId,
  };
}
